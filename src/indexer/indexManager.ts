/**
 * Index Manager - Manages the in-memory index and SQLite cache.
 *
 * Changes from original:
 *   - JSON cache replaced by SqliteCache (faster incremental writes)
 *   - BM25Search integrated for better search result ranking
 *   - debouncedSaveCache: waits 2 s after last change before writing
 *   - BM25 index rebuilt after full index; updated incrementally on file changes
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DartParser, DartFileInfo } from './dartParser';
import { PackageIndexer } from './packageIndexer';
import { PackageInfo } from '../providers/pubspecLockProvider';
import { SqliteCache } from './sqliteCache';
import { BM25Search, BM25Document } from './bm25Search';


export interface TranslationInfo {
  key: string;
  value: string;
  line: number;
}

export interface DiagnosticInfo {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source: string;
}

export class IndexManager {
  private index: Map<string, DartFileInfo> = new Map();
  private arbIndex: Map<string, TranslationInfo[]> = new Map();
  private diagnostics: DiagnosticInfo[] = [];
  private packages: PackageInfo[] = [];
  private parser: DartParser = new DartParser();
  private workspaceRoot: string;
  private onIndexChanged: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeIndex: vscode.Event<void> = this.onIndexChanged.event;

  // ── New: SQLite cache ───────────────────────────────────────────────────────
  private sqliteCache: SqliteCache;

  // ── New: BM25 search ────────────────────────────────────────────────────────
  private bm25 = new BM25Search();
  private bm25Dirty = true; // needs rebuild after index changes
  private fileDocIds = new Map<string, string[]>(); // tracks BM25 doc IDs per file

  // ── Debounced save timer ────────────────────────────────────────────────────
  private saveCacheTimer: NodeJS.Timeout | null = null;
  private reverseDepsTimeout: NodeJS.Timeout | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.sqliteCache = new SqliteCache(workspaceRoot);
  }

  // ── Full index ──────────────────────────────────────────────────────────────

  /** Build full index by scanning all Dart files */
  async buildFullIndex(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    const dartFiles = await vscode.workspace.findFiles('lib/**/*.dart', '**/.*');
    const androidFiles = await vscode.workspace.findFiles('android/app/**/*.{dart,kt,java,xml,gradle}', '**/.*');
    const arbFiles = await vscode.workspace.findFiles('lib/**/*.arb', '**/.*');
    const allFiles = [...dartFiles, ...androidFiles, ...arbFiles];

    this.index.clear();
    this.arbIndex.clear();
    this.sqliteCache.clearAll(); // wipe SQLite rows for a clean full rebuild

    const total = allFiles.length;

    for (let i = 0; i < allFiles.length; i++) {
      const uri = allFiles[i];
      try {
        const content = await this.readFile(uri);
        const relPath = this.relativePath(uri.fsPath);

        if (uri.fsPath.endsWith('.dart')) {
          const info = this.parser.parse(relPath, content);
          info.contentHash = this.computeHash(content);
          this.index.set(relPath, info);
          this.sqliteCache.upsertDartFile(relPath, info.contentHash, info);
        } else if (uri.fsPath.endsWith('.arb')) {
          const translations = this.parseArb(content);
          this.arbIndex.set(relPath, translations);
          this.sqliteCache.upsertArbFile(relPath, translations);
        }
      } catch {
        // skip unreadable files
      }

      if (progress) {
        progress.report({
          message: `Indexing ${path.basename(uri.fsPath)} (${i + 1}/${total})`,
          increment: 100 / total,
        });
      }
    }

    this.packages = PackageIndexer.indexPackages(this.workspaceRoot);
    this.sqliteCache.setMeta('packages', this.packages);

    // Build BM25 from scratch after full index
    this._rebuildBM25();
    this.bm25Dirty = false;

    if (this.shouldBuildReverseDeps()) {
      this.buildReverseDependencies().catch(e =>
        console.error('Error building reverse dependencies:', e)
      );
    }

    // SQLite cache is already updated incrementally during indexing.
    // JSON fallback is no longer needed as MCP server now reads from SQLite.

    this.onIndexChanged.fire();
  }

  // ── Incremental update ──────────────────────────────────────────────────────

  /** Update a single file in the index */
  async updateFile(uri: vscode.Uri): Promise<void> {
    const relPath = this.relativePath(uri.fsPath);
    try {
      const content = await this.readFile(uri);
      const newHash = this.computeHash(content);

      if (uri.fsPath.endsWith('.dart')) {
        // Skip if content unchanged (hash comparison in SQLite too)
        const cached = this.sqliteCache.getDartFile(relPath);
        if (cached && cached.hash === newHash) return;

        const info = this.parser.parse(relPath, content);
        info.contentHash = newHash;
        this.index.set(relPath, info);

        // SQLite: update single row — fast
        this.sqliteCache.upsertDartFile(relPath, newHash, info);

        // BM25: update single document — fast
        this._upsertBM25ForFile(relPath, info);

      } else if (uri.fsPath.endsWith('.arb')) {
        const translations = this.parseArb(content);
        this.arbIndex.set(relPath, translations);
        this.sqliteCache.upsertArbFile(relPath, translations);
      }

      // SQLite is updated synchronously above.

      if (this.shouldBuildReverseDeps()) {
        this._debounceReverseDeps();
      }

      this.onIndexChanged.fire();
    } catch {
      // file may have been deleted between event and processing
    }
  }

  /** Remove a file from the index */
  removeFile(uri: vscode.Uri): void {
    const relPath = this.relativePath(uri.fsPath);
    this.index.delete(relPath);
    this.arbIndex.delete(relPath);

    this.sqliteCache.deleteDartFile(relPath);
    this.sqliteCache.deleteArbFile(relPath);

    // Remove all BM25 documents belonging to this file
    this._removeBM25ForFile(relPath);

    this.onIndexChanged.fire();
  }

  /** Load index from SQLite cache at startup */
  loadCache(): boolean {
    const dartRows = this.sqliteCache.getAllDartFiles();
    const arbRows = this.sqliteCache.getAllArbFiles();

    if (dartRows.length === 0 && arbRows.length === 0) {
      return false;
    }

    // Load Dart files
    for (const row of dartRows) {
      this.index.set(row.path, row.info);
    }

    // Load ARB files
    for (const row of arbRows) {
      this.arbIndex.set(row.path, row.translations);
    }

    // Load metadata
    this.packages = this.sqliteCache.getMeta<PackageInfo[]>('packages') ?? [];
    this.diagnostics = this.sqliteCache.getMeta<DiagnosticInfo[]>('diagnostics') ?? [];

    // Rebuild BM25 from loaded data
    this._rebuildBM25();
    this.bm25Dirty = false;

    this.onIndexChanged.fire();
    console.log(`[FlutterExplorer] Loaded ${dartRows.length} dart files and ${arbRows.length} arb files from SQLite.`);
    return true;
  }


  // ── Diagnostics ─────────────────────────────────────────────────────────────

  public updateDiagnostics(diagnostics: DiagnosticInfo[]): void {
    this.diagnostics = diagnostics;
    this.sqliteCache.setMeta('diagnostics', diagnostics);
  }

  public getDiagnostics(): DiagnosticInfo[] {
    return this.diagnostics;
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  getStats(): {
    files: number; classes: number; functions: number; widgets: number;
    enums: number; mixins: number; calls: number; translations: number;
    extensions: number; typedefs: number; variables: number;
    constructors: number; properties: number; annotations: number;
  } {
    let classes = 0, functions = 0, widgets = 0, enums = 0, mixins = 0, calls = 0;
    let extensions = 0, typedefs = 0, variables = 0, constructors = 0, properties = 0, annotations = 0;

    for (const info of this.index.values()) {
      classes += info.classes.length;
      functions += info.functions.length;
      widgets += info.widgets.length;
      enums += info.enums.length;
      mixins += info.mixins.length;
      calls += (info.functionCalls?.length ?? 0);
      extensions += (info.extensions?.length ?? 0);
      typedefs += (info.typedefs?.length ?? 0);
      variables += (info.variables?.length ?? 0);
      constructors += (info.constructors?.length ?? 0);
      properties += (info.properties?.length ?? 0);
      annotations += (info.annotations?.length ?? 0);
    }
    let translations = 0;
    for (const arb of this.arbIndex.values()) translations += arb.length;

    return {
      files: this.index.size + this.arbIndex.size,
      classes, functions, widgets, enums, mixins, calls, translations,
      extensions, typedefs, variables, constructors, properties, annotations,
    };
  }

  // ── Search with BM25 re-ranking ─────────────────────────────────────────────

  /**
   * Search across all indexed files.
   * Results are re-ranked using BM25 when the index is built.
   */
  search(
    query: string,
    filter?: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation'
      | 'call' | 'extension' | 'typedef' | 'variable' | 'constructor'
      | 'property' | 'annotation' | 'file'
  ): SearchResult[] {
    const results: SearchResult[] = [];
    const q = query.toLowerCase();

    if (!filter || filter !== 'translation') {
      for (const info of this.index.values()) {
        if (!filter || filter === 'class') {
          for (const c of info.classes) {
            if (c.name.toLowerCase().includes(q)) {
              const usage = info.classUsages?.find(u => u.className === c.name);
              const usageCount = usage ? (usage.usedByClasses.length + usage.usedByFunctions.length) : 0;
              results.push({ name: c.name, type: 'class', subType: c.type, file: info.filePath, line: c.line, isPrivate: c.isPrivate, usageCount });
            }
          }
        }
        if (!filter || filter === 'function') {
          for (const f of info.functions) {
            if (f.name.toLowerCase().includes(q)) {
              const usage = info.functionUsages?.find(u => u.functionName === f.name && u.parentClass === f.parentClass);
              const usageCount = usage ? usage.calledByFunctions.length : 0;
              results.push({ name: f.name, type: 'function', subType: f.parentClass ? `${f.parentClass}.${f.name}` : f.name, file: info.filePath, line: f.line, isPrivate: f.isPrivate, usageCount });
            }
          }
        }
        if (!filter || filter === 'widget') {
          for (const c of info.classes) {
            if (c.type !== 'plain' && c.type !== 'ChangeNotifier' && c.name.toLowerCase().includes(q)) {
              const usage = info.classUsages?.find(u => u.className === c.name);
              const usageCount = usage ? (usage.usedByClasses.length + usage.usedByFunctions.length) : 0;
              results.push({ name: c.name, type: 'widget', subType: c.type, file: info.filePath, line: c.line, isPrivate: c.isPrivate, usageCount });
            }
          }
        }
        if (!filter || filter === 'enum') {
          for (const e of info.enums) {
            if (e.name.toLowerCase().includes(q))
              results.push({ name: e.name, type: 'enum', subType: e.values.join(', '), file: info.filePath, line: e.line, isPrivate: e.isPrivate });
          }
        }
        if (!filter || filter === 'mixin') {
          for (const m of info.mixins) {
            if (m.name.toLowerCase().includes(q))
              results.push({ name: m.name, type: 'mixin', subType: m.on || '', file: info.filePath, line: m.line, isPrivate: m.isPrivate });
          }
        }
        if (!filter || filter === 'extension') {
          for (const e of (info.extensions ?? [])) {
            if (e.name.toLowerCase().includes(q))
              results.push({ name: e.name, type: 'extension', subType: `on ${e.onType}`, file: info.filePath, line: e.line, isPrivate: e.isPrivate });
          }
        }
        if (!filter || filter === 'typedef') {
          for (const t of (info.typedefs ?? [])) {
            if (t.name.toLowerCase().includes(q))
              results.push({ name: t.name, type: 'typedef', subType: t.signature, file: info.filePath, line: t.line, isPrivate: t.isPrivate });
          }
        }
        if (!filter || filter === 'variable') {
          for (const v of (info.variables ?? [])) {
            if (v.name.toLowerCase().includes(q))
              results.push({ name: v.name, type: 'variable', subType: `${v.type}${v.value ? ' = ' + v.value : ''}`, file: info.filePath, line: v.line, isPrivate: v.isPrivate });
          }
        }
        if (!filter || filter === 'constructor') {
          for (const c of (info.constructors ?? [])) {
            const fullName = `${c.className}.${c.name}`;
            if (fullName.toLowerCase().includes(q))
              results.push({ name: fullName, type: 'constructor', subType: `(${c.params})`, file: info.filePath, line: c.line, isPrivate: c.name.startsWith('_') });
          }
        }
        if (!filter || filter === 'property') {
          for (const p of (info.properties ?? [])) {
            if (p.name.toLowerCase().includes(q)) {
              const prefix = p.className ? `${p.className}.` : '';
              results.push({ name: `${prefix}${p.name}`, type: 'property', subType: p.type, file: info.filePath, line: p.line, isPrivate: p.isPrivate });
            }
          }
        }
        if (!filter || filter === 'annotation') {
          for (const a of (info.annotations ?? [])) {
            if (a.name.toLowerCase().includes(q))
              results.push({ name: `@${a.name}`, type: 'annotation', subType: `on ${a.target} ${a.targetName}`, file: info.filePath, line: a.line, isPrivate: false });
          }
        }
        if (!filter || filter === 'call') {
          for (const call of (info.functionCalls ?? [])) {
            if (call.name.toLowerCase().includes(q))
              results.push({ name: call.name, type: 'call', subType: `Called in ${call.context}`, file: info.filePath, line: call.line, isPrivate: false });
          }
        }
      }
    }

    if (!filter || filter === 'file') {
      for (const filePath of this.index.keys()) {
        const fileName = path.basename(filePath);
        if (fileName.toLowerCase().includes(q))
          results.push({ name: fileName, type: 'file', subType: filePath, file: filePath, line: 1, isPrivate: false });
      }
      for (const filePath of this.arbIndex.keys()) {
        const fileName = path.basename(filePath);
        if (fileName.toLowerCase().includes(q) && !results.find(r => r.file === filePath))
          results.push({ name: fileName, type: 'file', subType: filePath, file: filePath, line: 1, isPrivate: false });
      }
    }

    if (!filter || filter === 'translation') {
      for (const [filePath, translations] of this.arbIndex.entries()) {
        for (const t of translations) {
          if (t.key.toLowerCase().includes(q) || t.value.toLowerCase().includes(q))
            results.push({ name: t.key, type: 'translation', subType: t.value.substring(0, 50) + (t.value.length > 50 ? '...' : ''), file: filePath, line: t.line, isPrivate: false });
        }
      }
    }

    // ── BM25 re-ranking ───────────────────────────────────────────────────────
    // FIX (bm25Dirty): lazy rebuild before search if index is stale
    if (this.bm25Dirty) {
      this._rebuildBM25(); // sets bm25Dirty = false internally
    }

    if (this.bm25.isBuilt && query.trim().length > 0) {
      const candidateIds = results.map(r => this._bm25Id(r));
      const scores = this.bm25.scoreMany(candidateIds, query);

      results.sort((a, b) => {
        const scoreA = scores.get(this._bm25Id(a)) ?? 0;
        const scoreB = scores.get(this._bm25Id(b)) ?? 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.name.localeCompare(b.name);
      });
    } else {
      results.sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.name.localeCompare(b.name);
      });
    }

    return results.slice(0, 500);
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  getAllFiles(): DartFileInfo[] {
    return [...this.index.values()];
  }

  public getAllPackages(): PackageInfo[] {
    return this.packages;
  }

  getFile(relPath: string): DartFileInfo | undefined {
    return this.index.get(relPath);
  }

  // ── Dependency graph ─────────────────────────────────────────────────────────

  getDependencyGraph(): DependencyNode[] {
    const nodes = new Map<string, DependencyNode>();

    for (const info of this.index.values()) {
      if (!nodes.has(info.filePath))
        nodes.set(info.filePath, { file: info.filePath, imports: [], importedBy: [] });

      const node = nodes.get(info.filePath)!;
      for (const imp of info.imports) {
        if (!imp.path.startsWith('package:') && !imp.path.startsWith('dart:')) {
          const resolved = this.resolveImportPath(info.filePath, imp.path);
          node.imports.push(resolved);
          if (!nodes.has(resolved))
            nodes.set(resolved, { file: resolved, imports: [], importedBy: [] });
          nodes.get(resolved)!.importedBy.push(info.filePath);
        }
      }
    }

    return [...nodes.values()];
  }

  parseWidgetTreeForContent(filePath: string, content: string): DartFileInfo {
    return this.parser.parse(filePath, content);
  }

  getWarnings(): { filePath: string; warnings: import('./dartParser').WarningInfo[] }[] {
    const results: { filePath: string; warnings: import('./dartParser').WarningInfo[] }[] = [];
    for (const [filePath, info] of this.index.entries()) {
      if (info.warnings && info.warnings.length > 0)
        results.push({ filePath, warnings: info.warnings });
    }
    return results;
  }

  analyzeTranslations(): { filePath: string; missingKeys: string[] }[] {
    const allKeys = new Set<string>();
    const fileKeys = new Map<string, Set<string>>();

    for (const [filePath, translations] of this.arbIndex.entries()) {
      const keys = new Set<string>();
      for (const t of translations) { allKeys.add(t.key); keys.add(t.key); }
      fileKeys.set(filePath, keys);
    }

    const results: { filePath: string; missingKeys: string[] }[] = [];
    for (const [filePath, keys] of fileKeys.entries()) {
      const missing: string[] = [];
      for (const k of allKeys) { if (!keys.has(k)) missing.push(k); }
      if (missing.length > 0) results.push({ filePath, missingKeys: missing });
    }
    return results;
  }

  public async buildReverseDependencies(): Promise<void> {
    for (const [filePath, info] of this.index.entries()) {
      for (const imp of info.imports) {
        if (!imp.path.startsWith('package:') && !imp.path.startsWith('dart:')) {
          const resolved = this.resolveImportPath(filePath, imp.path);
          const importedFile = this.index.get(resolved);
          if (importedFile) {
            const addFile = (usages: any[], fp: string) => {
              for (const u of usages ?? []) {
                if (!u.usedInFiles.includes(fp)) u.usedInFiles.push(fp);
              }
            };
            addFile(importedFile.classUsages, filePath);
            addFile(importedFile.functionUsages, filePath);
            addFile(importedFile.extensionUsages, filePath);
            addFile(importedFile.typedefUsages, filePath);
            addFile(importedFile.variableUsages, filePath);
            addFile(importedFile.constructorUsages, filePath);
            addFile(importedFile.propertyUsages, filePath);
            addFile(importedFile.annotationUsages, filePath);
            addFile(importedFile.enumUsages, filePath);
            addFile(importedFile.mixinUsages, filePath);
          }
        }
      }
    }
  }

  public relativePath(absPath: string): string {
    return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
  }

  // ── BM25 helpers ─────────────────────────────────────────────────────────────

  /**
   * Extract all BM25 documents for a single DartFileInfo.
   * Single source of truth — used by both _rebuildBM25 and _upsertBM25ForFile.
   */
  private _extractBM25Docs(info: DartFileInfo, filePath: string): BM25Document[] {
    const docs: BM25Document[] = [];

    for (const cls of info.classes) {
      docs.push({
        id: this._bm25Id({ name: cls.name, file: filePath, line: cls.line, type: 'class' } as any),
        fields: { name: cls.name, path: filePath, superclass: cls.extendsClass ?? undefined },
      });
      // Widgets are a separate BM25 doc
      if (cls.type !== 'plain' && cls.type !== 'ChangeNotifier') {
        docs.push({
          id: this._bm25Id({ name: cls.name, file: filePath, line: cls.line, type: 'widget' } as any),
          fields: { name: cls.name, path: filePath, comments: cls.type },
        });
      }
    }
    for (const fn of info.functions) {
      docs.push({
        id: this._bm25Id({ name: fn.name, file: filePath, line: fn.line, type: 'function' } as any),
        fields: { name: fn.name, path: filePath, comments: fn.parentClass ?? undefined },
      });
    }
    for (const e of (info.enums ?? [])) {
      docs.push({
        id: this._bm25Id({ name: e.name, file: filePath, line: e.line, type: 'enum' } as any),
        fields: { name: e.name, path: filePath },
      });
    }
    for (const m of (info.mixins ?? [])) {
      docs.push({
        id: this._bm25Id({ name: m.name, file: filePath, line: m.line, type: 'mixin' } as any),
        fields: { name: m.name, path: filePath },
      });
    }
    for (const ex of (info.extensions ?? [])) {
      docs.push({
        id: this._bm25Id({ name: ex.name, file: filePath, line: ex.line, type: 'extension' } as any),
        fields: { name: ex.name, path: filePath, comments: `on ${ex.onType}` },
      });
    }
    for (const td of (info.typedefs ?? [])) {
      docs.push({
        id: this._bm25Id({ name: td.name, file: filePath, line: td.line, type: 'typedef' } as any),
        fields: { name: td.name, path: filePath },
      });
    }
    for (const v of (info.variables ?? [])) {
      docs.push({
        id: this._bm25Id({ name: v.name, file: filePath, line: v.line, type: 'variable' } as any),
        fields: { name: v.name, path: filePath, comments: v.type },
      });
    }
    for (const c of (info.constructors ?? [])) {
      const fullName = `${c.className}.${c.name}`;
      docs.push({
        id: this._bm25Id({ name: fullName, file: filePath, line: c.line, type: 'constructor' } as any),
        fields: { name: fullName, path: filePath },
      });
    }
    for (const p of (info.properties ?? [])) {
      docs.push({
        id: this._bm25Id({ name: p.name, file: filePath, line: p.line, type: 'property' } as any),
        fields: { name: p.name, path: filePath, comments: `${p.className ?? ''} ${p.type}` },
      });
    }
    for (const a of (info.annotations ?? [])) {
      docs.push({
        id: this._bm25Id({ name: a.name, file: filePath, line: a.line, type: 'annotation' } as any),
        fields: { name: a.name, path: filePath, comments: `on ${a.targetName}` },
      });
    }
    for (const call of (info.functionCalls ?? [])) {
      docs.push({
        id: this._bm25Id({ name: call.name, file: filePath, line: call.line, type: 'call' } as any),
        fields: { name: call.name, path: filePath, comments: `in ${call.context}` },
      });
    }

    return docs;
  }

  /**
   * Build BM25 index from scratch.
   */
  private _rebuildBM25(): void {
    const docs: BM25Document[] = [];
    this.fileDocIds.clear();

    for (const info of this.index.values()) {
      const extracted = this._extractBM25Docs(info, info.filePath);
      docs.push(...extracted);
      this.fileDocIds.set(info.filePath, extracted.map(d => d.id));
    }

    // ARB translations
    for (const [filePath, translations] of this.arbIndex.entries()) {
      const arbIds: string[] = [];
      for (const t of translations) {
        const id = this._bm25Id({ name: t.key, file: filePath, line: t.line, type: 'translation' } as any);
        docs.push({
          id,
          fields: { name: t.key, path: filePath, comments: t.value.substring(0, 100) }
        });
        arbIds.push(id);
      }
      this.fileDocIds.set(filePath, arbIds);
    }

    this.bm25.buildIndex(docs);
    this.bm25Dirty = false;
  }

  /** Add/update BM25 documents for a single file. */
  private _upsertBM25ForFile(relPath: string, info: DartFileInfo): void {
    this._removeBM25ForFile(relPath); 
    const docs = this._extractBM25Docs(info, relPath);
    const ids: string[] = [];
    for (const doc of docs) {
      this.bm25.upsertDocument(doc);
      ids.push(doc.id);
    }
    this.fileDocIds.set(relPath, ids);
  }

  /**
   * Remove all BM25 documents belonging to a file.
   */
  private _removeBM25ForFile(relPath: string): void {
    const ids = this.fileDocIds.get(relPath);
    if (!ids) return;
    for (const id of ids) {
      this.bm25.removeDocument(id);
    }
    this.fileDocIds.delete(relPath);
  }

  /** Unique BM25 document ID derived from search result. */
  private _bm25Id(r: { name: string; file: string; line: number; type: string }): string {
    return `${r.file}:${r.line}:${r.name}:${r.type}`;
  }


  // ── Other helpers ─────────────────────────────────────────────────────────

  private shouldBuildReverseDeps(): boolean {
    return vscode.workspace.getConfiguration('flutterExplorer')
      .get<boolean>('enableReverseDependencies', true);
  }

  private _debounceReverseDeps(): void {
    if (this.reverseDepsTimeout) clearTimeout(this.reverseDepsTimeout);
    this.reverseDepsTimeout = setTimeout(() => {
      this.reverseDepsTimeout = null;
      this.buildReverseDependencies().catch(e =>
        console.error('Error building reverse dependencies:', e)
      );
    }, 2000);
  }

  private computeHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private resolveImportPath(fromFile: string, importPath: string): string {
    const dir = path.dirname(fromFile);
    return path.posix.normalize(path.posix.join(dir, importPath));
  }

  private async readFile(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf-8');
  }

  private parseArb(content: string): TranslationInfo[] {
    const translations: TranslationInfo[] = [];
    try {
      const data = JSON.parse(content);
      const lines = content.split('\n');
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('@') || typeof value !== 'string') continue;
        let lineNum = 1;
        const searchStr = `"${key}"`;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(searchStr)) { lineNum = i + 1; break; }
        }
        translations.push({ key, value, line: lineNum });
      }
    } catch { /* ignore JSON errors */ }
    return translations;
  }
}

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface SearchResult {
  name: string;
  type: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation'
  | 'call' | 'extension' | 'typedef' | 'variable' | 'constructor'
  | 'property' | 'annotation' | 'file';
  subType: string;
  file: string;
  line: number;
  isPrivate: boolean;
  usageCount?: number;
}

export interface DependencyNode {
  file: string;
  imports: string[];
  importedBy: string[];
}