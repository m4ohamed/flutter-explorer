import * as fs from 'fs';
import * as path from 'path';
import { backupFile, writeFileAtomic } from './utils/configWriter';

export interface UnusedKeyResult {
  key: string;
  definedInFiles: string[];
}

export interface IcuIssue {
  key: string;
  file: string;
  type: 'syntax_error' | 'mismatched_placeholders' | 'missing_metadata_placeholder' | 'missing_other_branch';
  message: string;
}

export interface MissingTranslationEntry {
  key: string;
  sourceLocale: string;
  sourceValue: string;
  description?: string;
  placeholders?: Record<string, any>;
  missingInLocales: string[];
}

/** Thrown when an ARB file exists but is not valid JSON. Writes are aborted instead of clobbering it. */
export class ArbParseError extends Error {
  constructor(public readonly file: string, reason: string) {
    super(`Cannot parse ${file}: ${reason}`);
    this.name = 'ArbParseError';
  }
}

type ArbData = Record<string, any>;

interface LoadedArb {
  file: string;
  data: ArbData;
  locale: string;
  dirty: boolean;
}

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'build', '.dart_tool', '.flutter-explorer', '.idea', '.vscode',
  'ios', 'android', 'macos', 'windows', 'linux', 'Pods', '.symlinks', 'out', 'dist',
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Generated localisation code that references every key and must not count as "usage". */
const GENERATED_DART = [
  /(^|\/)generated\//,
  /(^|\/)l10n\.dart$/,
  /(^|\/)app_localizations[^/]*\.dart$/,
  /(^|\/)messages_[^/]*\.dart$/,
  /\.g\.dart$/,
  /\.freezed\.dart$/,
  /\.gr\.dart$/,
];

export class ArbEditor {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // ─── Discovery & IO ────────────────────────────────────────────────────────

  public findArbFiles(): string[] {
    const found = new Set<string>();
    const visited = new Set<string>();
    const MAX_DEPTH = 8;

    const walk = (dir: string, depth: number): void => {
      if (depth > MAX_DEPTH || visited.has(dir)) { return; }
      visited.add(dir);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) { continue; }
          walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile() && entry.name.endsWith('.arb')) {
          found.add(path.relative(this.projectRoot, path.join(dir, entry.name)).replace(/\\/g, '/'));
        }
      }
    };

    walk(this.projectRoot, 0);
    return Array.from(found).sort();
  }

  private fullPath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
  }

  /** Strict read: missing file => {}, invalid JSON => ArbParseError. */
  public readArbStrict(filePath: string): ArbData {
    const full = this.fullPath(filePath);
    if (!fs.existsSync(full)) { return {}; }
    const text = fs.readFileSync(full, 'utf-8').replace(/^\uFEFF/, '');
    if (text.trim() === '') { return {}; }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ArbParseError(filePath, (err as Error).message);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ArbParseError(filePath, 'top level value is not a JSON object');
    }
    return parsed as ArbData;
  }

  /**
   * Tolerant read for read-only analysis: invalid files read as {}.
   * Never use the result of this method to write a file back.
   */
  public readArb(filePath: string): ArbData {
    try {
      return this.readArbStrict(filePath);
    } catch {
      return {};
    }
  }

  /** Atomic write that keeps the file's indentation, line endings and trailing newline, with a backup. */
  public writeArb(filePath: string, data: ArbData): void {
    const full = this.fullPath(filePath);
    let indent: string | number = 2;
    let eol = '\n';
    let trailingNewline = true;
    if (fs.existsSync(full)) {
      const old = fs.readFileSync(full, 'utf-8');
      const m = /^([ \t]+)"/m.exec(old);
      if (m) { indent = m[1].includes('\t') ? '\t' : m[1].length; }
      if (old.includes('\r\n')) { eol = '\r\n'; }
      trailingNewline = old.length === 0 ? true : /\n$/.test(old);
      backupFile(full);
    }
    let out = JSON.stringify(data, null, indent);
    if (eol !== '\n') { out = out.replace(/\n/g, eol); }
    if (trailingNewline) { out += eol; }
    writeFileAtomic(full, out);
  }

  /**
   * Extracts locale code from an ARB file path or file content (e.g. app_ar.arb -> ar)
   */
  public extractLocale(arbFilePath: string, fileContent?: Record<string, any>): string {
    if (fileContent && fileContent['@@locale']) {
      return fileContent['@@locale'];
    }

    const baseName = path.basename(arbFilePath, '.arb');
    // Patterns: app_en, intl_en_US, messages_ar, en, ar
    const match = baseName.match(/^(?:.*[_-])?([a-z]{2}(?:[_-][A-Z]{2})?)$/);
    if (match) {
      return match[1].replace('-', '_');
    }
    return baseName;
  }

  private loadAllStrict(files: string[]): LoadedArb[] {
    return files.map(file => {
      const data = this.readArbStrict(file);
      return { file, data, locale: this.extractLocale(file, data), dirty: false };
    });
  }

  private loadAllTolerant(files: string[]): { loaded: LoadedArb[]; unreadable: string[] } {
    const loaded: LoadedArb[] = [];
    const unreadable: string[] = [];
    for (const file of files) {
      try {
        const data = this.readArbStrict(file);
        loaded.push({ file, data, locale: this.extractLocale(file, data), dirty: false });
      } catch {
        unreadable.push(file);
      }
    }
    return { loaded, unreadable };
  }

  private flush(loaded: LoadedArb[]): string[] {
    const written: string[] = [];
    for (const item of loaded) {
      if (item.dirty) {
        this.writeArb(item.file, item.data);
        written.push(item.file);
      }
    }
    return written;
  }

  // ─── Writing translations ──────────────────────────────────────────────────

  private static validateKey(key: string): string | null {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) {
      return `Invalid translation key "${key}": use letters, digits and underscores only, starting with a letter or underscore.`;
    }
    return null;
  }

  private static normalizeLocaleMap(
    valuesOrAr: string | Record<string, string>,
    enValue?: string,
  ): Record<string, string> {
    const map: Record<string, string> = {};
    const add = (loc: string, val: unknown): void => {
      if (typeof val === 'string' && val.trim() !== '') { map[loc] = val; }
    };
    if (valuesOrAr && typeof valuesOrAr === 'object') {
      for (const [loc, val] of Object.entries(valuesOrAr)) { add(loc, val); }
    } else {
      add('ar', valuesOrAr);
      add('en', enValue);
    }
    return map;
  }

  private static matchLocale(fileLocale: string, localeMap: Record<string, string>): string | undefined {
    const fl = fileLocale.toLowerCase().replace('-', '_');
    for (const [loc, val] of Object.entries(localeMap)) {
      const cleanLoc = loc.toLowerCase().replace('-', '_');
      if (fl === cleanLoc || fl.startsWith(cleanLoc + '_') || cleanLoc.startsWith(fl + '_')) {
        return val;
      }
    }
    return undefined;
  }

  /** Apply one key to the in-memory files. Returns the files that received a value and those that did not. */
  private applyKey(
    loaded: LoadedArb[],
    key: string,
    localeMap: Record<string, string>,
    description?: string,
    placeholders?: Record<string, any>,
  ): { updated: string[]; skipped: string[] } {
    const updated: string[] = [];
    const skipped: string[] = [];
    const firstValue = Object.values(localeMap)[0];

    for (const item of loaded) {
      let value = ArbEditor.matchLocale(item.locale, localeMap);
      // A project with a single ARB file cannot be matched by locale: use the (only) value given.
      if (value === undefined && loaded.length === 1) { value = firstValue; }

      if (value === undefined) {
        // Old behaviour wrote the English (or first) value into every other locale, which hid the
        // key from the "missing translations" report and put the wrong language in the file.
        skipped.push(item.file);
        continue;
      }

      item.data[key] = value;
      const metaKey = `@${key}`;
      if (description || placeholders) {
        if (!item.data[metaKey] || typeof item.data[metaKey] !== 'object') { item.data[metaKey] = {}; }
        if (description) { item.data[metaKey].description = description; }
        if (placeholders) { item.data[metaKey].placeholders = placeholders; }
      }
      item.dirty = true;
      updated.push(item.file);
    }
    return { updated, skipped };
  }

  /**
   * Fully dynamic translation update supporting ANY locale or legacy ar/en strings.
   * Files whose locale has no value in the request are left untouched (see `skippedFiles`).
   */
  public updateTranslation(
    key: string,
    valuesOrAr: string | Record<string, string>,
    enValue?: string,
    description?: string,
    placeholders?: Record<string, any>
  ): { success: boolean; message: string; updatedFiles: string[]; skippedFiles?: string[] } {
    const keyError = ArbEditor.validateKey(key);
    if (keyError) { return { success: false, message: keyError, updatedFiles: [] }; }

    const arbFiles = this.findArbFiles();
    if (arbFiles.length === 0) {
      return { success: false, message: 'No ARB files found in the project', updatedFiles: [] };
    }

    const localeMap = ArbEditor.normalizeLocaleMap(valuesOrAr, enValue);
    if (Object.keys(localeMap).length === 0) {
      return { success: false, message: `No non-empty translation values were provided for "${key}"`, updatedFiles: [] };
    }

    let loaded: LoadedArb[];
    try {
      loaded = this.loadAllStrict(arbFiles);
    } catch (err) {
      if (err instanceof ArbParseError) {
        return {
          success: false,
          message: `${err.message}. Nothing was written; fix the file first so no translations are lost.`,
          updatedFiles: [],
        };
      }
      throw err;
    }

    const { updated, skipped } = this.applyKey(loaded, key, localeMap, description, placeholders);
    this.flush(loaded);

    return {
      success: updated.length > 0,
      message: updated.length > 0
        ? `Translation key "${key}" updated in ${updated.length} file(s) (${Object.keys(localeMap).join(', ')})` +
          (skipped.length > 0 ? `; left untouched (no value for their locale): ${skipped.join(', ')}` : '')
        : `No ARB file matched the locales provided (${Object.keys(localeMap).join(', ')}). Nothing was written.`,
      updatedFiles: updated,
      skippedFiles: skipped,
    };
  }

  public getAllTranslations(): {
    files: string[];
    keys: string[];
    locales: string[];
    missingKeys: { file: string; locale: string; keys: string[] }[];
    unreadableFiles?: string[];
  } {
    const arbFiles = this.findArbFiles();
    const { loaded, unreadable } = this.loadAllTolerant(arbFiles);
    const allKeys = new Set<string>();
    const fileKeys = new Map<string, { locale: string; keys: Set<string> }>();
    const allLocales = new Set<string>();

    for (const item of loaded) {
      allLocales.add(item.locale);
      const keys = new Set<string>();
      for (const key of Object.keys(item.data)) {
        if (!key.startsWith('@')) {
          allKeys.add(key);
          keys.add(key);
        }
      }
      fileKeys.set(item.file, { locale: item.locale, keys });
    }

    const missingKeys: { file: string; locale: string; keys: string[] }[] = [];
    for (const [file, { locale, keys }] of fileKeys.entries()) {
      const missing: string[] = [];
      for (const key of allKeys) {
        if (!keys.has(key)) { missing.push(key); }
      }
      if (missing.length > 0) { missingKeys.push({ file, locale, keys: missing }); }
    }

    const result: {
      files: string[]; keys: string[]; locales: string[];
      missingKeys: { file: string; locale: string; keys: string[] }[];
      unreadableFiles?: string[];
    } = {
      files: arbFiles,
      keys: Array.from(allKeys).sort(),
      locales: Array.from(allLocales).sort(),
      missingKeys,
    };
    if (unreadable.length > 0) { result.unreadableFiles = unreadable; }
    return result;
  }

  public deleteTranslation(key: string): { success: boolean; message: string; deletedFrom: string[] } {
    const keyError = ArbEditor.validateKey(key);
    if (keyError) { return { success: false, message: keyError, deletedFrom: [] }; }

    let loaded: LoadedArb[];
    try {
      loaded = this.loadAllStrict(this.findArbFiles());
    } catch (err) {
      if (err instanceof ArbParseError) {
        return { success: false, message: `${err.message}. Nothing was changed.`, deletedFrom: [] };
      }
      throw err;
    }

    for (const item of loaded) {
      if (item.data[key] !== undefined) { delete item.data[key]; item.dirty = true; }
      if (item.data[`@${key}`] !== undefined) { delete item.data[`@${key}`]; item.dirty = true; }
    }
    const deletedFrom = this.flush(loaded);

    if (deletedFrom.length === 0) {
      return { success: false, message: `Key "${key}" not found in any ARB file`, deletedFrom: [] };
    }
    return { success: true, message: `Key "${key}" deleted from ${deletedFrom.length} files`, deletedFrom };
  }

  // ─── Detect unused translations ────────────────────────────────────────────

  /**
   * Scans the hand-written Dart code in lib/ to find ARB keys that are never referenced.
   * Generated localisation files (l10n.dart, messages_*.dart, app_localizations*.dart, *.g.dart, ...)
   * are skipped: they define every key, so scanning them made every key look "used".
   */
  public findUnusedTranslations(): {
    totalKeys: number;
    unusedKeysCount: number;
    unusedKeys: UnusedKeyResult[];
    scannedFiles: number;
    unreadableFiles?: string[];
  } {
    const { loaded, unreadable } = this.loadAllTolerant(this.findArbFiles());
    const keyToFileMap = new Map<string, string[]>();
    for (const item of loaded) {
      for (const k of Object.keys(item.data)) {
        if (!k.startsWith('@')) {
          if (!keyToFileMap.has(k)) { keyToFileMap.set(k, []); }
          keyToFileMap.get(k)!.push(item.file);
        }
      }
    }

    const allKeys = Array.from(keyToFileMap.keys());
    const base: { totalKeys: number; unusedKeysCount: number; unusedKeys: UnusedKeyResult[]; scannedFiles: number; unreadableFiles?: string[] } =
      { totalKeys: allKeys.length, unusedKeysCount: 0, unusedKeys: [], scannedFiles: 0 };
    if (unreadable.length > 0) { base.unreadableFiles = unreadable; }
    if (allKeys.length === 0) { return base; }

    // One pass over the source: collect every identifier / word once, then do O(1) lookups.
    const tokens = new Set<string>();
    const tokenRe = /[A-Za-z_$][\w$]*/g;
    let scanned = 0;
    const libDir = path.join(this.projectRoot, 'lib');

    const scan = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) { scan(full); }
        } else if (entry.isFile() && entry.name.endsWith('.dart')) {
          const rel = path.relative(this.projectRoot, full).replace(/\\/g, '/');
          if (GENERATED_DART.some(re => re.test(rel))) { continue; }
          try {
            const text = fs.readFileSync(full, 'utf-8');
            scanned++;
            let m: RegExpExecArray | null;
            tokenRe.lastIndex = 0;
            while ((m = tokenRe.exec(text)) !== null) { tokens.add(m[0]); }
          } catch {
            // unreadable source file: ignore
          }
        }
      }
    };
    scan(libDir);

    const unusedKeys: UnusedKeyResult[] = [];
    for (const key of allKeys) {
      if (!tokens.has(key)) {
        unusedKeys.push({ key, definedInFiles: keyToFileMap.get(key) || [] });
      }
    }

    base.unusedKeysCount = unusedKeys.length;
    base.unusedKeys = unusedKeys;
    base.scannedFiles = scanned;
    return base;
  }

  // ─── ICU placeholders & plural validator ───────────────────────────────────

  /**
   * Validates ICU messages: syntax, `other` branch, placeholder parity between locales and
   * placeholders declared in `@key.placeholders` metadata of the source locale.
   */
  public validateIcuPlaceholders(): {
    valid: boolean;
    issuesCount: number;
    issues: IcuIssue[];
    unreadableFiles?: string[];
  } {
    const { loaded, unreadable } = this.loadAllTolerant(this.findArbFiles());
    const issues: IcuIssue[] = [];

    interface Parsed { file: string; locale: string; args: Set<string>; meta?: any }
    const byKey = new Map<string, Parsed[]>();

    for (const item of loaded) {
      for (const [k, val] of Object.entries(item.data)) {
        if (k.startsWith('@') || typeof val !== 'string') { continue; }
        const { args, errors } = parseIcuMessage(val);
        for (const e of errors) {
          issues.push({
            key: k,
            file: item.file,
            type: e.kind === 'other' ? 'missing_other_branch' : 'syntax_error',
            message: e.message,
          });
        }
        if (!byKey.has(k)) { byKey.set(k, []); }
        byKey.get(k)!.push({ file: item.file, locale: item.locale, args, meta: item.data[`@${k}`] });
      }
    }

    for (const [key, entries] of byKey.entries()) {
      if (entries.length === 0) { continue; }
      const baseline = entries.find(e => e.locale.toLowerCase() === 'en' || e.locale.toLowerCase().startsWith('en_')) ?? entries[0];

      for (const other of entries) {
        if (other === baseline) { continue; }
        const missing = Array.from(baseline.args).filter(x => !other.args.has(x));
        const extra = Array.from(other.args).filter(x => !baseline.args.has(x));
        if (missing.length > 0 || extra.length > 0) {
          issues.push({
            key,
            file: other.file,
            type: 'mismatched_placeholders',
            message: `Placeholders mismatch with ${baseline.file}: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`,
          });
        }
      }

      const meta = baseline.meta;
      if (meta && meta.placeholders && typeof meta.placeholders === 'object') {
        const declared = Object.keys(meta.placeholders);
        for (const p of baseline.args) {
          if (!declared.includes(p)) {
            issues.push({
              key,
              file: baseline.file,
              type: 'missing_metadata_placeholder',
              message: `Placeholder '{${p}}' is used in string but missing from '@${key}.placeholders' metadata`,
            });
          }
        }
      }
    }

    const result: { valid: boolean; issuesCount: number; issues: IcuIssue[]; unreadableFiles?: string[] } = {
      valid: issues.length === 0,
      issuesCount: issues.length,
      issues,
    };
    if (unreadable.length > 0) { result.unreadableFiles = unreadable; }
    return result;
  }

  // ─── AI auto-translate payload generator ───────────────────────────────────

  /**
   * Gathers all missing translations into a structured format ready for AI completion
   */
  public generateMissingTranslationsPayload(sourceLocale = 'en'): {
    sourceLocale: string;
    totalMissingEntries: number;
    entries: MissingTranslationEntry[];
    unreadableFiles?: string[];
  } {
    const { loaded, unreadable } = this.loadAllTolerant(this.findArbFiles());
    const filesByLocale = new Map<string, { file: string; data: ArbData }>();
    for (const item of loaded) {
      filesByLocale.set(item.locale.toLowerCase(), { file: item.file, data: item.data });
    }

    let source = filesByLocale.get(sourceLocale.toLowerCase());
    if (!source) {
      const first = loaded[0];
      if (first) {
        source = { file: first.file, data: first.data };
        sourceLocale = first.locale;
      }
    }

    const withUnreadable = <T extends object>(obj: T): T & { unreadableFiles?: string[] } =>
      unreadable.length > 0 ? { ...obj, unreadableFiles: unreadable } : obj;

    if (!source) {
      return withUnreadable({ sourceLocale, totalMissingEntries: 0, entries: [] as MissingTranslationEntry[] });
    }

    const sourceKeys = Object.entries(source.data).filter(([k]) => !k.startsWith('@'));
    const allLocales = Array.from(filesByLocale.keys()).filter(l => l !== sourceLocale.toLowerCase());
    const entries: MissingTranslationEntry[] = [];

    for (const [key, val] of sourceKeys) {
      const missingIn: string[] = [];
      for (const loc of allLocales) {
        const target = filesByLocale.get(loc);
        if (target && target.data[key] === undefined) { missingIn.push(loc); }
      }
      if (missingIn.length > 0) {
        const meta = source.data[`@${key}`];
        entries.push({
          key,
          sourceLocale,
          sourceValue: String(val),
          description: meta?.description,
          placeholders: meta?.placeholders,
          missingInLocales: missingIn,
        });
      }
    }

    return withUnreadable({ sourceLocale, totalMissingEntries: entries.length, entries });
  }

  /**
   * Batch applies multiple translated keys across locale files.
   * Files are read once, all keys are applied in memory and every changed file is written once.
   */
  public batchApplyTranslations(items: {
    key: string;
    translations: Record<string, string>;
    description?: string;
    placeholders?: Record<string, any>;
  }[]): { appliedCount: number; message: string; failedKeys?: string[] } {
    const arbFiles = this.findArbFiles();
    if (arbFiles.length === 0) {
      return { appliedCount: 0, message: 'No ARB files found in the project' };
    }

    let loaded: LoadedArb[];
    try {
      loaded = this.loadAllStrict(arbFiles);
    } catch (err) {
      if (err instanceof ArbParseError) {
        return { appliedCount: 0, message: `${err.message}. Nothing was written; fix the file first so no translations are lost.` };
      }
      throw err;
    }

    let count = 0;
    const failedKeys: string[] = [];
    for (const item of items) {
      const keyError = ArbEditor.validateKey(item.key);
      const localeMap = ArbEditor.normalizeLocaleMap(item.translations);
      if (keyError || Object.keys(localeMap).length === 0) {
        failedKeys.push(item.key);
        continue;
      }
      const { updated } = this.applyKey(loaded, item.key, localeMap, item.description, item.placeholders);
      if (updated.length > 0) { count++; } else { failedKeys.push(item.key); }
    }

    const written = this.flush(loaded);
    const result: { appliedCount: number; message: string; failedKeys?: string[] } = {
      appliedCount: count,
      message: `Successfully applied translations for ${count} of ${items.length} keys across ${written.length} ARB file(s).`,
    };
    if (failedKeys.length > 0) { result.failedKeys = failedKeys; }
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ICU message parser (just enough of MessageFormat to validate ARB strings)
// ─────────────────────────────────────────────────────────────────────────────

interface IcuError { kind: 'syntax' | 'other'; message: string }

export function parseIcuMessage(message: string): { args: Set<string>; errors: IcuError[] } {
  const args = new Set<string>();
  const errors: IcuError[] = [];
  let pos = 0;
  const s = message;

  const skipWs = (): void => { while (pos < s.length && /\s/.test(s[pos])) { pos++; } };

  /** Parses message text until the end (top level) or an unmatched '}' (inside a branch). */
  const parseText = (insideBranch: boolean): void => {
    while (pos < s.length) {
      const ch = s[pos];
      if (ch === "'") {
        if (s[pos + 1] === "'") { pos += 2; continue; }
        if (s[pos + 1] === '{' || s[pos + 1] === '}') {
          // quoted literal: '{' ... '
          pos++;
          while (pos < s.length) {
            if (s[pos] === "'") {
              if (s[pos + 1] === "'") { pos += 2; continue; }
              pos++;
              break;
            }
            pos++;
          }
          continue;
        }
        pos++;
        continue;
      }
      if (ch === '{') { pos++; parseArgument(); continue; }
      if (ch === '}') {
        if (insideBranch) { return; }
        errors.push({ kind: 'syntax', message: `Unmatched '}' at position ${pos}` });
        pos++;
        continue;
      }
      pos++;
    }
  };

  const readUntil = (stops: string): string => {
    const start = pos;
    while (pos < s.length && !stops.includes(s[pos])) { pos++; }
    return s.slice(start, pos).trim();
  };

  const parseArgument = (): void => {
    const argStart = pos - 1;
    const name = readUntil(',}');
    if (name === '') {
      errors.push({ kind: 'syntax', message: `Empty placeholder '{}' at position ${argStart}` });
    } else {
      args.add(name);
    }
    if (pos >= s.length) {
      errors.push({ kind: 'syntax', message: `Unclosed '{' at position ${argStart}` });
      return;
    }
    if (s[pos] === '}') { pos++; return; }

    // s[pos] === ','
    pos++;
    const type = readUntil(',}');
    if (pos >= s.length) {
      errors.push({ kind: 'syntax', message: `Unclosed '{' at position ${argStart}` });
      return;
    }

    if (type === 'plural' || type === 'select' || type === 'selectordinal') {
      if (s[pos] !== ',') {
        errors.push({ kind: 'syntax', message: `'${type}' argument '${name}' has no branches` });
        if (s[pos] === '}') { pos++; }
        return;
      }
      pos++;
      let hasOther = false;
      let closed = false;
      while (pos < s.length) {
        skipWs();
        if (pos >= s.length) { break; }
        if (s[pos] === '}') { pos++; closed = true; break; }
        const selector = readUntil('{}');
        if (s[pos] !== '{') {
          errors.push({ kind: 'syntax', message: `Expected '{' after '${selector}' in '${name}'` });
          if (s[pos] === '}') { pos++; closed = true; }
          break;
        }
        if (selector === 'other') { hasOther = true; }
        pos++; // consume '{'
        parseText(true);
        if (s[pos] === '}') {
          pos++;
        } else {
          errors.push({ kind: 'syntax', message: `Unclosed branch '${selector}' in '${name}'` });
          break;
        }
      }
      if (!closed && pos >= s.length) {
        errors.push({ kind: 'syntax', message: `Unclosed '{' for '${name}' at position ${argStart}` });
      }
      if (!hasOther && (type === 'plural' || type === 'select' || type === 'selectordinal')) {
        errors.push({ kind: 'other', message: `'${type}' argument '${name}' is missing the required 'other' branch` });
      }
      return;
    }

    // Simple typed argument such as {price, number, currency}: skip to the closing brace.
    let depth = 1;
    while (pos < s.length && depth > 0) {
      if (s[pos] === '{') { depth++; }
      else if (s[pos] === '}') { depth--; }
      pos++;
    }
    if (depth > 0) {
      errors.push({ kind: 'syntax', message: `Unclosed '{' at position ${argStart}` });
    }
  };

  parseText(false);
  return { args, errors };
}
