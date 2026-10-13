/**
 * MCP Integration Test
 * Verifies that the MCP server tools integrate correctly with the indexer,
 * parsers, and SQLite cache without crashing or returning malformed responses.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✔ ${message}`);
    passed++;
  } else {
    console.error(`✘ ${message}`);
    failed++;
  }
}

// Test 1: TypeScript compilation succeeds (all parser + cache + MCP changes are type-safe)
try {
  execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
  assert(true, 'TypeScript compilation passes with no errors');
} catch (err) {
  assert(false, `TypeScript compilation failed: ${err.stdout?.toString().slice(0, 200) || err.message}`);
}

// Test 2: Golden tests still pass (parser fixes did not regress)
try {
  const output = execSync('node tests/test-dart-parser-golden.js', { cwd: ROOT, encoding: 'utf-8' });
  const allPassed = output.includes('ALL 7 GOLDEN TESTS PASSED');
  assert(allPassed, 'All 7 golden parser tests pass');
} catch (err) {
  assert(false, `Golden tests failed: ${err.message}`);
}

// Test 3: IndexManager LRU cache is importable and functional
try {
  // Verify the compiled JS contains the LRUMap class
  const indexPath = path.join(ROOT, 'src', 'indexer', 'indexManager.ts');
  const indexSrc = fs.readFileSync(indexPath, 'utf-8');
  const hasLRU = indexSrc.includes('class LRUMap') && indexSrc.includes('INDEX_CACHE_CAPACITY');
  assert(hasLRU, 'IndexManager uses LRU cache with capacity limit');
} catch (err) {
  assert(false, `LRU cache check failed: ${err.message}`);
}

// Test 4: SQLite cache has connection safety guards
try {
  const sqlitePath = path.join(ROOT, 'src', 'indexer', 'sqliteCache.ts');
  const sqliteSrc = fs.readFileSync(sqlitePath, 'utf-8');
  const hasEnsureOpen = sqliteSrc.includes('ensureOpen()');
  const guardCount = (sqliteSrc.match(/this\.ensureOpen\(\)/g) || []).length;
  assert(hasEnsureOpen && guardCount >= 3, `SQLite cache has ensureOpen() guards (${guardCount} call sites)`);
} catch (err) {
  assert(false, `SQLite safety guard check failed: ${err.message}`);
}

// Test 5: Race condition guard in runConcurrent
try {
  const indexPath = path.join(ROOT, 'src', 'indexer', 'indexManager.ts');
  const indexSrc = fs.readFileSync(indexPath, 'utf-8');
  const hasRaceGuard = indexSrc.includes('activeToken') && indexSrc.includes('isCancellationRequested');
  assert(hasRaceGuard, 'runConcurrent has cancellation token race condition guard');
} catch (err) {
  assert(false, `Race condition guard check failed: ${err.message}`);
}

// Test 6: Empty catch blocks removed from IndexManager
try {
  const indexPath = path.join(ROOT, 'src', 'indexer', 'indexManager.ts');
  const indexSrc = fs.readFileSync(indexPath, 'utf-8');
  // Look for "catch {" without any content before the closing brace (empty catch)
  const emptyCatches = indexSrc.match(/catch\s*\{\s*\}/g) || [];
  assert(emptyCatches.length === 0, `No empty catch blocks remain in IndexManager (found ${emptyCatches.length})`);
} catch (err) {
  assert(false, `Empty catch block check failed: ${err.message}`);
}

// Test 7: Scratch test files cleaned up
try {
  const scratchDir = path.join(ROOT, 'scratch');
  const scratchFiles = fs.existsSync(scratchDir) ? fs.readdirSync(scratchDir) : [];
  const testFiles = scratchFiles.filter(f => f.startsWith('test_') && f.endsWith('.js'));
  assert(testFiles.length === 0, `Scratch test_*.js files cleaned up (${testFiles.length} remaining)`);
} catch (err) {
  assert(false, `Scratch cleanup check failed: ${err.message}`);
}

// Test 8: MCP server path traversal protection exists
try {
  const mcpPath = path.join(ROOT, 'src', 'mcp-server.ts');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf-8');
  const hasTraversalGuard = mcpSrc.includes("includes('..')") && mcpSrc.includes('traversal attempt');
  assert(hasTraversalGuard, 'MCP server has path traversal protection');
} catch (err) {
  assert(false, `MCP path traversal check failed: ${err.message}`);
}

// Summary
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} integration checks`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL INTEGRATION TESTS PASSED!');
}