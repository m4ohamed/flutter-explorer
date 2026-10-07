"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/arbEditor.test.ts
var import_node_test = require("node:test");
var assert = __toESM(require("node:assert/strict"));
var fs3 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path3 = __toESM(require("path"));

// src/mcp-arb-editor.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// src/utils/configWriter.ts
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
function defaultBackupDir() {
  return path.join(os.homedir(), ".flutter-explorer", "backups");
}
function writeFileAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
    }
    throw err;
  }
}
function backupFile(filePath, backupDir = defaultBackupDir()) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    fs.mkdirSync(backupDir, { recursive: true });
    const safeName = filePath.replace(/[:\\/]+/g, "_").replace(/^_+/, "");
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const target = path.join(backupDir, `${stamp}__${safeName}.bak`);
    fs.copyFileSync(filePath, target);
    const suffix = `__${safeName}.bak`;
    const copies = fs.readdirSync(backupDir).filter((f) => f.endsWith(suffix)).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - 10))) {
      try {
        fs.unlinkSync(path.join(backupDir, old));
      } catch {
      }
    }
    return target;
  } catch {
    return null;
  }
}

// src/mcp-arb-editor.ts
var ArbParseError = class extends Error {
  constructor(file, reason) {
    super(`Cannot parse ${file}: ${reason}`);
    this.file = file;
    this.name = "ArbParseError";
  }
};
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "build",
  ".dart_tool",
  ".flutter-explorer",
  ".idea",
  ".vscode",
  "ios",
  "android",
  "macos",
  "windows",
  "linux",
  "Pods",
  ".symlinks",
  "out",
  "dist"
]);
var FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
var GENERATED_DART = [
  /(^|\/)generated\//,
  /(^|\/)l10n\.dart$/,
  /(^|\/)app_localizations[^/]*\.dart$/,
  /(^|\/)messages_[^/]*\.dart$/,
  /\.g\.dart$/,
  /\.freezed\.dart$/,
  /\.gr\.dart$/
];
var ArbEditor = class _ArbEditor {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }
  // ─── Discovery & IO ────────────────────────────────────────────────────────
  findArbFiles() {
    const found = /* @__PURE__ */ new Set();
    const visited = /* @__PURE__ */ new Set();
    const MAX_DEPTH = 8;
    const walk = (dir, depth) => {
      if (depth > MAX_DEPTH || visited.has(dir)) {
        return;
      }
      visited.add(dir);
      let entries;
      try {
        entries = fs2.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) {
            continue;
          }
          walk(path2.join(dir, entry.name), depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".arb")) {
          found.add(path2.relative(this.projectRoot, path2.join(dir, entry.name)).replace(/\\/g, "/"));
        }
      }
    };
    walk(this.projectRoot, 0);
    return Array.from(found).sort();
  }
  fullPath(filePath) {
    return path2.isAbsolute(filePath) ? filePath : path2.join(this.projectRoot, filePath);
  }
  /** Strict read: missing file => {}, invalid JSON => ArbParseError. */
  readArbStrict(filePath) {
    const full = this.fullPath(filePath);
    if (!fs2.existsSync(full)) {
      return {};
    }
    const text = fs2.readFileSync(full, "utf-8").replace(/^\uFEFF/, "");
    if (text.trim() === "") {
      return {};
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ArbParseError(filePath, err.message);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ArbParseError(filePath, "top level value is not a JSON object");
    }
    return parsed;
  }
  /**
   * Tolerant read for read-only analysis: invalid files read as {}.
   * Never use the result of this method to write a file back.
   */
  readArb(filePath) {
    try {
      return this.readArbStrict(filePath);
    } catch {
      return {};
    }
  }
  /** Atomic write that keeps the file's indentation, line endings and trailing newline, with a backup. */
  writeArb(filePath, data) {
    const full = this.fullPath(filePath);
    let indent = 2;
    let eol = "\n";
    let trailingNewline = true;
    if (fs2.existsSync(full)) {
      const old = fs2.readFileSync(full, "utf-8");
      const m = /^([ \t]+)"/m.exec(old);
      if (m) {
        indent = m[1].includes("	") ? "	" : m[1].length;
      }
      if (old.includes("\r\n")) {
        eol = "\r\n";
      }
      trailingNewline = old.length === 0 ? true : /\n$/.test(old);
      backupFile(full);
    }
    let out = JSON.stringify(data, null, indent);
    if (eol !== "\n") {
      out = out.replace(/\n/g, eol);
    }
    if (trailingNewline) {
      out += eol;
    }
    writeFileAtomic(full, out);
  }
  /**
   * Extracts locale code from an ARB file path or file content (e.g. app_ar.arb -> ar)
   */
  extractLocale(arbFilePath, fileContent) {
    if (fileContent && fileContent["@@locale"]) {
      return fileContent["@@locale"];
    }
    const baseName = path2.basename(arbFilePath, ".arb");
    const match2 = baseName.match(/^(?:.*[_-])?([a-z]{2}(?:[_-][A-Z]{2})?)$/);
    if (match2) {
      return match2[1].replace("-", "_");
    }
    return baseName;
  }
  loadAllStrict(files) {
    return files.map((file) => {
      const data = this.readArbStrict(file);
      return { file, data, locale: this.extractLocale(file, data), dirty: false };
    });
  }
  loadAllTolerant(files) {
    const loaded = [];
    const unreadable = [];
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
  flush(loaded) {
    const written = [];
    for (const item of loaded) {
      if (item.dirty) {
        this.writeArb(item.file, item.data);
        written.push(item.file);
      }
    }
    return written;
  }
  // ─── Writing translations ──────────────────────────────────────────────────
  static validateKey(key) {
    if (typeof key !== "string" || !KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) {
      return `Invalid translation key "${key}": use letters, digits and underscores only, starting with a letter or underscore.`;
    }
    return null;
  }
  static normalizeLocaleMap(valuesOrAr, enValue) {
    const map = {};
    const add = (loc, val) => {
      if (typeof val === "string" && val.trim() !== "") {
        map[loc] = val;
      }
    };
    if (valuesOrAr && typeof valuesOrAr === "object") {
      for (const [loc, val] of Object.entries(valuesOrAr)) {
        add(loc, val);
      }
    } else {
      add("ar", valuesOrAr);
      add("en", enValue);
    }
    return map;
  }
  static matchLocale(fileLocale, localeMap) {
    const fl = fileLocale.toLowerCase().replace("-", "_");
    for (const [loc, val] of Object.entries(localeMap)) {
      const cleanLoc = loc.toLowerCase().replace("-", "_");
      if (fl === cleanLoc || fl.startsWith(cleanLoc + "_") || cleanLoc.startsWith(fl + "_")) {
        return val;
      }
    }
    return void 0;
  }
  /** Apply one key to the in-memory files. Returns the files that received a value and those that did not. */
  applyKey(loaded, key, localeMap, description, placeholders) {
    const updated = [];
    const skipped = [];
    const firstValue = Object.values(localeMap)[0];
    for (const item of loaded) {
      let value = _ArbEditor.matchLocale(item.locale, localeMap);
      if (value === void 0 && loaded.length === 1) {
        value = firstValue;
      }
      if (value === void 0) {
        skipped.push(item.file);
        continue;
      }
      item.data[key] = value;
      const metaKey = `@${key}`;
      if (description || placeholders) {
        if (!item.data[metaKey] || typeof item.data[metaKey] !== "object") {
          item.data[metaKey] = {};
        }
        if (description) {
          item.data[metaKey].description = description;
        }
        if (placeholders) {
          item.data[metaKey].placeholders = placeholders;
        }
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
  updateTranslation(key, valuesOrAr, enValue, description, placeholders) {
    const keyError = _ArbEditor.validateKey(key);
    if (keyError) {
      return { success: false, message: keyError, updatedFiles: [] };
    }
    const arbFiles = this.findArbFiles();
    if (arbFiles.length === 0) {
      return { success: false, message: "No ARB files found in the project", updatedFiles: [] };
    }
    const localeMap = _ArbEditor.normalizeLocaleMap(valuesOrAr, enValue);
    if (Object.keys(localeMap).length === 0) {
      return { success: false, message: `No non-empty translation values were provided for "${key}"`, updatedFiles: [] };
    }
    let loaded;
    try {
      loaded = this.loadAllStrict(arbFiles);
    } catch (err) {
      if (err instanceof ArbParseError) {
        return {
          success: false,
          message: `${err.message}. Nothing was written; fix the file first so no translations are lost.`,
          updatedFiles: []
        };
      }
      throw err;
    }
    const { updated, skipped } = this.applyKey(loaded, key, localeMap, description, placeholders);
    this.flush(loaded);
    return {
      success: updated.length > 0,
      message: updated.length > 0 ? `Translation key "${key}" updated in ${updated.length} file(s) (${Object.keys(localeMap).join(", ")})` + (skipped.length > 0 ? `; left untouched (no value for their locale): ${skipped.join(", ")}` : "") : `No ARB file matched the locales provided (${Object.keys(localeMap).join(", ")}). Nothing was written.`,
      updatedFiles: updated,
      skippedFiles: skipped
    };
  }
  getAllTranslations() {
    const arbFiles = this.findArbFiles();
    const { loaded, unreadable } = this.loadAllTolerant(arbFiles);
    const allKeys = /* @__PURE__ */ new Set();
    const fileKeys = /* @__PURE__ */ new Map();
    const allLocales = /* @__PURE__ */ new Set();
    for (const item of loaded) {
      allLocales.add(item.locale);
      const keys = /* @__PURE__ */ new Set();
      for (const key of Object.keys(item.data)) {
        if (!key.startsWith("@")) {
          allKeys.add(key);
          keys.add(key);
        }
      }
      fileKeys.set(item.file, { locale: item.locale, keys });
    }
    const missingKeys = [];
    for (const [file, { locale, keys }] of fileKeys.entries()) {
      const missing = [];
      for (const key of allKeys) {
        if (!keys.has(key)) {
          missing.push(key);
        }
      }
      if (missing.length > 0) {
        missingKeys.push({ file, locale, keys: missing });
      }
    }
    const result = {
      files: arbFiles,
      keys: Array.from(allKeys).sort(),
      locales: Array.from(allLocales).sort(),
      missingKeys
    };
    if (unreadable.length > 0) {
      result.unreadableFiles = unreadable;
    }
    return result;
  }
  deleteTranslation(key) {
    const keyError = _ArbEditor.validateKey(key);
    if (keyError) {
      return { success: false, message: keyError, deletedFrom: [] };
    }
    let loaded;
    try {
      loaded = this.loadAllStrict(this.findArbFiles());
    } catch (err) {
      if (err instanceof ArbParseError) {
        return { success: false, message: `${err.message}. Nothing was changed.`, deletedFrom: [] };
      }
      throw err;
    }
    for (const item of loaded) {
      if (item.data[key] !== void 0) {
        delete item.data[key];
        item.dirty = true;
      }
      if (item.data[`@${key}`] !== void 0) {
        delete item.data[`@${key}`];
        item.dirty = true;
      }
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
  findUnusedTranslations() {
    const { loaded, unreadable } = this.loadAllTolerant(this.findArbFiles());
    const keyToFileMap = /* @__PURE__ */ new Map();
    for (const item of loaded) {
      for (const k of Object.keys(item.data)) {
        if (!k.startsWith("@")) {
          if (!keyToFileMap.has(k)) {
            keyToFileMap.set(k, []);
          }
          keyToFileMap.get(k).push(item.file);
        }
      }
    }
    const allKeys = Array.from(keyToFileMap.keys());
    const base = { totalKeys: allKeys.length, unusedKeysCount: 0, unusedKeys: [], scannedFiles: 0 };
    if (unreadable.length > 0) {
      base.unreadableFiles = unreadable;
    }
    if (allKeys.length === 0) {
      return base;
    }
    const tokens = /* @__PURE__ */ new Set();
    const tokenRe = /[A-Za-z_$][\w$]*/g;
    let scanned = 0;
    const libDir = path2.join(this.projectRoot, "lib");
    const scan = (dir) => {
      let entries;
      try {
        entries = fs2.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path2.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) {
            scan(full);
          }
        } else if (entry.isFile() && entry.name.endsWith(".dart")) {
          const rel = path2.relative(this.projectRoot, full).replace(/\\/g, "/");
          if (GENERATED_DART.some((re) => re.test(rel))) {
            continue;
          }
          try {
            const text = fs2.readFileSync(full, "utf-8");
            scanned++;
            let m;
            tokenRe.lastIndex = 0;
            while ((m = tokenRe.exec(text)) !== null) {
              tokens.add(m[0]);
            }
          } catch {
          }
        }
      }
    };
    scan(libDir);
    const unusedKeys = [];
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
  validateIcuPlaceholders() {
    const { loaded, unreadable } = this.loadAllTolerant(this.findArbFiles());
    const issues = [];
    const byKey = /* @__PURE__ */ new Map();
    for (const item of loaded) {
      for (const [k, val] of Object.entries(item.data)) {
        if (k.startsWith("@") || typeof val !== "string") {
          continue;
        }
        const { args, errors } = parseIcuMessage(val);
        for (const e of errors) {
          issues.push({
            key: k,
            file: item.file,
            type: e.kind === "other" ? "missing_other_branch" : "syntax_error",
            message: e.message
          });
        }
        if (!byKey.has(k)) {
          byKey.set(k, []);
        }
        byKey.get(k).push({ file: item.file, locale: item.locale, args, meta: item.data[`@${k}`] });
      }
    }
    for (const [key, entries] of byKey.entries()) {
      if (entries.length === 0) {
        continue;
      }
      const baseline = entries.find((e) => e.locale.toLowerCase() === "en" || e.locale.toLowerCase().startsWith("en_")) ?? entries[0];
      for (const other of entries) {
        if (other === baseline) {
          continue;
        }
        const missing = Array.from(baseline.args).filter((x) => !other.args.has(x));
        const extra = Array.from(other.args).filter((x) => !baseline.args.has(x));
        if (missing.length > 0 || extra.length > 0) {
          issues.push({
            key,
            file: other.file,
            type: "mismatched_placeholders",
            message: `Placeholders mismatch with ${baseline.file}: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`
          });
        }
      }
      const meta = baseline.meta;
      if (meta && meta.placeholders && typeof meta.placeholders === "object") {
        const declared = Object.keys(meta.placeholders);
        for (const p of baseline.args) {
          if (!declared.includes(p)) {
            issues.push({
              key,
              file: baseline.file,
              type: "missing_metadata_placeholder",
              message: `Placeholder '{${p}}' is used in string but missing from '@${key}.placeholders' metadata`
            });
          }
        }
      }
    }
    const result = {
      valid: issues.length === 0,
      issuesCount: issues.length,
      issues
    };
    if (unreadable.length > 0) {
      result.unreadableFiles = unreadable;
    }
    return result;
  }
  // ─── AI auto-translate payload generator ───────────────────────────────────
  /**
   * Gathers all missing translations into a structured format ready for AI completion
   */
  generateMissingTranslationsPayload(sourceLocale = "en") {
    const { loaded, unreadable } = this.loadAllTolerant(this.findArbFiles());
    const filesByLocale = /* @__PURE__ */ new Map();
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
    const withUnreadable = (obj) => unreadable.length > 0 ? { ...obj, unreadableFiles: unreadable } : obj;
    if (!source) {
      return withUnreadable({ sourceLocale, totalMissingEntries: 0, entries: [] });
    }
    const sourceKeys = Object.entries(source.data).filter(([k]) => !k.startsWith("@"));
    const allLocales = Array.from(filesByLocale.keys()).filter((l) => l !== sourceLocale.toLowerCase());
    const entries = [];
    for (const [key, val] of sourceKeys) {
      const missingIn = [];
      for (const loc of allLocales) {
        const target = filesByLocale.get(loc);
        if (target && target.data[key] === void 0) {
          missingIn.push(loc);
        }
      }
      if (missingIn.length > 0) {
        const meta = source.data[`@${key}`];
        entries.push({
          key,
          sourceLocale,
          sourceValue: String(val),
          description: meta?.description,
          placeholders: meta?.placeholders,
          missingInLocales: missingIn
        });
      }
    }
    return withUnreadable({ sourceLocale, totalMissingEntries: entries.length, entries });
  }
  /**
   * Batch applies multiple translated keys across locale files.
   * Files are read once, all keys are applied in memory and every changed file is written once.
   */
  batchApplyTranslations(items) {
    const arbFiles = this.findArbFiles();
    if (arbFiles.length === 0) {
      return { appliedCount: 0, message: "No ARB files found in the project" };
    }
    let loaded;
    try {
      loaded = this.loadAllStrict(arbFiles);
    } catch (err) {
      if (err instanceof ArbParseError) {
        return { appliedCount: 0, message: `${err.message}. Nothing was written; fix the file first so no translations are lost.` };
      }
      throw err;
    }
    let count = 0;
    const failedKeys = [];
    for (const item of items) {
      const keyError = _ArbEditor.validateKey(item.key);
      const localeMap = _ArbEditor.normalizeLocaleMap(item.translations);
      if (keyError || Object.keys(localeMap).length === 0) {
        failedKeys.push(item.key);
        continue;
      }
      const { updated } = this.applyKey(loaded, item.key, localeMap, item.description, item.placeholders);
      if (updated.length > 0) {
        count++;
      } else {
        failedKeys.push(item.key);
      }
    }
    const written = this.flush(loaded);
    const result = {
      appliedCount: count,
      message: `Successfully applied translations for ${count} of ${items.length} keys across ${written.length} ARB file(s).`
    };
    if (failedKeys.length > 0) {
      result.failedKeys = failedKeys;
    }
    return result;
  }
};
function parseIcuMessage(message) {
  const args = /* @__PURE__ */ new Set();
  const errors = [];
  let pos = 0;
  const s = message;
  const skipWs = () => {
    while (pos < s.length && /\s/.test(s[pos])) {
      pos++;
    }
  };
  const parseText = (insideBranch) => {
    while (pos < s.length) {
      const ch = s[pos];
      if (ch === "'") {
        if (s[pos + 1] === "'") {
          pos += 2;
          continue;
        }
        if (s[pos + 1] === "{" || s[pos + 1] === "}") {
          pos++;
          while (pos < s.length) {
            if (s[pos] === "'") {
              if (s[pos + 1] === "'") {
                pos += 2;
                continue;
              }
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
      if (ch === "{") {
        pos++;
        parseArgument();
        continue;
      }
      if (ch === "}") {
        if (insideBranch) {
          return;
        }
        errors.push({ kind: "syntax", message: `Unmatched '}' at position ${pos}` });
        pos++;
        continue;
      }
      pos++;
    }
  };
  const readUntil = (stops) => {
    const start = pos;
    while (pos < s.length && !stops.includes(s[pos])) {
      pos++;
    }
    return s.slice(start, pos).trim();
  };
  const parseArgument = () => {
    const argStart = pos - 1;
    const name = readUntil(",}");
    if (name === "") {
      errors.push({ kind: "syntax", message: `Empty placeholder '{}' at position ${argStart}` });
    } else {
      args.add(name);
    }
    if (pos >= s.length) {
      errors.push({ kind: "syntax", message: `Unclosed '{' at position ${argStart}` });
      return;
    }
    if (s[pos] === "}") {
      pos++;
      return;
    }
    pos++;
    const type = readUntil(",}");
    if (pos >= s.length) {
      errors.push({ kind: "syntax", message: `Unclosed '{' at position ${argStart}` });
      return;
    }
    if (type === "plural" || type === "select" || type === "selectordinal") {
      if (s[pos] !== ",") {
        errors.push({ kind: "syntax", message: `'${type}' argument '${name}' has no branches` });
        if (s[pos] === "}") {
          pos++;
        }
        return;
      }
      pos++;
      let hasOther = false;
      let closed = false;
      while (pos < s.length) {
        skipWs();
        if (pos >= s.length) {
          break;
        }
        if (s[pos] === "}") {
          pos++;
          closed = true;
          break;
        }
        const selector = readUntil("{}");
        if (s[pos] !== "{") {
          errors.push({ kind: "syntax", message: `Expected '{' after '${selector}' in '${name}'` });
          if (s[pos] === "}") {
            pos++;
            closed = true;
          }
          break;
        }
        if (selector === "other") {
          hasOther = true;
        }
        pos++;
        parseText(true);
        if (s[pos] === "}") {
          pos++;
        } else {
          errors.push({ kind: "syntax", message: `Unclosed branch '${selector}' in '${name}'` });
          break;
        }
      }
      if (!closed && pos >= s.length) {
        errors.push({ kind: "syntax", message: `Unclosed '{' for '${name}' at position ${argStart}` });
      }
      if (!hasOther && (type === "plural" || type === "select" || type === "selectordinal")) {
        errors.push({ kind: "other", message: `'${type}' argument '${name}' is missing the required 'other' branch` });
      }
      return;
    }
    let depth = 1;
    while (pos < s.length && depth > 0) {
      if (s[pos] === "{") {
        depth++;
      } else if (s[pos] === "}") {
        depth--;
      }
      pos++;
    }
    if (depth > 0) {
      errors.push({ kind: "syntax", message: `Unclosed '{' at position ${argStart}` });
    }
  };
  parseText(false);
  return { args, errors };
}

// tests/arbEditor.test.ts
process.env.HOME = fs3.mkdtempSync(path3.join(os2.tmpdir(), "fe-home-"));
process.env.USERPROFILE = process.env.HOME;
function project(files) {
  const root = fs3.mkdtempSync(path3.join(os2.tmpdir(), "fe-arb-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path3.join(root, rel);
    fs3.mkdirSync(path3.dirname(full), { recursive: true });
    fs3.writeFileSync(full, content);
  }
  return { root, editor: new ArbEditor(root) };
}
var read = (root, rel) => fs3.readFileSync(path3.join(root, rel), "utf8");
var EN = JSON.stringify({ "@@locale": "en", hello: "Hello", bye: "Bye" }, null, 4) + "\n";
var AR = JSON.stringify({ "@@locale": "ar", hello: "\u0645\u0631\u062D\u0628\u0627", bye: "\u0648\u062F\u0627\u0639\u0627" }, null, 4) + "\n";
(0, import_node_test.test)("a corrupt ARB file makes the write abort instead of wiping it (old code overwrote it with one key)", () => {
  const broken = '{\n  "@@locale": "ar",\n  "hello": "\u0645\u0631\u062D\u0628\u0627",\n  <<<<<<< HEAD\n}\n';
  const { root, editor } = project({ "lib/l10n/app_en.arb": EN, "lib/l10n/app_ar.arb": broken });
  const r = editor.updateTranslation("newKey", { en: "New", ar: "\u062C\u062F\u064A\u062F" });
  assert.equal(r.success, false);
  assert.match(r.message, /Cannot parse lib\/l10n\/app_ar\.arb/);
  assert.equal(read(root, "lib/l10n/app_ar.arb"), broken);
  assert.equal(read(root, "lib/l10n/app_en.arb"), EN, "nothing is written when any file is unreadable");
});
(0, import_node_test.test)("values go only to matching locales; formatting is preserved", () => {
  const { root, editor } = project({
    "lib/l10n/app_en.arb": EN,
    "lib/l10n/app_ar.arb": AR.replace(/\n/g, "\r\n"),
    "lib/l10n/app_fr.arb": JSON.stringify({ "@@locale": "fr", hello: "Bonjour" }, null, 2) + "\n"
  });
  const r = editor.updateTranslation("welcome", { en: "Welcome", ar: "\u0623\u0647\u0644\u0627" }, void 0, "greeting");
  assert.equal(r.success, true);
  assert.deepEqual(r.updatedFiles.sort(), ["lib/l10n/app_ar.arb", "lib/l10n/app_en.arb"]);
  assert.deepEqual(r.skippedFiles, ["lib/l10n/app_fr.arb"]);
  const fr = JSON.parse(read(root, "lib/l10n/app_fr.arb"));
  assert.equal(fr.welcome, void 0, "French file must not receive English text");
  const enText = read(root, "lib/l10n/app_en.arb");
  assert.match(enText, /^ {4}"welcome": "Welcome"/m, "4-space indentation kept");
  const arText = read(root, "lib/l10n/app_ar.arb");
  assert.ok(arText.includes("\r\n") && !/[^\r]\n/.test(arText), "CRLF kept");
  assert.equal(JSON.parse(arText).welcome, "\u0623\u0647\u0644\u0627");
  assert.equal(JSON.parse(enText)["@welcome"].description, "greeting");
});
(0, import_node_test.test)('legacy call with only enValue no longer writes "" into the Arabic file', () => {
  const { root, editor } = project({ "lib/l10n/app_en.arb": EN, "lib/l10n/app_ar.arb": AR });
  const r = editor.updateTranslation("onlyEnglish", "", "English text");
  assert.equal(r.success, true);
  assert.equal(JSON.parse(read(root, "lib/l10n/app_ar.arb")).onlyEnglish, void 0);
  assert.equal(JSON.parse(read(root, "lib/l10n/app_en.arb")).onlyEnglish, "English text");
});
(0, import_node_test.test)("single ARB file project: value is used even though locale cannot be matched", () => {
  const { root, editor } = project({ "lib/l10n/intl_messages.arb": JSON.stringify({ a: "A" }) });
  const r = editor.updateTranslation("b", { en: "B" });
  assert.equal(r.success, true);
  assert.equal(JSON.parse(read(root, "lib/l10n/intl_messages.arb")).b, "B");
});
(0, import_node_test.test)("invalid keys are rejected", () => {
  const { editor } = project({ "lib/l10n/app_en.arb": EN });
  for (const bad of ["__proto__", "constructor", "a-b", "@x", "1abc", "", "a b"]) {
    assert.equal(editor.updateTranslation(bad, { en: "x" }).success, false, bad);
  }
});
(0, import_node_test.test)("batch apply reads once, writes each changed file once and reports failures", () => {
  const { root, editor } = project({ "lib/l10n/app_en.arb": EN, "lib/l10n/app_ar.arb": AR });
  const r = editor.batchApplyTranslations([
    { key: "k1", translations: { en: "One", ar: "\u0648\u0627\u062D\u062F" } },
    { key: "k2", translations: { en: "Two", ar: "\u0627\u062B\u0646\u0627\u0646" }, description: "two" },
    { key: "bad-key", translations: { en: "x" } },
    { key: "k3", translations: { de: "Drei" } }
    // no German file
  ]);
  assert.equal(r.appliedCount, 2);
  assert.deepEqual(r.failedKeys?.sort(), ["bad-key", "k3"]);
  const en = JSON.parse(read(root, "lib/l10n/app_en.arb"));
  const ar = JSON.parse(read(root, "lib/l10n/app_ar.arb"));
  assert.equal(en.k1, "One");
  assert.equal(ar.k2, "\u0627\u062B\u0646\u0627\u0646");
  assert.equal(en["@k2"].description, "two");
});
(0, import_node_test.test)("delete removes key and metadata everywhere, refuses when a file is corrupt", () => {
  const withMeta = JSON.stringify({ "@@locale": "en", hello: "Hello", "@hello": { description: "d" }, bye: "Bye" }, null, 2) + "\n";
  const { root, editor } = project({ "lib/l10n/app_en.arb": withMeta, "lib/l10n/app_ar.arb": AR });
  const r = editor.deleteTranslation("hello");
  assert.equal(r.success, true);
  assert.equal(JSON.parse(read(root, "lib/l10n/app_en.arb")).hello, void 0);
  assert.equal(JSON.parse(read(root, "lib/l10n/app_en.arb"))["@hello"], void 0);
  fs3.writeFileSync(path3.join(root, "lib/l10n/app_ar.arb"), "{ broken");
  const r2 = editor.deleteTranslation("bye");
  assert.equal(r2.success, false);
  assert.equal(JSON.parse(read(root, "lib/l10n/app_en.arb")).bye, "Bye");
});
(0, import_node_test.test)("getAllTranslations reports unreadable files instead of hiding them", () => {
  const { editor } = project({ "lib/l10n/app_en.arb": EN, "lib/l10n/app_ar.arb": "{ nope" });
  const r = editor.getAllTranslations();
  assert.deepEqual(r.unreadableFiles, ["lib/l10n/app_ar.arb"]);
  assert.deepEqual(r.keys, ["bye", "hello"]);
});
(0, import_node_test.test)("findArbFiles skips platform folders and node_modules", () => {
  const { editor } = project({
    "lib/l10n/app_en.arb": EN,
    "android/app/x.arb": "{}",
    "ios/Pods/y.arb": "{}",
    "node_modules/z/z.arb": "{}",
    "assets/l10n/app_ar.arb": AR
  });
  assert.deepEqual(editor.findArbFiles(), ["assets/l10n/app_ar.arb", "lib/l10n/app_en.arb"]);
});
(0, import_node_test.test)("unused translations ignore generated localisation code but see real usage", () => {
  const { editor } = project({
    "lib/l10n/app_en.arb": JSON.stringify({ usedKey: "a", stringUse: "b", unusedKey: "c", onlyInGenerated: "d" }),
    "lib/main.dart": "import 'x.dart';\nvoid main() { print(S.of(context).usedKey); print('stringUse'.tr()); }\n",
    "lib/generated/l10n.dart": "class S { String get usedKey => 1; String get unusedKey => 2; String get onlyInGenerated => 3; String get stringUse => 4; }",
    "lib/generated/intl/messages_en.dart": "'unusedKey': () => 'c', 'onlyInGenerated': () => 'd'",
    "lib/l10n/app_localizations_en.dart": 'String get unusedKey => "c";'
  });
  const r = editor.findUnusedTranslations();
  assert.deepEqual(r.unusedKeys.map((u) => u.key).sort(), ["onlyInGenerated", "unusedKey"]);
  assert.equal(r.scannedFiles, 1);
});
(0, import_node_test.test)("ICU: plural/select branches are parsed properly", () => {
  const p = parseIcuMessage("{count, plural, =0{No items} one{1 item} other{{count} items for {user}}}");
  assert.deepEqual(Array.from(p.args).sort(), ["count", "user"]);
  assert.deepEqual(p.errors, []);
  const s = parseIcuMessage("{gender, select, male{He} female{She} other{They}} replied");
  assert.deepEqual(Array.from(s.args), ["gender"], "branch words are not placeholders (old regex reported He/She/They)");
  assert.deepEqual(s.errors, []);
});
(0, import_node_test.test)("ICU: missing other branch, unclosed braces and unmatched braces are reported", () => {
  assert.equal(parseIcuMessage("{n, plural, one{x}}").errors[0].kind, "other");
  assert.ok(parseIcuMessage("Hello {name").errors.length > 0);
  assert.ok(parseIcuMessage("Hello name}").errors.length > 0);
  assert.ok(parseIcuMessage("Hi {}").errors.length > 0);
});
(0, import_node_test.test)("ICU: quoted braces and typed arguments", () => {
  assert.deepEqual(parseIcuMessage("Use '{' to open and '}' to close").errors, []);
  assert.deepEqual(Array.from(parseIcuMessage("Total {price, number, currency}").args), ["price"]);
  assert.deepEqual(Array.from(parseIcuMessage("{n, plural, offset:1 =0{none} other{# more}}").args), ["n"]);
});
(0, import_node_test.test)("validateIcuPlaceholders compares locales and checks metadata", () => {
  const en = { "@@locale": "en", msg: "Hi {name}, you have {count, plural, =0{nothing} other{{count} items}}", "@msg": { placeholders: { name: {} } }, ok: "Fine" };
  const ar = { "@@locale": "ar", msg: "\u0645\u0631\u062D\u0628\u0627 {name}", ok: "\u062A\u0645\u0627\u0645" };
  const { editor } = project({ "lib/l10n/app_en.arb": JSON.stringify(en), "lib/l10n/app_ar.arb": JSON.stringify(ar) });
  const r = editor.validateIcuPlaceholders();
  const types = r.issues.map((i) => i.type).sort();
  assert.deepEqual(types, ["mismatched_placeholders", "missing_metadata_placeholder"]);
  assert.match(r.issues.find((i) => i.type === "mismatched_placeholders").message, /missing \[count\]/);
  assert.equal(r.valid, false);
});
(0, import_node_test.test)("missing translations payload still works", () => {
  const { editor } = project({
    "lib/l10n/app_en.arb": JSON.stringify({ "@@locale": "en", a: "A", b: "B", "@b": { description: "bee" } }),
    "lib/l10n/app_ar.arb": JSON.stringify({ "@@locale": "ar", a: "\u0627" })
  });
  const r = editor.generateMissingTranslationsPayload("en");
  assert.equal(r.totalMissingEntries, 1);
  assert.equal(r.entries[0].key, "b");
  assert.equal(r.entries[0].description, "bee");
  assert.deepEqual(r.entries[0].missingInLocales, ["ar"]);
});
