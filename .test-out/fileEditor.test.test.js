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

// tests/fileEditor.test.ts
var import_node_test = require("node:test");
var assert = __toESM(require("node:assert/strict"));
var fs3 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path3 = __toESM(require("path"));

// src/utils/fileEditor.ts
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
    let target = path.join(backupDir, `${stamp}__${safeName}.bak`);
    for (let n = 1; fs.existsSync(target); n++) {
      target = path.join(backupDir, `${stamp}~${String(n).padStart(3, "0")}__${safeName}.bak`);
    }
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

// src/utils/fileEditor.ts
var MAX_EDIT_FILE_BYTES = 2 * 1024 * 1024;
var BLOCKED_SEGMENTS = /* @__PURE__ */ new Set([".git", "node_modules", ".dart_tool", ".flutter-explorer"]);
var fail = (error) => ({ ok: false, error });
function isOutside(rel) {
  return rel === ".." || rel.startsWith(".." + path2.sep) || path2.isAbsolute(rel);
}
function resolveEditableTarget(projectRoot, rawPath) {
  if (!projectRoot) {
    return fail("No active project path is set. Call flutter_set_project_path first.");
  }
  if (!rawPath || typeof rawPath !== "string") {
    return fail("File path is required (filePath, relativePath, or path).");
  }
  const clean = rawPath.trim().replace(/^['"]|['"]$/g, "");
  if (!clean) {
    return fail("File path is required (filePath, relativePath, or path).");
  }
  if (clean.includes("\0")) {
    return fail("Invalid path.");
  }
  const root = path2.resolve(projectRoot);
  const absolute = path2.resolve(root, clean);
  const rel = path2.relative(root, absolute);
  if (rel === "") {
    return fail("The path points at the project root, not at a file.");
  }
  if (isOutside(rel)) {
    return fail(`Refusing to edit "${clean}": it is outside the project root (${root}).`);
  }
  for (const segment of rel.split(path2.sep)) {
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) {
      return fail(`Refusing to edit "${rel.replace(/\\/g, "/")}": "${segment}" is a protected directory.`);
    }
  }
  try {
    let probe = absolute;
    while (!fs2.existsSync(probe)) {
      const parent = path2.dirname(probe);
      if (parent === probe) {
        break;
      }
      probe = parent;
    }
    const realRoot = fs2.realpathSync(root);
    const realProbe = fs2.realpathSync(probe);
    if (isOutside(path2.relative(realRoot, realProbe))) {
      return fail(`Refusing to edit "${clean}": it resolves (through a symlink) to a location outside the project root.`);
    }
  } catch (e) {
    return fail(`Could not verify the path: ${e?.message || e}`);
  }
  const exists = fs2.existsSync(absolute);
  if (exists && fs2.statSync(absolute).isDirectory()) {
    return fail(`"${rel.replace(/\\/g, "/")}" is a directory, not a file.`);
  }
  return { ok: true, absolute, relative: rel.replace(/\\/g, "/"), exists };
}
function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return { eol: crlf > lf ? "\r\n" : "\n", mixed: crlf > 0 && lf > 0 };
}
function toEol(value, eol) {
  const lf = value.replace(/\r\n/g, "\n");
  return eol === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
}
function loadText(absolute) {
  let buf;
  try {
    const stat = fs2.statSync(absolute);
    if (stat.size > MAX_EDIT_FILE_BYTES) {
      return fail(`File is ${stat.size} bytes; the edit tools only handle files up to ${MAX_EDIT_FILE_BYTES} bytes.`);
    }
    buf = fs2.readFileSync(absolute);
  } catch (e) {
    return fail(`Error reading file: ${e?.message || e}`);
  }
  if (buf.includes(0)) {
    return fail("File looks binary (contains NUL bytes); refusing to edit it as text.");
  }
  const bom = buf.length >= 3 && buf[0] === 239 && buf[1] === 187 && buf[2] === 191;
  const body = buf.subarray(bom ? 3 : 0);
  const text = body.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(body)) {
    return fail("File is not valid UTF-8 (UTF-16 or a legacy code page?); refusing to edit it to avoid corrupting it.");
  }
  const { eol, mixed } = detectEol(text);
  return { ok: true, text, bom, eol, mixedEol: mixed };
}
function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}
function countLines(value) {
  if (value === "") {
    return 0;
  }
  const n = value.split("\n").length;
  return value.endsWith("\n") ? n - 1 : n;
}
function renderPreview(text, firstLine, changedLines, context = 2, maxLines = 40) {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const from = Math.max(1, firstLine - context);
  let to = Math.min(lines.length, firstLine + Math.max(changedLines, 1) - 1 + context);
  if (to - from + 1 > maxLines) {
    to = from + maxLines - 1;
  }
  const out = [];
  for (let n = from; n <= to; n++) {
    const marker = n >= firstLine && n < firstLine + changedLines ? "+" : " ";
    out.push(`${marker} ${n}: ${lines[n - 1].replace(/\r$/, "")}`);
  }
  return out.join("\n");
}
function applyStringEdit(text, eol, mixedEol, req) {
  if (typeof req.oldString !== "string" || req.oldString === "") {
    return fail("oldString must not be empty. To create or replace a whole file use flutter_write_file.");
  }
  if (typeof req.newString !== "string") {
    return fail("newString is required (use an empty string to delete the matched text).");
  }
  if (req.oldString === req.newString) {
    return fail("oldString and newString are identical; nothing to change.");
  }
  const oldStr = toEol(req.oldString, eol);
  const newStr = toEol(req.newString, eol);
  const indices = [];
  let from = 0;
  for (; ; ) {
    const i = text.indexOf(oldStr, from);
    if (i === -1) {
      break;
    }
    indices.push(i);
    from = i + oldStr.length;
  }
  if (indices.length === 0) {
    const firstLine = oldStr.split(eol)[0].trim();
    let hint = "Copy the exact text with flutter_read_lines (indentation, trailing spaces and line endings must match).";
    if (firstLine.length >= 3) {
      const at = text.indexOf(firstLine);
      if (at !== -1) {
        hint = `The first line of oldString does occur at line ${lineNumberAt(text, at)}, but the whole block does not match. ` + hint;
      }
    }
    if (mixedEol) {
      hint += " This file mixes CRLF and LF line endings, which can break multi-line matches; match a single line or use flutter_replace_lines.";
    }
    return fail(`oldString was not found in the file. ${hint}`);
  }
  if (req.expectedCount !== void 0 && indices.length !== req.expectedCount) {
    return fail(`oldString matches ${indices.length} place(s) but expectedCount is ${req.expectedCount}. Nothing was changed.`);
  }
  if (indices.length > 1 && !req.replaceAll) {
    const lines = indices.slice(0, 8).map((i) => lineNumberAt(text, i)).join(", ");
    return fail(
      `oldString matches ${indices.length} places (lines ${lines}${indices.length > 8 ? ", \u2026" : ""}). Add more surrounding context so it matches exactly one place, or pass replaceAll: true.`
    );
  }
  const targets = req.replaceAll ? indices : [indices[0]];
  let out = "";
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
    newLineCount: countLines(newStr)
  };
}
function applyLineReplace(text, eol, req) {
  const { startLine, endLine } = req;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    return fail("startLine and endLine must be integers (1-based, inclusive).");
  }
  if (typeof req.newContent !== "string") {
    return fail("newContent is required (use an empty string to delete the lines).");
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
  const removedText = removed.join("");
  if (req.expectedOldText !== void 0) {
    const strip = (s) => s.replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (strip(removedText) !== strip(req.expectedOldText)) {
      const shown = removedText.length > 2e3 ? removedText.slice(0, 2e3) + "\u2026" : removedText;
      return fail(`expectedOldText does not match lines ${startLine}-${endLine}; the file may have changed. Nothing was changed. Current content of that range:
${shown}`);
    }
  }
  let body = toEol(req.newContent, eol);
  let prefix = "";
  if (insertion && startLine === total + 1 && total > 0 && !lines[total - 1].endsWith("\n")) {
    prefix = eol;
  }
  if (body !== "") {
    const needTerminator = removed.length > 0 ? removed[removed.length - 1].endsWith("\n") : prefix === "";
    if (needTerminator && !body.endsWith("\n")) {
      body += eol;
    }
  }
  const out = lines.slice(0, startLine - 1).join("") + prefix + body + lines.slice(startLine - 1 + removed.length).join("");
  return {
    ok: true,
    text: out,
    removedLines: removed.length,
    removedText,
    firstLine: startLine,
    newLineCount: countLines(body)
  };
}
function commitText(absolute, text, bom, options) {
  const content = (bom ? "\uFEFF" : "") + text;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_EDIT_FILE_BYTES) {
    return fail(`The resulting file would be ${bytes} bytes; the edit tools only handle files up to ${MAX_EDIT_FILE_BYTES} bytes.`);
  }
  const backup = backupFile(absolute, options?.backupDir);
  try {
    try {
      writeFileAtomic(absolute, content);
    } catch (err) {
      const retryable = ["EPERM", "EBUSY", "EACCES", "EXDEV"].includes(err?.code);
      if (retryable && fs2.existsSync(absolute)) {
        fs2.writeFileSync(absolute, content, "utf8");
      } else {
        throw err;
      }
    }
  } catch (err) {
    return fail(`Write failed: ${err?.message || err}. The original file was not modified${backup ? ` (a backup is at ${backup})` : ""}.`);
  }
  return { ok: true, backup, bytes };
}
function loadExisting(projectRoot, rawPath) {
  const target = resolveEditableTarget(projectRoot, rawPath);
  if (!target.ok) {
    return target;
  }
  if (!target.exists) {
    return fail(`File not found: ${target.relative}. To create a new file use flutter_write_file.`);
  }
  const loaded = loadText(target.absolute);
  if (!loaded.ok) {
    return loaded;
  }
  return { target, loaded };
}
function editFile(projectRoot, args, options) {
  const base = loadExisting(projectRoot, args.filePath);
  if (!("target" in base)) {
    return base;
  }
  const { target, loaded } = base;
  const edit = applyStringEdit(loaded.text, loaded.eol, loaded.mixedEol, args);
  if (!edit.ok) {
    return edit;
  }
  const preview = renderPreview(edit.text, edit.firstLine, edit.newLineCount);
  if (args.dryRun) {
    return {
      ok: true,
      file: target.relative,
      action: "edited",
      dryRun: true,
      replaced: edit.replaced,
      addedLines: edit.newLineCount,
      bytes: Buffer.byteLength(edit.text, "utf8"),
      backup: null,
      note: "dryRun: nothing was written.",
      preview
    };
  }
  const done = commitText(target.absolute, edit.text, loaded.bom, options);
  if (!done.ok) {
    return done;
  }
  return {
    ok: true,
    file: target.relative,
    action: "edited",
    dryRun: false,
    replaced: edit.replaced,
    addedLines: edit.newLineCount,
    bytes: done.bytes,
    backup: done.backup,
    note: edit.replaced > 1 ? `Replaced ${edit.replaced} occurrences; the preview shows the first one.` : void 0,
    preview
  };
}
function replaceLines(projectRoot, args, options) {
  const base = loadExisting(projectRoot, args.filePath);
  if (!("target" in base)) {
    return base;
  }
  const { target, loaded } = base;
  const edit = applyLineReplace(loaded.text, loaded.eol, args);
  if (!edit.ok) {
    return edit;
  }
  const preview = renderPreview(edit.text, edit.firstLine, edit.newLineCount);
  if (args.dryRun) {
    return {
      ok: true,
      file: target.relative,
      action: "edited",
      dryRun: true,
      removedLines: edit.removedLines,
      addedLines: edit.newLineCount,
      bytes: Buffer.byteLength(edit.text, "utf8"),
      backup: null,
      note: "dryRun: nothing was written.",
      preview
    };
  }
  const done = commitText(target.absolute, edit.text, loaded.bom, options);
  if (!done.ok) {
    return done;
  }
  return {
    ok: true,
    file: target.relative,
    action: "edited",
    dryRun: false,
    removedLines: edit.removedLines,
    addedLines: edit.newLineCount,
    bytes: done.bytes,
    backup: done.backup,
    preview
  };
}
function writeTextFile(projectRoot, args, options) {
  if (typeof args.content !== "string") {
    return fail("content is required.");
  }
  const target = resolveEditableTarget(projectRoot, args.filePath);
  if (!target.ok) {
    return target;
  }
  if (target.exists && !args.overwrite) {
    return fail(`${target.relative} already exists. Pass overwrite: true to replace it entirely, or use flutter_edit_file for a targeted change.`);
  }
  let content = args.content;
  let bom = false;
  if (target.exists) {
    const existing = loadText(target.absolute);
    if (!existing.ok) {
      return existing;
    }
    bom = existing.bom;
    if (existing.eol === "\r\n" && !content.includes("\r")) {
      content = toEol(content, "\r\n");
    }
  }
  const preview = renderPreview(content, 1, Math.min(countLines(content), 20), 0, 20);
  if (args.dryRun) {
    return {
      ok: true,
      file: target.relative,
      action: target.exists ? "overwritten" : "created",
      dryRun: true,
      addedLines: countLines(content),
      bytes: Buffer.byteLength(content, "utf8"),
      backup: null,
      note: "dryRun: nothing was written.",
      preview
    };
  }
  const done = commitText(target.absolute, content, bom, options);
  if (!done.ok) {
    return done;
  }
  return {
    ok: true,
    file: target.relative,
    action: target.exists ? "overwritten" : "created",
    dryRun: false,
    addedLines: countLines(content),
    bytes: done.bytes,
    backup: done.backup,
    preview
  };
}

// tests/fileEditor.test.ts
function project() {
  const base = fs3.mkdtempSync(path3.join(os2.tmpdir(), "fe-edit-"));
  const root = path3.join(base, "proj");
  const outside = path3.join(base, "outside");
  fs3.mkdirSync(path3.join(root, "lib"), { recursive: true });
  fs3.mkdirSync(outside, { recursive: true });
  return { root, backups: path3.join(base, "backups"), outside };
}
function expectFail(r) {
  assert.equal(r.ok, false);
  return r.error;
}
(0, import_node_test.test)("rejects paths that leave the project root", () => {
  const { root, outside } = project();
  fs3.writeFileSync(path3.join(outside, "secret.txt"), "x");
  assert.match(expectFail(resolveEditableTarget(root, "../outside/secret.txt")), /outside the project root/);
  assert.match(expectFail(resolveEditableTarget(root, path3.join(outside, "secret.txt"))), /outside the project root/);
  assert.match(expectFail(resolveEditableTarget(root, "lib/../../outside/secret.txt")), /outside the project root/);
});
(0, import_node_test.test)('accepts a file literally named "..foo" and absolute paths inside the root', () => {
  const { root } = project();
  const ok1 = resolveEditableTarget(root, "lib/..foo.dart");
  assert.equal(ok1.ok, true);
  const ok2 = resolveEditableTarget(root, path3.join(root, "lib", "a.dart"));
  assert.equal(ok2.ok, true);
  if (ok2.ok) {
    assert.equal(ok2.relative, "lib/a.dart");
  }
});
(0, import_node_test.test)("blocks protected directories and directories as targets", () => {
  const { root } = project();
  assert.match(expectFail(resolveEditableTarget(root, ".git/config")), /protected directory/);
  assert.match(expectFail(resolveEditableTarget(root, "node_modules/x/index.js")), /protected directory/);
  assert.match(expectFail(resolveEditableTarget(root, ".flutter-explorer/flutter-explorer.db")), /protected directory/);
  assert.match(expectFail(resolveEditableTarget(root, ".DART_TOOL/package_config.json")), /protected directory/);
  assert.match(expectFail(resolveEditableTarget(root, "lib")), /is a directory/);
  assert.match(expectFail(resolveEditableTarget(root, "")), /required/);
  assert.match(expectFail(resolveEditableTarget("", "lib/a.dart")), /No active project/);
});
(0, import_node_test.test)("blocks a symlink that points outside the project", { skip: process.platform === "win32" }, () => {
  const { root, outside } = project();
  fs3.writeFileSync(path3.join(outside, "secret.txt"), "x");
  fs3.symlinkSync(path3.join(outside, "secret.txt"), path3.join(root, "lib", "link.txt"));
  fs3.symlinkSync(outside, path3.join(root, "lib", "dirlink"));
  assert.match(expectFail(resolveEditableTarget(root, "lib/link.txt")), /symlink/);
  assert.match(expectFail(resolveEditableTarget(root, "lib/dirlink/new.txt")), /symlink/);
});
(0, import_node_test.test)("replaces a unique match and keeps everything else byte-for-byte", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "void a() {}\nvoid b() {}\nvoid c() {}\n");
  const r = editFile(root, { filePath: "lib/a.dart", oldString: "void b() {}", newString: "void b() { print(1); }" }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs3.readFileSync(file, "utf8"), "void a() {}\nvoid b() { print(1); }\nvoid c() {}\n");
  if (r.ok) {
    assert.equal(r.replaced, 1);
    assert.ok(r.backup && fs3.existsSync(r.backup));
    assert.match(r.preview, /\+ 2: void b\(\) \{ print\(1\); \}/);
  }
});
(0, import_node_test.test)("treats $ patterns in newString literally", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "final s = 'X';\n");
  const r = editFile(root, { filePath: "lib/a.dart", oldString: "'X'", newString: "'$&-$1-$$'" }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs3.readFileSync(file, "utf8"), "final s = '$&-$1-$$';\n");
});
(0, import_node_test.test)("refuses an ambiguous match and lists the line numbers; nothing is written", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  const original = "a();\nb();\na();\n";
  fs3.writeFileSync(file, original);
  const err = expectFail(editFile(root, { filePath: "lib/a.dart", oldString: "a();", newString: "z();" }, { backupDir: backups }));
  assert.match(err, /matches 2 places \(lines 1, 3\)/);
  assert.equal(fs3.readFileSync(file, "utf8"), original);
});
(0, import_node_test.test)("replaceAll and expectedCount", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "a();\nb();\na();\n");
  assert.match(expectFail(editFile(root, { filePath: "lib/a.dart", oldString: "a();", newString: "z();", replaceAll: true, expectedCount: 3 }, { backupDir: backups })), /expectedCount is 3/);
  assert.equal(fs3.readFileSync(file, "utf8"), "a();\nb();\na();\n");
  const ok2 = editFile(root, { filePath: "lib/a.dart", oldString: "a();", newString: "z();", replaceAll: true, expectedCount: 2 }, { backupDir: backups });
  assert.equal(ok2.ok, true);
  assert.equal(fs3.readFileSync(file, "utf8"), "z();\nb();\nz();\n");
});
(0, import_node_test.test)("not-found error points at the first matching line", () => {
  const r = applyStringEdit("class A {\n  void x() {}\n}\n", "\n", false, { oldString: "void x() {\n  }", newString: "y" });
  const err = expectFail(r);
  assert.match(err, /not found/);
  assert.match(err, /line 2/);
});
(0, import_node_test.test)("rejects empty and identical oldString", () => {
  assert.match(expectFail(applyStringEdit("abc", "\n", false, { oldString: "", newString: "x" })), /must not be empty/);
  assert.match(expectFail(applyStringEdit("abc", "\n", false, { oldString: "a", newString: "a" })), /identical/);
});
(0, import_node_test.test)("can delete text with an empty newString", () => {
  const r = applyStringEdit("a\nb\nc\n", "\n", false, { oldString: "b\n", newString: "" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, "a\nc\n");
  }
});
(0, import_node_test.test)("CRLF files: an LF oldString matches and the file stays CRLF", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "one\r\ntwo\r\nthree\r\n");
  const r = editFile(root, { filePath: "lib/a.dart", oldString: "one\ntwo", newString: "uno\ndos\ndos2" }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs3.readFileSync(file, "utf8"), "uno\r\ndos\r\ndos2\r\nthree\r\n");
});
(0, import_node_test.test)("BOM is preserved", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "\uFEFFhello\n");
  const r = editFile(root, { filePath: "lib/a.dart", oldString: "hello", newString: "world" }, { backupDir: backups });
  assert.equal(r.ok, true);
  const bytes = fs3.readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
  assert.equal(bytes.toString("utf8"), "\uFEFFworld\n");
});
(0, import_node_test.test)("mixed line endings: lines outside the edit keep their own ending", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "a\r\nb\nc\r\nd\n");
  const r = editFile(root, { filePath: "lib/a.dart", oldString: "b", newString: "B" }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs3.readFileSync(file, "utf8"), "a\r\nB\nc\r\nd\n");
});
(0, import_node_test.test)("Arabic and emoji text round-trips", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.arb");
  fs3.writeFileSync(file, '{"x": "\u0645\u0631\u062D\u0628\u0627 \u{1F44B}"}\n');
  const r = editFile(root, { filePath: "lib/a.arb", oldString: "\u0645\u0631\u062D\u0628\u0627", newString: "\u0623\u0647\u0644\u0627\u064B" }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs3.readFileSync(file, "utf8"), '{"x": "\u0623\u0647\u0644\u0627\u064B \u{1F44B}"}\n');
});
(0, import_node_test.test)("dryRun validates and previews without touching the file or making a backup", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "a\nb\n");
  const r = editFile(root, { filePath: "lib/a.dart", oldString: "b", newString: "B", dryRun: true }, { backupDir: backups });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.dryRun, true);
    assert.match(r.preview, /\+ 2: B/);
  }
  assert.equal(fs3.readFileSync(file, "utf8"), "a\nb\n");
  assert.equal(fs3.existsSync(backups), false);
});
(0, import_node_test.test)("refuses binary files, non-UTF-8 files and oversized files", () => {
  const { root, backups } = project();
  fs3.writeFileSync(path3.join(root, "lib", "bin.dat"), Buffer.from([1, 2, 0, 3, 4]));
  fs3.writeFileSync(path3.join(root, "lib", "latin1.txt"), Buffer.from([99, 97, 102, 233, 10]));
  fs3.writeFileSync(path3.join(root, "lib", "big.txt"), "x".repeat(MAX_EDIT_FILE_BYTES + 1));
  assert.match(expectFail(editFile(root, { filePath: "lib/bin.dat", oldString: "1", newString: "2" }, { backupDir: backups })), /binary/);
  assert.match(expectFail(editFile(root, { filePath: "lib/latin1.txt", oldString: "caf", newString: "x" }, { backupDir: backups })), /not valid UTF-8/);
  assert.match(expectFail(editFile(root, { filePath: "lib/big.txt", oldString: "x", newString: "y" }, { backupDir: backups })), /only handle files up to/);
});
(0, import_node_test.test)("missing file gives a pointer to flutter_write_file", () => {
  const { root, backups } = project();
  assert.match(expectFail(editFile(root, { filePath: "lib/nope.dart", oldString: "a", newString: "b" }, { backupDir: backups })), /flutter_write_file/);
});
(0, import_node_test.test)("keeps only the 10 newest backups per file", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "v0\n");
  for (let i = 0; i < 13; i++) {
    const r = editFile(root, { filePath: "lib/a.dart", oldString: `v${i}`, newString: `v${i + 1}` }, { backupDir: backups });
    assert.equal(r.ok, true);
  }
  assert.equal(fs3.readdirSync(backups).filter((f) => f.endsWith(".bak")).length, 10);
});
(0, import_node_test.test)("replaces a middle range and keeps the trailing newline", () => {
  const r = applyLineReplace("a\nb\nc\nd\n", "\n", { startLine: 2, endLine: 3, newContent: "X" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, "a\nX\nd\n");
    assert.equal(r.removedLines, 2);
  }
});
(0, import_node_test.test)("deletes lines with empty newContent", () => {
  const r = applyLineReplace("a\nb\nc\n", "\n", { startLine: 2, endLine: 2, newContent: "" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, "a\nc\n");
  }
});
(0, import_node_test.test)("inserts before a line when endLine = startLine - 1", () => {
  const r = applyLineReplace("a\nb\n", "\n", { startLine: 2, endLine: 1, newContent: "X\nY" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, "a\nX\nY\nb\n");
    assert.equal(r.removedLines, 0);
  }
});
(0, import_node_test.test)("appends after the last line, with and without a final newline", () => {
  const a = applyLineReplace("a\nb\n", "\n", { startLine: 3, endLine: 2, newContent: "c" });
  assert.equal(a.ok, true);
  if (a.ok) {
    assert.equal(a.text, "a\nb\nc\n");
  }
  const b = applyLineReplace("a\nb", "\n", { startLine: 3, endLine: 2, newContent: "c" });
  assert.equal(b.ok, true);
  if (b.ok) {
    assert.equal(b.text, "a\nb\nc");
  }
});
(0, import_node_test.test)("replacing an unterminated last line does not invent a trailing newline", () => {
  const r = applyLineReplace("a\nb", "\n", { startLine: 2, endLine: 2, newContent: "B" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, "a\nB");
  }
});
(0, import_node_test.test)("works on an empty file", () => {
  const r = applyLineReplace("", "\n", { startLine: 1, endLine: 0, newContent: "first" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, "first\n");
  }
});
(0, import_node_test.test)("line replace keeps CRLF", () => {
  const r = applyLineReplace("a\r\nb\r\nc\r\n", "\r\n", { startLine: 2, endLine: 2, newContent: "X\nY" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.text, "a\r\nX\r\nY\r\nc\r\n");
  }
});
(0, import_node_test.test)("range validation", () => {
  assert.match(expectFail(applyLineReplace("a\nb\n", "\n", { startLine: 0, endLine: 1, newContent: "x" })), /out of range/);
  assert.match(expectFail(applyLineReplace("a\nb\n", "\n", { startLine: 4, endLine: 4, newContent: "x" })), /out of range/);
  assert.match(expectFail(applyLineReplace("a\nb\n", "\n", { startLine: 1, endLine: 3, newContent: "x" })), /endLine 3 is out of range/);
  assert.match(expectFail(applyLineReplace("a\nb\n", "\n", { startLine: 2, endLine: 1.5, newContent: "x" })), /integers/);
});
(0, import_node_test.test)("expectedOldText guards against stale line numbers", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "one\ntwo\nthree\n");
  const bad = expectFail(replaceLines(root, { filePath: "lib/a.dart", startLine: 2, endLine: 2, newContent: "X", expectedOldText: "TWO" }, { backupDir: backups }));
  assert.match(bad, /may have changed/);
  assert.match(bad, /two/);
  assert.equal(fs3.readFileSync(file, "utf8"), "one\ntwo\nthree\n");
  const ok2 = replaceLines(root, { filePath: "lib/a.dart", startLine: 2, endLine: 2, newContent: "X", expectedOldText: "two\n" }, { backupDir: backups });
  assert.equal(ok2.ok, true);
  assert.equal(fs3.readFileSync(file, "utf8"), "one\nX\nthree\n");
});
(0, import_node_test.test)("replaceLines preserves BOM and CRLF on disk", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "\uFEFFa\r\nb\r\n");
  const r = replaceLines(root, { filePath: "lib/a.dart", startLine: 2, endLine: 2, newContent: "B" }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs3.readFileSync(file).toString("utf8"), "\uFEFFa\r\nB\r\n");
});
(0, import_node_test.test)("creates a new file with missing parent folders and no backup", () => {
  const { root, backups } = project();
  const r = writeTextFile(root, { filePath: "lib/features/x/new.dart", content: "class X {}\n" }, { backupDir: backups });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.action, "created");
    assert.equal(r.backup, null);
  }
  assert.equal(fs3.readFileSync(path3.join(root, "lib", "features", "x", "new.dart"), "utf8"), "class X {}\n");
});
(0, import_node_test.test)("refuses to overwrite unless asked, then keeps CRLF and BOM and backs up", () => {
  const { root, backups } = project();
  const file = path3.join(root, "lib", "a.dart");
  fs3.writeFileSync(file, "\uFEFFold\r\nfile\r\n");
  assert.match(expectFail(writeTextFile(root, { filePath: "lib/a.dart", content: "new\ncontent\n" }, { backupDir: backups })), /already exists/);
  assert.equal(fs3.readFileSync(file, "utf8"), "\uFEFFold\r\nfile\r\n");
  const r = writeTextFile(root, { filePath: "lib/a.dart", content: "new\ncontent\n", overwrite: true }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs3.readFileSync(file, "utf8"), "\uFEFFnew\r\ncontent\r\n");
  if (r.ok) {
    assert.ok(r.backup && fs3.readFileSync(r.backup, "utf8") === "\uFEFFold\r\nfile\r\n");
  }
});
(0, import_node_test.test)("write refuses outside paths, protected folders and oversized content", () => {
  const { root, backups } = project();
  assert.match(expectFail(writeTextFile(root, { filePath: "../evil.txt", content: "x" }, { backupDir: backups })), /outside the project root/);
  assert.match(expectFail(writeTextFile(root, { filePath: ".git/hooks/pre-commit", content: "x" }, { backupDir: backups })), /protected directory/);
  assert.match(expectFail(writeTextFile(root, { filePath: "lib/big.txt", content: "x".repeat(MAX_EDIT_FILE_BYTES + 1) }, { backupDir: backups })), /only handle files up to/);
  assert.equal(fs3.existsSync(path3.join(root, "lib", "big.txt")), false);
});
