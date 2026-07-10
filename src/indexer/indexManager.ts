import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DartParser, DartFileInfo } from './dartParser';
import { JsTsParser } from './jsTsParser';
import { AndroidParser } from './androidParser';
import { analyzeWithDart } from './dartAnalyzerWrapper';
import { PackageIndexer } from './packageIndexer';
import { PackageInfo } from '../providers/pubspecLockProvider';
import { SqliteCache } from './sqliteCache';
import { ProjectDetector } from '../utils/projectDetector';
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
  private jsTsParser: JsTsParser = new JsTsParser();
  private androidParser: AndroidParser = new AndroidParser();
  private workspaceRoot: string;
  private onIndexChanged: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeIndex: vscode.Event<void> = this.onIndexChanged.event;
  private sqliteCache: SqliteCache;
  private bm25 = new BM25Search();
  private bm25Dirty = true;
  private fileDocIds = new Map<string, string[]>();
  private reverseDepsTimeout: NodeJS.Timeout | null = null;
  private projectName: string | null = null;
  private extensionPath?: string;
  private isIndexing = false;
  private indexingCancellationTokenSource: vscode.CancellationTokenSource | null = null;
  private excludePatterns: RegExp[] = [];
  private _disposed = false;
  constructor(workspaceRoot: string, extensionPath?: string) {
    this.workspaceRoot = workspaceRoot;
    this.extensionPath = extensionPath;
    this.sqliteCache = new SqliteCache(workspaceRoot);
    this.loadAnalysisOptionsExcludes();
  }
  public globToRegExp(glob: string): RegExp {
    let pattern = glob.replace(/\\/g, '/');
    let regexStr = '^';
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === '*') {
        if (pattern[i + 1] === '*') {
          if (pattern[i + 2] === '/') {
            regexStr += '(?:.*/)?';
            i += 2;
          }
          else {
            regexStr += '.*';
            i++;
          }
        }
        else {
          regexStr += '[^/]*';
        }
      }
      else if (char === '?') {
        regexStr += '[^/]';
      }
      else if (char === '.') {
        regexStr += '\\.';
      }
      else if (char === '/' || char === '\\') {
        regexStr += '\\/';
      }
      else if (['(', ')', '+', '^', '$', '|', '{', '}', '[', ']'].includes(char)) {
        regexStr += '\\' + char;
      }
      else {
        regexStr += char;
      }
    }
    regexStr += '$';
    return new RegExp(regexStr);
  }
  public loadAnalysisOptionsExcludes(): void {
    this.excludePatterns = [];
    const optionsPath = path.join(this.workspaceRoot, 'analysis_options.yaml');
    if (!fs.existsSync(optionsPath)) {
      return;
    }
    try {
      const content = fs.readFileSync(optionsPath, 'utf8');
      const lines = content.split('\n');
      let inAnalyzer = false;
      let inExclude = false;
      let excludeIndent = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || trimmed === '') {
          continue;
        }
        const indent = line.length - line.trimStart().length;
        if (trimmed.startsWith('analyzer:')) {
          inAnalyzer = true;
          inExclude = false;
          continue;
        }
        if (inAnalyzer) {
          if (indent === 0 && !trimmed.startsWith('analyzer:')) {
            inAnalyzer = false;
            inExclude = false;
            continue;
          }
          if (trimmed.startsWith('exclude:')) {
            inExclude = true;
            excludeIndent = indent;
            const inlineArrayMatch = trimmed.match(/exclude:\s*\[(.*)\]/);
            if (inlineArrayMatch) {
              const items = inlineArrayMatch[1]
                .split(',')
                .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
                .filter(item => item !== '');
              for (const item of items) {
                this.excludePatterns.push(this.globToRegExp(item));
              }
              inExclude = false;
            }
            continue;
          }
          if (inExclude) {
            if (indent <= excludeIndent && !trimmed.startsWith('-')) {
              inExclude = false;
              continue;
            }
            if (trimmed.startsWith('-')) {
              const pattern = trimmed.substring(1).trim().replace(/^['"]|['"]$/g, '');
              if (pattern) {
                this.excludePatterns.push(this.globToRegExp(pattern));
              }
            }
          }
        }
      }
      console.log(`[FlutterExplorer] Loaded ${this.excludePatterns.length} exclude patterns from analysis_options.yaml`);
    }
    catch (e) {
      console.error('[FlutterExplorer] Failed to parse analysis_options.yaml:', e);
    }
  }
  public isFileExcluded(fsPath: string): boolean {
    const relPath = this.relativePath(fsPath).replace(/\\/g, '/');
    for (const pattern of this.excludePatterns) {
      if (pattern.test(relPath)) {
        return true;
      }
    }
    return false;
  }
  public getProjectMode(): 'flutter' | 'web' {
    if (fs.existsSync(path.join(this.workspaceRoot, 'pubspec.yaml'))) {
      return 'flutter';
    }
    return 'web';
  }
  public dispose(): void {
    if (this._disposed)
      return;
    this._disposed = true;
    if (this.reverseDepsTimeout) {
      clearTimeout(this.reverseDepsTimeout);
      this.reverseDepsTimeout = null;
    }
    if (this.indexingCancellationTokenSource) {
      this.indexingCancellationTokenSource.cancel();
      this.indexingCancellationTokenSource.dispose();
      this.indexingCancellationTokenSource = null;
    }
    this.sqliteCache.close();
    console.log('[FlutterExplorer] IndexManager disposed cleanly.');
  }
  private async runConcurrent<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
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
  async buildFullIndex(progress?: vscode.Progress<{
    message?: string;
    increment?: number;
  }>): Promise<void> {
    if (this.isIndexing) {
      const choice = await vscode.window.showInformationMessage('A full re-index is already in progress. What would you like to do?', { modal: true }, 'Cancel Existing & Start Over', 'Continue Current');
      if (choice === 'Cancel Existing & Start Over') {
        if (this.indexingCancellationTokenSource) {
          this.indexingCancellationTokenSource.cancel();
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      else if (choice === 'Continue Current') {
        return;
      }
      else {
        return;
      }
    }
    this.isIndexing = true;
    this.indexingCancellationTokenSource = new vscode.CancellationTokenSource();
    const token = this.indexingCancellationTokenSource.token;
    if (progress)
      progress.report({ message: 'Discovering project files...' });
    try {
      const mode = this.getProjectMode();
      let allFiles: vscode.Uri[] = [];
      if (mode === 'flutter') {
        const dartFiles = await vscode.workspace.findFiles('lib/**/*.dart', '**/.*', 10000, token);
        if (token.isCancellationRequested)
          return;
        const androidFiles = await vscode.workspace.findFiles('android/app/**/*.{dart,kt,java,xml,gradle}', '**/.*', 1000, token);
        if (token.isCancellationRequested)
          return;
        const arbFiles = await vscode.workspace.findFiles('lib/**/*.arb', '**/.*', 500, token);
        if (token.isCancellationRequested)
          return;
        allFiles = [...dartFiles, ...androidFiles, ...arbFiles].filter(uri => !this.isFileExcluded(uri.fsPath));
      }
      else {
        const excludePattern = '**/{node_modules,out,dist,build,.git,.next}/**';
        allFiles = (await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx}', excludePattern, 10000, token)).filter(uri => !this.isFileExcluded(uri.fsPath));
      }
      const total = allFiles.length;
      if (progress)
        progress.report({ message: `Found ${total} files to index.` });
      this.index.clear();
      this.arbIndex.clear();
      await this.sqliteCache.clearAll();
      this.projectName = await this._loadProjectName();
      const useDartAnalyzer = mode === 'flutter' && vscode.workspace.getConfiguration('flutterExplorer').get<boolean>('useDartAnalyzer', true);
      const concurrency = vscode.workspace.getConfiguration('flutterExplorer').get<number>('indexingConcurrency', 3);
      let dartFilesAnalyzed = false;
      if (useDartAnalyzer) {
        if (progress)
          progress.report({ message: 'Initializing Dart SDK Analyzer (discovering packages)...' });
        const dartResults = await analyzeWithDart(this.workspaceRoot, this.extensionPath, (msg, current, totalFiles) => {
          if (progress) {
            progress.report({
              message: msg,
              increment: current !== undefined && totalFiles ? (100 / totalFiles) : undefined
            });
          }
        });
        if (token.isCancellationRequested)
          return;
        if (dartResults && dartResults.length > 0) {
          const filesToUpsert: Array<{
            relPath: string;
            hash: string | undefined;
            info: DartFileInfo;
          }> = [];
          let completedPostCount = 0;
          const activePostFiles = new Set<string>();
          await this.runConcurrent(dartResults, concurrency, async (info, i) => {
            if (token.isCancellationRequested)
              return;
            const fileName = path.basename(info.filePath);
            activePostFiles.add(fileName);
            if (progress) {
              const remaining = dartResults.length - completedPostCount;
              progress.report({ message: `Saving Dart SDK Cache: [${Array.from(activePostFiles).join(', ')}] (${completedPostCount}/${dartResults.length} done, ${remaining} remaining)...` });
            }
            try {
              const fullPath = path.join(this.workspaceRoot, info.filePath);
              const content = await fs.promises.readFile(fullPath, 'utf8');
              info.contentHash = this.computeHash(content);
              const parsedInfo = this.parser.parse(info.filePath, content);
              info.warnings = parsedInfo.warnings;
              this.index.set(info.filePath, info);
              filesToUpsert.push({ relPath: info.filePath, hash: info.contentHash, info });
            }
            catch (e) {
              console.error(`Failed to post-process analyzed file ${info.filePath}:`, e);
            }
            finally {
              activePostFiles.delete(fileName);
              completedPostCount++;
              if (progress) {
                const remaining = dartResults.length - completedPostCount;
                progress.report({ message: `Saving Dart SDK Cache: [${Array.from(activePostFiles).join(', ')}] (${completedPostCount}/${dartResults.length} done, ${remaining} remaining)...` });
              }
            }
          });
          if (token.isCancellationRequested)
            return;
          if (filesToUpsert.length > 0) {
            await this.sqliteCache.batchUpsertDartFiles(filesToUpsert);
          }
          dartFilesAnalyzed = true;
        }
      }
      const dartFilesToUpsert: Array<{
        relPath: string;
        hash: string | undefined;
        info: DartFileInfo;
      }> = [];
      let completedCount = 0;
      const activeFiles = new Set<string>();
      await this.runConcurrent(allFiles, concurrency, async (uri, i) => {
        if (token.isCancellationRequested)
          return;
        const fileName = path.basename(uri.fsPath);
        activeFiles.add(fileName);
        if (progress) {
          const remaining = total - completedCount;
          progress.report({
            message: `Indexing: [${Array.from(activeFiles).join(', ')}] (${completedCount}/${total} done, ${remaining} remaining)...`,
          });
        }
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
          }
          else if (uri.fsPath.endsWith('.ts') || uri.fsPath.endsWith('.tsx') || uri.fsPath.endsWith('.js') || uri.fsPath.endsWith('.jsx')) {
            const content = await this.readFile(uri);
            const info = this.jsTsParser.parse(relPath, content);
            info.contentHash = this.computeHash(content);
            this.index.set(relPath, info);
            dartFilesToUpsert.push({ relPath, hash: info.contentHash, info });
          }
          else if (uri.fsPath.endsWith('.arb')) {
            const content = await this.readFile(uri);
            const translations = this.parseArb(content);
            this.arbIndex.set(relPath, translations);
            await this.sqliteCache.upsertArbFile(relPath, translations);
          }
          else if (uri.fsPath.endsWith('.kt') || uri.fsPath.endsWith('.java') || uri.fsPath.endsWith('.xml') || uri.fsPath.endsWith('.gradle') || uri.fsPath.endsWith('.gradle.kts')) {
            const content = await this.readFile(uri);
            const info = this.androidParser.parse(relPath, content);
            info.contentHash = this.computeHash(content);
            this.index.set(relPath, info);
            dartFilesToUpsert.push({ relPath, hash: info.contentHash, info });
          }
        }
        catch {
        }
        finally {
          activeFiles.delete(fileName);
          completedCount++;
          if (progress) {
            const remaining = total - completedCount;
            progress.report({
              message: `Indexing: [${Array.from(activeFiles).join(', ')}] (${completedCount}/${total} done, ${remaining} remaining)...`,
              increment: 100 / total,
            });
          }
        }
      });
      if (token.isCancellationRequested)
        return;
      if (dartFilesToUpsert.length > 0) {
        await this.sqliteCache.batchUpsertDartFiles(dartFilesToUpsert);
      }
      this.packages = PackageIndexer.indexPackages(this.workspaceRoot);
      await this.sqliteCache.setMeta('packages', this.packages);
      this._rebuildBM25();
      this.bm25Dirty = false;
      if (this.shouldBuildReverseDeps()) {
        this.buildReverseDependencies().catch(e => console.error('Error building reverse dependencies:', e));
      }
      this.sqliteCache.checkpoint();
      this.onIndexChanged.fire();
    }
    finally {
      this.isIndexing = false;
      this.indexingCancellationTokenSource?.dispose();
      this.indexingCancellationTokenSource = null;
    }
  }
  async updateFile(uri: vscode.Uri): Promise<void> {
    const relPath = this.relativePath(uri.fsPath);
    if (this.isFileExcluded(uri.fsPath)) {
      if (this.index.has(relPath) || this.arbIndex.has(relPath)) {
        await this.removeFile(uri);
      }
      return;
    }
    try {
      const content = await this.readFile(uri);
      const newHash = this.computeHash(content);
      if (uri.fsPath.endsWith('.dart')) {
        const cached = await this.sqliteCache.getDartFile(relPath);
        if (cached && cached.hash === newHash)
          return;
        const info = this.parser.parse(relPath, content);
        info.contentHash = newHash;
        this.index.set(relPath, info);
        await this.sqliteCache.upsertDartFile(relPath, newHash, info);
        this._upsertBM25ForFile(relPath, info);
      }
      else if (uri.fsPath.endsWith('.ts') || uri.fsPath.endsWith('.tsx') || uri.fsPath.endsWith('.js') || uri.fsPath.endsWith('.jsx')) {
        const cached = await this.sqliteCache.getDartFile(relPath);
        if (cached && cached.hash === newHash)
          return;
        const info = this.jsTsParser.parse(relPath, content);
        info.contentHash = newHash;
        this.index.set(relPath, info);
        await this.sqliteCache.upsertDartFile(relPath, newHash, info);
        this._upsertBM25ForFile(relPath, info);
      }
      else if (uri.fsPath.endsWith('.kt') || uri.fsPath.endsWith('.java') || uri.fsPath.endsWith('.xml') || uri.fsPath.endsWith('.gradle') || uri.fsPath.endsWith('.gradle.kts')) {
        const cached = await this.sqliteCache.getDartFile(relPath);
        if (cached && cached.hash === newHash)
          return;
        const info = this.androidParser.parse(relPath, content);
        info.contentHash = newHash;
        this.index.set(relPath, info);
        await this.sqliteCache.upsertDartFile(relPath, newHash, info);
        this._upsertBM25ForFile(relPath, info);
      }
      else if (uri.fsPath.endsWith('.arb')) {
        const translations = this.parseArb(content);
        this.arbIndex.set(relPath, translations);
        await this.sqliteCache.upsertArbFile(relPath, translations);
      }
      if (this.shouldBuildReverseDeps()) {
        this._debounceReverseDeps();
      }
      this.onIndexChanged.fire();
    }
    catch {
    }
  }
  async removeFile(uri: vscode.Uri): Promise<void> {
    const relPath = this.relativePath(uri.fsPath);
    this.index.delete(relPath);
    this.arbIndex.delete(relPath);
    await this.sqliteCache.deleteDartFile(relPath);
    await this.sqliteCache.deleteArbFile(relPath);
    this._removeBM25ForFile(relPath);
    this.onIndexChanged.fire();
  }
  async loadCache(): Promise<boolean> {
    this.projectName = await this._loadProjectName();
    const dartRows = await this.sqliteCache.getAllDartFiles();
    const arbRows = await this.sqliteCache.getAllArbFiles();
    if (dartRows.length === 0 && arbRows.length === 0) {
      return false;
    }
    for (const row of dartRows) {
      this.index.set(row.path, row.info);
    }
    for (const row of arbRows) {
      this.arbIndex.set(row.path, row.translations);
    }
    this.packages = (await this.sqliteCache.getMeta<PackageInfo[]>('packages')) ?? [];
    this.diagnostics = (await this.sqliteCache.getMeta<DiagnosticInfo[]>('diagnostics')) ?? [];
    this._rebuildBM25();
    this.bm25Dirty = false;
    this.onIndexChanged.fire();
    const source = this.sqliteCache.isAvailable ? 'SQLite' : 'JSON Cache';
    console.log(`[FlutterExplorer] Loaded ${dartRows.length} dart files and ${arbRows.length} arb files from ${source}.`);
    return true;
  }
  public updateDiagnostics(diagnostics: DiagnosticInfo[]): void {
    this.diagnostics = diagnostics;
    this.sqliteCache.setMeta('diagnostics', diagnostics);
  }
  public getDiagnostics(): DiagnosticInfo[] {
    return this.diagnostics;
  }
  getStats(): {
    files: number;
    classes: number;
    functions: number;
    widgets: number;
    enums: number;
    mixins: number;
    calls: number;
    translations: number;
    extensions: number;
    typedefs: number;
    variables: number;
    constructors: number;
    properties: number;
    annotations: number;
    extensionTypes: number;
  } {
    let classes = 0, functions = 0, widgets = 0, enums = 0, mixins = 0, calls = 0;
    let extensions = 0, typedefs = 0, variables = 0, constructors = 0, properties = 0, annotations = 0;
    let extensionTypes = 0;
    for (const info of this.index.values()) {
      classes += (info.classes || []).length;
      functions += (info.functions || []).length;
      functions += (info.classes || []).reduce((sum, c) => sum + (c.methods || []).length, 0);
      functions += (info.extensions || []).reduce((sum, e) => sum + (e.methods || []).length, 0);
      functions += (info.extensionTypes || []).reduce((sum, et) => sum + (et.methods || []).length, 0);
      widgets += (info.widgets || []).length;
      enums += (info.enums || []).length;
      mixins += (info.mixins || []).length;
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
    for (const arb of this.arbIndex.values())
      translations += arb.length;
    return {
      files: this.index.size + this.arbIndex.size,
      classes, functions, widgets, enums, mixins, calls, translations,
      extensions, typedefs, variables, constructors, properties, annotations,
      extensionTypes,
    };
  }
  search(query: string, filter?: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation' | 'call' | 'extension' | 'typedef' | 'variable' | 'constructor' | 'property' | 'annotation' | 'file' | 'extensionType'): SearchResult[] {
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
          const allFunctions = [
            ...info.functions,
            ...info.classes.flatMap(c => c.methods),
            ...(info.extensions || []).flatMap(e => e.methods),
            ...(info.extensionTypes || []).flatMap(et => et.methods)
          ];
          for (const f of allFunctions) {
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
    if (this.bm25Dirty) {
      this._rebuildBM25();
    }
    if (this.bm25.isBuilt && query.trim().length > 0) {
      const candidateIds = results.map(r => this._bm25Id(r));
      const scores = this.bm25.scoreMany(candidateIds, query);
      results.sort((a, b) => {
        const scoreA = scores.get(this._bm25Id(a)) ?? 0;
        const scoreB = scores.get(this._bm25Id(b)) ?? 0;
        if (scoreB !== scoreA)
          return scoreB - scoreA;
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts)
          return aStarts - bStarts;
        return a.name.localeCompare(b.name);
      });
    }
    else {
      results.sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts)
          return aStarts - bStarts;
        return a.name.localeCompare(b.name);
      });
    }
    return results.slice(0, 500);
  }
  getAllFiles(): DartFileInfo[] {
    return [...this.index.values()];
  }
  public getAllPackages(): PackageInfo[] {
    return this.packages;
  }
  getFile(relPath: string): DartFileInfo | undefined {
    return this.index.get(relPath);
  }
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
            resolved = 'lib/' + imp.path.substring(`package:${this.projectName}/`.length);
          }
        }
        else if (!imp.path.startsWith('dart:')) {
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
  getDetailedGraph(): {
    nodes: any[];
    edges: any[];
  } {
    const nodes: any[] = [];
    const edges: any[] = [];
    const seenNodes = new Set<string>();
    const classMethods = new Map<string, Set<string>>();
    const topLevelFunctions = new Set<string>();
    const classAncestors = new Map<string, string[]>();
    const allClassNames = new Set<string>();
    const allMixinNames = new Set<string>();
    const allEnumNames = new Set<string>();
    for (const info of this.index.values()) {
      for (const cls of info.classes || []) {
        allClassNames.add(cls.name);
        const ancestors: string[] = [];
        if (cls.extendsClass)
          ancestors.push(cls.extendsClass);
        for (const m of cls.mixins || [])
          ancestors.push(m);
        for (const impl of cls.implements || [])
          ancestors.push(impl);
        if (ancestors.length > 0) {
          classAncestors.set(cls.name, ancestors);
        }
      }
      for (const fn of info.functions || []) {
        if (fn.parentClass) {
          if (!classMethods.has(fn.parentClass)) {
            classMethods.set(fn.parentClass, new Set());
          }
          classMethods.get(fn.parentClass)!.add(fn.name);
        }
        else {
          topLevelFunctions.add(fn.name);
        }
      }
      for (const m of info.mixins || []) {
        allMixinNames.add(m.name);
      }
      for (const e of info.enums || []) {
        allEnumNames.add(e.name);
      }
    }
    function resolveClassMethodOwner(clsName: string, methodName: string, visited = new Set<string>()): string | null {
      if (visited.has(clsName))
        return null;
      visited.add(clsName);
      const methods = classMethods.get(clsName);
      if (methods && methods.has(methodName))
        return clsName;
      const ancestors = classAncestors.get(clsName);
      if (ancestors) {
        for (const parent of ancestors) {
          const owner = resolveClassMethodOwner(parent, methodName, visited);
          if (owner)
            return owner;
        }
      }
      return null;
    }
    const addNode = (id: string, name: string, type: string, file?: string, line?: number) => {
      if (!seenNodes.has(id)) {
        seenNodes.add(id);
        const node: any = { id, name, type };
        if (file)
          node.file = file;
        if (line !== undefined)
          node.line = line;
        nodes.push(node);
      }
    };
    for (const [filePath, info] of this.index.entries()) {
      const fileId = `file:${filePath}`;
      addNode(fileId, path.basename(filePath), 'file', filePath);
      for (const imp of info.imports || []) {
        if (imp.path && !imp.path.startsWith('dart:')) {
          const resolvedPath = this.resolveImportPath(filePath, imp.path);
          if (resolvedPath && this.index.has(resolvedPath)) {
            addNode(`file:${resolvedPath}`, path.basename(resolvedPath), 'file', resolvedPath);
            edges.push({ source: fileId, target: `file:${resolvedPath}`, type: 'imports' });
          }
        }
      }
      for (const cls of info.classes || []) {
        const classId = `class:${cls.name}`;
        addNode(classId, cls.name, 'class', filePath, cls.line);
        edges.push({ source: fileId, target: classId, type: 'contains' });
        if (cls.extendsClass) {
          edges.push({ source: classId, target: `class:${cls.extendsClass}`, type: 'extends' });
        }
        for (const impl of cls.implements || []) {
          edges.push({ source: classId, target: `class:${impl}`, type: 'implements' });
        }
        for (const mx of cls.mixins || []) {
          edges.push({ source: classId, target: `class:${mx}`, type: 'mixes_in' });
        }
      }
      for (const func of info.functions || []) {
        const funcId = func.parentClass ? `method:${func.parentClass}.${func.name}` : `func:${func.name}`;
        addNode(funcId, func.name, func.parentClass ? 'method' : 'function', filePath, func.line);
        const parentId = func.parentClass ? `class:${func.parentClass}` : fileId;
        edges.push({ source: parentId, target: funcId, type: 'contains' });
      }
      for (const w of info.widgets || []) {
        const wId = `class:${w.name}`;
        addNode(wId, w.name, 'widget', filePath, w.line);
        edges.push({ source: fileId, target: wId, type: 'contains' });
      }
      for (const en of info.enums || []) {
        const eId = `enum:${en.name}`;
        addNode(eId, en.name, 'enum', filePath, en.line);
        edges.push({ source: fileId, target: eId, type: 'contains' });
      }
      for (const m of info.mixins || []) {
        const mxId = `mixin:${m.name}`;
        addNode(mxId, m.name, 'mixin', filePath, m.line);
        edges.push({ source: fileId, target: mxId, type: 'contains' });
      }
      for (const ext of info.extensions || []) {
        const extId = `extension:${ext.name}`;
        addNode(extId, ext.name, 'extension', filePath, ext.line);
        edges.push({ source: fileId, target: extId, type: 'contains' });
        if (ext.onType) {
          edges.push({ source: extId, target: `class:${ext.onType}`, type: 'extends' });
        }
      }
      for (const td of info.typedefs || []) {
        const tdId = `typedef:${td.name}`;
        addNode(tdId, td.name, 'typedef', filePath, td.line);
        edges.push({ source: fileId, target: tdId, type: 'contains' });
      }
      for (const v of info.variables || []) {
        const vId = `variable:${v.name}`;
        addNode(vId, v.name, 'variable', filePath, v.line);
        edges.push({ source: fileId, target: vId, type: 'contains' });
      }
      for (const ctor of info.constructors || []) {
        const ctorId = `constructor:${ctor.className}.${ctor.name || 'new'}`;
        addNode(ctorId, `${ctor.className}.${ctor.name || 'new'}`, 'constructor', filePath, ctor.line);
        const parentClass = `class:${ctor.className}`;
        edges.push({ source: parentClass, target: ctorId, type: 'contains' });
      }
      for (const call of info.functionCalls || []) {
        let callerId: string;
        if (call.callerClass && call.callerFunction) {
          callerId = `method:${call.callerClass}.${call.callerFunction}`;
        }
        else if (call.callerFunction) {
          callerId = `func:${call.callerFunction}`;
        }
        else if (call.callerClass) {
          callerId = `class:${call.callerClass}`;
        }
        else {
          callerId = fileId;
        }
        let calleeId: string | null = null;
        const callName = call.name;
        if (call.receiver) {
          const rx = call.receiver;
          if (allClassNames.has(rx)) {
            const owner = resolveClassMethodOwner(rx, callName);
            if (owner) {
              calleeId = `method:${owner}.${callName}`;
            }
            else {
              calleeId = `class:${rx}`;
            }
          }
          else if (allMixinNames.has(rx)) {
            calleeId = `mixin:${rx}`;
          }
          else if (allEnumNames.has(rx)) {
            calleeId = `enum:${rx}`;
          }
          else if (rx !== 'this' && rx !== 'super') {
            const pascalRx = rx.charAt(0).toUpperCase() + rx.slice(1);
            if (allClassNames.has(pascalRx)) {
              const owner = resolveClassMethodOwner(pascalRx, callName);
              if (owner) {
                calleeId = `method:${owner}.${callName}`;
              }
              else {
                calleeId = `method:${pascalRx}.${callName}`;
              }
            }
          }
        }
        if (!calleeId) {
          if (allClassNames.has(callName)) {
            calleeId = `class:${callName}`;
          }
          else if (allMixinNames.has(callName)) {
            calleeId = `mixin:${callName}`;
          }
          else if (allEnumNames.has(callName)) {
            calleeId = `enum:${callName}`;
          }
          else if (call.callerClass) {
            const owner = resolveClassMethodOwner(call.callerClass, callName);
            if (owner) {
              calleeId = `method:${owner}.${callName}`;
            }
          }
        }
        if (!calleeId) {
          if (topLevelFunctions.has(callName)) {
            calleeId = `func:${callName}`;
          }
        }
        if (!calleeId) {
          calleeId = `func:${callName}`;
        }
        if (callerId !== calleeId) {
          edges.push({ source: callerId, target: calleeId, type: 'calls' });
        }
      }
      for (const usage of info.classUsages || []) {
        for (const usedFile of usage.usedInFiles || []) {
          if (usedFile !== filePath && this.index.has(usedFile)) {
            edges.push({ source: `file:${usedFile}`, target: `class:${usage.className}`, type: 'uses_class' });
          }
        }
      }
      for (const usage of info.variableUsages || []) {
        for (const usedFile of usage.usedInFiles || []) {
          if (usedFile !== filePath && this.index.has(usedFile)) {
            edges.push({ source: `file:${usedFile}`, target: `variable:${usage.variableName}`, type: 'uses_variable' });
          }
        }
      }
    }
    return { nodes, edges };
  }
  parseWidgetTreeForContent(filePath: string, content: string): DartFileInfo {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.md') || filePath.endsWith('.css') || filePath.endsWith('.scss') || filePath.endsWith('.json')) {
      return this.jsTsParser.parse(filePath, content);
    }
    if (filePath.endsWith('.kt') || filePath.endsWith('.java') || filePath.endsWith('.xml') || filePath.endsWith('.gradle') || filePath.endsWith('.gradle.kts') || filePath.endsWith('.html')) {
      return this.androidParser.parse(filePath, content);
    }
    return this.parser.parse(filePath, content);
  }
  getWarnings(): {
    filePath: string;
    warnings: import('./dartParser').WarningInfo[];
  }[] {
    const results: {
      filePath: string;
      warnings: import('./dartParser').WarningInfo[];
    }[] = [];
    const hashGroups = new Map<string, {
      type: string;
      name: string;
      filePath: string;
      line: number;
    }[]>();
    for (const [filePath, info] of this.index.entries()) {
      const processItem = (item: any, type: string) => {
        if (item.bodyHash && item.bodyLength && item.bodyLength >= 50) {
          if (!hashGroups.has(item.bodyHash))
            hashGroups.set(item.bodyHash, []);
          hashGroups.get(item.bodyHash)!.push({ type, name: item.name, filePath, line: item.line });
        }
      };
      for (const c of info.classes || [])
        processItem(c, 'class');
      for (const f of info.functions || [])
        processItem(f, 'function');
      for (const c of info.classes || []) {
        for (const m of c.methods || [])
          processItem(m, 'method');
      }
      for (const e of info.extensions || []) {
        for (const m of e.methods || [])
          processItem(m, 'method');
      }
      for (const et of info.extensionTypes || []) {
        for (const m of et.methods || [])
          processItem(m, 'method');
      }
    }
    const duplicateWarningsByFile = new Map<string, import('./dartParser').WarningInfo[]>();
    for (const group of hashGroups.values()) {
      if (group.length > 1) {
        for (const item of group) {
          if (!duplicateWarningsByFile.has(item.filePath))
            duplicateWarningsByFile.set(item.filePath, []);
          const others = group.filter(g => g !== item).slice(0, 3);
          const otherNames = others.map(g => `'${g.name}' in ${path.basename(g.filePath)}`).join(', ');
          const extra = group.length > 4 ? ` and ${group.length - 4} more` : '';
          duplicateWarningsByFile.get(item.filePath)!.push({
            type: 'duplicated_logic',
            message: `Duplicated ${item.type} logic: matches ${otherNames}${extra}`,
            line: item.line
          });
        }
      }
    }
    for (const [filePath, info] of this.index.entries()) {
      const fileWarnings = [...(info.warnings || [])];
      const duplicates = duplicateWarningsByFile.get(filePath);
      if (duplicates) {
        fileWarnings.push(...duplicates);
      }
      if (fileWarnings.length > 0) {
        results.push({ filePath, warnings: fileWarnings });
      }
    }
    return results;
  }
  analyzeTranslations(): {
    filePath: string;
    missingKeys: string[];
  }[] {
    const allKeys = new Set<string>();
    const fileKeys = new Map<string, Set<string>>();
    for (const [filePath, translations] of this.arbIndex.entries()) {
      const keys = new Set<string>();
      for (const t of translations) {
        allKeys.add(t.key);
        keys.add(t.key);
      }
      fileKeys.set(filePath, keys);
    }
    const results: {
      filePath: string;
      missingKeys: string[];
    }[] = [];
    for (const [filePath, keys] of fileKeys.entries()) {
      const missing: string[] = [];
      for (const k of allKeys) {
        if (!keys.has(k))
          missing.push(k);
      }
      if (missing.length > 0)
        results.push({ filePath, missingKeys: missing });
    }
    return results;
  }
  public async buildReverseDependencies(): Promise<void> {
    if (this._disposed)
      return;
    for (const [filePath, info] of this.index.entries()) {
      if (this._disposed)
        return;
      for (const imp of info.imports) {
        if (!imp.path.startsWith('dart:')) {
          const resolved = this.resolveImportPath(filePath, imp.path);
          const importedFile = this.index.get(resolved);
          if (importedFile) {
            const addFile = (usages: any[], fp: string) => {
              for (const u of usages ?? []) {
                if (!u.usedInFiles.includes(fp))
                  u.usedInFiles.push(fp);
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
    if (this._disposed)
      return;
    const filesToUpdate = Array.from(this.index.entries()).map(([relPath, info]) => ({
      relPath,
      hash: info.contentHash,
      info
    }));
    await this.sqliteCache.batchUpsertDartFiles(filesToUpdate);
    if (this._disposed)
      return;
    this.sqliteCache.checkpoint();
  }
  public relativePath(absPath: string): string {
    return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
  }
  private _extractBM25Docs(info: DartFileInfo, filePath: string): BM25Document[] {
    const docs: BM25Document[] = [];
    for (const cls of info.classes) {
      docs.push({
        id: this._bm25Id({ name: cls.name, file: filePath, line: cls.line, type: 'class' } as any),
        fields: { name: cls.name, path: filePath, superclass: cls.extendsClass ?? undefined },
      });
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
  private _rebuildBM25(): void {
    const docs: BM25Document[] = [];
    this.fileDocIds.clear();
    for (const info of this.index.values()) {
      const extracted = this._extractBM25Docs(info, info.filePath);
      docs.push(...extracted);
      this.fileDocIds.set(info.filePath, extracted.map(d => d.id));
    }
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
  private _removeBM25ForFile(relPath: string): void {
    const ids = this.fileDocIds.get(relPath);
    if (!ids)
      return;
    for (const id of ids) {
      this.bm25.removeDocument(id);
    }
    this.fileDocIds.delete(relPath);
  }
  private _bm25Id(r: {
    name: string;
    file: string;
    line: number;
    type: string;
  }): string {
    return `${r.file}:${r.line}:${r.name}:${r.type}`;
  }
  private shouldBuildReverseDeps(): boolean {
    return vscode.workspace.getConfiguration('flutterExplorer')
      .get<boolean>('enableReverseDependencies', true);
  }
  private _debounceReverseDeps(): void {
    if (this.reverseDepsTimeout)
      clearTimeout(this.reverseDepsTimeout);
    this.reverseDepsTimeout = setTimeout(() => {
      this.reverseDepsTimeout = null;
      this.buildReverseDependencies().catch(e => console.error('Error building reverse dependencies:', e));
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
      return importPath;
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
        if (key.startsWith('@') || typeof value !== 'string')
          continue;
        let lineNum = 1;
        const searchStr = `"${key}"`;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(searchStr)) {
            lineNum = i + 1;
            break;
          }
        }
        translations.push({ key, value, line: lineNum });
      }
    }
    catch { }
    return translations;
  }
  public getImpactAnalysis(filePath: string): any {
    const relPath = this.relativePath(filePath);
    const fileInfo = this.index.get(relPath);
    if (!fileInfo)
      return { error: "File not indexed" };
    const targets = new Set<string>();
    for (const cls of fileInfo.classes)
      targets.add(cls.name);
    for (const func of fileInfo.functions)
      targets.add(func.name);
    const affectedFlows: any[] = [];
    const entryPoints = this._findEntryPoints();
    for (const ep of entryPoints) {
      const path = this._findPathToTargets(ep, targets);
      if (path) {
        affectedFlows.push({ entryPoint: ep.name, path: path });
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
      for (const func of info.functions) {
        if (func.name === 'main') {
          entryPoints.push({ ...func, filePath: path, kind: 'Function' });
        }
      }
      for (const cls of info.classes) {
        const isWidget = cls.extendsClass && (cls.extendsClass.includes('Widget') ||
          cls.extendsClass.includes('State') ||
          cls.extendsClass.includes('Controller'));
        if (isWidget) {
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
    const queue: {
      node: any;
      path: any[];
    }[] = [{ node: start, path: [start] }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const { node, path } = queue.shift()!;
      const qname = `${node.filePath}:${node.name}`;
      if (visited.has(qname))
        continue;
      visited.add(qname);
      if (targets.has(node.name))
        return path;
      if (path.length >= maxDepth)
        continue;
      const fileInfo = this.index.get(node.filePath);
      if (fileInfo) {
        const calls = fileInfo.functionCalls.filter(c => c.callerFunction === node.name &&
          (!node.parentClass || c.callerClass === node.parentClass));
        for (const call of calls) {
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
    const dotIdx = name.indexOf('.');
    if (dotIdx !== -1) {
      const clsName = name.substring(0, dotIdx);
      const methodName = name.substring(dotIdx + 1);
      for (const [path, info] of this.index.entries()) {
        for (const c of info.classes) {
          if (c.name === clsName) {
            const m = c.methods.find(meth => meth.name === methodName);
            if (m)
              return { ...m, filePath: path, kind: 'Method' };
          }
        }
      }
    }
    for (const [path, info] of this.index.entries()) {
      for (const f of info.functions) {
        if (f.name === name)
          return { ...f, filePath: path, kind: 'Function' };
      }
      for (const c of info.classes) {
        if (c.name === name)
          return { ...c, filePath: path, kind: 'Class', name: c.name, line: c.line };
      }
      for (const et of info.extensionTypes) {
        if (et.name === name)
          return { ...et, filePath: path, kind: 'ExtensionType', name: et.name, line: et.line };
      }
    }
    return null;
  }
  public async ensureProjectName(forFile?: string): Promise<void> {
    if (!this.projectName || forFile) {
      const name = await this._loadProjectName(forFile);
      if (name)
        this.projectName = name;
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
          if (match)
            return match[1];
        }
        currentDir = path.dirname(currentDir);
      }
      return null;
    }
    catch (err) {
      console.error('[FlutterExplorer] Error loading project name:', err);
      return null;
    }
  }
  public async compareParsersAndWriteReport(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    try {
      let sdkResults: DartFileInfo[] = [];
      let regexResults: DartFileInfo[] = [];
      const dataDir = ProjectDetector.getDataDir(this.workspaceRoot);
      const sdkDbPath = path.join(dataDir, 'analyze.db');
      const regexDbPath = path.join(dataDir, 'indexer.db');
      let useExisting = false;
      if (fs.existsSync(sdkDbPath) && fs.existsSync(regexDbPath)) {
        const choice = await vscode.window.showInformationMessage(
          'Existing index databases (analyze.db & indexer.db) found. Do you want to run a full re-index or use the existing databases for comparison?',
          'Use Existing Databases',
          'Run Full Re-index'
        );
        if (choice === 'Use Existing Databases') {
          useExisting = true;
        }
        else if (!choice) {
          return;
        }
      }
      if (useExisting) {
        if (progress) progress.report({ message: 'Loading existing SDK Analyzer results from analyze.db...' });
        const sdkCache = new SqliteCache(this.workspaceRoot, { dbName: 'analyze.db', readonly: true });
        const sdkEntries = await sdkCache.getAllDartFiles();
        sdkResults = sdkEntries.map(e => e.info);
        sdkCache.close();
        if (progress) progress.report({ message: 'Loading existing Regex results from indexer.db...' });
        const regexCache = new SqliteCache(this.workspaceRoot, { dbName: 'indexer.db', readonly: true });
        const regexEntries = await regexCache.getAllDartFiles();
        regexResults = regexEntries.map(e => e.info);
        regexCache.close();
      }
      else {
        if (progress) progress.report({ message: 'Phase 1: Running Dart SDK Analyzer...' });
        const runResults = await analyzeWithDart(this.workspaceRoot, this.extensionPath);
        if (!runResults) {
          vscode.window.showErrorMessage('Dart SDK Analyzer failed to return results.');
          return;
        }
        sdkResults = runResults;
        for (const info of sdkResults) {
          info.filePath = info.filePath.replace(/\\/g, '/');
        }
        if (progress) progress.report({ message: 'Saving SDK Analyzer results to analyze.db...' });
        const sdkCache = new SqliteCache(this.workspaceRoot, { dbName: 'analyze.db' });
        await sdkCache.clearAll();
        const sdkUpserts = sdkResults.map(info => ({
          relPath: info.filePath,
          hash: info.contentHash,
          info
        }));
        if (sdkUpserts.length > 0) {
          await sdkCache.batchUpsertDartFiles(sdkUpserts);
        }
        sdkCache.checkpoint();
        sdkCache.close();
        if (progress) progress.report({ message: 'Phase 2: Running Regex-based Parser...' });
        const dartFiles = await vscode.workspace.findFiles('lib/**/*.dart', '**/.*', 10000);
        const regexUpserts: Array<{ relPath: string; hash: string; info: DartFileInfo }> = [];
        for (const uri of dartFiles) {
          const relPath = this.relativePath(uri.fsPath).replace(/\\/g, '/');
          if (this.isFileExcluded(uri.fsPath))
            continue;
          try {
            const content = await this.readFile(uri);
            const info = this.parser.parse(relPath, content);
            info.filePath = relPath;
            info.contentHash = this.computeHash(content);
            regexResults.push(info);
            regexUpserts.push({ relPath, hash: info.contentHash, info });
          }
          catch (e) {
            console.error(`Failed to parse ${relPath} with Regex:`, e);
          }
        }
        if (progress) progress.report({ message: 'Saving Regex results to indexer.db...' });
        const regexCache = new SqliteCache(this.workspaceRoot, { dbName: 'indexer.db' });
        await regexCache.clearAll();
        if (regexUpserts.length > 0) {
          await regexCache.batchUpsertDartFiles(regexUpserts);
        }
        regexCache.checkpoint();
        regexCache.close();
      }
      if (progress) progress.report({ message: 'Phase 3: Comparing parser results...' });
      const collectWidgets = (widgetsList: any[]): Array<{ name: string; line: number }> => {
        const result: Array<{ name: string; line: number }> = [];
        const traverse = (wList: any[]) => {
          for (const w of wList) {
            if (w && w.name) {
              result.push({ name: w.name, line: w.line });
              if (w.children) traverse(w.children);
            }
          }
        };
        traverse(widgetsList);
        return result;
      };
      const normalizeParams = (paramStr: string): string => {
        let clean = paramStr.replace(/[\{\}\s]/g, '');
        return clean.split(',')
                    .map(p => p.trim())
                    .filter(p => p.length > 0)
                    .sort()
                    .join(',');
      };
      let totalFiles = sdkResults.length;
      let diffs: string[] = [];
      let totalClassesSDK = 0;
      let totalClassesRegex = 0;
      let totalMethodsSDK = 0;
      let totalMethodsRegex = 0;
      let totalFunctionsSDK = 0;
      let totalFunctionsRegex = 0;
      let totalWidgetsSDK = 0;
      let totalWidgetsRegex = 0;
      for (let idx = 0; idx < sdkResults.length; idx++) {
        const sdkInfo = sdkResults[idx];
        const relPath = sdkInfo.filePath;
        const regexInfo = regexResults.find(r => r.filePath === relPath);
        if (!regexInfo) {
          diffs.push(`### 📄 File: \`${relPath}\` (Missed completely by Regex Parser)\n`);
          continue;
        }
        totalClassesSDK += sdkInfo.classes.length;
        totalClassesRegex += regexInfo.classes.length;
        totalFunctionsSDK += sdkInfo.functions.length;
        totalFunctionsRegex += regexInfo.functions.length;
        sdkInfo.classes.forEach(c => totalMethodsSDK += c.methods.length);
        regexInfo.classes.forEach(c => totalMethodsRegex += c.methods.length);
        const fileDiffs: string[] = [];
        for (const sdkClass of sdkInfo.classes) {
          const regexClass = regexInfo.classes.find(c => c.name === sdkClass.name);
          if (!regexClass) {
            fileDiffs.push(`- ❌ **Missing Class**: Class \`${sdkClass.name}\` (line ${sdkClass.line}) was NOT found by regex parser.`);
            continue;
          }
          const sdkExt = sdkClass.extendsClass === 'Object' ? null : sdkClass.extendsClass;
          const normSDKExt = sdkExt ? sdkExt.replace(/\s+/g, '') : null;
          const normRegexExt = regexClass.extendsClass ? regexClass.extendsClass.replace(/\s+/g, '') : null;
          if (normSDKExt !== normRegexExt) {
            fileDiffs.push(`- ⚠️ **Class \`${sdkClass.name}\`**: mismatched extends class (SDK: \`${sdkClass.extendsClass}\`, Regex: \`${regexClass.extendsClass}\`).`);
          }
          for (const sdkMethod of sdkClass.methods) {
            const regexMethod = regexClass.methods.find(m => m.name === sdkMethod.name);
            if (!regexMethod) {
              fileDiffs.push(`  - ❌ **Missing Method**: Method \`${sdkClass.name}.${sdkMethod.name}\` (line ${sdkMethod.line}) was NOT found by regex parser.`);
              continue;
            }
            const normSDKReturn = sdkMethod.returnType.replace(/\s+/g, '');
            const normRegexReturn = regexMethod.returnType.replace(/\s+/g, '');
            if (normSDKReturn !== normRegexReturn) {
              fileDiffs.push(`  - ⚠️ **Method \`${sdkClass.name}.${sdkMethod.name}\`**: mismatched return type (SDK: \`${sdkMethod.returnType}\`, Regex: \`${regexMethod.returnType}\`).`);
            }
            const normSDKParams = normalizeParams(sdkMethod.params);
            const normRegexParams = normalizeParams(regexMethod.params);
            if (normSDKParams !== normRegexParams) {
              fileDiffs.push(`  - ⚠️ **Method \`${sdkClass.name}.${sdkMethod.name}\`**: mismatched params (SDK: \`${sdkMethod.params}\`, Regex: \`${regexMethod.params}\`).`);
            }
            if (sdkMethod.isStatic !== regexMethod.isStatic) {
              fileDiffs.push(`  - ⚠️ **Method \`${sdkClass.name}.${sdkMethod.name}\`**: mismatched static modifier (SDK: ${sdkMethod.isStatic}, Regex: ${regexMethod.isStatic}).`);
            }
          }
          for (const regexMethod of regexClass.methods) {
            const sdkMethod = sdkClass.methods.find(m => m.name === regexMethod.name);
            if (!sdkMethod) {
              fileDiffs.push(`  - ➕ **Extra Method**: Method \`${sdkClass.name}.${regexMethod.name}\` (line ${regexMethod.line}) was extracted by regex but not in SDK (potential false positive).`);
            }
          }
        }
        for (const regexClass of regexInfo.classes) {
          const sdkClass = sdkInfo.classes.find(c => c.name === regexClass.name);
          if (!sdkClass) {
            fileDiffs.push(`- ➕ **Extra Class**: Class \`${regexClass.name}\` (line ${regexClass.line}) was extracted by regex but not in SDK.`);
          }
        }
        for (const sdkFunc of sdkInfo.functions) {
          const regexFunc = regexInfo.functions.find(f => f.name === sdkFunc.name);
          if (!regexFunc) {
            fileDiffs.push(`- ❌ **Missing Function**: Top-level function \`${sdkFunc.name}\` (line ${sdkFunc.line}) was NOT found by regex parser.`);
            continue;
          }
          const normSDKReturn = sdkFunc.returnType.replace(/\s+/g, '');
          const normRegexReturn = regexFunc.returnType.replace(/\s+/g, '');
          if (normSDKReturn !== normRegexReturn) {
            fileDiffs.push(`- ⚠️ **Function \`${sdkFunc.name}\`**: mismatched return type (SDK: \`${sdkFunc.returnType}\`, Regex: \`${regexFunc.returnType}\`).`);
          }
        }
        for (const regexFunc of regexInfo.functions) {
          const sdkFunc = sdkInfo.functions.find(f => f.name === regexFunc.name);
          if (!sdkFunc) {
            fileDiffs.push(`- ➕ **Extra Function**: Top-level function \`${regexFunc.name}\` (line ${regexFunc.line}) was extracted by regex but not in SDK.`);
          }
        }
        for (const sdkEnum of sdkInfo.enums) {
          const regexEnum = regexInfo.enums.find(e => e.name === sdkEnum.name);
          if (!regexEnum) {
            fileDiffs.push(`- ❌ **Missing Enum**: Enum \`${sdkEnum.name}\` (line ${sdkEnum.line}) was NOT found by regex parser.`);
            continue;
          }
          const sdkVals = sdkEnum.values.join(',');
          const regexVals = regexEnum.values.join(',');
          if (sdkVals !== regexVals) {
            fileDiffs.push(`- ⚠️ **Enum \`${sdkEnum.name}\`**: mismatched values (SDK: \`[${sdkVals}]\`, Regex: \`[${regexVals}]\`).`);
          }
        }
        for (const regexEnum of regexInfo.enums) {
          const sdkEnum = sdkInfo.enums.find(e => e.name === regexEnum.name);
          if (!sdkEnum) {
            fileDiffs.push(`- ➕ **Extra Enum**: Enum \`${regexEnum.name}\` (line ${regexEnum.line}) was extracted by regex but not in SDK.`);
          }
        }
        if (sdkInfo.mixins && regexInfo.mixins) {
          for (const sdkMixin of sdkInfo.mixins) {
            const regexMixin = regexInfo.mixins.find(m => m.name === sdkMixin.name);
            if (!regexMixin) {
              fileDiffs.push(`- ❌ **Missing Mixin**: Mixin \`${sdkMixin.name}\` (line ${sdkMixin.line}) was NOT found by regex parser.`);
            }
          }
          for (const regexMixin of regexInfo.mixins) {
            const sdkMixin = sdkInfo.mixins.find(m => m.name === regexMixin.name);
            if (!sdkMixin) {
              fileDiffs.push(`- ➕ **Extra Mixin**: Mixin \`${regexMixin.name}\` (line ${regexMixin.line}) was extracted by regex but not in SDK.`);
            }
          }
        }
        if (sdkInfo.extensions && regexInfo.extensions) {
          for (const sdkExt of sdkInfo.extensions) {
            const regexExt = regexInfo.extensions.find(e => e.name === sdkExt.name);
            if (!regexExt) {
              fileDiffs.push(`- ❌ **Missing Extension**: Extension \`${sdkExt.name}\` (line ${sdkExt.line}) was NOT found by regex parser.`);
            }
          }
          for (const regexExt of regexInfo.extensions) {
            const sdkExt = sdkInfo.extensions.find(e => e.name === regexExt.name);
            if (!sdkExt) {
              fileDiffs.push(`- ➕ **Extra Extension**: Extension \`${regexExt.name}\` (line ${regexExt.line}) was extracted by regex but not in SDK.`);
            }
          }
        }
        if (sdkInfo.typedefs && regexInfo.typedefs) {
          for (const sdkTypedef of sdkInfo.typedefs) {
            const regexTypedef = regexInfo.typedefs.find(t => t.name === sdkTypedef.name);
            if (!regexTypedef) {
              fileDiffs.push(`- ❌ **Missing Typedef**: Typedef \`${sdkTypedef.name}\` (line ${sdkTypedef.line}) was NOT found by regex parser.`);
            }
          }
          for (const regexTypedef of regexInfo.typedefs) {
            const sdkTypedef = sdkInfo.typedefs.find(t => t.name === regexTypedef.name);
            if (!sdkTypedef) {
              fileDiffs.push(`- ➕ **Extra Typedef**: Typedef \`${regexTypedef.name}\` (line ${regexTypedef.line}) was extracted by regex but not in SDK.`);
            }
          }
        }
        if (sdkInfo.variables && regexInfo.variables) {
          for (const sdkVar of sdkInfo.variables) {
            const regexVar = regexInfo.variables.find(v => v.name === sdkVar.name);
            if (!regexVar) {
              fileDiffs.push(`- ❌ **Missing Variable**: Top-level variable \`${sdkVar.name}\` (line ${sdkVar.line}) was NOT found by regex parser.`);
            }
          }
          for (const regexVar of regexInfo.variables) {
            const sdkVar = sdkInfo.variables.find(v => v.name === regexVar.name);
            if (!sdkVar) {
              fileDiffs.push(`- ➕ **Extra Variable**: Top-level variable \`${regexVar.name}\` (line ${regexVar.line}) was extracted by regex but not in SDK.`);
            }
          }
        }
        const sdkWidgets = collectWidgets(sdkInfo.widgets || []);
        const regexWidgets = collectWidgets(regexInfo.widgets || []);
        totalWidgetsSDK += sdkWidgets.length;
        totalWidgetsRegex += regexWidgets.length;
        for (const sdkWidget of sdkWidgets) {
          const regexWidget = regexWidgets.find(w => w.name === sdkWidget.name);
          if (!regexWidget) {
            fileDiffs.push(`- ❌ **Missing Widget**: Widget \`${sdkWidget.name}\` (line ${sdkWidget.line}) was NOT found by regex parser.`);
          }
        }
        for (const regexWidget of regexWidgets) {
          const sdkWidget = sdkWidgets.find(w => w.name === regexWidget.name);
          if (!sdkWidget) {
            fileDiffs.push(`- ➕ **Extra Widget**: Widget \`${regexWidget.name}\` (line ${regexWidget.line}) was extracted by regex but not in SDK.`);
          }
        }
        if (fileDiffs.length > 0) {
          const fullPath = path.join(this.workspaceRoot, relPath);
          diffs.push(`### 📄 File: [${relPath}](file:///${fullPath.replace(/\\/g, '/')})\n` + fileDiffs.join('\n') + '\n');
        }
      }
      const reportPath = path.join(this.workspaceRoot, 'parser_comparison_report.md');
      const timeStr = new Date().toLocaleString();
      let reportContent = `# Parser Comparison Report\n\n`;
      reportContent += `Generated on: **${timeStr}**\n\n`;
      reportContent += `This report compares the findings of the **Regex-based Parser** (\`dartParser.ts\`) against the **Dart SDK Analyzer** (\`tools/dart_analyzer.dart\`) to find discrepancies and improve the regex parser.\n\n`;
      reportContent += `## 📊 Statistics Summary\n\n`;
      reportContent += `| Metric | Dart SDK Analyzer (Ground Truth) | Regex Parser (\`dartParser.ts\`) | Difference |\n`;
      reportContent += `| --- | --- | --- | --- |\n`;
      reportContent += `| **Analyzed Files** | ${totalFiles} | ${totalFiles} | 0 |\n`;
      reportContent += `| **Total Classes** | ${totalClassesSDK} | ${totalClassesRegex} | ${totalClassesRegex - totalClassesSDK} |\n`;
      reportContent += `| **Total Methods** | ${totalMethodsSDK} | ${totalMethodsRegex} | ${totalMethodsRegex - totalMethodsSDK} |\n`;
      reportContent += `| **Total Top-level Functions** | ${totalFunctionsSDK} | ${totalFunctionsRegex} | ${totalFunctionsRegex - totalFunctionsSDK} |\n`;
      reportContent += `| **Total Widgets** | ${totalWidgetsSDK} | ${totalWidgetsRegex} | ${totalWidgetsRegex - totalWidgetsSDK} |\n\n`;
      if (diffs.length === 0) {
        reportContent += `## 🎉 Congratulations!\n\nBoth parsers are in 100% agreement. No structural differences found across the project files!\n`;
      }
      else {
        reportContent += `## 🔍 Detected Discrepancies\n\n`;
        reportContent += diffs.join('\n');
      }
      fs.writeFileSync(reportPath, reportContent, 'utf-8');
      const doc = await vscode.workspace.openTextDocument(reportPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('Parser comparison complete! Report opened in editor.');
    }
    catch (e) {
      console.error('compareParsersAndWriteReport failed:', e);
      vscode.window.showErrorMessage(`Comparison failed: ${e}`);
    }
  }
}
export interface SearchResult {
  name: string;
  type: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation' | 'call' | 'extension' | 'typedef' | 'variable' | 'constructor' | 'property' | 'annotation' | 'file' | 'extensionType';
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
