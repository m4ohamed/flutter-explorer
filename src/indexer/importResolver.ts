/**
 * Import & call resolution shared by IndexManager, the MCP server and the code analyzer.
 *
 * Before this module existed there were three independent resolvers with different rules
 * (only one of them knew about TypeScript extensions), which is why cycle detection and the
 * architecture report silently returned nothing for TypeScript projects.
 *
 * This file has no dependency on `vscode`, so it can be used from the MCP server process too.
 */
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Import resolution
// ─────────────────────────────────────────────────────────────────────────────

const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];
const OTHER_EXTS = ['.dart', '.kt', '.java'];
/** `import './x.js'` in an ESM TypeScript project really means `./x.ts`. */
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

export interface ImportResolverOptions {
  /** Dart package name (pubspec `name:`), used to resolve `package:<name>/...`. */
  projectName?: string | null;
  /** tsconfig-style `paths`, e.g. { "@/*": ["src/*"] } (targets relative to the project root). */
  paths?: Record<string, string[]>;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function normalizeKey(p: string): string {
  const n = path.posix.normalize(toPosix(p));
  return n.startsWith('./') ? n.slice(2) : n;
}

export class ImportResolver {
  /** normalized path -> the key exactly as it appears in the index */
  private files = new Map<string, string>();
  private cache = new Map<string, string | null>();
  private suffixScanCache = new Map<string, string | null>();
  private projectName: string | null;
  private paths: Array<{ prefix: string; wildcard: boolean; targets: string[] }> = [];

  constructor(files: Iterable<string>, options: ImportResolverOptions | string | null = null) {
    // Backwards friendly: `new ImportResolver(files, 'my_dart_package')`
    const opts: ImportResolverOptions =
      typeof options === 'string' ? { projectName: options } : options ?? {};
    this.projectName = opts.projectName ?? null;
    for (const f of files) {
      this.files.set(normalizeKey(f), f);
    }
    if (opts.paths) {
      for (const [pattern, targets] of Object.entries(opts.paths)) {
        const wildcard = pattern.endsWith('*');
        this.paths.push({
          prefix: wildcard ? pattern.slice(0, -1) : pattern,
          wildcard,
          targets: targets.map(t => toPosix(t)),
        });
      }
      // Longest prefix first, like the TypeScript compiler.
      this.paths.sort((a, b) => b.prefix.length - a.prefix.length);
    }
  }

  /** True when `filePath` is part of the indexed file set. */
  has(filePath: string): boolean {
    return this.files.has(normalizeKey(filePath));
  }

  /**
   * Resolve an import/export/part specifier written in `fromFile` to the matching
   * indexed file. Returns null for external packages, SDK libraries and unknown files.
   */
  resolve(fromFile: string, spec: string): string | null {
    const raw = (spec ?? '').trim();
    if (!raw) { return null; }
    const cacheKey = fromFile + '\u0000' + raw;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) { return cached; }
    const result = this.resolveUncached(fromFile, raw);
    this.cache.set(cacheKey, result);
    return result;
  }

  private resolveUncached(fromFile: string, spec: string): string | null {
    if (spec.startsWith('dart:')) { return null; }

    if (spec.startsWith('package:')) {
      const m = /^package:([^/]+)\/(.+)$/.exec(spec);
      if (!m || !this.projectName || m[1] !== this.projectName) { return null; }
      return this.tryCandidates('lib/' + m[2]);
    }

    // Any other URI scheme (http:, file:, node:, vscode:, ...) is not a project file.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)) { return null; }

    const fromNorm = normalizeKey(fromFile);
    const fromDir = path.posix.dirname(fromNorm);

    if (spec.startsWith('.')) {
      return this.tryCandidates(path.posix.join(fromDir, spec));
    }

    if (spec.startsWith('/')) {
      return this.tryCandidates(spec.replace(/^\/+/, ''));
    }

    // tsconfig-style path aliases ("@/foo" -> "src/foo").
    for (const alias of this.paths) {
      if (alias.wildcard ? spec.startsWith(alias.prefix) : spec === alias.prefix) {
        const rest = alias.wildcard ? spec.slice(alias.prefix.length) : '';
        for (const target of alias.targets) {
          const hit = this.tryCandidates(target.replace('*', rest));
          if (hit) { return hit; }
        }
      }
    }

    const ext = path.posix.extname(fromNorm);

    // Dart allows relative imports without a leading "./".
    if (ext === '.dart') {
      return this.tryCandidates(path.posix.join(fromDir, spec));
    }

    // Kotlin / Java: fully qualified names such as com.example.app.MainActivity
    if ((ext === '.kt' || ext === '.java') && /^[\w.]+$/.test(spec) && spec.includes('.')) {
      return this.resolveQualifiedName(spec);
    }

    // Bare specifier in a TS/JS file => npm package => external.
    return null;
  }

  private resolveQualifiedName(qualified: string): string | null {
    const cached = this.suffixScanCache.get(qualified);
    if (cached !== undefined) { return cached; }
    const tail = '/' + qualified.replace(/\./g, '/');
    let found: string | null = null;
    for (const [norm, original] of this.files) {
      if (norm.endsWith(tail + '.kt') || norm.endsWith(tail + '.java')) {
        found = original;
        break;
      }
    }
    this.suffixScanCache.set(qualified, found);
    return found;
  }

  private tryCandidates(base: string): string | null {
    const b = path.posix.normalize(base);
    if (b.startsWith('../') || b === '..') { return null; }
    const candidates: string[] = [b];

    const ext = path.posix.extname(b);
    if (ext && JS_TO_TS[ext]) {
      const stem = b.slice(0, -ext.length);
      for (const e of JS_TO_TS[ext]) { candidates.push(stem + e); }
    }
    for (const e of TS_EXTS) { candidates.push(b + e); }
    for (const e of OTHER_EXTS) { candidates.push(b + e); }
    for (const e of TS_EXTS) { candidates.push(b + '/index' + e); }

    for (const c of candidates) {
      const hit = this.files.get(c);
      if (hit !== undefined) { return hit; }
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Call resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal structural view of an indexed file (matches DartFileInfo without importing it). */
export interface IndexedFileLike {
  classes?: Array<{
    name: string;
    line?: number;
    lineEnd?: number;
    extendsClass?: string | null;
    mixins?: string[];
    implements?: string[];
    methods?: Array<{ name: string; line?: number }>;
  }>;
  functions?: Array<{ name: string }>;
  imports?: Array<{ path: string } | string>;
  exports?: Array<string | { path: string }>;
}

export interface CallSite {
  name: string;
  receiver?: string | null;
  callerClass?: string | null;
  callerFunction?: string | null;
  line?: number;
}

export interface CallTarget {
  qname: string;
  filePath: string;
  kind: 'function' | 'method' | 'class';
  name: string;
  parentClass: string | null;
}

/** Same format as the code analyzer: `<file>:<Class.>name`. */
export function makeQName(filePath: string, className: string | null | undefined, entity: string): string {
  return `${filePath}:${className ? className + '.' : ''}${entity}`;
}

function stripGenerics(typeName: string): string {
  const lt = typeName.indexOf('<');
  return (lt >= 0 ? typeName.slice(0, lt) : typeName).trim();
}

interface ClassEntry {
  name: string;
  file: string;
  info: NonNullable<IndexedFileLike['classes']>[number];
}

export class CallResolver {
  private classesByName = new Map<string, ClassEntry[]>();
  private classesByFile = new Map<string, ClassEntry[]>();
  private funcsByFile = new Map<string, Map<string, CallTarget>>();
  private funcsByName = new Map<string, CallTarget[]>();
  private methodsByClass = new Map<string, CallTarget[]>(); // key: `${className}\u0000${method}`
  private importedCache = new Map<string, Set<string>>();

  constructor(
    private index: Record<string, IndexedFileLike>,
    private resolver: ImportResolver,
  ) {
    for (const [file, info] of Object.entries(index)) {
      for (const cls of info.classes ?? []) {
        const entry: ClassEntry = { name: cls.name, file, info: cls };
        pushMap(this.classesByName, cls.name, entry);
        pushMap(this.classesByFile, file, entry);
        for (const m of cls.methods ?? []) {
          const target: CallTarget = {
            qname: makeQName(file, cls.name, m.name),
            filePath: file,
            kind: 'method',
            name: m.name,
            parentClass: cls.name,
          };
          pushMap(this.methodsByClass, cls.name + '\u0000' + m.name, target);
        }
      }
      for (const fn of info.functions ?? []) {
        const target: CallTarget = {
          qname: makeQName(file, null, fn.name),
          filePath: file,
          kind: 'function',
          name: fn.name,
          parentClass: null,
        };
        let perFile = this.funcsByFile.get(file);
        if (!perFile) { perFile = new Map(); this.funcsByFile.set(file, perFile); }
        if (!perFile.has(fn.name)) { perFile.set(fn.name, target); }
        pushMap(this.funcsByName, fn.name, target);
      }
    }
  }

  /** Class (in `file`) whose line range contains `line`; innermost wins. */
  classAt(file: string, line: number | undefined): string | null {
    if (!line) { return null; }
    let best: ClassEntry | null = null;
    for (const entry of this.classesByFile.get(file) ?? []) {
      const start = entry.info.line ?? 0;
      const end = entry.info.lineEnd ?? Number.MAX_SAFE_INTEGER;
      if (line >= start && line <= end) {
        if (!best || start >= (best.info.line ?? 0)) { best = entry; }
      }
    }
    return best ? best.name : null;
  }

  /** Qualified name of the code that contains `call` (used as the caller node of an edge). */
  callerQName(file: string, call: CallSite): string {
    const cls = call.callerClass ?? this.classAt(file, call.line);
    if (call.callerFunction) { return makeQName(file, cls, call.callerFunction); }
    return makeQName(file, cls, '<module>');
  }

  resolve(fromFile: string, call: CallSite): CallTarget | null {
    let name = call.name;
    if (!name) { return null; }
    let receiver = call.receiver ?? null;

    // Some parsers emit "Class.method" in `name`.
    const dot = name.lastIndexOf('.');
    if (dot > 0) {
      receiver = name.slice(0, dot);
      name = name.slice(dot + 1);
    }

    const callerClass = call.callerClass ?? this.classAt(fromFile, call.line);

    if (receiver) {
      if (receiver === 'this' || receiver === 'super') {
        if (!callerClass) { return null; }
        return this.findMethod(callerClass, name, receiver === 'super', fromFile);
      }
      const cls = this.resolveClassName(receiver, fromFile);
      if (!cls) { return null; }
      return this.findMethod(cls.name, name, false, cls.file) ?? this.classTarget(cls);
    }

    // 1. A function declared in the same file.
    const sameFile = this.funcsByFile.get(fromFile)?.get(name);
    if (sameFile) { return sameFile; }

    // 2. Implicit `this` (Dart / Kotlin / Java): method of the caller class or its ancestors.
    if (callerClass) {
      const method = this.findMethod(callerClass, name, false, fromFile);
      if (method) { return method; }
    }

    // 3. A function exported by one of the files we import.
    const imported = this.importedFiles(fromFile);
    for (const f of imported) {
      const hit = this.funcsByFile.get(f)?.get(name);
      if (hit) { return hit; }
    }

    // 4. Constructor / instantiation of a class.
    const cls = this.resolveClassName(name, fromFile, false);
    if (cls) { return this.classTarget(cls); }

    // 5. A single, unambiguous function anywhere in the project.
    const global = this.funcsByName.get(name);
    if (global && global.length === 1) { return global[0]; }

    return null;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private classTarget(cls: ClassEntry): CallTarget {
    return {
      qname: makeQName(cls.file, null, cls.name),
      filePath: cls.file,
      kind: 'class',
      name: cls.name,
      parentClass: null,
    };
  }

  private importedFiles(file: string): Set<string> {
    const cached = this.importedCache.get(file);
    if (cached) { return cached; }
    const out = new Set<string>();
    const info = this.index[file];
    const specs: string[] = [];
    for (const imp of info?.imports ?? []) {
      specs.push(typeof imp === 'string' ? imp : imp.path);
    }
    for (const exp of info?.exports ?? []) {
      specs.push(typeof exp === 'string' ? exp : exp.path);
    }
    for (const spec of specs) {
      if (!spec) { continue; }
      const resolved = this.resolver.resolve(file, spec);
      if (resolved && resolved !== file) { out.add(resolved); }
    }
    this.importedCache.set(file, out);
    return out;
  }

  /**
   * Find a class by (type or variable) name. `indexManager` resolves to `IndexManager`,
   * `_cache` to `Cache`. `allowVariableForm=false` is used for bare calls like `Foo()`.
   */
  private resolveClassName(receiver: string, fromFile: string, allowVariableForm = true): ClassEntry | null {
    const candidates: string[] = [receiver];
    if (allowVariableForm) {
      const stripped = receiver.replace(/^[_$]+/, '');
      if (stripped && stripped !== receiver) { candidates.push(stripped); }
      if (stripped && stripped[0] === stripped[0].toLowerCase()) {
        candidates.push(stripped[0].toUpperCase() + stripped.slice(1));
      }
    }
    for (const candidate of candidates) {
      const entries = this.classesByName.get(candidate);
      if (!entries || entries.length === 0) { continue; }
      if (entries.length === 1) { return entries[0]; }
      const sameFile = entries.find(e => e.file === fromFile);
      if (sameFile) { return sameFile; }
      const imported = this.importedFiles(fromFile);
      const viaImport = entries.find(e => imported.has(e.file));
      if (viaImport) { return viaImport; }
      return entries[0];
    }
    return null;
  }

  private findMethod(className: string, method: string, skipSelf: boolean, preferFile: string): CallTarget | null {
    const order = this.ancestry(className);
    for (let i = skipSelf ? 1 : 0; i < order.length; i++) {
      const hits = this.methodsByClass.get(order[i] + '\u0000' + method);
      if (hits && hits.length > 0) {
        return hits.find(h => h.filePath === preferFile) ?? hits[0];
      }
    }
    return null;
  }

  /** The class itself followed by its ancestors (extends / with / implements), breadth first. */
  private ancestry(className: string): string[] {
    const seen = new Set<string>([className]);
    const order: string[] = [className];
    for (let i = 0; i < order.length && order.length < 64; i++) {
      for (const entry of this.classesByName.get(order[i]) ?? []) {
        const parents = [
          entry.info.extendsClass ?? '',
          ...(entry.info.mixins ?? []),
          ...(entry.info.implements ?? []),
        ];
        for (const parent of parents) {
          const clean = stripGenerics(parent);
          if (clean && !seen.has(clean)) {
            seen.add(clean);
            order.push(clean);
          }
        }
      }
    }
    return order;
  }
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) { list.push(value); } else { map.set(key, [value]); }
}
