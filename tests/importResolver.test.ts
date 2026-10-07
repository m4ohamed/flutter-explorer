import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ImportResolver, CallResolver, makeQName } from '../src/indexer/importResolver';

const FILES = [
  'src/extension.ts',
  'src/indexer/indexManager.ts',
  'src/indexer/dartParser.ts',
  'src/indexer/jsTsParser.ts',
  'src/utils/index.ts',
  'src/utils/helpers.tsx',
  'lib/main.dart',
  'lib/core/theme.dart',
  'lib/data/user.dart',
  'lib/data/user.g.dart',
  'android/app/src/main/java/com/example/app/MainActivity.kt',
];

test('relative TypeScript imports resolve without extension', () => {
  const r = new ImportResolver(FILES);
  assert.equal(r.resolve('src/extension.ts', './indexer/indexManager'), 'src/indexer/indexManager.ts');
  assert.equal(r.resolve('src/indexer/indexManager.ts', './dartParser'), 'src/indexer/dartParser.ts');
});

test('ESM style ".js" specifiers map to the .ts source', () => {
  const r = new ImportResolver(FILES);
  assert.equal(r.resolve('src/indexer/indexManager.ts', './jsTsParser.js'), 'src/indexer/jsTsParser.ts');
});

test('directory imports resolve to index files and .tsx', () => {
  const r = new ImportResolver(FILES);
  assert.equal(r.resolve('src/extension.ts', './utils'), 'src/utils/index.ts');
  assert.equal(r.resolve('src/extension.ts', './utils/helpers'), 'src/utils/helpers.tsx');
});

test('npm packages, node builtins and SDK libraries are external', () => {
  const r = new ImportResolver(FILES, 'my_app');
  assert.equal(r.resolve('src/extension.ts', 'vscode'), null);
  assert.equal(r.resolve('src/extension.ts', 'node:fs'), null);
  assert.equal(r.resolve('lib/main.dart', 'dart:async'), null);
  assert.equal(r.resolve('lib/main.dart', 'package:flutter/material.dart'), null);
});

test('dart package: imports of the own package resolve to lib/', () => {
  const r = new ImportResolver(FILES, 'my_app');
  assert.equal(r.resolve('lib/main.dart', 'package:my_app/core/theme.dart'), 'lib/core/theme.dart');
});

test('dart relative imports and part directives work without "./"', () => {
  const r = new ImportResolver(FILES, 'my_app');
  assert.equal(r.resolve('lib/main.dart', 'core/theme.dart'), 'lib/core/theme.dart');
  assert.equal(r.resolve('lib/data/user.dart', 'user.g.dart'), 'lib/data/user.g.dart');
  assert.equal(r.resolve('lib/data/user.g.dart', 'user.dart'), 'lib/data/user.dart');
});

test('kotlin fully qualified imports resolve by package path', () => {
  const r = new ImportResolver(FILES);
  assert.equal(
    r.resolve('android/app/src/main/java/com/example/app/Other.kt', 'com.example.app.MainActivity'),
    'android/app/src/main/java/com/example/app/MainActivity.kt',
  );
});

test('imports escaping the project are rejected', () => {
  const r = new ImportResolver(FILES);
  assert.equal(r.resolve('src/extension.ts', '../../outside'), null);
});

test('tsconfig style path aliases', () => {
  const r = new ImportResolver(FILES, { paths: { '@/*': ['src/*'] } });
  assert.equal(r.resolve('src/extension.ts', '@/indexer/indexManager'), 'src/indexer/indexManager.ts');
});

test('windows style keys are normalised and returned as indexed', () => {
  const r = new ImportResolver(['src\\a.ts', 'src\\b.ts']);
  assert.equal(r.resolve('src\\a.ts', './b'), 'src\\b.ts');
});

// ── CallResolver ────────────────────────────────────────────────────────────

const INDEX = {
  'src/a.ts': {
    imports: [{ path: './b' }],
    classes: [
      { name: 'Alpha', line: 1, lineEnd: 20, extendsClass: 'Base', methods: [{ name: 'run' }, { name: 'build' }] },
    ],
    functions: [{ name: 'helper' }],
  },
  'src/b.ts': {
    imports: [],
    classes: [
      { name: 'Base', line: 1, lineEnd: 10, methods: [{ name: 'dispose' }] },
      { name: 'IndexManager', line: 12, lineEnd: 40, methods: [{ name: 'buildFullIndex' }, { name: 'build' }] },
    ],
    functions: [{ name: 'fromB' }, { name: 'helper' }],
  },
  'src/c.ts': {
    imports: [],
    classes: [{ name: 'Other', line: 1, lineEnd: 9, methods: [{ name: 'build' }] }],
    functions: [{ name: 'unique' }],
  },
};

function makeCalls() {
  const resolver = new ImportResolver(Object.keys(INDEX));
  return new CallResolver(INDEX, resolver);
}

test('calls on this / super use the caller class and its ancestors', () => {
  const c = makeCalls();
  assert.equal(c.resolve('src/a.ts', { name: 'run', receiver: 'this', callerClass: 'Alpha' })?.qname, makeQName('src/a.ts', 'Alpha', 'run'));
  assert.equal(c.resolve('src/a.ts', { name: 'dispose', receiver: 'this', callerClass: 'Alpha' })?.qname, makeQName('src/b.ts', 'Base', 'dispose'));
  assert.equal(c.resolve('src/a.ts', { name: 'dispose', receiver: 'super', callerClass: 'Alpha' })?.qname, makeQName('src/b.ts', 'Base', 'dispose'));
});

test('a variable named after a class resolves to that class (indexManager -> IndexManager)', () => {
  const c = makeCalls();
  const hit = c.resolve('src/a.ts', { name: 'buildFullIndex', receiver: 'indexManager' });
  assert.equal(hit?.qname, makeQName('src/b.ts', 'IndexManager', 'buildFullIndex'));
});

test('ambiguous method names are NOT guessed (the old resolver picked the first class)', () => {
  const c = makeCalls();
  assert.equal(c.resolve('src/c.ts', { name: 'build', receiver: 'somethingElse' }), null);
  // But a call on a known class picks that class's method, not the first "build" in the index.
  assert.equal(c.resolve('src/c.ts', { name: 'build', receiver: 'IndexManager' })?.qname, makeQName('src/b.ts', 'IndexManager', 'build'));
});

test('bare calls prefer same file, then imported files, then unique global', () => {
  const c = makeCalls();
  assert.equal(c.resolve('src/a.ts', { name: 'helper' })?.qname, makeQName('src/a.ts', null, 'helper'));
  assert.equal(c.resolve('src/a.ts', { name: 'fromB' })?.qname, makeQName('src/b.ts', null, 'fromB'));
  assert.equal(c.resolve('src/a.ts', { name: 'unique' })?.qname, makeQName('src/c.ts', null, 'unique'));
  assert.equal(c.resolve('src/c.ts', { name: 'helper' }), null); // ambiguous globally, not imported
});

test('instantiation resolves to the class', () => {
  const c = makeCalls();
  const hit = c.resolve('src/a.ts', { name: 'IndexManager' });
  assert.equal(hit?.kind, 'class');
  assert.equal(hit?.qname, makeQName('src/b.ts', null, 'IndexManager'));
});

test('missing callerClass is inferred from the line range', () => {
  const c = makeCalls();
  assert.equal(c.classAt('src/a.ts', 5), 'Alpha');
  assert.equal(c.callerQName('src/a.ts', { name: 'x', callerFunction: 'run', line: 5 }), makeQName('src/a.ts', 'Alpha', 'run'));
  assert.equal(c.callerQName('src/a.ts', { name: 'x', line: 99 }), makeQName('src/a.ts', null, '<module>'));
});
