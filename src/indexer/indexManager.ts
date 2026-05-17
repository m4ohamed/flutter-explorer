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
import { analyzeWithDart } from './dartAnalyzerWrapper';

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
  private reverseDepsTimeout: NodeJS.Timeout | null = null;
  private projectName: string | null = null;

  private extensionPath?: string;
  private isIndexing = false;
  private indexingCancellationTokenSource: vscode.CancellationTokenSource | null = null;

  constructor(workspaceRoot: string, extensionPath?: string) {
    this.workspaceRoot = workspaceRoot;
    this.extensionPath = extensionPath;
    this.sqliteCache = new SqliteCache(workspaceRoot);
  }


  // ── Concurrency Helper ──────────────────────────────────────────────────────
  private async runConcurrent<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
  ): Promise<void> {
    let index = 0;
    const execWorker = async (): Promise<void> => {
      while (index < items.length) {
        const currentIndex = index++;
        await worker(items[currentIndex], currentIndex);
      }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
      workers.push(execWorker());
    }
    await Promise.all(workers);
  }

  // ── Full index ──────────────────────────────────────────────────────────────

  /** Build full index by scanning all Dart files */
  async buildFullIndex(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    if (this.isIndexing) {
      const choice = await vscode.window.showInformationMessage(
        'A full re-index is already in progress. What would you like to do?',
        { modal: true },
        'Cancel Existing & Start Over',
        'Continue Current',
      );

      if (choice === 'Cancel Existing & Start Over') {
        if (this.indexingCancellationTokenSource) {
          this.indexingCancellationTokenSource.cancel();
          // Give it a moment to stop
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else if (choice === 'Continue Current') {
        return; // Just let the other one finish
      } else {
        return; // Aborted by user
      }
    }

    this.isIndexing = true;
    this.indexingCancellationTokenSource = new vscode.CancellationTokenSource();
    const token = this.indexingCancellationTokenSource.token;

    try {
      const dartFiles = await vscode.workspace.findFiles('lib/**/*.dart', '**/.*', 10000, token);
      if (token.isCancellationRequested) return;
      const androidFiles = await vscode.workspace.findFiles('android/app/**/*.{dart,kt,java,xml,gradle}', '**/.*', 1000, token);
      if (token.isCancellationRequested) return;
      const arbFiles = await vscode.workspace.findFiles('lib/**/*.arb', '**/.*', 500, token);
      if (token.isCancellationRequested) return;

      const allFiles = [...dartFiles, ...androidFiles, ...arbFiles];

      this.index.clear();
      this.arbIndex.clear();
      this.sqliteCache.clearAll(); // wipe SQLite rows for a clean full rebuild
      this.projectName = await this._loadProjectName();

      const total = allFiles.length;

      const useDartAnalyzer = vscode.workspace.getConfiguration('flutterExplorer').get<boolean>('useDartAnalyzer', true);
      const concurrency = vscode.workspace.getConfiguration('flutterExplorer').get<number>('indexingConcurrency', 3);
      let dartFilesAnalyzed = false;

      if (useDartAnalyzer) {
        if (progress) progress.report({ message: 'Analyzing project with Dart SDK...' });
        const dartResults = await analyzeWithDart(this.workspaceRoot, this.extensionPath, (current) => {
          if (progress) progress.report({ message: `Analyzed ${current} Dart files...` });
        });

        if (token.isCancellationRequested) return;

        if (dartResults && dartResults.length > 0) {
          const filesToUpsert: Array<{ relPath: string; hash: string | undefined; info: DartFileInfo }> = [];
          
          await this.runConcurrent(dartResults, concurrency, async (info, i) => {
            if (token.isCancellationRequested) return;
            try {
              if (progress && i % 10 === 0) {
                progress.report({ message: `Processing ${info.filePath} (${i + 1}/${dartResults.length})` });
              }
              const fullPath = path.join(this.workspaceRoot, info.filePath);
              const content = await fs.promises.readFile(fullPath, 'utf8');
              info.contentHash = this.computeHash(content);
              this.index.set(info.filePath, info);
              filesToUpsert.push({ relPath: info.filePath, hash: info.contentHash, info });
            } catch (e) {
              console.error(`Failed to post-process analyzed file ${info.filePath}:`, e);
            }
          });

          if (token.isCancellationRequested) return;
          if (filesToUpsert.length > 0) {
            this.sqliteCache.batchUpsertDartFiles(filesToUpsert);
          }
          dartFilesAnalyzed = true;
        }
      }

      const dartFilesToUpsert: Array<{ relPath: string; hash: string | undefined; info: DartFileInfo }> = [];

      await this.runConcurrent(allFiles, concurrency, async (uri, i) => {
        if (token.isCancellationRequested) return;
        try {
          const relPath = this.relativePath(uri.fsPath);

          if (uri.fsPath.endsWith('.dart')) {
            if (!dartFilesAnalyzed) {
              const content = await this.readFile(uri);
              const info = this.parser.parse(relPath, content);
              info.contentHash = this.computeHash(content);
              this.index.set(relPath, info);
              dartFilesToUpsert.push({ relPath, hash: info.contentHash, info });
            }
          } else if (uri.fsPath.endsWith('.arb')) {
            const content = await this.readFile(uri);
            const translations = this.parseArb(content);
            this.arbIndex.set(relPath, translations);
            this.sqliteCache.upsertArbFile(relPath, translations);
          } else if (uri.fsPath.endsWith('.kt') || uri.fsPath.endsWith('.java') || uri.fsPath.endsWith('.xml') || uri.fsPath.endsWith('.gradle')) {
            // Basic indexing for android files if needed, currently buildFullIndex gathers them but doesn't do much
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
      });

      if (token.isCancellationRequested) return;
      if (dartFilesToUpsert.length > 0) {
        this.sqliteCache.batchUpsertDartFiles(dartFilesToUpsert);
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
      this.sqliteCache.checkpoint();

      this.onIndexChanged.fire();
    } finally {
      this.isIndexing = false;
      this.indexingCancellationTokenSource?.dispose();
      this.indexingCancellationTokenSource = null;
    }
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
  async loadCache(): Promise<boolean> {
    this.projectName = await this._loadProjectName();
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
    const source = this.sqliteCache.isAvailable ? 'SQLite' : 'JSON Cache';
    console.log(`[FlutterExplorer] Loaded ${dartRows.length} dart files and ${arbRows.length} arb files from ${source}.`);
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
    extensionTypes: number;
  } {
    let classes = 0, functions = 0, widgets = 0, enums = 0, mixins = 0, calls = 0;
    let extensions = 0, typedefs = 0, variables = 0, constructors = 0, properties = 0, annotations = 0;
    let extensionTypes = 0;

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
      extensionTypes += (info.extensionTypes?.length ?? 0);
    }
    let translations = 0;
    for (const arb of this.arbIndex.values()) translations += arb.length;

    return {
      files: this.index.size + this.arbIndex.size,
      classes, functions, widgets, enums, mixins, calls, translations,
      extensions, typedefs, variables, constructors, properties, annotations,
      extensionTypes,
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
      | 'property' | 'annotation' | 'file' | 'extensionType'
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
        if (!filter || filter === 'extensionType') {
          for (const et of (info.extensionTypes ?? [])) {
            if (et.name.toLowerCase().includes(q))
              results.push({ name: et.name, type: 'extensionType', subType: `on ${et.representationType}`, file: info.filePath, line: et.line, isPrivate: et.isPrivate });
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
        let resolved: string | null = null;

        if (imp.path.startsWith('package:')) {
          if (this.projectName && imp.path.startsWith(`package:${this.projectName}/`)) {
            // Local package import
            resolved = 'lib/' + imp.path.substring(`package:${this.projectName}/`.length);
          }
        } else if (!imp.path.startsWith('dart:')) {
          // Relative import
          resolved = this.resolveImportPath(info.filePath, imp.path);
        }

        if (resolved && this.index.has(resolved)) {
          node.imports.push(resolved);
          if (!nodes.has(resolved))
            nodes.set(resolved, { file: resolved, imports: [], importedBy: [] });
          nodes.get(resolved)!.importedBy.push(info.filePath);
        }
      }
    }

    return [...nodes.values()];
  }

  /**
   * Builds a detailed graph of all entities (files, classes, functions) and their relationships.
   */
  getDetailedGraph(): { nodes: any[], edges: any[] } {
    const nodes: any[] = [];
    const edges: any[] = [];
    const seenNodes = new Set<string>();

    // 1. Files
    for (const [path, info] of this.index.entries()) {
      const fileId = `file:${path}`;
      if (!seenNodes.has(fileId)) {
        nodes.push({ id: fileId, label: path.split('/').pop() || path, type: 'file', path });
        seenNodes.add(fileId);
      }

      // 2. Classes in this file
      for (const cls of info.classes) {
        const clsId = `class:${cls.name}`;
        if (!seenNodes.has(clsId)) {
          nodes.push({ id: clsId, label: cls.name, type: 'class', path, line: cls.line });
          seenNodes.add(clsId);
        }
        // Relationship: File contains Class
        edges.push({ from: fileId, to: clsId, type: 'contains' });

        // Relationship: Inheritance (Class extends Class)
        if (cls.extendsClass) {
          edges.push({ from: clsId, to: `class:${cls.extendsClass}`, type: 'extends' });
        }
        for (const m of cls.mixins) {
          edges.push({ from: clsId, to: `class:${m}`, type: 'with' });
        }
      }

      // 3. Functions in this file
      for (const fn of info.functions) {
        const fnId = fn.parentClass ? `method:${fn.parentClass}.${fn.name}` : `func:${fn.name}`;
        if (!seenNodes.has(fnId)) {
          nodes.push({ id: fnId, label: fn.name, type: fn.parentClass ? 'method' : 'function', path, line: fn.line });
          seenNodes.add(fnId);
        }
        // Relationship: Container contains Function
        const parentId = fn.parentClass ? `class:${fn.parentClass}` : fileId;
        edges.push({ from: parentId, to: fnId, type: 'contains' });
      }

      // 4. Function Calls (Relationships)
      for (const call of (info.functionCalls ?? [])) {
        let callerId: string;
        if (call.callerClass && call.callerFunction) {
          callerId = `method:${call.callerClass}.${call.callerFunction}`;
        } else if (call.callerFunction) {
          callerId = `func:${call.callerFunction}`;
        } else if (call.callerClass) {
          callerId = `class:${call.callerClass}`;
        } else {
          callerId = fileId;
        }

        const calleeId = call.name.includes('.') ? `method:${call.name}` : `func:${call.name}`;

        // Only add edge if we actually found a caller and it's not self-call
        if (callerId !== calleeId) {
          edges.push({ from: callerId, to: calleeId, type: 'calls' });
        }
      }

      // 5. Imports (File to File)
      for (const imp of info.imports) {
        const resolved = this.resolveImportPath(path, imp.path);
        if (this.index.has(resolved)) {
          edges.push({ from: fileId, to: `file:${resolved}`, type: 'imports' });
        }
      }
    }

    return { nodes, edges };
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

    // SQLite: save all modified entries (reverse deps are global)
    const filesToUpdate = Array.from(this.index.entries()).map(([relPath, info]) => ({
      relPath,
      hash: info.contentHash,
      info
    }));
    this.sqliteCache.batchUpsertDartFiles(filesToUpdate);
    this.sqliteCache.checkpoint();
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

    for (const et of (info.extensionTypes ?? [])) {
      docs.push({
        id: this._bm25Id({ name: et.name, file: filePath, line: et.line, type: 'extensionType' } as any),
        fields: { name: et.name, path: filePath, comments: et.representationType },
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
    if (importPath.startsWith('package:')) {
      if (this.projectName && importPath.startsWith(`package:${this.projectName}/`)) {
        return 'lib/' + importPath.substring(`package:${this.projectName}/`.length);
      }
      return importPath; // Cannot resolve external packages yet
    }
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

  // ── Impact Analysis (Blast Radius) ──────────────────────────────────────────

  /**
   * Find all "Entry Points" (main, build methods, event handlers) that 
   * eventually call code within the target file.
   */
  public getImpactAnalysis(filePath: string): any {
    const relPath = this.relativePath(filePath);
    const fileInfo = this.index.get(relPath);
    if (!fileInfo) return { error: "File not indexed" };

    // 1. Identify all addressable entities in this file (classes, functions, methods)
    const targets = new Set<string>();
    for (const cls of fileInfo.classes) targets.add(cls.name);
    for (const func of fileInfo.functions) targets.add(func.name);

    // 2. Perform backward search on the global call graph
    const affectedFlows: any[] = [];
    const entryPoints = this._findEntryPoints();

    // For each entry point, check if it can reach any target
    // In a large project, we'd use a pre-built adjacency map, but for now we'll traverse
    for (const ep of entryPoints) {
      const path = this._findPathToTargets(ep, targets);
      if (path) {
        affectedFlows.push({
          entryPoint: ep.name,
          path: path
        });
      }
    }

    return {
      targetFile: relPath,
      entitiesCount: targets.size,
      affectedFlows: affectedFlows
    };
  }

  private _findEntryPoints(): any[] {
    const entryPoints: any[] = [];
    for (const [path, info] of this.index.entries()) {
      // main() is always an entry point
      for (const func of info.functions) {
        if (func.name === 'main') {
          entryPoints.push({ ...func, filePath: path, kind: 'Function' });
        }
      }
      // build() methods in Widgets are entry points
      for (const cls of info.classes) {
        const isWidget = cls.extendsClass && (
          cls.extendsClass.includes('Widget') ||
          cls.extendsClass.includes('State') ||
          cls.extendsClass.includes('Controller')
        );
        if (isWidget) {
          // Look for build or other lifecycle methods
          for (const method of cls.methods) {
            if (method.name === 'build' || method.name === 'initState') {
              entryPoints.push({ ...method, filePath: path, kind: 'Method' });
            }
          }
        }
      }
    }
    return entryPoints;
  }

  private _findPathToTargets(start: any, targets: Set<string>, maxDepth = 5): any[] | null {
    const queue: { node: any; path: any[] }[] = [{ node: start, path: [start] }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { node, path } = queue.shift()!;
      const qname = `${node.filePath}:${node.name}`;
      if (visited.has(qname)) continue;
      visited.add(qname);

      if (targets.has(node.name)) {
        return path;
      }

      if (path.length >= maxDepth) continue;

      // Find functions called by this node
      const fileInfo = this.index.get(node.filePath);
      if (fileInfo) {
        const calls = fileInfo.functionCalls.filter(c =>
          c.callerFunction === node.name &&
          (!node.parentClass || c.callerClass === node.parentClass)
        );

        for (const call of calls) {
          // Resolve target node (simplistic: look for first match in index)
          const targetNode = this._resolveCall(call.name);
          if (targetNode) {
            queue.push({ node: targetNode, path: [...path, targetNode] });
          }
        }
      }
    }
    return null;
  }

  private _resolveCall(name: string): any | null {
    // Check if name is Class.method
    const dotIdx = name.indexOf('.');
    if (dotIdx !== -1) {
      const clsName = name.substring(0, dotIdx);
      const methodName = name.substring(dotIdx + 1);
      for (const [path, info] of this.index.entries()) {
        for (const c of info.classes) {
          if (c.name === clsName) {
            const m = c.methods.find(meth => meth.name === methodName);
            if (m) return { ...m, filePath: path, kind: 'Method' };
          }
        }
      }
    }

    // Basic resolution: find first function or class with this name
    for (const [path, info] of this.index.entries()) {
      for (const f of info.functions) {
        if (f.name === name) return { ...f, filePath: path, kind: 'Function' };
      }
      for (const c of info.classes) {
        if (c.name === name) return { ...c, filePath: path, kind: 'Class', name: c.name, line: c.line };
      }
      for (const et of info.extensionTypes) {
        if (et.name === name) return { ...et, filePath: path, kind: 'ExtensionType', name: et.name, line: et.line };
      }
    }
    return null;
  }

  public async ensureProjectName(forFile?: string): Promise<void> {
    if (!this.projectName || forFile) {
      const name = await this._loadProjectName(forFile);
      if (name) this.projectName = name;
    }
  }

  private async _loadProjectName(forFile?: string): Promise<string | null> {
    try {
      let currentDir = forFile ? path.dirname(forFile) : this.workspaceRoot;
      const root = path.parse(currentDir).root;

      while (currentDir && currentDir !== root) {
        const pubspecPath = path.join(currentDir, 'pubspec.yaml');
        if (fs.existsSync(pubspecPath)) {
          const content = fs.readFileSync(pubspecPath, 'utf-8');
          const match = content.match(/^name:\s+([\w\-]+)/m);
          if (match) return match[1];
        }
        currentDir = path.dirname(currentDir);
      }
      return null;
    } catch (err) {
      console.error('[FlutterExplorer] Error loading project name:', err);
      return null;
    }
  }
}

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface SearchResult {
  name: string;
  type: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation'
  | 'call' | 'extension' | 'typedef' | 'variable' | 'constructor'
  | 'property' | 'annotation' | 'file' | 'extensionType';
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