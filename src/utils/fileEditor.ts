/**
 * Safe, text-only file editing primitives behind the MCP tools `flutter_edit_file`,
 * `flutter_replace_lines` and `flutter_write_file`.
 *
 * Guarantees:
 *   - every path is confined to the active project root (lexically AND after resolving symlinks);
 *   - `.git`, `node_modules`, `.dart_tool` and `.flutter-explorer` can never be written;
 *   - only valid UTF-8 text files up to MAX_EDIT_FILE_BYTES are touched (binary files and
 *     Latin-1/UTF-16 files are refused instead of being silently corrupted);
 *   - the file's own conventions survive an edit: BOM, dominant line ending (CRLF/LF), and
 *     every byte outside the edited region;
 *   - an edit must match exactly one place (unless `replaceAll`), so a vague `oldString` can
 *     never rewrite the wrong block;
 *   - the previous content is backed up (last 10 copies per file) and the new content is written
 *     through a temp file + rename.
 *
 * Every function is synchronous on purpose: the MCP server is a single Node thread, so a
 * read-modify-write here can never interleave with another tool call.
 *
 * Nothing here imports `vscode` or the MCP SDK.
 */
import * as fs from 'fs';
import * as path from 'path';
import { writeFileAtomic, backupFile } from './configWriter';

export const MAX_EDIT_FILE_BYTES = 2 * 1024 * 1024;

const BLOCKED_SEGMENTS = new Set(['.git', 'node_modules', '.dart_tool', '.flutter-explorer']);

export interface Failure {
  ok: false;
  error: string;
}

const fail = (error: string): Failure => ({ ok: false, error });

export interface EditOptions {
  /** Where backups go; defaults to ~/.flutter-explorer/backups. Mainly for tests. */
  backupDir?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path confinement
// ─────────────────────────────────────────────────────────────────────────────

export interface Target {
  ok: true;
  absolute: string;
  relative: string;
  exists: boolean;
}

function isOutside(rel: string): boolean {
  return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
}

export function resolveEditableTarget(projectRoot: string, rawPath: string | undefined | null): Target | Failure {
  if (!projectRoot) {
    return fail('No active project path is set. Call flutter_set_project_path first.');
  }
  if (!rawPath || typeof rawPath !== 'string') {
    return fail('File path is required (filePath, relativePath, or path).');
  }
  const clean = rawPath.trim().replace(/^['"]|['"]$/g, '');
  if (!clean) {
    return fail('File path is required (filePath, relativePath, or path).');
  }
  if (clean.includes('\0')) {
    return fail('Invalid path.');
  }

  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, clean);
  const rel = path.relative(root, absolute);

  if (rel === '') {
    return fail('The path points at the project root, not at a file.');
  }
  if (isOutside(rel)) {
    return fail(`Refusing to edit "${clean}": it is outside the project root (${root}).`);
  }
  for (const segment of rel.split(path.sep)) {
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) {
      return fail(`Refusing to edit "${rel.replace(/\\/g, '/')}": "${segment}" is a protected directory.`);
    }
  }

  // Symlink escape: resolve the deepest existing ancestor and make sure it is still inside the root.
  try {
    let probe = absolute;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) { break; }
      probe = parent;
    }
    const realRoot = fs.realpathSync(root);
    const realProbe = fs.realpathSync(probe);
    if (isOutside(path.relative(realRoot, realProbe))) {
      return fail(`Refusing to edit "${clean}": it resolves (through a symlink) to a location outside the project root.`);
    }
  } catch (e: any) {
    return fail(`Could not verify the path: ${e?.message || e}`);
  }

  const exists = fs.existsSync(absolute);
  if (exists && fs.statSync(absolute).isDirectory()) {
    return fail(`"${rel.replace(/\\/g, '/')}" is a directory, not a file.`);
  }

  return { ok: true, absolute, relative: rel.replace(/\\/g, '/'), exists };
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading / line-ending helpers
// ─────────────────────────────────────────────────────────────────────────────

export type Eol = '\r\n' | '\n';

export interface LoadedText {
  ok: true;
  text: string;
  bom: boolean;
  eol: Eol;
  mixedEol: boolean;
}

export function detectEol(text: string): { eol: Eol; mixed: boolean } {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return { eol: crlf > lf ? '\r\n' : '\n', mixed: crlf > 0 && lf > 0 };
}

export function toEol(value: string, eol: Eol): string {
  const lf = value.replace(/\r\n/g, '\n');
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}

export function loadText(absolute: string): LoadedText | Failure {
  let buf: Buffer;
  try {
    const stat = fs.statSync(absolute);
    if (stat.size > MAX_EDIT_FILE_BYTES) {
      return fail(`File is ${stat.size} bytes; the edit tools only handle files up to ${MAX_EDIT_FILE_BYTES} bytes.`);
    }
    buf = fs.readFileSync(absolute);
  } catch (e: any) {
    return fail(`Error reading file: ${e?.message || e}`);
  }

  if (buf.includes(0)) {
    return fail('File looks binary (contains NUL bytes); refusing to edit it as text.');
  }
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = buf.subarray(bom ? 3 : 0);
  const text = body.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(body)) {
    return fail('File is not valid UTF-8 (UTF-16 or a legacy code page?); refusing to edit it to avoid corrupting it.');
  }
  const { eol, mixed } = detectEol(text);
  return { ok: true, text, bom, eol, mixedEol: mixed };
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) { line++; }
  }
  return line;
}

function countLines(value: string): number {
  if (value === '') { return 0; }
  const n = value.split('\n').length;
  return value.endsWith('\n') ? n - 1 : n;
}

/** Numbered excerpt of `text`; lines in [firstLine, firstLine + changedLines) are marked with '+'. */
export function renderPreview(text: string, firstLine: number, changedLines: number, context = 2, maxLines = 40): string {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') { lines.pop(); }
  const from = Math.max(1, firstLine - context);
  let to = Math.min(lines.length, firstLine + Math.max(changedLines, 1) - 1 + context);
  if (to - from + 1 > maxLines) { to = from + maxLines - 1; }
  const out: string[] = [];
  for (let n = from; n <= to; n++) {
    const marker = n >= firstLine && n < firstLine + changedLines ? '+' : ' ';
    out.push(`${marker} ${n}: ${lines[n - 1].replace(/\r$/, '')}`);
  }
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure edit operations
// ─────────────────────────────────────────────────────────────────────────────

export interface StringEditRequest {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  expectedCount?: number;
}

export interface StringEditResult {
  ok: true;
  text: string;
  replaced: number;
  firstLine: number;
  newLineCount: number;
}

export function applyStringEdit(text: string, eol: Eol, mixedEol: boolean, req: StringEditRequest): StringEditResult | Failure {
  if (typeof req.oldString !== 'string' || req.oldString === '') {
    return fail('oldString must not be empty. To create or replace a whole file use flutter_write_file.');
  }
  if (typeof req.newString !== 'string') {
    return fail('newString is required (use an empty string to delete the matched text).');
  }
  if (req.oldString === req.newString) {
    return fail('oldString and newString are identical; nothing to change.');
  }

  const oldStr = toEol(req.oldString, eol);
  const newStr = toEol(req.newString, eol);

  const indices: number[] = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(oldStr, from);
    if (i === -1) { break; }
    indices.push(i);
    from = i + oldStr.length;
  }

  if (indices.length === 0) {
    const firstLine = oldStr.split(eol)[0].trim();
    let hint = 'Copy the exact text with flutter_read_lines (indentation, trailing spaces and line endings must match).';
    if (firstLine.length >= 3) {
      const at = text.indexOf(firstLine);
      if (at !== -1) {
        hint = `The first line of oldString does occur at line ${lineNumberAt(text, at)}, but the whole block does not match. ` + hint;
      }
    }
    if (mixedEol) {
      hint += ' This file mixes CRLF and LF line endings, which can break multi-line matches; match a single line or use flutter_replace_lines.';
    }
    return fail(`oldString was not found in the file. ${hint}`);
  }

  if (req.expectedCount !== undefined && indices.length !== req.expectedCount) {
    return fail(`oldString matches ${indices.length} place(s) but expectedCount is ${req.expectedCount}. Nothing was changed.`);
  }

  if (indices.length > 1 && !req.replaceAll) {
    const lines = indices.slice(0, 8).map(i => lineNumberAt(text, i)).join(', ');
    return fail(
      `oldString matches ${indices.length} places (lines ${lines}${indices.length > 8 ? ', …' : ''}). ` +
      'Add more surrounding context so it matches exactly one place, or pass replaceAll: true.'
    );
  }

  const targets = req.replaceAll ? indices : [indices[0]];
  let out = '';
  let last = 0;
  for (const i of targets) {
    out += text.slice(last, i) + newStr;
    last = i + oldStr.length;
  }
  out += text.slice(last);

  return {
    ok: true,
    text: out,
    replaced: targets.length,
    firstLine: lineNumberAt(text, indices[0]),
    newLineCount: countLines(newStr),
  };
}

export interface LineReplaceRequest {
  startLine: number;
  /** Inclusive. Use `startLine - 1` to insert before `startLine` without removing anything. */
  endLine: number;
  newContent: string;
  /** Optional guard against stale line numbers: the removed text must equal this. */
  expectedOldText?: string;
}

export interface LineReplaceResult {
  ok: true;
  text: string;
  removedLines: number;
  removedText: string;
  firstLine: number;
  newLineCount: number;
}

export function applyLineReplace(text: string, eol: Eol, req: LineReplaceRequest): LineReplaceResult | Failure {
  const { startLine, endLine } = req;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    return fail('startLine and endLine must be integers (1-based, inclusive).');
  }
  if (typeof req.newContent !== 'string') {
    return fail('newContent is required (use an empty string to delete the lines).');
  }

  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const total = lines.length;

  if (startLine < 1 || startLine > total + 1) {
    return fail(`startLine ${startLine} is out of range; the file has ${total} line(s).`);
  }
  const insertion = endLine === startLine - 1;
  if (!insertion && (endLine < startLine || endLine > total)) {
    return fail(`endLine ${endLine} is out of range; it must be between ${startLine} and ${total} (or ${startLine - 1} to insert before line ${startLine}).`);
  }

  const removed = insertion ? [] : lines.slice(startLine - 1, endLine);
  const removedText = removed.join('');

  if (req.expectedOldText !== undefined) {
    const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n$/, '');
    if (strip(removedText) !== strip(req.expectedOldText)) {
      const shown = removedText.length > 2000 ? removedText.slice(0, 2000) + '…' : removedText;
      return fail(`expectedOldText does not match lines ${startLine}-${endLine}; the file may have changed. Nothing was changed. Current content of that range:\n${shown}`);
    }
  }

  let body = toEol(req.newContent, eol);
  let prefix = '';
  if (insertion && startLine === total + 1 && total > 0 && !lines[total - 1].endsWith('\n')) {
    prefix = eol;
  }
  if (body !== '') {
    const needTerminator = removed.length > 0 ? removed[removed.length - 1].endsWith('\n') : prefix === '';
    if (needTerminator && !body.endsWith('\n')) {
      body += eol;
    }
  }

  const out =
    lines.slice(0, startLine - 1).join('') +
    prefix +
    body +
    lines.slice(startLine - 1 + removed.length).join('');

  return {
    ok: true,
    text: out,
    removedLines: removed.length,
    removedText,
    firstLine: startLine,
    newLineCount: countLines(body),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Committing to disk
// ─────────────────────────────────────────────────────────────────────────────

interface Committed {
  ok: true;
  backup: string | null;
  bytes: number;
}

function commitText(absolute: string, text: string, bom: boolean, options?: EditOptions): Committed | Failure {
  const content = (bom ? '\uFEFF' : '') + text;
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_EDIT_FILE_BYTES) {
    return fail(`The resulting file would be ${bytes} bytes; the edit tools only handle files up to ${MAX_EDIT_FILE_BYTES} bytes.`);
  }

  const backup = backupFile(absolute, options?.backupDir);
  try {
    try {
      writeFileAtomic(absolute, content);
    } catch (err: any) {
      // Windows can refuse to rename over a file another process (VS Code, antivirus, OneDrive) holds open.
      const retryable = ['EPERM', 'EBUSY', 'EACCES', 'EXDEV'].includes(err?.code);
      if (retryable && fs.existsSync(absolute)) {
        fs.writeFileSync(absolute, content, 'utf8');
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    return fail(`Write failed: ${err?.message || err}. The original file was not modified${backup ? ` (a backup is at ${backup})` : ''}.`);
  }
  return { ok: true, backup, bytes };
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level operations used by the tools
// ─────────────────────────────────────────────────────────────────────────────

export interface EditSummary {
  ok: true;
  file: string;
  action: 'edited' | 'created' | 'overwritten';
  dryRun: boolean;
  replaced?: number;
  removedLines?: number;
  addedLines: number;
  bytes: number;
  backup: string | null;
  note?: string;
  preview: string;
}

function loadExisting(projectRoot: string, rawPath: string | undefined): { target: Target; loaded: LoadedText } | Failure {
  const target = resolveEditableTarget(projectRoot, rawPath);
  if (!target.ok) { return target; }
  if (!target.exists) {
    return fail(`File not found: ${target.relative}. To create a new file use flutter_write_file.`);
  }
  const loaded = loadText(target.absolute);
  if (!loaded.ok) { return loaded; }
  return { target, loaded };
}

export function editFile(
  projectRoot: string,
  args: StringEditRequest & { filePath?: string; dryRun?: boolean },
  options?: EditOptions,
): EditSummary | Failure {
  const base = loadExisting(projectRoot, args.filePath);
  if (!('target' in base)) { return base; }
  const { target, loaded } = base;

  const edit = applyStringEdit(loaded.text, loaded.eol, loaded.mixedEol, args);
  if (!edit.ok) { return edit; }

  const preview = renderPreview(edit.text, edit.firstLine, edit.newLineCount);
  if (args.dryRun) {
    return {
      ok: true, file: target.relative, action: 'edited', dryRun: true, replaced: edit.replaced,
      addedLines: edit.newLineCount, bytes: Buffer.byteLength(edit.text, 'utf8'), backup: null,
      note: 'dryRun: nothing was written.', preview,
    };
  }

  const done = commitText(target.absolute, edit.text, loaded.bom, options);
  if (!done.ok) { return done; }
  return {
    ok: true, file: target.relative, action: 'edited', dryRun: false, replaced: edit.replaced,
    addedLines: edit.newLineCount, bytes: done.bytes, backup: done.backup,
    note: edit.replaced > 1 ? `Replaced ${edit.replaced} occurrences; the preview shows the first one.` : undefined,
    preview,
  };
}

export function replaceLines(
  projectRoot: string,
  args: LineReplaceRequest & { filePath?: string; dryRun?: boolean },
  options?: EditOptions,
): EditSummary | Failure {
  const base = loadExisting(projectRoot, args.filePath);
  if (!('target' in base)) { return base; }
  const { target, loaded } = base;

  const edit = applyLineReplace(loaded.text, loaded.eol, args);
  if (!edit.ok) { return edit; }

  const preview = renderPreview(edit.text, edit.firstLine, edit.newLineCount);
  if (args.dryRun) {
    return {
      ok: true, file: target.relative, action: 'edited', dryRun: true, removedLines: edit.removedLines,
      addedLines: edit.newLineCount, bytes: Buffer.byteLength(edit.text, 'utf8'), backup: null,
      note: 'dryRun: nothing was written.', preview,
    };
  }

  const done = commitText(target.absolute, edit.text, loaded.bom, options);
  if (!done.ok) { return done; }
  return {
    ok: true, file: target.relative, action: 'edited', dryRun: false, removedLines: edit.removedLines,
    addedLines: edit.newLineCount, bytes: done.bytes, backup: done.backup, preview,
  };
}

export function writeTextFile(
  projectRoot: string,
  args: { filePath?: string; content: string; overwrite?: boolean; dryRun?: boolean },
  options?: EditOptions,
): EditSummary | Failure {
  if (typeof args.content !== 'string') {
    return fail('content is required.');
  }
  const target = resolveEditableTarget(projectRoot, args.filePath);
  if (!target.ok) { return target; }
  if (target.exists && !args.overwrite) {
    return fail(`${target.relative} already exists. Pass overwrite: true to replace it entirely, or use flutter_edit_file for a targeted change.`);
  }

  let content = args.content;
  let bom = false;
  if (target.exists) {
    const existing = loadText(target.absolute);
    if (!existing.ok) { return existing; }
    bom = existing.bom;
    if (existing.eol === '\r\n' && !content.includes('\r')) {
      content = toEol(content, '\r\n');
    }
  }

  const preview = renderPreview(content, 1, Math.min(countLines(content), 20), 0, 20);
  if (args.dryRun) {
    return {
      ok: true, file: target.relative, action: target.exists ? 'overwritten' : 'created', dryRun: true,
      addedLines: countLines(content), bytes: Buffer.byteLength(content, 'utf8'), backup: null,
      note: 'dryRun: nothing was written.', preview,
    };
  }

  const done = commitText(target.absolute, content, bom, options);
  if (!done.ok) { return done; }
  return {
    ok: true, file: target.relative, action: target.exists ? 'overwritten' : 'created', dryRun: false,
    addedLines: countLines(content), bytes: done.bytes, backup: done.backup, preview,
  };
}
