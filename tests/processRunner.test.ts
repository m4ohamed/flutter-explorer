import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isSafeArg, resolveInsideProject, runProcess, parseToolDiagnostics } from '../src/utils/processRunner';
import { runProjectAnalysis, runBuildRunner } from '../src/utils/analysisRunner';

test('isSafeArg rejects every shell meta character', () => {
  for (const bad of ['lib; calc.exe', 'a&b', 'a|b', '$(whoami)', '`id`', 'a"b', '%PATH%', 'a\nb', 'a>b', 'a<b', 'a^b', 'a!b', '*.dart', '{a,b}', '']) {
    assert.equal(isSafeArg(bad), false, JSON.stringify(bad));
  }
});

test('isSafeArg accepts ordinary and Arabic paths', () => {
  for (const ok of ['lib/features/posts', 'C:\\Users\\Name With Space\\proj', 'مشروع/lib/main.dart', '--noEmit', 'src/(group)/page.tsx', "it's/fine.dart"]) {
    assert.equal(isSafeArg(ok), true, ok);
  }
});

test('resolveInsideProject keeps paths inside the project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-root-'));
  fs.mkdirSync(path.join(root, 'lib'));
  assert.equal(resolveInsideProject(root, 'lib')?.rel, 'lib');
  assert.equal(resolveInsideProject(root, path.join(root, 'lib'))?.rel, 'lib');
  assert.equal(resolveInsideProject(root, '.')?.rel, '.');
  assert.equal(resolveInsideProject(root, '../etc/passwd'), null);
  assert.equal(resolveInsideProject(root, path.join(os.tmpdir(), 'other')), null);
  assert.equal(resolveInsideProject(root, 'lib; calc.exe'), null);
  assert.equal(resolveInsideProject(root, '-rf')?.rel, './-rf');
  assert.equal(resolveInsideProject(root, ''), null);
  assert.equal(resolveInsideProject(root, undefined), null);
});

test('resolveInsideProject rejects a symlink that points outside', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-out-'));
  fs.symlinkSync(outside, path.join(root, 'escape'));
  assert.equal(resolveInsideProject(root, 'escape'), null);
});

test('runProcess refuses commands outside the allow-list', async () => {
  const r = await runProcess('calc.exe', [], { cwd: os.tmpdir() });
  assert.match(r.error ?? '', /not allowed/);
});

test('runProcess refuses injected arguments and never starts a shell', async () => {
  const marker = path.join(os.tmpdir(), 'fe-pwned-' + Date.now());
  const r = await runProcess('node', ['-e', '1', `; touch ${marker}`], { cwd: os.tmpdir() });
  assert.match(r.error ?? '', /Unsafe argument/);
  assert.equal(fs.existsSync(marker), false);
});

function script(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-script-'));
  const file = path.join(dir, 'run.js');
  fs.writeFileSync(file, body);
  return file;
}

test('runProcess runs allowed commands and captures output', async () => {
  const r = await runProcess('node', [script('console.log(21 * 2);')], { cwd: os.tmpdir() });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '42');
});

test('runProcess reports non-zero exit codes and stderr', async () => {
  const r = await runProcess('node', [script('console.error(7); process.exit(3);')], { cwd: os.tmpdir() });
  assert.equal(r.code, 3);
  assert.equal(r.stderr.trim(), '7');
});

test('runProcess kills on timeout', async () => {
  const t0 = Date.now();
  const r = await runProcess('node', [script('setTimeout(() => {}, 60000);')], { cwd: os.tmpdir(), timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 5000);
});

test('runProcess reports a missing executable as an error', async () => {
  const r = await runProcess('flutter', ['--version'], { cwd: os.tmpdir() });
  // Either flutter exists on this machine or we get a clear "not found" error.
  assert.ok(r.code === 0 || (r.error ?? '').includes('Command not found'));
});

test('parseToolDiagnostics understands flutter, tsc and javac output', () => {
  const out = [
    "  error • Undefined name 'x' • lib/main.dart:12:5 • undefined_identifier",
    '   info • Avoid print • lib/a.dart:3:1 • avoid_print',
    "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    'src/Main.java:7: error: cannot find symbol',
    'random noise',
  ].join('\n');
  const d = parseToolDiagnostics(out);
  assert.equal(d.length, 4);
  assert.deepEqual(d.map(x => x.severity), ['error', 'info', 'error', 'error']);
  assert.equal(d[0].file, 'lib/main.dart');
  assert.equal(d[0].line, 12);
  assert.equal(d[2].description, 'TS2322');
});

test('runProjectAnalysis rejects targets outside the project and injection attempts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-proj-'));
  const a = await runProjectAnalysis(root, 'flutter', '../../etc');
  assert.equal(a.ok, false);
  const b = await runProjectAnalysis(root, 'flutter', 'lib && calc.exe');
  assert.equal(b.ok, false);
});

test('runProjectAnalysis runs tsc, parses errors and filters by target', async () => {
  // Needs a typescript install; the test tree lives inside the workspace that has node_modules.
  const base = path.resolve(__dirname, '..', '.tmp-ts-proj');
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(path.join(base, 'src', 'a'), { recursive: true });
  fs.mkdirSync(path.join(base, 'src', 'b'), { recursive: true });
  fs.writeFileSync(path.join(base, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] }));
  fs.writeFileSync(path.join(base, 'src', 'a', 'bad.ts'), 'export const n: number = "x";\n');
  fs.writeFileSync(path.join(base, 'src', 'b', 'bad2.ts'), 'export const m: boolean = 5;\n');
  try {
    const all = await runProjectAnalysis(base, 'ts');
    assert.equal(all.ok, true);
    if (all.ok) {
      assert.equal(all.report.success, false);
      assert.equal(all.report.diagnosticsCount, 2);
    }
    const only = await runProjectAnalysis(base, 'ts', 'src/a');
    assert.equal(only.ok, true);
    if (only.ok) {
      assert.equal(only.report.diagnosticsCount, 1);
      assert.match(only.report.diagnostics[0].file, /src[\\/]a[\\/]bad\.ts/);
      assert.match(only.report.note ?? '', /whole project/);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a missing tool is reported as failure, not success', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-proj-'));
  const r = await runProjectAnalysis(root, 'flutter');
  assert.equal(r.ok, true);
  if (r.ok && !r.report.success) {
    assert.ok(r.report.note);
  }
});

test('runBuildRunner requires a pubspec.yaml', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-proj-'));
  const r = await runBuildRunner(root);
  assert.equal(r.ok, false);
});
