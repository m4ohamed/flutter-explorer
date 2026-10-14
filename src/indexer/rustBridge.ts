import * as path from 'path';
import * as fs from 'fs';
import { BM25Document, BM25Search } from './bm25Search';
import { DartParser, DartFileInfo, WarningInfo } from './dartParser';

// Load `vscode` dynamically so RustBridge works both inside VS Code Extension Host
// and in standalone Node.js processes (such as `mcp-server.ts` and CLI test runners).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vscodeApi: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeApi = require('vscode');
} catch {
  vscodeApi = null;
}

export type ExecutionEngine = 'auto' | 'rust' | 'javascript';

export interface EngineStatus {
  configuredEngine: ExecutionEngine;
  activeEngine: 'rust' | 'javascript';
  isWasmLoaded: boolean;
  wasmVersion?: string;
  details: string;
}

/**
 * RustBridge provides a dual-engine architecture with Graceful Fallback:
 * - High-speed Rust WebAssembly (WASM) engine when available.
 * - Hybrid AST + Semantic enrichment so `imports`, `widgets`, `functionCalls`, and `usages` are never lost.
 * - Persistent `WasmSearchIndex` in WASM memory for instant BM25 queries.
 * - 100% transparent fallback to existing TypeScript/JavaScript implementation on any failure.
 */
export class RustBridge {
  private static instance: RustBridge | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wasmModule: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wasmSearchIndex: any = null;
  private wasmLoaded: boolean = false;
  private wasmVersion: string = '';
  private tsFallbackParser: DartParser = new DartParser();

  private constructor() {
    this.initWasm();
  }

  public static getInstance(): RustBridge {
    if (!RustBridge.instance) {
      RustBridge.instance = new RustBridge();
    }
    return RustBridge.instance;
  }

  private initWasm(): void {
    try {
      const candidatePaths = [
        path.join(__dirname, '..', 'wasm_pkg', 'flutter_explorer_core.js'),
        path.join(__dirname, '..', '..', 'out', 'wasm_pkg', 'flutter_explorer_core.js'),
        path.join(__dirname, 'wasm_pkg', 'flutter_explorer_core.js'),
      ];

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          this.wasmModule = require(p);
          if (this.wasmModule && typeof this.wasmModule.get_core_version === 'function') {
            this.wasmLoaded = true;
            this.wasmVersion = this.wasmModule.get_core_version();
            console.error(`[RustBridge] 🦀 Rust WASM core loaded successfully (v${this.wasmVersion})`);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('[RustBridge] ⚠️ Rust WASM module could not be loaded; falling back to JavaScript engine.', err);
      this.wasmLoaded = false;
      this.wasmModule = null;
    }
  }

  public getStatus(): EngineStatus {
    let configured: ExecutionEngine = 'auto';
    try {
      if (vscodeApi && vscodeApi.workspace) {
        const config = vscodeApi.workspace.getConfiguration('flutterExplorer');
        configured = (config.get('engine', 'auto') as ExecutionEngine) || 'auto';
      } else if (process.env.FLUTTER_EXPLORER_ENGINE) {
        const envEngine = process.env.FLUTTER_EXPLORER_ENGINE.toLowerCase();
        if (envEngine === 'rust' || envEngine === 'javascript' || envEngine === 'auto') {
          configured = envEngine;
        }
      }
    } catch {
      configured = 'auto';
    }

    let active: 'rust' | 'javascript' = 'javascript';
    let details = '';

    if (configured === 'javascript') {
      active = 'javascript';
      details = 'Engine forced to JavaScript by user configuration.';
    } else if (configured === 'rust') {
      if (this.wasmLoaded) {
        active = 'rust';
        details = `Rust WASM core active (v${this.wasmVersion}).`;
      } else {
        active = 'javascript';
        details = 'Rust configured but WASM module not found. Fell back to JavaScript.';
      }
    } else {
      if (this.wasmLoaded) {
        active = 'rust';
        details = `Auto-selected Rust WASM core (v${this.wasmVersion}).`;
      } else {
        active = 'javascript';
        details = 'WASM not yet compiled; running seamlessly on TypeScript/JavaScript engine.';
      }
    }

    return {
      configuredEngine: configured,
      activeEngine: active,
      isWasmLoaded: this.wasmLoaded,
      wasmVersion: this.wasmVersion,
      details,
    };
  }

  /**
   * Builds or rebuilds the persistent WASM BM25 index in memory if `WasmSearchIndex` is exported by WASM.
   */
  public buildPersistentSearchIndex(docs: BM25Document[]): boolean {
    const status = this.getStatus();
    if (status.activeEngine === 'rust' && this.wasmModule && typeof this.wasmModule.WasmSearchIndex === 'function') {
      try {
        if (this.wasmSearchIndex && typeof this.wasmSearchIndex.free === 'function') {
          try { this.wasmSearchIndex.free(); } catch { /* ignore */ }
        }
        this.wasmSearchIndex = new this.wasmModule.WasmSearchIndex(JSON.stringify(docs));
        return true;
      } catch (err) {
        console.warn('[RustBridge] Failed to build persistent WasmSearchIndex:', err);
        this.wasmSearchIndex = null;
      }
    }
    return false;
  }

  public upsertPersistentSearchDoc(doc: BM25Document): boolean {
    if (this.wasmSearchIndex && typeof this.wasmSearchIndex.upsert_doc === 'function') {
      try {
        return !!this.wasmSearchIndex.upsert_doc(JSON.stringify(doc));
      } catch {
        return false;
      }
    }
    return false;
  }

  public removePersistentSearchDoc(id: string): boolean {
    if (this.wasmSearchIndex && typeof this.wasmSearchIndex.remove_doc === 'function') {
      try {
        return !!this.wasmSearchIndex.remove_doc(id);
      } catch {
        return false;
      }
    }
    return false;
  }

  public searchPersistentIndex(query: string, topK: number = 50): Array<{ id: string; score: number }> | null {
    const status = this.getStatus();
    if (status.activeEngine === 'rust' && this.wasmSearchIndex && typeof this.wasmSearchIndex.search === 'function') {
      try {
        const rawJson = this.wasmSearchIndex.search(query, topK);
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (err) {
        console.warn('[RustBridge] Persistent WasmSearchIndex query failed:', err);
      }
    }
    return null;
  }

  /**
   * Run BM25 search across documents using Rust WASM if available, falling back to TypeScript
   */
  public bm25Search(docs: BM25Document[], query: string, topK: number = 50): Array<{ id: string; score: number }> {
    const status = this.getStatus();

    if (status.activeEngine === 'rust' && this.wasmModule) {
      // 1. Try persistent index first if its doc count matches
      if (
        this.wasmSearchIndex &&
        typeof this.wasmSearchIndex.size === 'function' &&
        this.wasmSearchIndex.size() === docs.length
      ) {
        const fastRes = this.searchPersistentIndex(query, topK);
        if (fastRes) {
          return fastRes;
        }
      }

      // 2. Stateless WASM search call
      try {
        const docsJson = JSON.stringify(docs);
        const rawJson = this.wasmModule.bm25_search_json(docsJson, query, topK);
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (err) {
        console.warn('[RustBridge] Rust BM25 execution failed, falling back to TypeScript BM25', err);
      }
    }

    // Graceful Fallback: TypeScript BM25Search
    const searcher = new BM25Search();
    searcher.buildIndex(docs);
    return searcher.search(query, topK);
  }

  /**
   * Scan code for warnings using Rust WASM if available, falling back to DartParser
   */
  public scanWarnings(filePath: string, sourceCode: string): WarningInfo[] {
    const status = this.getStatus();

    if (status.activeEngine === 'rust' && this.wasmModule && typeof this.wasmModule.scan_warnings_json === 'function') {
      try {
        const rawJson = this.wasmModule.scan_warnings_json(sourceCode);
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return parsed.map((w: any) => ({
            type: w.type,
            message: w.message,
            line: w.line,
            codeSnippet: w.code_snippet,
            suggestion: w.suggestion,
          }));
        }
      } catch (err) {
        console.warn('[RustBridge] Rust warning scanner failed, falling back to TypeScript DartParser', err);
      }
    }

    return this.tsFallbackParser.parse(filePath, sourceCode).warnings;
  }

  /**
   * Parse Dart AST structure (classes, methods, enums) using Pure Rust WASM if available, falling back to DartParser
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public parseDartAst(filePath: string, sourceCode: string): any {
    const status = this.getStatus();

    if (status.activeEngine === 'rust' && this.wasmModule && typeof this.wasmModule.parse_dart_ast_json === 'function') {
      try {
        const rawJson = this.wasmModule.parse_dart_ast_json(sourceCode);
        const parsed = JSON.parse(rawJson);
        if (parsed && Array.isArray(parsed.classes)) {
          return parsed;
        }
      } catch (err) {
        console.warn('[RustBridge] Rust AST parser failed, falling back to TypeScript DartParser', err);
      }
    }

    return this.tsFallbackParser.parse(filePath, sourceCode);
  }

  /**
   * Parse Dart source code to a complete DartFileInfo structure.
   * - When `options.pureAstOnly` is true, returns only the raw syntactic AST from Rust WASM (for speed micro-benchmarks).
   * - By default (`pureAstOnly: false`), performs a Hybrid Merge: combines Rust WASM's AST (`classes`, `methods`,
   *   `functions`, `enums`, `lineEnd`) and `scanWarnings` with `DartParser`'s semantic graph (`imports`, `exports`,
   *   `widgets`, `functionCalls`, `usages`, `properties`, `constructors`, etc.) so saving a file in `updateFile()`
   *   or running `buildFullIndex()` never wipes out widget trees or dependency graphs.
   */
  public parseDartToInfo(
    filePath: string,
    sourceCode: string,
    options?: { pureAstOnly?: boolean }
  ): DartFileInfo {
    const status = this.getStatus();
    const cleanPath = filePath.replace(/\\/g, '/');

    if (status.activeEngine === 'rust' && this.wasmModule && typeof this.wasmModule.parse_dart_ast_json === 'function') {
      try {
        const rawJson = this.wasmModule.parse_dart_ast_json(sourceCode);
        const parsed = JSON.parse(rawJson);
        if (parsed && Array.isArray(parsed.classes)) {
          if (options?.pureAstOnly) {
            return {
              filePath: cleanPath,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              classes: (parsed.classes || []).map((c: any) => ({
                name: c.name,
                type: c.type || 'class',
                line: c.line,
                lineEnd: c.line_end ?? c.lineEnd,
                extendsClass: c.extends_class || c.extendsClass || null,
                mixins: c.mixins || [],
                implements: c.implements || [],
                isAbstract: !!(c.is_abstract ?? c.isAbstract),
                isPrivate: !!(c.is_private ?? c.isPrivate),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                methods: (c.methods || []).map((m: any) => ({
                  name: m.name,
                  returnType: m.return_type || m.returnType || '',
                  params: m.params || '',
                  line: m.line,
                  lineEnd: m.line_end ?? m.lineEnd,
                  isPrivate: !!(m.is_private ?? m.isPrivate),
                  isAsync: !!(m.is_async ?? m.isAsync),
                  isStatic: !!(m.is_static ?? m.isStatic),
                  parentClass: c.name,
                  bodyHash: '',
                })),
                properties: [],
                bodyHash: '',
              })),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              functions: (parsed.functions || []).map((m: any) => ({
                name: m.name,
                returnType: m.return_type || m.returnType || '',
                params: m.params || '',
                line: m.line,
                lineEnd: m.line_end ?? m.lineEnd,
                isPrivate: !!(m.is_private ?? m.isPrivate),
                isAsync: !!(m.is_async ?? m.isAsync),
                isStatic: !!(m.is_static ?? m.isStatic),
                parentClass: null,
                bodyHash: '',
              })),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              enums: (parsed.enums || []).map((e: any) => ({
                name: e.name,
                values: e.values || [],
                line: e.line,
                isPrivate: !!(e.is_private ?? e.isPrivate),
              })),
              mixins: [],
              extensions: [],
              extensionTypes: [],
              widgets: [],
              warnings: this.scanWarnings(cleanPath, sourceCode),
              imports: [],
              exports: [],
              typedefs: [],
              functionCalls: [],
              classUsages: [],
              functionUsages: [],
              extensionUsages: [],
              typedefUsages: [],
              variableUsages: [],
              constructorUsages: [],
              propertyUsages: [],
              annotationUsages: [],
              enumUsages: [],
              mixinUsages: [],
              annotations: [],
              constructors: [],
              variables: [],
              properties: [],
              lastModified: Date.now(),
            };
          }

          // Hybrid Mode: enrich semantic graph while applying Rust AST boundaries & Rust warnings
          const baseInfo = this.tsFallbackParser.parse(cleanPath, sourceCode);

          // Overlay accurate lineEnd and enum values discovered by Rust AST
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rustClassMap = new Map<string, any>();
          for (const rc of parsed.classes || []) {
            rustClassMap.set(rc.name, rc);
          }

          for (const cls of baseInfo.classes) {
            const rc = rustClassMap.get(cls.name);
            if (rc) {
              if (rc.line_end || rc.lineEnd) {
                cls.lineEnd = rc.line_end ?? rc.lineEnd;
              }
              if (Array.isArray(rc.methods)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rmMap = new Map<string, any>(rc.methods.map((m: any) => [m.name, m]));
                for (const m of cls.methods) {
                  const rm = rmMap.get(m.name);
                  if (rm && (rm.line_end || rm.lineEnd)) {
                    m.lineEnd = rm.line_end ?? rm.lineEnd;
                  }
                }
              }
            }
          }

          // Merge Rust warning scanner results (deduplicated by line + type)
          const rustWarnings = this.scanWarnings(cleanPath, sourceCode);
          const seenWarn = new Set(baseInfo.warnings.map(w => `${w.type}:${w.line}`));
          for (const rw of rustWarnings) {
            const key = `${rw.type}:${rw.line}`;
            if (!seenWarn.has(key)) {
              baseInfo.warnings.push(rw);
              seenWarn.add(key);
            }
          }

          return baseInfo;
        }
      } catch (err) {
        console.warn('[RustBridge] Rust AST parser failed, falling back to TypeScript DartParser', err);
      }
    }

    return this.tsFallbackParser.parse(cleanPath, sourceCode);
  }
}
