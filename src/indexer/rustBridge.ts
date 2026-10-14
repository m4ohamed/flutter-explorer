import * as path from 'path';
import * as fs from 'fs';
import { BM25Document, BM25Search } from './bm25Search';
import { DartParser, DartFileInfo, WarningInfo, WidgetInfo } from './dartParser';
import { AndroidParser } from './androidParser';
import { JsTsParser } from './jsTsParser';

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
 * RustBridge provides a Multi-Language Dual-Engine architecture with Graceful Fallback:
 * - High-speed Pure Rust WebAssembly (WASM) engine supporting:
 *   1. Flutter / Dart (`.dart`)
 *   2. Android Native (`.kt`, `.java`, Jetpack Compose `@Composable`, `.xml` layouts/manifests/resources, `.gradle`, `.kts`)
 *   3. Web / TypeScript / React (`.ts`, `.tsx`, `.js`, `.jsx`, React functional/class components & JSX/TSX trees)
 * - Persistent `WasmSearchIndex` in WASM memory for sub-millisecond BM25 queries.
 * - 100% transparent fallback to TypeScript `DartParser`, `AndroidParser`, `JsTsParser`, and `BM25Search` if WASM is not compiled.
 */
export class RustBridge {
  private static instance: RustBridge | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wasmModule: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wasmSearchIndex: any = null;
  private wasmLoaded: boolean = false;
  private wasmVersion: string = '';
  private tsFallbackDartParser: DartParser = new DartParser();
  private tsFallbackAndroidParser: AndroidParser = new AndroidParser();
  private tsFallbackJsTsParser: JsTsParser = new JsTsParser();

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
            console.error(`[RustBridge] 🦀 Multi-Language Rust WASM core loaded successfully (v${this.wasmVersion})`);
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
        details = `Multi-Language Rust WASM core active (v${this.wasmVersion}).`;
      } else {
        active = 'javascript';
        details = 'Rust configured but WASM module not found. Fell back to JavaScript.';
      }
    } else {
      if (this.wasmLoaded) {
        active = 'rust';
        details = `Auto-selected Multi-Language Rust WASM core (v${this.wasmVersion}).`;
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

  private fallbackParseByExtension(filePath: string, sourceCode: string): DartFileInfo {
    const lower = filePath.toLowerCase();
    if (
      lower.endsWith('.kt') ||
      lower.endsWith('.java') ||
      lower.endsWith('.xml') ||
      lower.endsWith('.gradle') ||
      lower.endsWith('.kts')
    ) {
      return this.tsFallbackAndroidParser.parse(filePath, sourceCode);
    }
    if (
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.js') ||
      lower.endsWith('.jsx') ||
      lower.endsWith('.md') ||
      lower.endsWith('.css') ||
      lower.endsWith('.scss') ||
      lower.endsWith('.json')
    ) {
      return this.tsFallbackJsTsParser.parse(filePath, sourceCode);
    }
    return this.tsFallbackDartParser.parse(filePath, sourceCode);
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

    const searcher = new BM25Search();
    searcher.buildIndex(docs);
    return searcher.search(query, topK);
  }

  /**
   * Scan code for warnings across Dart, Kotlin/Java/XML, and TS/React using Rust WASM if available
   */
  public scanWarnings(filePath: string, sourceCode: string): WarningInfo[] {
    const status = this.getStatus();

    if (status.activeEngine === 'rust' && this.wasmModule) {
      try {
        const rawJson =
          typeof this.wasmModule.scan_file_warnings_json === 'function'
            ? this.wasmModule.scan_file_warnings_json(filePath, sourceCode)
            : typeof this.wasmModule.scan_warnings_json === 'function'
            ? this.wasmModule.scan_warnings_json(sourceCode)
            : null;
        if (rawJson) {
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
        }
      } catch (err) {
        console.warn('[RustBridge] Rust warning scanner failed, falling back to TypeScript parser', err);
      }
    }

    return this.fallbackParseByExtension(filePath, sourceCode).warnings;
  }

  /**
   * Parse AST structure for any supported language using Pure Rust WASM if available
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public parseDartAst(filePath: string, sourceCode: string): any {
    const status = this.getStatus();

    if (status.activeEngine === 'rust' && this.wasmModule) {
      try {
        const rawJson =
          typeof this.wasmModule.parse_file_ast_json === 'function'
            ? this.wasmModule.parse_file_ast_json(filePath, sourceCode)
            : typeof this.wasmModule.parse_dart_ast_json === 'function'
            ? this.wasmModule.parse_dart_ast_json(sourceCode)
            : null;
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          if (parsed && Array.isArray(parsed.classes)) {
            return parsed;
          }
        }
      } catch (err) {
        console.warn('[RustBridge] Rust AST parser failed, falling back to TypeScript parser', err);
      }
    }

    return this.fallbackParseByExtension(filePath, sourceCode);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapRustWidgetTree(rawWidgets: any[]): WidgetInfo[] {
    if (!Array.isArray(rawWidgets)) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rawWidgets.map((w: any) => ({
      name: w.name || '',
      line: w.line || 1,
      children: this.mapRustWidgetTree(w.children || []),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: Array.isArray(w.properties)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? w.properties.map((p: any) => ({ name: p.name || 'detail', value: p.value || '' }))
        : [],
    }));
  }

  /**
   * Multi-Language Single-Pass Pure Rust WASM parser producing a full `DartFileInfo`
   * for `.dart`, `.kt`, `.java`, `.xml`, `.gradle`, `.gradle.kts`, `.ts`, `.tsx`, `.js`, `.jsx`, `.md`, `.css`, `.json`.
   * Falls back transparently to TypeScript (`DartParser`, `AndroidParser`, `JsTsParser`) when WASM is unavailable.
   */
  public parseFileToInfo(
    filePath: string,
    sourceCode: string,
    _options?: { pureAstOnly?: boolean }
  ): DartFileInfo {
    const status = this.getStatus();
    const cleanPath = filePath.replace(/\\/g, '/');
    const isDart = cleanPath.toLowerCase().endsWith('.dart');

    if (
      status.activeEngine === 'rust' &&
      this.wasmModule &&
      (typeof this.wasmModule.parse_file_ast_json === 'function' ||
        (isDart && typeof this.wasmModule.parse_dart_ast_json === 'function'))
    ) {
      try {
        const rawJson =
          typeof this.wasmModule.parse_file_ast_json === 'function'
            ? this.wasmModule.parse_file_ast_json(cleanPath, sourceCode)
            : this.wasmModule.parse_dart_ast_json(sourceCode);
        const parsed = JSON.parse(rawJson);
        if (parsed && Array.isArray(parsed.classes)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const classes = (parsed.classes || []).map((c: any) => ({
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            properties: (c.properties || []).map((p: any) => ({
              name: p.name,
              type: p.type || 'dynamic',
              className: p.class_name ?? p.className ?? c.name,
              isFinal: !!(p.is_final ?? p.isFinal),
              isConst: !!(p.is_const ?? p.isConst),
              isStatic: !!(p.is_static ?? p.isStatic),
              isPrivate: !!(p.is_private ?? p.isPrivate),
              isGetter: !!(p.is_getter ?? p.isGetter),
              isSetter: !!(p.is_setter ?? p.isSetter),
              line: p.line,
            })),
            bodyHash: '',
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const functions = (parsed.functions || []).map((m: any) => ({
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
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const enums = (parsed.enums || []).map((e: any) => ({
            name: e.name,
            values: e.values || [],
            line: e.line,
            isPrivate: !!(e.is_private ?? e.isPrivate),
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mixins = (parsed.mixins || []).map((mx: any) => ({
            name: mx.name,
            on: mx.on || null,
            line: mx.line,
            isPrivate: !!(mx.is_private ?? mx.isPrivate),
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const extensions = (parsed.extensions || []).map((ext: any) => ({
            name: ext.name,
            onType: ext.on_type || ext.onType || 'dynamic',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            methods: (ext.methods || []).map((m: any) => ({
              name: m.name,
              returnType: m.return_type || m.returnType || '',
              params: m.params || '',
              line: m.line,
              lineEnd: m.line_end ?? m.lineEnd,
              isPrivate: !!(m.is_private ?? m.isPrivate),
              isAsync: !!(m.is_async ?? m.isAsync),
              isStatic: !!(m.is_static ?? m.isStatic),
              parentClass: ext.name,
              bodyHash: '',
            })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            properties: (ext.properties || []).map((p: any) => ({
              name: p.name,
              type: p.type || 'dynamic',
              className: ext.name,
              isFinal: !!(p.is_final ?? p.isFinal),
              isConst: !!(p.is_const ?? p.isConst),
              isStatic: !!(p.is_static ?? p.isStatic),
              isPrivate: !!(p.is_private ?? p.isPrivate),
              isGetter: !!(p.is_getter ?? p.isGetter),
              isSetter: !!(p.is_setter ?? p.isSetter),
              line: p.line,
            })),
            line: ext.line,
            isPrivate: !!(ext.is_private ?? ext.isPrivate),
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const typedefs = (parsed.typedefs || []).map((td: any) => ({
            name: td.name,
            signature: td.signature || '',
            line: td.line,
            isPrivate: !!(td.is_private ?? td.isPrivate),
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const variables = (parsed.variables || []).map((v: any) => ({
            name: v.name,
            type: v.type || 'dynamic',
            value: v.value ?? undefined,
            line: v.line,
            isConst: !!(v.is_const ?? v.isConst),
            isFinal: !!(v.is_final ?? v.isFinal),
            isPrivate: !!(v.is_private ?? v.isPrivate),
            isTopLevel: !!(v.is_top_level ?? v.isTopLevel ?? true),
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const constructors = (parsed.constructors || []).map((ct: any) => ({
            name: ct.name,
            className: ct.class_name || ct.className || '',
            isFactory: !!(ct.is_factory ?? ct.isFactory),
            isConst: !!(ct.is_const ?? ct.isConst),
            params: ct.params || '',
            line: ct.line,
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const properties = (parsed.properties || []).map((p: any) => ({
            name: p.name,
            type: p.type || 'dynamic',
            className: p.class_name ?? p.className ?? null,
            isFinal: !!(p.is_final ?? p.isFinal),
            isConst: !!(p.is_const ?? p.isConst),
            isStatic: !!(p.is_static ?? p.isStatic),
            isPrivate: !!(p.is_private ?? p.isPrivate),
            isGetter: !!(p.is_getter ?? p.isGetter),
            isSetter: !!(p.is_setter ?? p.isSetter),
            line: p.line,
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const annotations = (parsed.annotations || []).map((a: any) => ({
            name: a.name,
            target: a.target || 'member',
            targetName: a.target_name || a.targetName || '',
            line: a.line,
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const functionCalls = (parsed.function_calls || parsed.functionCalls || []).map((fc: any) => ({
            name: fc.name,
            line: fc.line,
            callerClass: fc.caller_class ?? fc.callerClass ?? null,
            callerFunction: fc.caller_function ?? fc.callerFunction ?? null,
            context: fc.context || '',
            isStatic: !!(fc.is_static ?? fc.isStatic),
            isChained: !!(fc.is_chained ?? fc.isChained),
            receiver: fc.receiver ?? undefined,
          }));

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawImportDetails = parsed.import_details || parsed.importDetails || [];
          const imports = Array.isArray(rawImportDetails) && rawImportDetails.length > 0
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? rawImportDetails.map((imp: any) => ({
                path: imp.path || '',
                alias: imp.alias || null,
                showNames: imp.show_names || imp.showNames || [],
                hideNames: imp.hide_names || imp.hideNames || [],
                line: imp.line || 1,
              }))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            : (parsed.imports || []).map((imp: any, idx: number) => ({
                path: typeof imp === 'string' ? imp : (imp.path || ''),
                alias: null,
                showNames: [],
                hideNames: [],
                line: idx + 1,
              }));

          return {
            filePath: cleanPath,
            classes,
            functions,
            enums,
            mixins,
            extensions,
            extensionTypes: [],
            widgets: this.mapRustWidgetTree(parsed.widgets || []),
            warnings: this.scanWarnings(cleanPath, sourceCode),
            imports,
            exports: parsed.exports || [],
            typedefs,
            functionCalls,
            classUsages: classes.map((c: { name: string }) => ({
              className: c.name,
              usedInFiles: [cleanPath],
              usedByClasses: [],
              usedByFunctions: [],
              confidence: 'medium' as const,
            })),
            functionUsages: functions.map((f: { name: string; parentClass: string | null }) => ({
              functionName: f.name,
              parentClass: f.parentClass,
              calledByFunctions: [],
              calledInFiles: [cleanPath],
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            extensionUsages: extensions.map((e: { name: string }) => ({
              extensionName: e.name,
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            typedefUsages: typedefs.map((t: { name: string }) => ({
              typedefName: t.name,
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            variableUsages: variables.map((v: { name: string }) => ({
              variableName: v.name,
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            constructorUsages: constructors.map((ct: { name: string; className: string }) => ({
              constructorName: ct.name,
              className: ct.className,
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            propertyUsages: properties.map((p: { name: string; className: string | null }) => ({
              propertyName: p.name,
              className: p.className,
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            annotationUsages: annotations.map((a: { name: string }) => ({
              annotationName: a.name,
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            enumUsages: enums.map((e: { name: string }) => ({
              enumName: e.name,
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            mixinUsages: mixins.map((m: { name: string }) => ({
              mixinName: m.name,
              usedInFiles: [cleanPath],
              confidence: 'medium' as const,
            })),
            annotations,
            constructors,
            variables,
            properties,
            lastModified: Date.now(),
          };
        }
      } catch (err) {
        console.warn('[RustBridge] Rust Multi-Language AST parser failed, falling back to TypeScript parser', err);
      }
    }

    return this.fallbackParseByExtension(cleanPath, sourceCode);
  }

  /**
   * Backwards-compatible alias for `parseFileToInfo`
   */
  public parseDartToInfo(
    filePath: string,
    sourceCode: string,
    options?: { pureAstOnly?: boolean }
  ): DartFileInfo {
    return this.parseFileToInfo(filePath, sourceCode, options);
  }
}
