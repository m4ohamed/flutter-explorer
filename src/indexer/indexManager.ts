/**
 * Index Manager - Manages the in-memory index and JSON cache
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DartParser, DartFileInfo } from './dartParser';

const CACHE_FILENAME = '.vscode/flutter-explorer-index.json';

export interface TranslationInfo {
  key: string;
  value: string;
  line: number;
}

export class IndexManager {
  private index: Map<string, DartFileInfo> = new Map();
  private arbIndex: Map<string, TranslationInfo[]> = new Map();
  private parser: DartParser = new DartParser();
  private workspaceRoot: string;
  private onIndexChanged: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeIndex: vscode.Event<void> = this.onIndexChanged.event;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /** Build full index by scanning all Dart files */
  async buildFullIndex(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    const dartFiles = await vscode.workspace.findFiles('lib/**/*.dart', '**/.*');
    const androidFiles = await vscode.workspace.findFiles('android/app/**/*.{dart,kt,java,xml,gradle}', '**/.*');
    const arbFiles = await vscode.workspace.findFiles('lib/**/*.arb', '**/.*');
    const allFiles = [...dartFiles, ...androidFiles, ...arbFiles];

    this.index.clear();
    this.arbIndex.clear();
    const total = allFiles.length;

    for (let i = 0; i < allFiles.length; i++) {
      const uri = allFiles[i];
      try {
        const content = await this.readFile(uri);
        if (uri.fsPath.endsWith('.dart')) {
          const info = this.parser.parse(this.relativePath(uri.fsPath), content);
          this.index.set(this.relativePath(uri.fsPath), info);
        } else if (uri.fsPath.endsWith('.arb')) {
          const translations = this.parseArb(content);
          this.arbIndex.set(this.relativePath(uri.fsPath), translations);
        }
      } catch {
        // Skip files that can't be read
      }
      if (progress) {
        progress.report({
          message: `Indexing ${path.basename(uri.fsPath)} (${i + 1}/${total})`,
          increment: (100 / total),
        });
      }
    }

    this.saveCache();
    this.onIndexChanged.fire();
  }

  /** Update a single file in the index */
  async updateFile(uri: vscode.Uri): Promise<void> {
    const relPath = this.relativePath(uri.fsPath);
    try {
      const content = await this.readFile(uri);
      if (uri.fsPath.endsWith('.dart')) {
        const info = this.parser.parse(relPath, content);
        this.index.set(relPath, info);
      } else if (uri.fsPath.endsWith('.arb')) {
        const translations = this.parseArb(content);
        this.arbIndex.set(relPath, translations);
      }
      this.saveCache();
      this.onIndexChanged.fire();
    } catch {
      // File might have been deleted between event and processing
    }
  }

  /** Remove a file from the index */
  removeFile(uri: vscode.Uri): void {
    const relPath = this.relativePath(uri.fsPath);
    this.index.delete(relPath);
    this.arbIndex.delete(relPath);
    this.saveCache();
    this.onIndexChanged.fire();
  }

  /** Load cached index from disk */
  loadCache(): boolean {
    const cachePath = path.join(this.workspaceRoot, CACHE_FILENAME);
    try {
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, 'utf-8');
        const data: { dart: Record<string, DartFileInfo>, arb: Record<string, TranslationInfo[]> } = JSON.parse(raw);
        this.index.clear();
        this.arbIndex.clear();

        // Handle old cache format gracefully
        if (!data.dart && !data.arb) {
          for (const [key, val] of Object.entries(data as any)) {
            this.index.set(key, val as DartFileInfo);
          }
        } else {
          if (data.dart) {
            for (const [key, val] of Object.entries(data.dart)) { this.index.set(key, val); }
          }
          if (data.arb) {
            for (const [key, val] of Object.entries(data.arb)) { this.arbIndex.set(key, val); }
          }
        }

        this.onIndexChanged.fire();
        return true;
      }
    } catch {
      // Cache corrupted, will rebuild
    }
    return false;
  }

  /** Save current index to disk */
  private saveCache(): void {
    const cachePath = path.join(this.workspaceRoot, CACHE_FILENAME);
    try {
      const dir = path.dirname(cachePath);
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
      const data = { dart: {} as Record<string, DartFileInfo>, arb: {} as Record<string, TranslationInfo[]> };
      for (const [key, val] of this.index.entries()) { data.dart[key] = val; }
      for (const [key, val] of this.arbIndex.entries()) { data.arb[key] = val; }
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore cache write errors
    }
  }

  /** Get index statistics */
  getStats(): { files: number; classes: number; functions: number; widgets: number; enums: number; mixins: number; translations: number } {
    let classes = 0, functions = 0, widgets = 0, enums = 0, mixins = 0;
    for (const info of this.index.values()) {
      classes += info.classes.length;
      functions += info.functions.length;
      widgets += info.widgets.length;
      enums += info.enums.length;
      mixins += info.mixins.length;
    }
    let translations = 0;
    for (const arb of this.arbIndex.values()) {
      translations += arb.length;
    }
    return { files: this.index.size + this.arbIndex.size, classes, functions, widgets, enums, mixins, translations };
  }

  /** Get all indexed data */
  getAllFiles(): DartFileInfo[] {
    return Array.from(this.index.values());
  }

  /** Get info for a specific file */
  getFile(relPath: string): DartFileInfo | undefined {
    return this.index.get(relPath);
  }

  /** Search across all indexed files */
  search(query: string, filter?: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation'): SearchResult[] {
    const results: SearchResult[] = [];
    const q = query.toLowerCase();

    // Search Dart files
    if (!filter || filter !== 'translation') {
      for (const info of this.index.values()) {
        if (!filter || filter === 'class') {
          for (const c of info.classes) {
            if (c.name.toLowerCase().includes(q)) {
              results.push({ name: c.name, type: 'class', subType: c.type, file: info.filePath, line: c.line, isPrivate: c.isPrivate });
            }
          }
        }
        if (!filter || filter === 'function') {
          for (const f of info.functions) {
            if (f.name.toLowerCase().includes(q)) {
              results.push({ name: f.name, type: 'function', subType: f.parentClass ? `${f.parentClass}.${f.name}` : f.name, file: info.filePath, line: f.line, isPrivate: f.isPrivate });
            }
          }
        }
        if (!filter || filter === 'widget') {
          for (const c of info.classes) {
            if (c.type !== 'plain' && c.type !== 'ChangeNotifier' && c.name.toLowerCase().includes(q)) {
              results.push({ name: c.name, type: 'widget', subType: c.type, file: info.filePath, line: c.line, isPrivate: c.isPrivate });
            }
          }
        }
        if (!filter || filter === 'enum') {
          for (const e of info.enums) {
            if (e.name.toLowerCase().includes(q)) {
              results.push({ name: e.name, type: 'enum', subType: e.values.join(', '), file: info.filePath, line: e.line, isPrivate: e.isPrivate });
            }
          }
        }
        if (!filter || filter === 'mixin') {
          for (const m of info.mixins) {
            if (m.name.toLowerCase().includes(q)) {
              results.push({ name: m.name, type: 'mixin', subType: m.on || '', file: info.filePath, line: m.line, isPrivate: m.isPrivate });
            }
          }
        }
      }
    }

    // Search ARB files
    if (!filter || filter === 'translation') {
      for (const [filePath, translations] of this.arbIndex.entries()) {
        for (const t of translations) {
          if (t.key.toLowerCase().includes(q) || t.value.toLowerCase().includes(q)) {
            // Highlight the matching part
            const isKeyMatch = t.key.toLowerCase().includes(q);
            results.push({
              name: t.key,
              type: 'translation',
              subType: t.value.substring(0, 50) + (t.value.length > 50 ? '...' : ''),
              file: filePath,
              line: t.line,
              isPrivate: false
            });
          }
        }
      }
    }

    // Sort by relevance: exact start match first, then contains
    results.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) { return aStarts - bStarts; }
      return a.name.localeCompare(b.name);
    });

    return results.slice(0, 500); // Limit to 500 to prevent UI freeze
  }

  /** Build dependency graph from imports */
  getDependencyGraph(): DependencyNode[] {
    const nodes: Map<string, DependencyNode> = new Map();

    for (const info of this.index.values()) {
      if (!nodes.has(info.filePath)) {
        nodes.set(info.filePath, { file: info.filePath, imports: [], importedBy: [] });
      }
      const node = nodes.get(info.filePath)!;

      for (const imp of info.imports) {
        // Only track internal (relative) imports
        if (!imp.path.startsWith('package:') && !imp.path.startsWith('dart:')) {
          const resolved = this.resolveImportPath(info.filePath, imp.path);
          node.imports.push(resolved);

          if (!nodes.has(resolved)) {
            nodes.set(resolved, { file: resolved, imports: [], importedBy: [] });
          }
          nodes.get(resolved)!.importedBy.push(info.filePath);
        }
      }
    }

    return Array.from(nodes.values());
  }

  /** Parse active file for widget tree */
  parseWidgetTreeForContent(filePath: string, content: string): DartFileInfo {
    return this.parser.parse(filePath, content);
  }

  /** Get all code warnings */
  getWarnings(): { filePath: string; warnings: import('./dartParser').WarningInfo[] }[] {
    const results: { filePath: string; warnings: import('./dartParser').WarningInfo[] }[] = [];
    for (const [filePath, info] of this.index.entries()) {
      if (info.warnings && info.warnings.length > 0) {
        results.push({ filePath, warnings: info.warnings });
      }
    }
    return results;
  }

  /** Analyze translations to find missing keys across ARB files */
  analyzeTranslations(): { filePath: string; missingKeys: string[] }[] {
    const allKeys = new Set<string>();
    const fileKeys = new Map<string, Set<string>>();

    // Gather all keys
    for (const [filePath, translations] of this.arbIndex.entries()) {
      const keys = new Set<string>();
      for (const t of translations) {
        allKeys.add(t.key);
        keys.add(t.key);
      }
      fileKeys.set(filePath, keys);
    }

    // Find missing
    const results: { filePath: string; missingKeys: string[] }[] = [];
    for (const [filePath, keys] of fileKeys.entries()) {
      const missing: string[] = [];
      for (const k of allKeys) {
        if (!keys.has(k)) { missing.push(k); }
      }
      if (missing.length > 0) {
        results.push({ filePath, missingKeys: missing });
      }
    }
    return results;
  }

  private relativePath(absPath: string): string {
    return path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/');
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
        if (key.startsWith('@')) continue; // Skip metadata
        if (typeof value !== 'string') continue;

        // Find line number (approximate, first occurrence of the key in quotes)
        let lineNum = 1;
        const searchStr = `"${key}"`;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(searchStr)) {
            lineNum = i + 1;
            break;
          }
        }

        translations.push({
          key,
          value,
          line: lineNum
        });
      }
    } catch {
      // Ignore JSON parse errors for ARB files
    }
    return translations;
  }
}

export interface SearchResult {
  name: string;
  type: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation';
  subType: string;
  file: string;
  line: number;
  isPrivate: boolean;
}

export interface DependencyNode {
  file: string;
  imports: string[];
  importedBy: string[];
}
