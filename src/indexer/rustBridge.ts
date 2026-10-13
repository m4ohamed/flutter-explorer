import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { BM25Document, BM25Search } from './bm25Search';
import { DartParser, DartFileInfo, WarningInfo } from './dartParser';

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
 * - 100% transparent fallback to existing TypeScript/JavaScript implementation on any failure.
 */
export class RustBridge {
  private static instance: RustBridge | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wasmModule: any = null;
  private wasmLoaded: boolean = false;
  private wasmVersion: string = '';

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
            console.log(`[RustBridge] 🦀 Rust WASM core loaded successfully (v${this.wasmVersion})`);
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
    const config = vscode.workspace.getConfiguration('flutterExplorer');
    const configured = config.get<ExecutionEngine>('engine', 'auto') || 'auto';

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
      // Auto
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
   * Run BM25 search across documents using Rust WASM if available, falling back to TypeScript
   */
  public bm25Search(docs: BM25Document[], query: string, topK: number = 50): Array<{ id: string; score: number }> {
    const status = this.getStatus();

    if (status.activeEngine === 'rust' && this.wasmModule) {
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

    if (status.activeEngine === 'rust' && this.wasmModule) {
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

    // Graceful Fallback: TypeScript DartParser
    const parser = new DartParser();
    const parsed = parser.parse(filePath, sourceCode);
    return parsed.warnings;
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

    // Graceful Fallback: TypeScript DartParser
    const parser = new DartParser();
    return parser.parse(filePath, sourceCode);
  }

  /**
   * Parse Dart source code to a standardized DartFileInfo structure using Pure Rust WASM.
   * If WASM is unavailable or fails, gracefully falls back to DartParser.
   */
  public parseDartToInfo(filePath: string, sourceCode: string): DartFileInfo {
    const status = this.getStatus();

    if (status.activeEngine === 'rust' && this.wasmModule && typeof this.wasmModule.parse_dart_ast_json === 'function') {
      try {
        const rawJson = this.wasmModule.parse_dart_ast_json(sourceCode);
        const parsed = JSON.parse(rawJson);
        if (parsed && Array.isArray(parsed.classes)) {
          const cleanPath = filePath.replace(/\\/g, '/');
          return {
            filePath: cleanPath,
            classes: (parsed.classes || []).map((c: any) => ({
              name: c.name,
              type: c.type || 'class',
              line: c.line,
              lineEnd: c.line_end,
              extendsClass: c.extends_class || null,
              mixins: c.mixins || [],
              implements: c.implements || [],
              isAbstract: !!c.is_abstract,
              isPrivate: !!c.is_private,
              methods: (c.methods || []).map((m: any) => ({
                name: m.name,
                returnType: m.return_type || '',
                params: m.params || '',
                line: m.line,
                lineEnd: m.line_end,
                isPrivate: !!m.is_private,
                isAsync: !!m.is_async,
                isStatic: !!m.is_static,
                parentClass: c.name,
                bodyHash: '',
              })),
              properties: [],
              bodyHash: '',
            })),
            functions: (parsed.functions || []).map((m: any) => ({
              name: m.name,
              returnType: m.return_type || '',
              params: m.params || '',
              line: m.line,
              lineEnd: m.line_end,
              isPrivate: !!m.is_private,
              isAsync: !!m.is_async,
              isStatic: !!m.is_static,
              parentClass: null,
              bodyHash: '',
            })),
            enums: (parsed.enums || []).map((e: any) => ({
              name: e.name,
              values: e.values || [],
              line: e.line,
              isPrivate: !!e.is_private,
            })),
            mixins: [],
            extensions: [],
            extensionTypes: [],
            widgets: [],
            warnings: [],
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
      } catch (err) {
        console.warn('[RustBridge] Rust AST parser failed, falling back to TypeScript DartParser', err);
      }
    }

    // Graceful Fallback: TypeScript DartParser
    const parser = new DartParser();
    return parser.parse(filePath, sourceCode);
  }
}


