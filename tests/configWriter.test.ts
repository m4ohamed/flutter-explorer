import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { upsertMcpServer, upsertMarkedBlock, backupFile } from '../src/utils/configWriter';

function tmp(): { dir: string; backups: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-cfg-'));
  return { dir, backups: path.join(dir, 'backups') };
}
const ENTRY = { command: 'node', args: ['/x/out/mcp-server.js'], env: { FLUTTER_PROJECT_PATH: '${workspaceFolder}' } };

test('creates a new config file', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'sub', 'mcp.json');
  const r = upsertMcpServer(file, 'flutter-explorer-mcp', ENTRY, false, backups);
  assert.equal(r.status, 'created');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: { 'flutter-explorer-mcp': ENTRY } });
});

test('keeps every other server and top level key, backs up, and is idempotent', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'claude_desktop_config.json');
  const original = { theme: 'dark', mcpServers: { other: { command: 'x' }, another: { command: 'y' } } };
  fs.writeFileSync(file, JSON.stringify(original, null, 4) + '\n');

  const r1 = upsertMcpServer(file, 'flutter-explorer-mcp', ENTRY, false, backups);
  assert.equal(r1.status, 'updated');
  assert.ok(r1.backup && fs.existsSync(r1.backup));
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.theme, 'dark');
  assert.deepEqual(Object.keys(after.mcpServers).sort(), ['another', 'flutter-explorer-mcp', 'other']);
  assert.match(fs.readFileSync(file, 'utf8'), /^ {4}"theme"/m, 'indentation preserved');

  const mtime = fs.statSync(file).mtimeMs;
  const r2 = upsertMcpServer(file, 'flutter-explorer-mcp', ENTRY, false, backups);
  assert.equal(r2.status, 'unchanged');
  assert.equal(fs.statSync(file).mtimeMs, mtime, 'no rewrite when nothing changed');
});

test('NEVER overwrites a file that is not strict JSON (old code replaced it with {})', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'mcp.json');
  const jsonc = '{\n  // my servers\n  "servers": { "keep-me": { "command": "x" }, },\n}\n';
  fs.writeFileSync(file, jsonc);
  const r = upsertMcpServer(file, 'flutter-explorer-mcp', ENTRY, true, backups);
  assert.equal(r.status, 'skipped');
  assert.equal(fs.readFileSync(file, 'utf8'), jsonc);

  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ "mcpServers": { "a": ');
  assert.equal(upsertMcpServer(broken, 'x', ENTRY, false, backups).status, 'skipped');
  assert.equal(fs.readFileSync(broken, 'utf8'), '{ "mcpServers": { "a": ');
});

test('merges servers stored under the other key instead of deleting them', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({ servers: { a: { command: 'a' } }, mcpServers: { b: { command: 'b' } } }));
  const r = upsertMcpServer(file, 'flutter-explorer-mcp', ENTRY, true, backups);
  assert.equal(r.status, 'updated');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.mcpServers, undefined);
  assert.deepEqual(Object.keys(after.servers).sort(), ['a', 'b', 'flutter-explorer-mcp']);
});

test('preserves CRLF files', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'mcp.json');
  fs.writeFileSync(file, '{\r\n  "mcpServers": {}\r\n}\r\n');
  upsertMcpServer(file, 'flutter-explorer-mcp', ENTRY, false, backups);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(text));
});

test('backups are pruned to the 10 newest per file', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'a.json');
  fs.writeFileSync(file, '{}');
  for (let i = 0; i < 14; i++) { backupFile(file, backups); }
  assert.ok(fs.readdirSync(backups).length <= 10);
});

// ── GEMINI.md style marker blocks ───────────────────────────────────────────

const HEADER = '# Agent rules';
const BODY = `${HEADER}\n\nrule one\nrule two\n\n## Section\ntext`;

test('creates the file with a marked block', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'GEMINI.md');
  assert.equal(upsertMarkedBlock(file, 'rules', BODY, HEADER, backups).status, 'created');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /flutter-explorer:rules:begin/);
  assert.match(text, /rule two/);
});

test('re-running is idempotent and content below the block survives updates', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'GEMINI.md');
  upsertMarkedBlock(file, 'rules', BODY, HEADER, backups);
  assert.equal(upsertMarkedBlock(file, 'rules', BODY, HEADER, backups).status, 'unchanged');

  fs.appendFileSync(file, '\n# My own notes\nkeep this forever\n');
  const r = upsertMarkedBlock(file, 'rules', BODY.replace('rule two', 'rule TWO (new)'), HEADER, backups);
  assert.equal(r.status, 'updated');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /rule TWO \(new\)/);
  assert.doesNotMatch(text, /rule two\n/);
  assert.match(text, /keep this forever/);
});

test('migrates the legacy unmarked block without eating user content after it', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'GEMINI.md');
  const legacy = `# Existing user text\nhello\n\n${BODY.replace('rule one', 'OLD RULE')}\n\n# User section after\nprecious\n`;
  fs.writeFileSync(file, legacy);
  const r = upsertMarkedBlock(file, 'rules', BODY, HEADER, backups);
  assert.equal(r.status, 'updated');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /Existing user text/);
  assert.doesNotMatch(text, /OLD RULE/);
  assert.match(text, /rule one/);
  assert.match(text, /# User section after\nprecious/);
  assert.equal(text.split('flutter-explorer:rules:begin').length - 1, 1);
});

test('legacy block at the very end of the file is migrated too', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'GEMINI.md');
  fs.writeFileSync(file, `user line\n\n${BODY.replace('rule one', 'OLD')}\n`);
  upsertMarkedBlock(file, 'rules', BODY, HEADER, backups);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^user line/);
  assert.doesNotMatch(text, /OLD/);
  assert.match(text, /rule one/);
});

test('appends to a file that has other content', () => {
  const { dir, backups } = tmp();
  const file = path.join(dir, 'GEMINI.md');
  fs.writeFileSync(file, 'something else\n');
  upsertMarkedBlock(file, 'rules', BODY, HEADER, backups);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^something else/);
  assert.match(text, /rule one/);
});
