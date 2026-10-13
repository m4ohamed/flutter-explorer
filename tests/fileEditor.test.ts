import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveEditableTarget, applyStringEdit, applyLineReplace,
  editFile, replaceLines, writeTextFile, MAX_EDIT_FILE_BYTES,
} from '../src/utils/fileEditor';

function project(): { root: string; backups: string; outside: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-edit-'));
  const root = path.join(base, 'proj');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return { root, backups: path.join(base, 'backups'), outside };
}

function expectFail(r: { ok: boolean }): string {
  assert.equal(r.ok, false);
  return (r as { ok: false; error: string }).error;
}

// ───────────────────────── path confinement ─────────────────────────

test('rejects paths that leave the project root', () => {
  const { root, outside } = project();
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  assert.match(expectFail(resolveEditableTarget(root, '../outside/secret.txt')), /outside the project root/);
  assert.match(expectFail(resolveEditableTarget(root, path.join(outside, 'secret.txt'))), /outside the project root/);
  assert.match(expectFail(resolveEditableTarget(root, 'lib/../../outside/secret.txt')), /outside the project root/);
});

test('accepts a file literally named "..foo" and absolute paths inside the root', () => {
  const { root } = project();
  const ok1 = resolveEditableTarget(root, 'lib/..foo.dart');
  assert.equal(ok1.ok, true);
  const ok2 = resolveEditableTarget(root, path.join(root, 'lib', 'a.dart'));
  assert.equal(ok2.ok, true);
  if (ok2.ok) { assert.equal(ok2.relative, 'lib/a.dart'); }
});

test('blocks protected directories and directories as targets', () => {
  const { root } = project();
  assert.match(expectFail(resolveEditableTarget(root, '.git/config')), /protected directory/);
  assert.match(expectFail(resolveEditableTarget(root, 'node_modules/x/index.js')), /protected directory/);
  assert.match(expectFail(resolveEditableTarget(root, '.flutter-explorer/flutter-explorer.db')), /protected directory/);
  assert.match(expectFail(resolveEditableTarget(root, '.DART_TOOL/package_config.json')), /protected directory/);
  assert.match(expectFail(resolveEditableTarget(root, 'lib')), /is a directory/);
  assert.match(expectFail(resolveEditableTarget(root, '')), /required/);
  assert.match(expectFail(resolveEditableTarget('', 'lib/a.dart')), /No active project/);
});

test('blocks a symlink that points outside the project', { skip: process.platform === 'win32' }, () => {
  const { root, outside } = project();
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'lib', 'link.txt'));
  fs.symlinkSync(outside, path.join(root, 'lib', 'dirlink'));
  assert.match(expectFail(resolveEditableTarget(root, 'lib/link.txt')), /symlink/);
  assert.match(expectFail(resolveEditableTarget(root, 'lib/dirlink/new.txt')), /symlink/);
});

// ───────────────────────── string edits ─────────────────────────

test('replaces a unique match and keeps everything else byte-for-byte', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, 'void a() {}\nvoid b() {}\nvoid c() {}\n');
  const r = editFile(root, { filePath: 'lib/a.dart', oldString: 'void b() {}', newString: 'void b() { print(1); }' }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'void a() {}\nvoid b() { print(1); }\nvoid c() {}\n');
  if (r.ok) {
    assert.equal(r.replaced, 1);
    assert.ok(r.backup && fs.existsSync(r.backup));
    assert.match(r.preview, /\+ 2: void b\(\) \{ print\(1\); \}/);
  }
});

test('treats $ patterns in newString literally', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, "final s = 'X';\n");
  const r = editFile(root, { filePath: 'lib/a.dart', oldString: "'X'", newString: "'$&-$1-$$'" }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), "final s = '$&-$1-$$';\n");
});

test('refuses an ambiguous match and lists the line numbers; nothing is written', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  const original = 'a();\nb();\na();\n';
  fs.writeFileSync(file, original);
  const err = expectFail(editFile(root, { filePath: 'lib/a.dart', oldString: 'a();', newString: 'z();' }, { backupDir: backups }));
  assert.match(err, /matches 2 places \(lines 1, 3\)/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('replaceAll and expectedCount', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, 'a();\nb();\na();\n');
  assert.match(expectFail(editFile(root, { filePath: 'lib/a.dart', oldString: 'a();', newString: 'z();', replaceAll: true, expectedCount: 3 }, { backupDir: backups })), /expectedCount is 3/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'a();\nb();\na();\n');
  const ok = editFile(root, { filePath: 'lib/a.dart', oldString: 'a();', newString: 'z();', replaceAll: true, expectedCount: 2 }, { backupDir: backups });
  assert.equal(ok.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'z();\nb();\nz();\n');
});

test('not-found error points at the first matching line', () => {
  const r = applyStringEdit('class A {\n  void x() {}\n}\n', '\n', false, { oldString: 'void x() {\n  }', newString: 'y' });
  const err = expectFail(r);
  assert.match(err, /not found/);
  assert.match(err, /line 2/);
});

test('rejects empty and identical oldString', () => {
  assert.match(expectFail(applyStringEdit('abc', '\n', false, { oldString: '', newString: 'x' })), /must not be empty/);
  assert.match(expectFail(applyStringEdit('abc', '\n', false, { oldString: 'a', newString: 'a' })), /identical/);
});

test('can delete text with an empty newString', () => {
  const r = applyStringEdit('a\nb\nc\n', '\n', false, { oldString: 'b\n', newString: '' });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.text, 'a\nc\n'); }
});

test('CRLF files: an LF oldString matches and the file stays CRLF', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, 'one\r\ntwo\r\nthree\r\n');
  const r = editFile(root, { filePath: 'lib/a.dart', oldString: 'one\ntwo', newString: 'uno\ndos\ndos2' }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'uno\r\ndos\r\ndos2\r\nthree\r\n');
});

test('BOM is preserved', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, '\uFEFFhello\n');
  const r = editFile(root, { filePath: 'lib/a.dart', oldString: 'hello', newString: 'world' }, { backupDir: backups });
  assert.equal(r.ok, true);
  const bytes = fs.readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(bytes.toString('utf8'), '\uFEFFworld\n');
});

test('mixed line endings: lines outside the edit keep their own ending', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, 'a\r\nb\nc\r\nd\n');
  const r = editFile(root, { filePath: 'lib/a.dart', oldString: 'b', newString: 'B' }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'a\r\nB\nc\r\nd\n');
});

test('Arabic and emoji text round-trips', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.arb');
  fs.writeFileSync(file, '{"x": "مرحبا 👋"}\n');
  const r = editFile(root, { filePath: 'lib/a.arb', oldString: 'مرحبا', newString: 'أهلاً' }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"x": "أهلاً 👋"}\n');
});

test('dryRun validates and previews without touching the file or making a backup', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, 'a\nb\n');
  const r = editFile(root, { filePath: 'lib/a.dart', oldString: 'b', newString: 'B', dryRun: true }, { backupDir: backups });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.dryRun, true); assert.match(r.preview, /\+ 2: B/); }
  assert.equal(fs.readFileSync(file, 'utf8'), 'a\nb\n');
  assert.equal(fs.existsSync(backups), false);
});

test('refuses binary files, non-UTF-8 files and oversized files', () => {
  const { root, backups } = project();
  fs.writeFileSync(path.join(root, 'lib', 'bin.dat'), Buffer.from([1, 2, 0, 3, 4]));
  fs.writeFileSync(path.join(root, 'lib', 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  fs.writeFileSync(path.join(root, 'lib', 'big.txt'), 'x'.repeat(MAX_EDIT_FILE_BYTES + 1));
  assert.match(expectFail(editFile(root, { filePath: 'lib/bin.dat', oldString: '1', newString: '2' }, { backupDir: backups })), /binary/);
  assert.match(expectFail(editFile(root, { filePath: 'lib/latin1.txt', oldString: 'caf', newString: 'x' }, { backupDir: backups })), /not valid UTF-8/);
  assert.match(expectFail(editFile(root, { filePath: 'lib/big.txt', oldString: 'x', newString: 'y' }, { backupDir: backups })), /only handle files up to/);
});

test('missing file gives a pointer to flutter_write_file', () => {
  const { root, backups } = project();
  assert.match(expectFail(editFile(root, { filePath: 'lib/nope.dart', oldString: 'a', newString: 'b' }, { backupDir: backups })), /flutter_write_file/);
});

test('keeps only the 10 newest backups per file', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, 'v0\n');
  for (let i = 0; i < 13; i++) {
    const r = editFile(root, { filePath: 'lib/a.dart', oldString: `v${i}`, newString: `v${i + 1}` }, { backupDir: backups });
    assert.equal(r.ok, true);
  }
  assert.equal(fs.readdirSync(backups).filter(f => f.endsWith('.bak')).length, 10);
});

// ───────────────────────── line replacement ─────────────────────────

test('replaces a middle range and keeps the trailing newline', () => {
  const r = applyLineReplace('a\nb\nc\nd\n', '\n', { startLine: 2, endLine: 3, newContent: 'X' });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.text, 'a\nX\nd\n'); assert.equal(r.removedLines, 2); }
});

test('deletes lines with empty newContent', () => {
  const r = applyLineReplace('a\nb\nc\n', '\n', { startLine: 2, endLine: 2, newContent: '' });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.text, 'a\nc\n'); }
});

test('inserts before a line when endLine = startLine - 1', () => {
  const r = applyLineReplace('a\nb\n', '\n', { startLine: 2, endLine: 1, newContent: 'X\nY' });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.text, 'a\nX\nY\nb\n'); assert.equal(r.removedLines, 0); }
});

test('appends after the last line, with and without a final newline', () => {
  const a = applyLineReplace('a\nb\n', '\n', { startLine: 3, endLine: 2, newContent: 'c' });
  assert.equal(a.ok, true);
  if (a.ok) { assert.equal(a.text, 'a\nb\nc\n'); }
  const b = applyLineReplace('a\nb', '\n', { startLine: 3, endLine: 2, newContent: 'c' });
  assert.equal(b.ok, true);
  if (b.ok) { assert.equal(b.text, 'a\nb\nc'); }
});

test('replacing an unterminated last line does not invent a trailing newline', () => {
  const r = applyLineReplace('a\nb', '\n', { startLine: 2, endLine: 2, newContent: 'B' });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.text, 'a\nB'); }
});

test('works on an empty file', () => {
  const r = applyLineReplace('', '\n', { startLine: 1, endLine: 0, newContent: 'first' });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.text, 'first\n'); }
});

test('line replace keeps CRLF', () => {
  const r = applyLineReplace('a\r\nb\r\nc\r\n', '\r\n', { startLine: 2, endLine: 2, newContent: 'X\nY' });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.text, 'a\r\nX\r\nY\r\nc\r\n'); }
});

test('range validation', () => {
  assert.match(expectFail(applyLineReplace('a\nb\n', '\n', { startLine: 0, endLine: 1, newContent: 'x' })), /out of range/);
  assert.match(expectFail(applyLineReplace('a\nb\n', '\n', { startLine: 4, endLine: 4, newContent: 'x' })), /out of range/);
  assert.match(expectFail(applyLineReplace('a\nb\n', '\n', { startLine: 1, endLine: 3, newContent: 'x' })), /endLine 3 is out of range/);
  assert.match(expectFail(applyLineReplace('a\nb\n', '\n', { startLine: 2, endLine: 1.5, newContent: 'x' })), /integers/);
});

test('expectedOldText guards against stale line numbers', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, 'one\ntwo\nthree\n');
  const bad = expectFail(replaceLines(root, { filePath: 'lib/a.dart', startLine: 2, endLine: 2, newContent: 'X', expectedOldText: 'TWO' }, { backupDir: backups }));
  assert.match(bad, /may have changed/);
  assert.match(bad, /two/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\ntwo\nthree\n');
  const ok = replaceLines(root, { filePath: 'lib/a.dart', startLine: 2, endLine: 2, newContent: 'X', expectedOldText: 'two\n' }, { backupDir: backups });
  assert.equal(ok.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\nX\nthree\n');
});

test('replaceLines preserves BOM and CRLF on disk', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, '\uFEFFa\r\nb\r\n');
  const r = replaceLines(root, { filePath: 'lib/a.dart', startLine: 2, endLine: 2, newContent: 'B' }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(file).toString('utf8'), '\uFEFFa\r\nB\r\n');
});

// ───────────────────────── write file ─────────────────────────

test('creates a new file with missing parent folders and no backup', () => {
  const { root, backups } = project();
  const r = writeTextFile(root, { filePath: 'lib/features/x/new.dart', content: 'class X {}\n' }, { backupDir: backups });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.action, 'created'); assert.equal(r.backup, null); }
  assert.equal(fs.readFileSync(path.join(root, 'lib', 'features', 'x', 'new.dart'), 'utf8'), 'class X {}\n');
});

test('refuses to overwrite unless asked, then keeps CRLF and BOM and backs up', () => {
  const { root, backups } = project();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, '\uFEFFold\r\nfile\r\n');
  assert.match(expectFail(writeTextFile(root, { filePath: 'lib/a.dart', content: 'new\ncontent\n' }, { backupDir: backups })), /already exists/);
  assert.equal(fs.readFileSync(file, 'utf8'), '\uFEFFold\r\nfile\r\n');
  const r = writeTextFile(root, { filePath: 'lib/a.dart', content: 'new\ncontent\n', overwrite: true }, { backupDir: backups });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '\uFEFFnew\r\ncontent\r\n');
  if (r.ok) { assert.ok(r.backup && fs.readFileSync(r.backup, 'utf8') === '\uFEFFold\r\nfile\r\n'); }
});

test('write refuses outside paths, protected folders and oversized content', () => {
  const { root, backups } = project();
  assert.match(expectFail(writeTextFile(root, { filePath: '../evil.txt', content: 'x' }, { backupDir: backups })), /outside the project root/);
  assert.match(expectFail(writeTextFile(root, { filePath: '.git/hooks/pre-commit', content: 'x' }, { backupDir: backups })), /protected directory/);
  assert.match(expectFail(writeTextFile(root, { filePath: 'lib/big.txt', content: 'x'.repeat(MAX_EDIT_FILE_BYTES + 1) }, { backupDir: backups })), /only handle files up to/);
  assert.equal(fs.existsSync(path.join(root, 'lib', 'big.txt')), false);
});
