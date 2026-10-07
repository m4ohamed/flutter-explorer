// Minimal test runner: bundles every tests/**/*.test.ts with esbuild and runs them with node:test.
// No extra dependencies (esbuild is already a devDependency of this project).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, '.test-out');

function findTests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'fixtures') { found.push(...findTests(full)); }
    } else if (entry.name.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const entries = findTests(__dirname);
  if (entries.length === 0) {
    console.error('No test files found');
    process.exit(1);
  }
  await esbuild.build({
    entryPoints: entries,
    outdir: outDir,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode', 'sqlite3'],
    logLevel: 'warning',
    outExtension: { '.js': '.test.js' },
  });
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.test.js')).map(f => path.join(outDir, f));
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
  process.exit(result.status ?? 1);
}

main().catch(err => { console.error(err); process.exit(1); });
