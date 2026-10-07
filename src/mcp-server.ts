import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as os from "os";
import { DirectSearch } from './mcp-direct-search';
import { ArbEditor } from './mcp-arb-editor';
import { CodeAnalyzer } from './mcp-code-analyzer';
import { DartParser, DartFileInfo, ClassInfo, FunctionInfo } from './indexer/dartParser';
import { JsTsParser } from './indexer/jsTsParser';
import { AndroidParser } from './indexer/androidParser';
import { BM25Search, BM25Document } from './indexer/bm25Search';
import { PackageResolver } from './indexer/packageResolver';
import { VmServiceBridge } from './runtime/vmServiceBridge';
import { runProjectAnalysis, runBuildRunner } from './utils/analysisRunner';

// Redirect console.log to console.error to prevent corrupting MCP stdio JSON-RPC protocol
const originalConsoleLog = console.log;
console.log = function (...args) {
  console.error(...args);
};

/**
 * Flutter Explorer MCP Server
 * Exposes indexed Dart/Flutter data to AI agents via stdio
 */

import { ProjectDetector } from './utils/projectDetector';
import { SqliteCache } from './indexer/sqliteCache';

let packageResolver: PackageResolver | null = null;
function getPackageResolver(): PackageResolver {
  if (!packageResolver) {
    packageResolver = new PackageResolver(currentProjectPath);
  }
  return packageResolver;
}

let vmServiceBridge: VmServiceBridge | null = null;
function getVmServiceBridge(): VmServiceBridge {
  if (!vmServiceBridge) {
    vmServiceBridge = new VmServiceBridge(currentProjectPath);
  }
  return vmServiceBridge;
}

// Current project path, resolved via environment variable or global active project fallback
let currentProjectPath: string = process.env.FLUTTER_PROJECT_PATH || "";
if (!currentProjectPath || currentProjectPath === "${workspaceFolder}") {
  try {
    const fallbackPath = path.join(os.homedir(), '.gemini', 'active-project.txt');
    if (fs.existsSync(fallbackPath)) {
      currentProjectPath = fs.readFileSync(fallbackPath, 'utf-8').trim();
    }
  } catch (e) {
    // ignore
  }
}
if (!currentProjectPath) {
  currentProjectPath = ProjectDetector.findProjectRoot(process.cwd());
}
const PUBSPEC_PATH = () => path.join(currentProjectPath, "pubspec.yaml");

let sqliteCache: SqliteCache | null = null;

function getSqliteCache() {
  if (!sqliteCache) {
    sqliteCache = new SqliteCache(currentProjectPath, { readonly: true });
  }
  return sqliteCache;
}

// ✅ قراءة الـ JSON fallback مباشرة من الملف
function readJsonFallback(): any | null {
  try {
    const dataDir = ProjectDetector.getDataDir(currentProjectPath);
    const jsonPath = path.join(dataDir, 'flutter-explorer.json');

    // ✅ جرب الـ path الجديد أولاً، ثم الـ .vscode القديم
    const legacyJsonPath = path.join(currentProjectPath, '.vscode', 'flutter-explorer.json');
    const targetPath = fs.existsSync(jsonPath) ? jsonPath
      : fs.existsSync(legacyJsonPath) ? legacyJsonPath
        : null;

    if (!targetPath) {
      console.error('[MCP] No JSON fallback found.');
      return null;
    }

    const content = fs.readFileSync(targetPath, 'utf-8');
    const raw = JSON.parse(content);
    console.error(`[MCP] Loaded JSON fallback from: ${targetPath}`);

    // ✅ تحويل من صيغة JSON Cache إلى صيغة index المتوقعة
    const index: any = { dart: {}, arb: {}, packages: [], diagnostics: [] };

    for (const [relPath, entry] of Object.entries(raw.dartFiles || {})) {
      try {
        index.dart[relPath] = JSON.parse((entry as any).data);
      } catch { /* skip corrupt entries */ }
    }

    for (const [relPath, entry] of Object.entries(raw.arbFiles || {})) {
      try {
        index.arb[relPath] = JSON.parse((entry as any).data);
      } catch { /* skip corrupt entries */ }
    }

    index.packages = raw.meta?.packages ?? [];
    index.diagnostics = raw.meta?.diagnostics ?? [];

    const dartCount = Object.keys(index.dart).length;
    const arbCount = Object.keys(index.arb).length;
    console.error(`[MCP] JSON fallback: ${dartCount} dart files, ${arbCount} arb files`);

    return (dartCount > 0 || arbCount > 0) ? index : null;
  } catch (error) {
    console.error('[MCP] Error reading JSON fallback:', error);
    return null;
  }
}

function getParserForFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    return new JsTsParser() as any;
  }
  if (['.kt', '.java', '.xml', '.gradle'].includes(ext) || filePath.endsWith('.gradle.kts')) {
    return new AndroidParser() as any;
  }
  return new DartParser();
}

/**
 * Normalizes input arguments across MCP tools to resolve a file's relative and absolute paths.
 * Supports aliases: filePath, relativePath, path.
 */
function resolveFilePath(args: { filePath?: string; relativePath?: string; path?: string } | undefined | null): { relative: string; absolute: string } | null {
  if (!args) return null;
  const raw = args.filePath || args.relativePath || args.path;
  if (!raw || typeof raw !== 'string') return null;
  const cleanRaw = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!cleanRaw) return null;

  let absPath: string;
  if (path.isAbsolute(cleanRaw)) {
    absPath = path.normalize(cleanRaw);
  } else {
    absPath = path.normalize(path.join(currentProjectPath, cleanRaw));
  }

  let relPath = path.relative(currentProjectPath, absPath).replace(/\\/g, '/');
  if (relPath.startsWith('./')) {
    relPath = relPath.substring(2);
  }

  return {
    relative: relPath,
    absolute: absPath.replace(/\\/g, '/')
  };
}

const server = new McpServer({
  name: "flutter-explorer-mcp",
  version: "1.0.0",
});

async function handleIndexError() {
  const cache = getSqliteCache();
  const diag = await cache.getDiagnostics();

  let message = "Index not found. ";

  if (!diag.exists) {
    message += `The database file was not found at: ${diag.dbPath}. Please ensure the Flutter Explorer VS Code extension is active and has finished indexing the project.`;
  } else if (!diag.available) {
    message += `The database file exists at ${diag.dbPath}, but the MCP server could not open it. Error: ${diag.error || 'Unknown access error'}. This might be due to a file lock or an incompatible SQLite library.`;
  } else if (diag.counts.dart_files === 0 && diag.counts.arb_files === 0) {
    message += `The database is connected but contains 0 indexed files. This usually means indexing is still in progress. Please wait for the VS Code extension to finish indexing or try the 'Rebuild Full Index' command in VS Code.`;
  } else {
    message += `The database is connected and contains ${diag.counts.dart_files} files, but the requested data could not be retrieved. Try re-indexing the project.`;
  }

  return { content: [{ type: "text" as const, text: message }] };
}

// ✅ Helper لقراءة الـ index — SQLite أولاً، ثم JSON لو SQLite فارغ
async function readIndex() {
  try {
    const cache = getSqliteCache();
    console.error(`[MCP Debug] Cache available: ${cache.isAvailable}, Project path: ${currentProjectPath}`);

    if (cache.isAvailable) {
      const dartRows = await cache.getAllDartFiles();
      const arbRows = await cache.getAllArbFiles();
      console.error(`[MCP Debug] SQLite: ${dartRows.length} dart files, ${arbRows.length} arb files`);

      // ✅ لو SQLite فيه بيانات — استخدمه
      if (dartRows.length > 0 || arbRows.length > 0) {
        const index: any = {
          dart: {},
          arb: {},
          packages: (await cache.getMeta<any[]>('packages')) ?? [],
          diagnostics: (await cache.getMeta<any[]>('diagnostics')) ?? []
        };
        for (const row of dartRows) index.dart[row.path] = row.info;
        for (const row of arbRows) index.arb[row.path] = row.translations;
        return index;
      }

      // ✅ SQLite موجود لكن فارغ — جرب JSON
      console.error('[MCP Debug] SQLite is empty, trying JSON fallback...');
      const jsonIndex = readJsonFallback();
      if (jsonIndex) return jsonIndex;

      // كلاهما فارغ
      return null;
    } else {
      // SQLite مش متاح — جرب JSON مباشرة
      console.error('[MCP Debug] SQLite not available, trying JSON fallback...');
      const jsonIndex = readJsonFallback();
      if (jsonIndex) return jsonIndex;
    }

    return null;
  } catch (error) {
    console.error("Error reading index:", error);
    // ✅ حتى لو حصل exception — جرب JSON كآخر حل
    try {
      return readJsonFallback();
    } catch {
      return null;
    }
  }
}

let cachedBM25: BM25Search | null = null;
let lastIndexSignature = '';

function getIndexSignature(index: any): string {
  let fileCount = 0;
  let hashAcc = '';
  for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
    fileCount++;
    hashAcc += info.contentHash ?? String(info.lastModified ?? 0) + filePath;
  }
  for (const filePath of Object.keys(index.arb as Record<string, any>)) {
    fileCount++;
    hashAcc += filePath;
  }
  return `${fileCount}:${hashAcc.length}:${hashAcc.slice(-64)}`;
}

function buildMcpBM25(index: any): BM25Search {
  const bm25 = new BM25Search();
  const docs: BM25Document[] = [];
  
  const bm25Id = (r: { name: string; file: string; line: number; type: string }) => {
    return `${r.file}:${r.line}:${r.name}:${r.type}`;
  };

  for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
    for (const cls of info.classes || []) {
      docs.push({
        id: bm25Id({ name: cls.name, file: filePath, line: cls.line, type: 'class' }),
        fields: { name: cls.name, path: filePath, superclass: cls.extendsClass ?? undefined },
      });
      if (cls.type !== 'plain' && cls.type !== 'ChangeNotifier') {
        docs.push({
          id: bm25Id({ name: cls.name, file: filePath, line: cls.line, type: 'widget' }),
          fields: { name: cls.name, path: filePath, comments: cls.type },
        });
      }
    }
    for (const fn of info.functions || []) {
      docs.push({
        id: bm25Id({ name: fn.name, file: filePath, line: fn.line, type: 'function' }),
        fields: { name: fn.name, path: filePath, comments: fn.parentClass ?? undefined },
      });
    }
    for (const e of (info.enums || [])) {
      docs.push({
        id: bm25Id({ name: e.name, file: filePath, line: e.line, type: 'enum' }),
        fields: { name: e.name, path: filePath },
      });
    }
    for (const m of (info.mixins || [])) {
      docs.push({
        id: bm25Id({ name: m.name, file: filePath, line: m.line, type: 'mixin' }),
        fields: { name: m.name, path: filePath },
      });
    }
    for (const ex of (info.extensions || [])) {
      docs.push({
        id: bm25Id({ name: ex.name, file: filePath, line: ex.line, type: 'extension' }),
        fields: { name: ex.name, path: filePath, comments: `on ${ex.onType}` },
      });
    }
    for (const td of (info.typedefs || [])) {
      docs.push({
        id: bm25Id({ name: td.name, file: filePath, line: td.line, type: 'typedef' }),
        fields: { name: td.name, path: filePath },
      });
    }
    for (const v of (info.variables || [])) {
      docs.push({
        id: bm25Id({ name: v.name, file: filePath, line: v.line, type: 'variable' }),
        fields: { name: v.name, path: filePath, comments: v.type },
      });
    }
    for (const c of (info.constructors || [])) {
      const fullName = `${c.className}.${c.name}`;
      docs.push({
        id: bm25Id({ name: fullName, file: filePath, line: c.line, type: 'constructor' }),
        fields: { name: fullName, path: filePath },
      });
    }
    for (const p of (info.properties || [])) {
      docs.push({
        id: bm25Id({ name: p.name, file: filePath, line: p.line, type: 'property' }),
        fields: { name: p.name, path: filePath, comments: `${p.className ?? ''} ${p.type}` },
      });
    }
    for (const a of (info.annotations || [])) {
      docs.push({
        id: bm25Id({ name: a.name, file: filePath, line: a.line, type: 'annotation' }),
        fields: { name: a.name, path: filePath, comments: `on ${a.targetName}` },
      });
    }
    for (const call of (info.functionCalls || [])) {
      docs.push({
        id: bm25Id({ name: call.name, file: filePath, line: call.line, type: 'call' }),
        fields: { name: call.name, path: filePath, comments: `in ${call.context}` },
      });
    }
    for (const et of (info.extensionTypes || [])) {
      docs.push({
        id: bm25Id({ name: et.name, file: filePath, line: et.line, type: 'extensionType' }),
        fields: { name: et.name, path: filePath, comments: et.representationType },
      });
    }
  }

  for (const [filePath, translations] of Object.entries(index.arb as Record<string, any>)) {
    for (const t of translations) {
      docs.push({
        id: bm25Id({ name: t.key, file: filePath, line: t.line, type: 'translation' }),
        fields: { name: t.key, path: filePath, comments: t.value.substring(0, 100) }
      });
    }
  }

  bm25.buildIndex(docs);
  return bm25;
}

async function getBM25Search(index: any): Promise<BM25Search> {
  const currentSignature = getIndexSignature(index);
  if (!cachedBM25 || lastIndexSignature !== currentSignature) {
    console.error('[MCP] Rebuilding BM25 Search Index for MCP...');
    cachedBM25 = buildMcpBM25(index);
    lastIndexSignature = currentSignature;
  }
  return cachedBM25;
}

function getBM25IdForMcpResult(r: any): string {
  let type = '';
  switch (r.type) {
    case 'class_definition': type = 'class'; break;
    case 'function_definition': type = 'function'; break;
    case 'function_call': type = 'call'; break;
    case 'enum_definition': type = 'enum'; break;
    case 'mixin_definition': type = 'mixin'; break;
    case 'extension_definition': type = 'extension'; break;
    case 'typedef_definition': type = 'typedef'; break;
    case 'variable_definition': type = 'variable'; break;
    case 'constructor_definition': type = 'constructor'; break;
    case 'property_definition': type = 'property'; break;
    case 'annotation_definition': type = 'annotation'; break;
    case 'translation': type = 'translation'; break;
    default: type = r.type;
  }
  return `${r.file}:${r.line ?? 1}:${r.name}:${type}`;
}

// Helper to recursively get directory structure
function getDirectoryStructure(dirPath: string, relativePath: string = ""): any[] {
  const results: any[] = [];
  try {
    if (!fs.existsSync(dirPath)) return [];

    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      if (item.startsWith('.') || item === 'node_modules' || item === 'build' ||
        item === 'ios' || item === 'android' || item === 'windows' ||
        item === 'macos' || item === 'linux') continue;

      const fullPath = path.join(dirPath, item);
      const relItemPath = path.join(relativePath, item);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        results.push({
          name: item,
          type: "directory",
          path: relItemPath,
          children: getDirectoryStructure(fullPath, relItemPath)
        });
      } else {
        results.push({
          name: item,
          type: "file",
          path: relItemPath,
          size: stats.size
        });
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }
  return results;
}

/**
 * Helper to resolve Dart import paths
 */
function resolveImportPath(importPath: string, fromFile: string, index?: any): string {
  if (importPath.startsWith('package:')) {
    let projName: string | null = null;
    try {
      const pubspecContent = fs.readFileSync(PUBSPEC_PATH(), 'utf-8');
      const nameMatch = pubspecContent.match(/^name:\s*([a-zA-Z0-9_\-]+)/m);
      if (nameMatch) {
        projName = nameMatch[1].trim();
      }
    } catch (e) {
      // ignore
    }
    if (projName && importPath.startsWith(`package:${projName}/`)) {
      return 'lib/' + importPath.substring(`package:${projName}/`.length);
    }
    return importPath;
  }
  const dir = path.dirname(fromFile);
  const resolved = path.posix.normalize(path.posix.join(dir.replace(/\\/g, '/'), importPath));

  if (index && index.dart) {
    if (index.dart[resolved]) return resolved;
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.dart', '.kt', '.java'];
    for (const ext of exts) {
      if (index.dart[resolved + ext]) return resolved + ext;
      if (index.dart[resolved + '/index' + ext]) return resolved + '/index' + ext;
    }
  }

  return resolved;
}

/**
 * Build a detailed graph from the SQLite index
 */
function buildDetailedGraph(index: any) {
  const nodes: any[] = [];
  const edges: any[] = [];
  const seenNodes = new Set<string>();

  if (!index || !index.dart) return { nodes, edges };

  // Pre-build lookup indexes to resolve method calls to their definitions correctly
  const classMethods = new Map<string, Set<string>>();
  const topLevelFunctions = new Set<string>();
  const classAncestors = new Map<string, string[]>();
  const allClassNames = new Set<string>();
  const allMixinNames = new Set<string>();
  const allEnumNames = new Set<string>();

  for (const info of Object.values(index.dart as Record<string, any>)) {
    for (const cls of info.classes || []) {
      allClassNames.add(cls.name);
      const ancestors: string[] = [];
      if (cls.extendsClass) ancestors.push(cls.extendsClass);
      for (const m of cls.mixins || []) ancestors.push(m);
      for (const impl of cls.implements || []) ancestors.push(impl);
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
      } else {
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

  // Helper to find the class (either the class itself or an ancestor) defining a method
  function resolveClassMethodOwner(clsName: string, methodName: string, visited = new Set<string>()): string | null {
    if (visited.has(clsName)) return null;
    visited.add(clsName);

    const methods = classMethods.get(clsName);
    if (methods && methods.has(methodName)) return clsName;

    const ancestors = classAncestors.get(clsName);
    if (ancestors) {
      for (const parent of ancestors) {
        const owner = resolveClassMethodOwner(parent, methodName, visited);
        if (owner) return owner;
      }
    }
    return null;
  }

  const addNode = (id: string, name: string, type: string, file?: string, line?: number) => {
    if (!seenNodes.has(id)) {
      seenNodes.add(id);
      const node: any = { id, name, type };
      if (file) node.file = file;
      if (line !== undefined) node.line = line;
      nodes.push(node);
    }
  };

  for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
    const fileId = `file:${filePath}`;
    addNode(fileId, path.basename(filePath), 'file', filePath);

    // ── Imports → file-to-file edges ──────────────────────────────────────
    for (const imp of info.imports || []) {
      if (imp.path && !imp.path.startsWith('dart:')) {
        const resolvedPath = resolveImportPath(imp.path, filePath, index);
        if (resolvedPath && index.dart[resolvedPath]) {
          addNode(`file:${resolvedPath}`, path.basename(resolvedPath), 'file', resolvedPath);
          edges.push({ source: fileId, target: `file:${resolvedPath}`, type: 'imports' });
        }
      }
    }

    // ── Classes ────────────────────────────────────────────────────────────
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

    // ── Functions & Methods ────────────────────────────────────────────────
    for (const func of info.functions || []) {
      const funcId = func.parentClass ? `method:${func.parentClass}.${func.name}` : `func:${func.name}`;
      addNode(funcId, func.name, func.parentClass ? 'method' : 'function', filePath, func.line);
      const parentId = func.parentClass ? `class:${func.parentClass}` : fileId;
      edges.push({ source: parentId, target: funcId, type: 'contains' });
    }

    // ── Widgets ────────────────────────────────────────────────────────────
    for (const w of info.widgets || []) {
      const wId = `class:${w.name}`; // resolve to class ID for consistency
      addNode(wId, w.name, 'widget', filePath, w.line);
      edges.push({ source: fileId, target: wId, type: 'contains' });
    }

    // ── Enums ──────────────────────────────────────────────────────────────
    for (const en of info.enums || []) {
      const eId = `enum:${en.name}`;
      addNode(eId, en.name, 'enum', filePath, en.line);
      edges.push({ source: fileId, target: eId, type: 'contains' });
    }

    // ── Mixins ─────────────────────────────────────────────────────────────
    for (const m of info.mixins || []) {
      const mxId = `mixin:${m.name}`;
      addNode(mxId, m.name, 'mixin', filePath, m.line);
      edges.push({ source: fileId, target: mxId, type: 'contains' });
    }

    // ── Extensions ─────────────────────────────────────────────────────────
    for (const ext of info.extensions || []) {
      const extId = `extension:${ext.name}`;
      addNode(extId, ext.name, 'extension', filePath, ext.line);
      edges.push({ source: fileId, target: extId, type: 'contains' });
      if (ext.onType) {
        edges.push({ source: extId, target: `class:${ext.onType}`, type: 'extends' });
      }
    }

    // ── Typedefs ───────────────────────────────────────────────────────────
    for (const td of info.typedefs || []) {
      const tdId = `typedef:${td.name}`;
      addNode(tdId, td.name, 'typedef', filePath, td.line);
      edges.push({ source: fileId, target: tdId, type: 'contains' });
    }

    // ── Variables (top-level) ──────────────────────────────────────────────
    for (const v of info.variables || []) {
      const vId = `variable:${v.name}`;
      addNode(vId, v.name, 'variable', filePath, v.line);
      edges.push({ source: fileId, target: vId, type: 'contains' });
    }

    // ── Constructors ───────────────────────────────────────────────────────
    for (const ctor of info.constructors || []) {
      const ctorId = `constructor:${ctor.className}.${ctor.name || 'new'}`;
      addNode(ctorId, `${ctor.className}.${ctor.name || 'new'}`, 'constructor', filePath, ctor.line);
      const parentClass = `class:${ctor.className}`;
      edges.push({ source: parentClass, target: ctorId, type: 'contains' });
    }

    // ── Function Calls → call edges ────────────────────────────────────────
    for (const call of info.functionCalls || []) {
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

      let calleeId: string | null = null;
      const callName = call.name;

      // 1. Resolve receiver
      if (call.receiver) {
        const rx = call.receiver;
        if (allClassNames.has(rx)) {
          const owner = resolveClassMethodOwner(rx, callName);
          if (owner) {
            calleeId = `method:${owner}.${callName}`;
          } else {
            calleeId = `class:${rx}`;
          }
        } else if (allMixinNames.has(rx)) {
          calleeId = `mixin:${rx}`;
        } else if (allEnumNames.has(rx)) {
          calleeId = `enum:${rx}`;
        } else if (rx !== 'this' && rx !== 'super') {
          // Heuristic: camelCase variable to PascalCase ClassName
          const pascalRx = rx.charAt(0).toUpperCase() + rx.slice(1);
          if (allClassNames.has(pascalRx)) {
            const owner = resolveClassMethodOwner(pascalRx, callName);
            if (owner) {
              calleeId = `method:${owner}.${callName}`;
            } else {
              calleeId = `method:${pascalRx}.${callName}`;
            }
          }
        }
      }

      // 2. Resolve no-receiver, this, or super
      if (!calleeId) {
        if (allClassNames.has(callName)) {
          calleeId = `class:${callName}`;
        } else if (allMixinNames.has(callName)) {
          calleeId = `mixin:${callName}`;
        } else if (allEnumNames.has(callName)) {
          calleeId = `enum:${callName}`;
        } else if (call.callerClass) {
          const owner = resolveClassMethodOwner(call.callerClass, callName);
          if (owner) {
            calleeId = `method:${owner}.${callName}`;
          }
        }
      }

      // 3. Resolve to top-level function if defined
      if (!calleeId) {
        if (topLevelFunctions.has(callName)) {
          calleeId = `func:${callName}`;
        }
      }

      // 4. Default fallback
      if (!calleeId) {
        calleeId = `func:${callName}`;
      }

      if (callerId !== calleeId) {
        edges.push({ source: callerId, target: calleeId, type: 'calls' });
      }
    }

    // ── Class usages → cross-file edges ────────────────────────────────────
    for (const usage of info.classUsages || []) {
      for (const usedFile of usage.usedInFiles || []) {
        if (usedFile !== filePath && index.dart[usedFile]) {
          edges.push({ source: `file:${usedFile}`, target: `class:${usage.className}`, type: 'uses_class' });
        }
      }
    }

    // ── Variable usages → cross-file edges ─────────────────────────────────
    for (const usage of info.variableUsages || []) {
      for (const usedFile of usage.usedInFiles || []) {
        if (usedFile !== filePath && index.dart[usedFile]) {
          edges.push({ source: `file:${usedFile}`, target: `variable:${usage.variableName}`, type: 'uses_variable' });
        }
      }
    }
  }

  return { nodes, edges };
}

// --- Tools ---

// 1. Search Tool
server.registerTool(
  "flutter_search",
  {
    description: "Search for classes, functions, widgets, and other Dart elements. Use flutter_get_code_block to get full function/class bodies.",
    inputSchema: z.object({
      query: z.string().describe("The search term (class name, function name, etc.)"),
      filter: z.enum(["class", "function", "widget", "enum", "mixin", "extension", "ext", "extensionType", "typedef", "type", "variable", "vars", "constructor", "property", "annotation", "file", "call", "translation"]).optional().describe("Filter by type (aliases: ext, type, vars)"),
      searchMode: z.enum(["definitions", "calls", "both"]).optional().describe("Search in definitions, calls, or both (default: both)"),
      useDirectSearch: z.boolean().optional().describe("Force direct file search even if index exists (default: false)"),
    }),
  },
  async ({ query, filter, searchMode = "both", useDirectSearch = false }: {
    query: string;
    filter?: "class" | "function" | "widget" | "enum" | "mixin" | "extension" | "ext" | "extensionType" | "typedef" | "type" | "variable" | "vars" | "constructor" | "property" | "annotation" | "file" | "call" | "translation";
    searchMode?: "definitions" | "calls" | "both";
    useDirectSearch?: boolean;
  }) => {
    const index = await readIndex();
    const results: any[] = [];
    const q = query.toLowerCase();
    const mode = searchMode || "both";

    let normalizedFilter = filter;
    if (filter === "ext") normalizedFilter = "extension";
    else if (filter === "type") normalizedFilter = "typedef";
    else if (filter === "vars") normalizedFilter = "variable";
    else if (filter === "call") normalizedFilter = "function";

    const targetFilter = normalizedFilter;

    if (index && !useDirectSearch) {
      for (const file in index.dart) {
        const info = index.dart[file];

        if (!targetFilter || targetFilter === "class" || targetFilter === "widget") {
          if (mode === "definitions" || mode === "both") {
            for (const c of info.classes) {
              if (c.name.toLowerCase().includes(q)) {
                if (filter === "widget" && c.type === "plain") continue;
                if (targetFilter === "widget" && c.type === "plain") continue;
                results.push({ name: c.name, type: "class_definition", subtype: c.type, file, line: c.line, lineEnd: c.lineEnd });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "function") {
          if (mode === "definitions" || mode === "both") {
            const allFunctions = [
              ...info.functions,
              ...info.classes.flatMap((c: any) => c.methods),
              ...(info.extensions || []).flatMap((e: any) => e.methods),
              ...(info.extensionTypes || []).flatMap((et: any) => et.methods)
            ];
            for (const f of allFunctions) {
              if (f.name.toLowerCase().includes(q)) {
                results.push({ name: f.name, type: "function_definition", parent: f.parentClass, file, line: f.line, lineEnd: f.lineEnd });
              }
            }
          }
          if ((mode === "calls" || mode === "both") && info.functionCalls) {
            for (const call of info.functionCalls) {
              if (call.name.toLowerCase().includes(q)) {
                results.push({ name: call.name, type: "function_call", callerClass: call.callerClass, callerFunction: call.callerFunction, file, line: call.line, context: call.context });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "enum") {
          if (mode === "definitions" || mode === "both") {
            for (const e of info.enums || []) {
              if (e.name.toLowerCase().includes(q)) {
                results.push({ name: e.name, type: "enum_definition", file, line: e.line, values: e.values });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "mixin") {
          if (mode === "definitions" || mode === "both") {
            for (const m of info.mixins || []) {
              if (m.name.toLowerCase().includes(q)) {
                results.push({ name: m.name, type: "mixin_definition", file, line: m.line, on: m.on });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "extension") {
          if (mode === "definitions" || mode === "both") {
            for (const e of info.extensions || []) {
              if (e.name.toLowerCase().includes(q)) {
                results.push({ name: e.name, type: "extension_definition", file, line: e.line, on: e.onType });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "extensionType") {
          if (mode === "definitions" || mode === "both") {
            for (const et of info.extensionTypes || []) {
              if (et.name.toLowerCase().includes(q)) {
                results.push({ name: et.name, type: "extension_type_definition", file, line: et.line, on: et.representationType });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "typedef") {
          if (mode === "definitions" || mode === "both") {
            for (const t of info.typedefs || []) {
              if (t.name.toLowerCase().includes(q)) {
                results.push({ name: t.name, type: "typedef_definition", file, line: t.line, signature: t.signature });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "variable") {
          if (mode === "definitions" || mode === "both") {
            for (const v of info.variables || []) {
              if (v.name.toLowerCase().includes(q)) {
                results.push({ name: v.name, type: "variable_definition", file, line: v.line, varType: v.type, isConst: v.isConst, isFinal: v.isFinal });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "constructor") {
          if (mode === "definitions" || mode === "both") {
            for (const c of info.constructors || []) {
              const fullName = `${c.className}.${c.name}`;
              if (fullName.toLowerCase().includes(q)) {
                results.push({ name: fullName, type: "constructor_definition", file, line: c.line, params: c.params, isFactory: c.isFactory, isConst: c.isConst });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "property") {
          if (mode === "definitions" || mode === "both") {
            for (const p of info.properties || []) {
              if (p.name.toLowerCase().includes(q)) {
                results.push({ name: p.name, type: "property_definition", file, line: p.line, propType: p.type, className: p.className, isStatic: p.isStatic, isGetter: p.isGetter, isSetter: p.isSetter });
              }
            }
          }
        }

        if (!targetFilter || targetFilter === "annotation") {
          if (mode === "definitions" || mode === "both") {
            for (const a of info.annotations || []) {
              if (a.name.toLowerCase().includes(q)) {
                results.push({ name: `@${a.name}`, type: "annotation_definition", file, line: a.line, target: a.target, targetName: a.targetName });
              }
            }
          }
        }
      }

      if (!targetFilter || targetFilter === "file") {
        for (const file in index.dart) {
          if (path.basename(file).toLowerCase().includes(q)) {
            results.push({ name: path.basename(file), type: "file", file });
          }
        }
        for (const file in index.arb) {
          if (path.basename(file).toLowerCase().includes(q) && !results.find(r => r.file === file)) {
            results.push({ name: path.basename(file), type: "file", file });
          }
        }
      }

      if (!targetFilter || targetFilter === "translation") {
        for (const file in index.arb) {
          for (const t of index.arb[file]) {
            if (t.key.toLowerCase().includes(q) || t.value.toLowerCase().includes(q)) {
              results.push({ name: t.key, type: "translation", value: t.value, file, line: t.line });
            }
          }
        }
      }
    }

    if (index && !useDirectSearch && results.length > 0) {
      try {
        const bm25 = await getBM25Search(index);
        if (bm25.isBuilt && query.trim().length > 0) {
          const candidateIds = results.map(r => getBM25IdForMcpResult(r));
          const scores = bm25.scoreMany(candidateIds, query);

          results.sort((a, b) => {
            const idA = getBM25IdForMcpResult(a);
            const idB = getBM25IdForMcpResult(b);
            const scoreA = scores.get(idA) ?? 0;
            const scoreB = scores.get(idB) ?? 0;
            if (scoreB !== scoreA) return scoreB - scoreA;
            const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
            const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
            if (aStarts !== bStarts) return aStarts - bStarts;
            return a.name.localeCompare(b.name);
          });
        }
      } catch (err) {
        console.error('[MCP BM25 Search Error]', err);
      }
    }

    if (results.length === 0 || !index || useDirectSearch) {
      const directSearch = new DirectSearch(currentProjectPath);
      const directResults = directSearch.search(query, filter, mode);
      for (const result of directResults) {
        results.push({ ...result, _source: !index || useDirectSearch ? "direct_search" : "index" });
      }
    }

    const indexStatus = () => {
      const dbPath = ProjectDetector.getDbPath(currentProjectPath);
      const exists = fs.existsSync(dbPath);
      const cache = getSqliteCache();
      const available = cache.isAvailable;
      if (!exists) return `Index not found (DB missing at ${dbPath}). Using direct search.`;
      if (!available) return `Index exists but inaccessible. Using direct search.`;
      return "Index empty. Using direct search.";
    };

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          results: results.slice(0, 50),
          source: !index || useDirectSearch ? "direct_search" : "index",
          note: !index ? indexStatus() : "",
        }, null, 2)
      }],
    };
  }
);

// 2. Stats Tool
server.registerTool(
  "flutter_get_stats",
  {
    description: "Get summary statistics of the Flutter project index",
    inputSchema: z.object({}),
  },
  async () => {
    const index = await readIndex();
    if (!index) return await handleIndexError();

    let files = 0, classes = 0, functions = 0, methods = 0, widgets = 0, enums = 0, mixins = 0;
    let extensions = 0, typedefs = 0, variables = 0, constructors = 0, properties = 0, annotations = 0;

    for (const file in index.dart || {}) {
      const info = index.dart[file];
      files++;
      classes += (info.classes || []).length;
      functions += (info.functions || []).length;
      methods += (info.classes || []).reduce((sum: number, c: any) => sum + (c.methods || []).length, 0) +
                 (info.extensions || []).reduce((sum: number, e: any) => sum + (e.methods || []).length, 0) +
                 (info.extensionTypes || []).reduce((sum: number, et: any) => sum + (et.methods || []).length, 0);
      widgets += (info.widgets || []).length;
      enums += (info.enums || []).length;
      mixins += (info.mixins || []).length;
      extensions += (info.extensions || []).length;
      typedefs += (info.typedefs || []).length;
      variables += (info.variables || []).length;
      constructors += (info.constructors || []).length;
      properties += (info.properties || []).length;
      annotations += (info.annotations || []).length;
    }
    let translations = 0;
    for (const file in index.arb || {}) {
      translations += index.arb[file].length;
    }

    const stats = [
      `Files: ${files}`,
      `Classes: ${classes}`,
      `Functions (Top-level): ${functions}`,
      `Methods: ${methods}`,
      `Widgets: ${widgets}`,
      `Enums: ${enums}`,
      `Mixins: ${mixins}`,
      `Extensions: ${extensions}`,
      `Typedefs: ${typedefs}`,
      `Variables: ${variables}`,
      `Constructors: ${constructors}`,
      `Properties: ${properties}`,
      `Annotations: ${annotations}`,
      `Translations: ${translations}`
    ].join(", ");

    return { content: [{ type: "text" as const, text: stats }] };
  }
);

server.registerTool(
  "flutter_get_project_structure",
  {
    description: "Get the structure of the project (folders and files), specifically focusing on the lib/ directory.",
    inputSchema: z.object({
      targetPath: z.string().optional().describe("Specific subdirectory to explore (defaults to 'lib', 'src', or 'app/src/main' based on existence)"),
    }),
  },
  async ({ targetPath }) => {
    let resolvedTargetPath = targetPath;
    if (!resolvedTargetPath) {
      if (fs.existsSync(path.join(currentProjectPath, "lib"))) {
        resolvedTargetPath = "lib";
      } else if (fs.existsSync(path.join(currentProjectPath, "src"))) {
        resolvedTargetPath = "src";
      } else if (fs.existsSync(path.join(currentProjectPath, "app/src/main"))) {
        resolvedTargetPath = "app/src/main";
      } else {
        resolvedTargetPath = ""; // default to root if none of the above exist
      }
    }

    const fullPath = path.join(currentProjectPath, resolvedTargetPath);
    if (!fs.existsSync(fullPath)) {
      return { content: [{ type: "text" as const, text: `Path not found: ${resolvedTargetPath || "root"}` }] };
    }

    const structure = getDirectoryStructure(fullPath, resolvedTargetPath);

    const formatStructure = (items: any[], indent: string = ""): string => {
      let output = "";
      for (const item of items) {
        if (item.type === "directory") {
          output += `${indent}📁 ${item.name}/\n`;
          output += formatStructure(item.children, indent + "  ");
        } else {
          output += `${indent}📄 ${item.name}\n`;
        }
      }
      return output;
    };

    const formatted = formatStructure(structure);
    return { content: [{ type: "text" as const, text: formatted || "Directory is empty." }] };
  }
);

server.registerTool(
  "flutter_get_file_info",
  {
    description: "Get detailed information about a specific Dart file",
    inputSchema: z.object({
      relativePath: z.string().optional().describe("The relative path of the file (e.g. lib/main.dart)"),
      filePath: z.string().optional().describe("Alias for relativePath"),
      path: z.string().optional().describe("Alias for relativePath"),
    }),
  },
  async (args: { relativePath?: string; filePath?: string; path?: string }) => {
    const resolved = resolveFilePath(args);
    if (!resolved) {
      return { content: [{ type: "text" as const, text: "Error: File path is required (provide relativePath, filePath, or path)." }] };
    }

    const index = await readIndex();
    if (!index) return await handleIndexError();

    let info = index.dart?.[resolved.relative];
    if (!info && index.dart) {
      const lower = resolved.relative.toLowerCase();
      const key = Object.keys(index.dart).find(k => k.toLowerCase() === lower || k.endsWith(resolved.relative));
      if (key) info = index.dart[key];
    }

    if (!info) return { content: [{ type: "text" as const, text: `File not found in index: ${resolved.relative}` }] };

    return { content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_pubspec",
  {
    description: "Read and analyze the project's pubspec.yaml, package.json, or build.gradle/settings.gradle file",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const pubspecPath = PUBSPEC_PATH();
      if (fs.existsSync(pubspecPath)) {
        const content = fs.readFileSync(pubspecPath, "utf-8");
        return { content: [{ type: "text" as const, text: content }] };
      }
      const pkgPath = path.join(currentProjectPath, "package.json");
      if (fs.existsSync(pkgPath)) {
        const content = fs.readFileSync(pkgPath, "utf-8");
        return { content: [{ type: "text" as const, text: content }] };
      }
      for (const f of ['build.gradle.kts', 'app/build.gradle.kts', 'build.gradle', 'app/build.gradle', 'settings.gradle.kts', 'settings.gradle']) {
        const gp = path.join(currentProjectPath, f);
        if (fs.existsSync(gp)) {
          const content = fs.readFileSync(gp, "utf-8");
          return { content: [{ type: "text" as const, text: `// File: ${f}\n${content}` }] };
        }
      }
      return { content: [{ type: "text" as const, text: `No project configuration file (pubspec.yaml, package.json, build.gradle) found at: ${currentProjectPath}` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Error reading project config: ${error}` }] };
    }
  }
);

server.registerTool(
  "flutter_get_code_warnings",
  {
    description: "Get code warnings (like hardcoded text, colors, duplicated code/logic, and mockups) from the Dart project with optional filtering",
    inputSchema: z.object({
      typeFilter: z.enum([
        "all", "text", "color", "duplicated_logic", "mockup",
        "mockup_empty_callback", "mockup_fake_data", "mockup_stub_widget",
        "mockup_unbound_input", "mockup_fake_delay", "mockup_todo_comment"
      ]).optional().describe("Filter by warning type ('all', 'text', 'color', 'duplicated_logic', 'mockup', etc.)"),
      searchQuery: z.string().optional().describe("Search text inside the warning message (e.g. #FFFFFF or a word)"),
      fileQuery: z.string().optional().describe("Search text inside the file path (e.g. main.dart)"),
    }),
  },
  async ({ typeFilter, searchQuery, fileQuery }: { typeFilter?: string; searchQuery?: string; fileQuery?: string }) => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();

    const warnings = [];
    const sq = searchQuery?.toLowerCase();
    const fq = fileQuery?.toLowerCase();
    
    for (const file in index.dart) {
      if (fq && !file.toLowerCase().includes(fq)) continue;

      if (index.dart[file].warnings && index.dart[file].warnings.length > 0) {
        let fileWarnings = index.dart[file].warnings;
        
        if (typeFilter && typeFilter !== 'all') {
          if (typeFilter === 'mockup') {
            fileWarnings = fileWarnings.filter((w: any) => w.type && w.type.startsWith('mockup_'));
          } else {
            const targetType = typeFilter === 'text' ? 'hardcoded_text' : 
                               typeFilter === 'color' ? 'hardcoded_color' : 
                               typeFilter === 'duplicated_logic' ? 'duplicated_logic' : typeFilter;
            fileWarnings = fileWarnings.filter((w: any) => w.type === targetType);
          }
        }
        
        if (sq) {
          fileWarnings = fileWarnings.filter((w: any) => w.message.toLowerCase().includes(sq));
        }

        if (fileWarnings.length > 0) {
          warnings.push({ filePath: file, warnings: fileWarnings });
        }
      }
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(warnings, null, 2) }] };
  }
);

server.registerTool(
  "flutter_detect_mockups",
  {
    description: "Scan Flutter project to detect mockup, dummy, placeholder, and unimplemented UI code (empty callbacks, hardcoded mock data, stub widgets, unbound inputs, fake delays, TODO comments)",
    inputSchema: z.object({
      category: z.enum(["all", "callback", "data", "widget", "input", "async", "comment"]).optional().describe("Filter by mockup category ('all', 'callback', 'data', 'widget', 'input', 'async', 'comment')"),
      filePath: z.string().optional().describe("Filter results for a specific file (e.g. lib/pages/home_page.dart)"),
    }),
  },
  async ({ category, filePath }: { category?: string; filePath?: string }) => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();

    const results: any[] = [];
    const categoryCounts: Record<string, number> = {
      callback: 0,
      data: 0,
      widget: 0,
      input: 0,
      async: 0,
      comment: 0,
    };
    let totalCount = 0;

    const fp = filePath?.toLowerCase();

    for (const file in index.dart) {
      if (fp && !file.toLowerCase().includes(fp)) continue;

      const fileInfo = index.dart[file];
      if (!fileInfo.warnings || fileInfo.warnings.length === 0) continue;

      const mockups = fileInfo.warnings.filter((w: any) => {
        if (!w.type || !w.type.startsWith('mockup_')) return false;
        if (!category || category === 'all') return true;
        return w.category === category || w.type === `mockup_${category}`;
      });

      if (mockups.length > 0) {
        for (const m of mockups) {
          const cat = m.category || 'widget';
          if (categoryCounts[cat] !== undefined) {
            categoryCounts[cat]++;
          }
          totalCount++;
        }
        results.push({
          filePath: file,
          count: mockups.length,
          mockups: mockups.map((m: any) => ({
            type: m.type,
            category: m.category,
            line: m.line,
            message: m.message,
            codeSnippet: m.codeSnippet,
            suggestion: m.suggestion,
          })),
        });
      }
    }

    const output = {
      summary: {
        totalFilesWithMockups: results.length,
        totalMockupItems: totalCount,
        breakdownByCategory: categoryCounts,
      },
      files: results,
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_diagnostics",
  {
    description: "Get VS Code diagnostics (errors and warnings) for the project, optionally filtered by file or severity",
    inputSchema: z.object({
      filePath: z.string().optional().describe("Optional relative or absolute file path to filter diagnostics for"),
      relativePath: z.string().optional().describe("Alias for filePath"),
      path: z.string().optional().describe("Alias for filePath"),
      severity: z.enum(["error", "warning", "info"]).optional().describe("Optional severity level to filter by"),
    }),
  },
  async (args: { filePath?: string; relativePath?: string; path?: string; severity?: "error" | "warning" | "info" }) => {
    const index = await readIndex();
    if (!index || !index.diagnostics) return { content: [{ type: "text" as const, text: "No diagnostics found in index." }] };

    let diagnostics = index.diagnostics as any[];
    const resolved = resolveFilePath(args);

    if (resolved) {
      const targetRel = resolved.relative.toLowerCase();
      diagnostics = diagnostics.filter((d: any) => {
        const dPath = (d.filePath || d.file || "").replace(/\\/g, '/').toLowerCase();
        return dPath === targetRel || dPath.endsWith(targetRel);
      });
    }

    if (args?.severity) {
      const targetSev = args.severity.toLowerCase();
      diagnostics = diagnostics.filter((d: any) => (d.severity || "").toLowerCase() === targetSev);
    }

    if (diagnostics.length === 0) {
      return { content: [{ type: "text" as const, text: resolved ? `No diagnostics found for ${resolved.relative}.` : "No diagnostics found in index." }] };
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(diagnostics, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_missing_translations",
  {
    description: "Find missing translation keys across all ARB files",
    inputSchema: z.object({}),
  },
  async () => {
    const arbEditor = new ArbEditor(currentProjectPath);
    const results = arbEditor.getAllTranslations();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ files: results.files, totalKeys: results.keys.length, missingKeys: results.missingKeys }, null, 2)
      }]
    };
  }
);

server.registerTool(
  "flutter_update_translation",
  {
    description: "Update or add a translation key across all ARB files, supporting dynamic multi-locale maps or Arabic/English values",
    inputSchema: z.object({
      key: z.string().describe("Translation key (e.g. loginButton)"),
      arValue: z.string().optional().describe("Arabic translation value (optional if translations map is provided)"),
      enValue: z.string().optional().describe("English translation value (optional if translations map is provided)"),
      translations: z.record(z.string(), z.string()).optional().describe("Dynamic map of locale to value (e.g. {'en': 'Hello', 'ar': 'مرحبا', 'fr': 'Bonjour'})"),
      description: z.string().optional().describe("Optional description for the translation key"),
      placeholders: z.record(z.string(), z.any()).optional().describe("Optional ICU placeholder definitions"),
    }),
  },
  async ({ key, arValue, enValue, translations, description, placeholders }) => {
    const arbEditor = new ArbEditor(currentProjectPath);
    const result = arbEditor.updateTranslation(
      key,
      translations || (arValue ?? ""),
      enValue,
      description,
      placeholders as Record<string, any> | undefined
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);



server.registerTool(
  "flutter_delete_translation",
  {
    description: "Delete a translation key from all ARB files",
    inputSchema: z.object({
      key: z.string().describe("Translation key to delete"),
    }),
  },
  async ({ key }) => {
    const arbEditor = new ArbEditor(currentProjectPath);
    const result = arbEditor.deleteTranslation(key);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_list_translations",
  {
    description: "List all translation keys and check for missing keys across ARB files",
    inputSchema: z.object({}),
  },
  async () => {
    const arbEditor = new ArbEditor(currentProjectPath);
    const result = arbEditor.getAllTranslations();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_impact_analysis",
  {
    description: "Analyze the 'blast radius' of a file: find all application entry points (UI/Main/Events) that eventually call code in this file.",
    inputSchema: z.object({
      relativePath: z.string().optional().describe("The relative path of the file to analyze (e.g. lib/core/utils.dart)"),
      filePath: z.string().optional().describe("Alias for relativePath"),
      path: z.string().optional().describe("Alias for relativePath"),
      maxDepth: z.number().optional().describe("Maximum search depth (default: 25)"),
    }),
  },
  async (args: { relativePath?: string; filePath?: string; path?: string; maxDepth?: number }) => {
    const resolved = resolveFilePath(args);
    if (!resolved) {
      return { content: [{ type: "text" as const, text: "Error: File path is required (provide relativePath, filePath, or path)." }] };
    }

    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();

    const maxDepth = args.maxDepth ?? 25;
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const affectedFlows = analyzer.findImpactBackwards(index, resolved.relative, maxDepth);

    const result = {
      targetFile: resolved.relative,
      affectedFlows,
      summary: affectedFlows.length > 0
        ? `Found ${affectedFlows.length} execution flows from entry points reaching this file.`
        : "No direct execution flows from entry points (main/build/events) found reaching this file."
    };

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_reverse_deps",
  {
    description: "Get reverse dependencies for a class or function (what depends on this element)",
    inputSchema: z.object({
      name: z.string().describe("Element name"),
      type: z.enum(["class", "function", "extension", "typedef", "variable", "constructor", "property", "annotation", "enum", "mixin"]).describe("Type of element"),
      parentClass: z.string().optional().describe("Parent class name (required for properties/functions inside classes)"),
    }),
  },
  async ({ name, type, parentClass }: {
    name: string;
    type: "class" | "function" | "extension" | "typedef" | "variable" | "constructor" | "property" | "annotation" | "enum" | "mixin";
    parentClass?: string;
  }) => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();

    const results: any[] = [];

    for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
      let usages: any[] = [];
      let matchField = "";

      switch (type) {
        case "class": usages = info.classUsages || []; matchField = "className"; break;
        case "function": usages = info.functionUsages || []; matchField = "functionName"; break;
        case "extension": usages = info.extensionUsages || []; matchField = "extensionName"; break;
        case "typedef": usages = info.typedefUsages || []; matchField = "typedefName"; break;
        case "variable": usages = info.variableUsages || []; matchField = "variableName"; break;
        case "constructor": usages = info.constructorUsages || []; matchField = "constructorName"; break;
        case "property": usages = info.propertyUsages || []; matchField = "propertyName"; break;
        case "annotation": usages = info.annotationUsages || []; matchField = "annotationName"; break;
        case "enum": usages = info.enumUsages || []; matchField = "enumName"; break;
        case "mixin": usages = info.mixinUsages || []; matchField = "mixinName"; break;
      }

      const usage = usages.find((u: any) => {
        if (type === "function" || type === "property") {
          return u[matchField] === name && u.className === (parentClass || null);
        }
        if (type === "constructor") {
          return u[matchField] === name && u.className === (parentClass || "");
        }
        return u[matchField] === name;
      });

      if (usage) results.push({ filePath, ...usage });
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
  }
);

server.registerTool(
  "flutter_set_project_path",
  {
    description: "Set the Flutter project root path for the MCP server",
    inputSchema: z.object({
      projectPath: z.string().optional().describe("Absolute path to the Flutter project root (directory containing pubspec.yaml, package.json, or .git)"),
      path: z.string().optional().describe("Alias for projectPath"),
    }),
  },
  async (args: { projectPath?: string; path?: string }) => {
    const targetPath = args.projectPath || args.path;
    if (!targetPath) {
      return { content: [{ type: "text" as const, text: "Error: Project path is required (provide projectPath or path)." }] };
    }

    const cleanPath = path.normalize(targetPath.trim().replace(/^['"]|['"]$/g, ''));
    const hasPubspec = fs.existsSync(path.join(cleanPath, "pubspec.yaml"));
    const hasGit = fs.existsSync(path.join(cleanPath, ".git"));
    const hasPackageJson = fs.existsSync(path.join(cleanPath, "package.json"));
    const hasGradle = fs.existsSync(path.join(cleanPath, "build.gradle")) ||
      fs.existsSync(path.join(cleanPath, "build.gradle.kts")) ||
      fs.existsSync(path.join(cleanPath, "settings.gradle")) ||
      fs.existsSync(path.join(cleanPath, "settings.gradle.kts"));

    if (!hasPubspec && !hasGit && !hasPackageJson && !hasGradle) {
      return { content: [{ type: "text" as const, text: `Error: No Flutter project (pubspec.yaml), JS/TS project (package.json), Android project (build.gradle/settings.gradle), or repository root (.git) found in: ${cleanPath}` }] };
    }

    currentProjectPath = cleanPath;
    sqliteCache = null; // Force re-initialization with new path
    packageResolver = null;
    if (vmServiceBridge) {
      vmServiceBridge.disconnect();
      vmServiceBridge = null;
    }

    // Persist to ~/.gemini/active-project.txt so it survives MCP server restarts
    try {
      const geminiDir = path.join(os.homedir(), '.gemini');
      if (!fs.existsSync(geminiDir)) {
        fs.mkdirSync(geminiDir, { recursive: true });
      }
      fs.writeFileSync(path.join(geminiDir, 'active-project.txt'), cleanPath, 'utf-8');
    } catch {
      // ignore persistence error
    }

    return { content: [{ type: "text" as const, text: `Project path set to: ${cleanPath}` }] };
  }
);

server.registerTool(
  "flutter_get_project_path",
  {
    description: "Get the current Flutter project root path",
    inputSchema: z.object({}),
  },
  async () => {
    return { content: [{ type: "text" as const, text: `Current project path: ${currentProjectPath}` }] };
  }
);

server.registerTool(
  "flutter_get_node_at_cursor",
  {
    description: "Find the Dart element (class/function) at a specific cursor position in a file.",
    inputSchema: z.object({
      relativePath: z.string().describe("Relative path of the file"),
      line: z.number().describe("Line number (1-indexed)"),
    }),
  },
  async ({ relativePath, line }) => {
    const cache = getSqliteCache();
    const node = await cache.getNodeAtCursor(relativePath, line);
    if (!node) return { content: [{ type: "text" as const, text: "No specific Dart element found at this position." }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(node, null, 2) }] };
  }
);

server.registerTool(
  "flutter_list_packages",
  {
    description: "List all project dependencies from pubspec.lock",
    inputSchema: z.object({
      filter: z.enum(["direct", "dev", "transitive", "all"]).optional().describe("Filter by dependency type"),
      source: z.enum(["hosted", "git", "path", "all"]).optional().describe("Filter by source"),
    }),
  },
  async ({ filter = "all", source = "all" }) => {
    const index = await readIndex();
    if (!index || !index.packages) return await handleIndexError();

    let packages = index.packages;
    if (filter !== "all") packages = packages.filter((p: any) => p.dependencyType === filter);
    if (source !== "all") packages = packages.filter((p: any) => p.source === source);

    return { content: [{ type: "text" as const, text: JSON.stringify(packages, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_code_block",
  {
    description: "Get the full body of a class, function, or method including comments",
    inputSchema: z.object({
      elementType: z.enum(["class", "function", "method", "enum", "mixin", "extension"]).describe("Type of element to extract"),
      name: z.string().describe("Name of the class, function, or method"),
      filePath: z.string().optional().describe("Relative path to the file (optional, will search all files if not provided)"),
      relativePath: z.string().optional().describe("Alias for filePath"),
      path: z.string().optional().describe("Alias for filePath"),
      parentClass: z.string().optional().describe("Parent class name (optional, auto-detected if not provided)"),
    }),
  },
  async (args: {
    elementType: "class" | "function" | "method" | "enum" | "mixin" | "extension";
    name: string;
    filePath?: string;
    relativePath?: string;
    path?: string;
    parentClass?: string;
  }) => {
    const { elementType, name } = args;
    let parentClass = args.parentClass;
    const resolved = resolveFilePath(args);
    const index = await readIndex();
    if (!index || !index.dart) return { content: [{ type: "text", text: "Index not found." }] };

    let targetFile = resolved ? resolved.relative : (args.filePath || args.relativePath || args.path);

    // Auto-detect parentClass if not provided and targetFile is known
    if (targetFile && elementType === 'method' && !parentClass && index.dart) {
      const info = index.dart[targetFile] as DartFileInfo | undefined;
      if (info) {
        const cls = info.classes.find((c: ClassInfo) => c.methods.some(m => m.name === name));
        if (cls) parentClass = cls.name;
        else {
          const ext = (info.extensions || []).find((e: any) => e.methods?.some((m: any) => m.name === name));
          if (ext) parentClass = ext.name;
        }
      }
    }

    if (!targetFile) {
      for (const file in index.dart) {
        const info = index.dart[file] as DartFileInfo;
        let found = false;

        if (elementType === 'class') found = info.classes.some((c: ClassInfo) => c.name === name);
        else if (elementType === 'enum') found = (info.enums || []).some((e: any) => e.name === name);
        else if (elementType === 'mixin') found = (info.mixins || []).some((m: any) => m.name === name);
        else if (elementType === 'extension') found = (info.extensions || []).some((e: any) => e.name === name);
        else if (elementType === 'function') found = info.functions.some((f: FunctionInfo) => f.name === name && !f.parentClass);
        else if (elementType === 'method') {
          found = info.classes.some((c: ClassInfo) => c.methods.some(m => m.name === name && (!parentClass || c.name === parentClass))) ||
                  (info.extensions || []).some((e: any) => e.methods.some((m: any) => m.name === name && (!parentClass || e.name === parentClass))) ||
                  (info.extensionTypes || []).some((et: any) => et.methods.some((m: any) => m.name === name && (!parentClass || et.name === parentClass)));
        }

        if (found) { targetFile = file; break; }
      }
    }

    if (!targetFile) return { content: [{ type: "text" as const, text: `Element not found: ${elementType} ${name}` }] };

    const fullPath = path.join(currentProjectPath, targetFile);
    let targetContent = '';
    try {
      targetContent = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error}` }] };
    }

    const existingParsed = index.dart[targetFile] as DartFileInfo | undefined;
    const parser = getParserForFile(targetFile);
    const result = parser.extractCodeBlock(targetContent, elementType, name, parentClass, existingParsed);

    if (!result) return { content: [{ type: "text" as const, text: `Could not extract code block for ${elementType} ${name}` }] };

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ elementType, name, filePath: targetFile, startLine: result.startLine, endLine: result.endLine, comments: result.comments, body: result.body }, null, 2)
      }],
    };
  }
);

server.registerTool(
  "flutter_analyze_logic_flow",
  {
    description: "Analyze a function's logic and return a summarized flow of steps",
    inputSchema: z.object({
      functionName: z.string().describe("Name of the function to analyze"),
      filePath: z.string().optional().describe("Relative path to the file (optional, will search if not provided)"),
      relativePath: z.string().optional().describe("Alias for filePath"),
      path: z.string().optional().describe("Alias for filePath"),
      parentClass: z.string().optional().describe("Parent class name (required for methods)"),
    }),
  },
  async (args: { functionName: string; filePath?: string; relativePath?: string; path?: string; parentClass?: string }) => {
    const { functionName, parentClass } = args;
    const resolved = resolveFilePath(args);
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    let targetFile = resolved ? resolved.relative : (args.filePath || args.relativePath || args.path);
    let resolvedParentClass = parentClass;

    if (!targetFile) {
      for (const file in index.dart) {
        const info = index.dart[file] as DartFileInfo;
        let found = false;
        
        if (!resolvedParentClass) {
          found = info.functions.some((f: FunctionInfo) => f.name === functionName);
        }
        
        if (!found) {
          for (const c of info.classes) {
            if (c.methods.some(m => m.name === functionName && (!resolvedParentClass || c.name === resolvedParentClass))) {
              found = true;
              resolvedParentClass = c.name;
              break;
            }
          }
        }
        if (!found) {
          for (const e of (info.extensions || [])) {
            if (e.methods.some((m: any) => m.name === functionName && (!resolvedParentClass || e.name === resolvedParentClass))) {
              found = true;
              resolvedParentClass = e.name;
              break;
            }
          }
        }
        if (!found) {
          for (const et of (info.extensionTypes || [])) {
            if (et.methods.some((m: any) => m.name === functionName && (!resolvedParentClass || et.name === resolvedParentClass))) {
              found = true;
              resolvedParentClass = et.name;
              break;
            }
          }
        }
        if (found) { targetFile = file; break; }
      }
    }

    if (!targetFile) return { content: [{ type: "text" as const, text: `Function not found: ${functionName}` }] };

    const fullPath = path.join(currentProjectPath, targetFile);
    let targetContent = '';
    try {
      targetContent = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error}` }] };
    }

    const elementType = resolvedParentClass ? 'method' : 'function';
    const existingParsed = index.dart[targetFile] as DartFileInfo | undefined;
    const parser = getParserForFile(targetFile);
    const result = parser.extractCodeBlock(targetContent, elementType, functionName, resolvedParentClass, existingParsed);

    if (!result) return { content: [{ type: "text" as const, text: `Could not extract function body for ${functionName}` }] };

    const logicSteps = analyzer.analyzeLogicFlow(result.body);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          functionName, filePath: targetFile, startLine: result.startLine, endLine: result.endLine, logicSteps,
          summary: logicSteps.length > 0
            ? `Function has ${logicSteps.length} logical steps: ` + logicSteps.map((s: any) => s.description).join(', ')
            : 'No clear logical steps detected'
        }, null, 2)
      }],
    };
  }
);

server.registerTool(
  "flutter_get_dependencies",
  {
    description: "Get the dependencies (repositories, services, etc.) that a class depends on from its constructor",
    inputSchema: z.object({
      className: z.string().describe("Name of the class"),
      filePath: z.string().optional().describe("Relative path to the file (optional, will search if not provided)"),
    }),
  },
  async ({ className, filePath }: { className: string; filePath?: string }) => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    let targetFile = filePath;

    if (!targetFile) {
      for (const file in index.dart) {
        const info = index.dart[file] as DartFileInfo;
        if (info.classes.some((c: ClassInfo) => c.name === className)) { targetFile = file; break; }
      }
    }

    if (!targetFile) return { content: [{ type: "text" as const, text: `Class not found: ${className}` }] };

    const fullPath = path.join(currentProjectPath, targetFile);
    let targetContent = '';
    try {
      targetContent = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error}` }] };
    }

    const existingParsed = index.dart[targetFile] as DartFileInfo | undefined;
    const parser = getParserForFile(targetFile);
    const result = parser.extractCodeBlock(targetContent, 'class', className, undefined, existingParsed);
    if (!result) return { content: [{ type: "text" as const, text: `Could not extract class body for ${className}` }] };

    // Resolve project name from pubspec.yaml if possible
    let projectName: string | null = null;
    try {
      const pubspecContent = fs.readFileSync(PUBSPEC_PATH(), 'utf-8');
      const nameMatch = pubspecContent.match(/^name:\s*([a-zA-Z0-9_\-]+)/m);
      if (nameMatch) {
        projectName = nameMatch[1].trim();
      }
    } catch (e) {
      // ignore
    }



    const resolveJsTsAndroidImportPath = (fromFile: string, importPath: string): string | null => {
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        return null;
      }
      const dir = path.dirname(fromFile);
      const joined = path.posix.normalize(path.posix.join(dir.replace(/\\/g, '/'), importPath));
      for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.kt', '.java']) {
        const testPath = joined + ext;
        if (fs.existsSync(path.join(currentProjectPath, testPath)) && !fs.statSync(path.join(currentProjectPath, testPath)).isDirectory()) {
          return testPath;
        }
      }
      return null;
    };

    const isJsTsOrAndroid = targetFile.endsWith('.ts') || targetFile.endsWith('.tsx') || targetFile.endsWith('.js') || targetFile.endsWith('.jsx') || targetFile.endsWith('.kt') || targetFile.endsWith('.java');
    const dependencies = analyzer.extractConstructorDependencies(result.body);
    const importDependencies: string[] = [];
    
    const imports: { path: string; line: number }[] = [];
    if (existingParsed?.imports && existingParsed.imports.length > 0) {
      for (const imp of existingParsed.imports) {
        imports.push({ path: imp.path, line: imp.line });
      }
    } else {
      const lines = targetContent.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const importMatch = line.match(/import\s+['"]([^'"]+)['"]/) || line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
        if (importMatch) {
          imports.push({ path: importMatch[1], line: i + 1 });
        }
      }
    }

    for (const imp of imports) {
      const lowerPath = imp.path.toLowerCase();
      let isMatching = false;

      if (isJsTsOrAndroid) {
        isMatching = true;
      } else {
        const resolvedPath = resolveImportPath(imp.path, targetFile, index);
        const importedFileInfo = index.dart[resolvedPath] as DartFileInfo | undefined;

        if (importedFileInfo) {
          isMatching = importedFileInfo.classes.some(c => dependencies.includes(c.name));
        }
        
        if (!isMatching) {
          isMatching = dependencies.some(dep => {
            const depLower = dep.toLowerCase();
            return lowerPath.includes(depLower) || lowerPath.includes(depLower.replace('service', '').replace('repository', ''));
          });
        }

        if (!isMatching) {
          isMatching = [
            'repository', 'service', 'provider', 'usecase', 'datasource',
            'notifier', 'bloc', 'controller', 'helper', 'api'
          ].some(keyword => lowerPath.includes(keyword));
        }
      }

      if (isMatching) {
        importDependencies.push(imp.path);
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ className, filePath: targetFile, constructorDependencies: dependencies, importDependencies, totalDependencies: dependencies.length + importDependencies.length }, null, 2)
      }],
    };
  }
);

server.registerTool(
  "flutter_read_fragment",
  {
    description: "Read a code fragment by element name (class, function, method) with surrounding comments",
    inputSchema: z.object({
      name: z.string().describe("Name of the element to read"),
      elementType: z.enum(["class", "function", "method"]).optional().describe("Type of element (auto-detected if not provided)"),
      filePath: z.string().optional().describe("Relative path to the file (optional, will search if not provided)"),
      relativePath: z.string().optional().describe("Alias for filePath"),
      path: z.string().optional().describe("Alias for filePath"),
      parentClass: z.string().optional().describe("Parent class name (optional, auto-detected if not provided)"),
      includeContext: z.boolean().optional().describe("Include surrounding context lines (default: false)"),
      contextLines: z.number().optional().describe("Number of context lines before/after (default: 3)"),
    }),
  },
  async (args: {
    name: string;
    elementType?: "class" | "function" | "method";
    filePath?: string;
    relativePath?: string;
    path?: string;
    parentClass?: string;
    includeContext?: boolean;
    contextLines?: number;
  }) => {
    const { name, elementType } = args;
    const includeContext = args.includeContext ?? false;
    const contextLines = args.contextLines ?? 3;
    let parentClass = args.parentClass;
    const resolved = resolveFilePath(args);

    const index = await readIndex();
    if (!index || !index.dart) return { content: [{ type: "text", text: "Index not found." }] };

    let targetFile = resolved ? resolved.relative : (args.filePath || args.relativePath || args.path);
    let detectedType = elementType;

    // Auto-detect type and parentClass if targetFile is provided
    if (targetFile && index.dart) {
      const info = index.dart[targetFile] as DartFileInfo | undefined;
      if (info) {
        if (!detectedType) {
          if (info.classes.some((c: ClassInfo) => c.name === name)) detectedType = 'class';
          else if (info.functions.some((f: FunctionInfo) => f.name === name && !f.parentClass)) detectedType = 'function';
          else {
            const matchClass = info.classes.find((c: ClassInfo) => c.methods.some(m => m.name === name));
            if (matchClass) {
              detectedType = 'method';
              if (!parentClass) parentClass = matchClass.name;
            } else {
              const matchExt = (info.extensions || []).find((e: any) => e.methods?.some((m: any) => m.name === name));
              if (matchExt) {
                detectedType = 'method';
                if (!parentClass) parentClass = matchExt.name;
              }
            }
          }
        } else if (detectedType === 'method' && !parentClass) {
          const matchClass = info.classes.find((c: ClassInfo) => c.methods.some(m => m.name === name));
          if (matchClass) parentClass = matchClass.name;
        }
      }
    }

    if (!targetFile) {
      for (const file in index.dart) {
        const info = index.dart[file] as DartFileInfo;

        if (!detectedType) {
          if (info.classes.some((c: ClassInfo) => c.name === name)) detectedType = 'class';
          else if (info.functions.some((f: FunctionInfo) => f.name === name && !f.parentClass)) detectedType = 'function';
          else if (info.classes.some((c: ClassInfo) => c.methods.some(m => m.name === name))) detectedType = 'method';
          else if ((info.extensions || []).some((e: any) => e.methods.some((m: any) => m.name === name))) detectedType = 'method';
          else if ((info.extensionTypes || []).some((et: any) => et.methods.some((m: any) => m.name === name))) detectedType = 'method';
        }

        let found = false;
        if (detectedType === 'class') found = info.classes.some((c: ClassInfo) => c.name === name);
        else if (detectedType === 'function') found = info.functions.some((f: FunctionInfo) => f.name === name && !f.parentClass);
        else if (detectedType === 'method') {
          found = info.classes.some((c: ClassInfo) => c.methods.some(m => m.name === name && (!parentClass || c.name === parentClass))) ||
                  (info.extensions || []).some((e: any) => e.methods.some((m: any) => m.name === name && (!parentClass || e.name === parentClass))) ||
                  (info.extensionTypes || []).some((et: any) => et.methods.some((m: any) => m.name === name && (!parentClass || et.name === parentClass)));
        }

        if (found) { targetFile = file; break; }
      }
    }

    if (!targetFile) return { content: [{ type: "text" as const, text: `Element not found: ${name}` }] };

    const fullPath = path.join(currentProjectPath, targetFile);
    let targetContent = '';
    try {
      targetContent = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error}` }] };
    }

    const existingParsed = index.dart[targetFile] as DartFileInfo | undefined;
    const parser = getParserForFile(targetFile);
    const result = parser.extractCodeBlock(targetContent, detectedType || 'function', name, parentClass, existingParsed);

    if (!result) return { content: [{ type: "text" as const, text: `Could not extract code block for ${name}` }] };

    let finalBody = result.body;
    if (includeContext) {
      const lines = targetContent.split('\n');
      const contextStart = Math.max(0, result.startLine - 1 - contextLines);
      const contextEnd = Math.min(lines.length, result.endLine + contextLines);
      finalBody = lines.slice(contextStart, contextEnd).join('\n');
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ name, elementType: detectedType, filePath: targetFile, startLine: result.startLine, endLine: result.endLine, comments: result.comments, body: finalBody, hasContext: includeContext }, null, 2)
      }],
    };
  }
);

server.registerTool(
  "flutter_search_text",
  {
    description: "Search for specific text, strings, or comments across all Dart files",
    inputSchema: z.object({
      query: z.string().describe("The text or regex to search for"),
      isRegex: z.boolean().optional().describe("Whether to treat query as a regular expression (default: auto-detected if query contains regex tokens like '|' or true)"),
      caseInsensitive: z.boolean().optional().describe("Whether the search should be case-insensitive (default: true)"),
      includeComments: z.boolean().optional().describe("Whether to include comments in the search (default: true)"),
      includeStrings: z.boolean().optional().describe("Whether to include string literals in the search (default: true)"),
    }),
  },
  async (options: { query: string; isRegex?: boolean; caseInsensitive?: boolean; includeComments?: boolean; includeStrings?: boolean }) => {
    const directSearch = new DirectSearch(currentProjectPath);
    const results = directSearch.searchText(options.query, options);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ results, totalResults: results.length, query: options.query }, null, 2)
      }],
    };
  }
);

server.registerTool(
  "flutter_get_index_status",
  {
    description: "Check the status and last update time of the project index",
    inputSchema: z.object({}),
  },
  async () => {
    const dbPath = ProjectDetector.getDbPath(currentProjectPath);
    const dataDir = ProjectDetector.getDataDir(currentProjectPath);
    const jsonPath = path.join(dataDir, 'flutter-explorer.json');
    const legacyJsonPath = path.join(currentProjectPath, '.vscode', 'flutter-explorer.json');

    const dbExists = fs.existsSync(dbPath);
    const jsonExists = fs.existsSync(jsonPath) || fs.existsSync(legacyJsonPath);

    if (!dbExists && !jsonExists) {
      return { content: [{ type: "text" as const, text: `Index not found. DB: ${dbPath}, JSON: not found.` }] };
    }

    try {
      const index = await readIndex();
      const fileCount = index ? Object.keys(index.dart || {}).length : 0;

      // ✅ إظهار مصدر البيانات الفعلي
      const cache = getSqliteCache();
      const dartRows = cache.isAvailable ? await cache.getAllDartFiles() : [];
      const source = dartRows.length > 0 ? 'SQLite' : (jsonExists ? 'JSON fallback' : 'empty');

      const dbStats = dbExists ? fs.statSync(dbPath) : null;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            source,
            indexedFiles: fileCount,
            sqlite: { exists: dbExists, path: dbPath, lastModified: dbStats?.mtime, sizeBytes: dbStats?.size },
            jsonFallback: { exists: jsonExists, path: fs.existsSync(jsonPath) ? jsonPath : legacyJsonPath }
          }, null, 2)
        }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Error checking index status: ${error}` }] };
    }
  }
);

server.registerTool(
  "flutter_get_detailed_graph",
  {
    description: "Get a detailed relationship graph (inheritance, calls, imports) for the project or a specific file",
    inputSchema: z.object({
      focusFile: z.string().optional().describe("Optional: focus the graph on a specific file and its direct neighbors"),
      depth: z.number().optional().describe("Traversal depth (default: 1)"),
    }),
  },
  async ({ focusFile, depth = 1 }) => {
    const index = await readIndex();
    if (!index) return await handleIndexError();

    const graph = buildDetailedGraph(index);

    if (focusFile) {
      const neighbors = new Set<string>([focusFile]);
      let currentFrontier = new Set<string>([focusFile]);

      for (let i = 0; i < depth; i++) {
        const nextFrontier = new Set<string>();
        for (const edge of graph.edges) {
          if (currentFrontier.has(edge.source)) { neighbors.add(edge.target); nextFrontier.add(edge.target); }
          if (currentFrontier.has(edge.target)) { neighbors.add(edge.source); nextFrontier.add(edge.source); }
        }
        currentFrontier = nextFrontier;
      }

      graph.nodes = graph.nodes.filter(n => neighbors.has(n.id) || neighbors.has(n.name));
      graph.edges = graph.edges.filter(e => neighbors.has(e.source) && neighbors.has(e.target));
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ nodeCount: graph.nodes.length, edgeCount: graph.edges.length, graph }, null, 2)
      }],
    };
  }
);

server.registerTool(
  "flutter_get_hints",
  {
    description: "Get context-aware suggestions for the next steps based on recent analysis",
    inputSchema: z.object({
      lastToolUsed: z.string().describe("The name of the tool that was just called"),
      lastResult: z.any().optional().describe("The result of the last tool call"),
    }),
  },
  async ({ lastToolUsed, lastResult }) => {
    const hints: any[] = [];

    switch (lastToolUsed) {
      case "flutter_search":
        hints.push({ tool: "flutter_get_code_block", reason: "Read the full body of a found element" });
        hints.push({ tool: "flutter_get_detailed_graph", reason: "See how this element fits into the architecture" });
        break;
      case "flutter_get_code_block":
        hints.push({ tool: "flutter_analyze_logic_flow", reason: "Understand the logical steps inside this code" });
        hints.push({ tool: "flutter_get_impact_analysis", reason: "Check what might break if you change this code" });
        break;
      case "flutter_get_impact_analysis":
        hints.push({ tool: "flutter_get_reverse_deps", reason: "Find all places that depend on this file" });
        break;
      case "flutter_get_missing_translations":
        hints.push({ tool: "flutter_update_translation", reason: "Fix a missing translation key" });
        break;
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ suggestions: hints, note: "These hints are generated based on common development workflows." }, null, 2)
      }],
    };
  }
);

server.registerTool(
  "flutter_read_lines",
  {
    description: "Read a specific range of lines from any file in the project with 1-based line numbers. Highly recommended for inspecting code around errors or reviewing large files without token bloat.",
    inputSchema: z.object({
      filePath: z.string().optional().describe("Path to the file (relative or absolute)"),
      relativePath: z.string().optional().describe("Alias for filePath"),
      path: z.string().optional().describe("Alias for filePath"),
      startLine: z.number().optional().describe("Starting line number (1-indexed, inclusive, default: 1)"),
      endLine: z.number().optional().describe("Ending line number (1-indexed, inclusive, default: startLine + 100)"),
      maxLines: z.number().optional().describe("Maximum lines to return (default: 300, max: 800)"),
    }),
  },
  async (args: {
    filePath?: string;
    relativePath?: string;
    path?: string;
    startLine?: number;
    endLine?: number;
    maxLines?: number;
  }) => {
    const resolved = resolveFilePath(args);
    if (!resolved) {
      return { content: [{ type: "text" as const, text: "Error: File path is required (filePath, relativePath, or path)." }] };
    }

    const fullPath = resolved.absolute;
    if (!fs.existsSync(fullPath)) {
      return { content: [{ type: "text" as const, text: `Error: File not found: ${resolved.relative} (resolved: ${fullPath})` }] };
    }

    let fileContent = "";
    try {
      fileContent = fs.readFileSync(fullPath, "utf-8");
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error reading file: ${e?.message || e}` }] };
    }

    const lines = fileContent.split("\n");
    const totalLines = lines.length;

    const start = Math.max(1, Math.min(totalLines, args.startLine ?? 1));
    const capMax = Math.min(800, Math.max(1, args.maxLines ?? 300));
    const defaultEnd = Math.min(totalLines, start + 100 - 1);
    let end = Math.max(start, Math.min(totalLines, args.endLine ?? defaultEnd));

    if (end - start + 1 > capMax) {
      end = start + capMax - 1;
    }

    const sliced = lines.slice(start - 1, end);
    const numbered = sliced.map((line, idx) => `${start + idx}: ${line}`).join("\n");
    const header = `File: ${resolved.relative} (Lines ${start}-${end} of ${totalLines}):\n\n`;

    return {
      content: [{
        type: "text" as const,
        text: header + numbered,
      }],
    };
  }
);

let isAnalyzeRunning = false;
server.registerTool(
  "flutter_run_analyze",
  {
    description: "Run compiler checks or linters on the current project based on its detected type (Flutter, TS/JS, Android), optionally targeting a specific file or directory.",
    inputSchema: z.object({
      targetPath: z.string().optional().describe("Optional relative or absolute path to a specific file or folder to analyze (e.g. lib/features/posts)"),
      filePath: z.string().optional().describe("Alias for targetPath"),
      path: z.string().optional().describe("Alias for targetPath"),
    }),
  },
  async (analyzeArgs?: { targetPath?: string; filePath?: string; path?: string }) => {
    if (isAnalyzeRunning) {
      return { content: [{ type: "text", text: "Another analysis is already running. Please wait." }] };
    }
    
    isAnalyzeRunning = true;
    try {
      const projectType = ProjectDetector.getProjectType(currentProjectPath);
      const target = analyzeArgs?.targetPath || analyzeArgs?.filePath || analyzeArgs?.path;
      const result = await runProjectAnalysis(currentProjectPath, projectType, target);
      if (!result.ok) {
        return { content: [{ type: "text", text: result.error }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result.report, null, 2)
        }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to run analyzer: ${error}` }] };
    } finally {
      isAnalyzeRunning = false;
    }
  }
);

let isBuildRunnerRunning = false;
server.registerTool(
  "flutter_run_build_runner",
  {
    description: "Run 'dart run build_runner build --delete-conflicting-outputs' to generate code for Freezed, Riverpod, etc.",
    inputSchema: z.object({}),
  },
  async () => {
    if (isBuildRunnerRunning) {
      return { content: [{ type: "text", text: "Another build_runner process is already running. Please wait." }] };
    }

    isBuildRunnerRunning = true;
    try {
      const result = await runBuildRunner(currentProjectPath);
      if (!result.ok) {
        return { content: [{ type: "text", text: result.error }] };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result.report, null, 2)
        }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to run build_runner: ${error}` }] };
    } finally {
      isBuildRunnerRunning = false;
    }
  }
);

server.registerTool(
  "flutter_find_references",
  {
    description: "Find all usages/references of a class, function, variable, enum, mixin, extension, or typedef in the project.",
    inputSchema: z.object({
      name: z.string().describe("The name of the element to find references for (e.g. 'AuthService')"),
      type: z.enum(["class", "function", "variable", "enum", "mixin", "extension", "typedef"]).describe("The type of the element"),
    }),
  },
  async ({ name, type }: { name: string; type: "class" | "function" | "variable" | "enum" | "mixin" | "extension" | "typedef" }) => {
    const index = await readIndex();
    if (!index || !index.dart) return { content: [{ type: "text", text: "Index not found." }] };

    const references: any[] = [];
    const nameLower = name.toLowerCase();
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const symbolRegex = new RegExp(`\\b${escapedName}\\b`);

    for (const [file, info] of Object.entries(index.dart as Record<string, DartFileInfo>)) {
      if (info.functionCalls) {
        for (const call of info.functionCalls) {
          if (type === "function" && (call.name.toLowerCase() === nameLower || call.name.toLowerCase().endsWith("." + nameLower))) {
            references.push({
              file,
              line: call.line,
              context: call.context,
              caller: call.callerClass ? `${call.callerClass}.${call.callerFunction}` : call.callerFunction || "top-level",
              kind: "call"
            });
          }
          else if (type === "class" && (call.receiver?.toLowerCase() === nameLower || call.name.toLowerCase() === nameLower || call.name.toLowerCase().startsWith(nameLower + "."))) {
            references.push({
              file,
              line: call.line,
              context: call.context,
              caller: call.callerClass ? `${call.callerClass}.${call.callerFunction}` : call.callerFunction || "top-level",
              kind: "instantiation_or_access"
            });
          }
        }
      }

      if (type === "class") {
        for (const cls of info.classes || []) {
          if (cls.extendsClass?.toLowerCase() === nameLower) {
            references.push({
              file,
              line: cls.line,
              context: `class ${cls.name} extends ${cls.extendsClass}`,
              caller: cls.name,
              kind: "extends"
            });
          }
          if (cls.implements?.some(impl => impl.toLowerCase() === nameLower)) {
            references.push({
              file,
              line: cls.line,
              context: `class ${cls.name} implements ... ${name} ...`,
              caller: cls.name,
              kind: "implements"
            });
          }
          if (cls.mixins?.some(mx => mx.toLowerCase() === nameLower)) {
            references.push({
              file,
              line: cls.line,
              context: `class ${cls.name} with ... ${name} ...`,
              caller: cls.name,
              kind: "mixin"
            });
          }
        }
      }
    }

    // ─── Phase 2: Collect usedInFiles from index for targeted scan ──────────
    const indexBasedFiles = new Set<string>();
    for (const [, info] of Object.entries(index.dart as Record<string, DartFileInfo>)) {
      let usedInFiles: string[] | undefined;
      if (type === "class") {
        usedInFiles = info.classUsages?.find(u => u.className.toLowerCase() === nameLower)?.usedInFiles;
      } else if (type === "function") {
        usedInFiles = info.functionUsages?.find(u => u.functionName.toLowerCase() === nameLower)?.calledInFiles;
      } else if (type === "extension") {
        usedInFiles = info.extensionUsages?.find(u => u.extensionName.toLowerCase() === nameLower)?.usedInFiles;
      } else if (type === "typedef") {
        usedInFiles = info.typedefUsages?.find(u => u.typedefName.toLowerCase() === nameLower)?.usedInFiles;
      } else if (type === "variable") {
        usedInFiles = info.variableUsages?.find(u => u.variableName.toLowerCase() === nameLower)?.usedInFiles;
      } else if (type === "enum") {
        usedInFiles = info.enumUsages?.find(u => u.enumName.toLowerCase() === nameLower)?.usedInFiles;
      } else if (type === "mixin") {
        usedInFiles = info.mixinUsages?.find(u => u.mixinName.toLowerCase() === nameLower)?.usedInFiles;
      }
      if (usedInFiles) { for (const f of usedInFiles) indexBasedFiles.add(f); }
    }

    // ─── Phase 2 & 3: File-content regex scan ────────────────────────────────
    const allIndexedFiles = Object.keys(index.dart as Record<string, DartFileInfo>);
    // Scan targeted files first; if index gave no usedInFiles, scan everything
    const primaryScan = indexBasedFiles.size > 0 ? [...indexBasedFiles] : allIndexedFiles;

    const scanFile = (uFile: string) => {
      const uFilePath = path.join(currentProjectPath, uFile);
      try {
        if (!fs.existsSync(uFilePath)) return;
        const content = fs.readFileSync(uFilePath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lineContent = lines[i];
          if (!symbolRegex.test(lineContent)) continue;
          const trimmed = lineContent.trim();
          if (trimmed.startsWith('import ')) continue;
          if (trimmed.startsWith('export ')) continue;
          if (!references.some(r => r.file === uFile && r.line === i + 1)) {
            references.push({
              file: uFile,
              line: i + 1,
              context: trimmed.length > 200 ? trimmed.substring(0, 200) + '\u2026' : trimmed,
              caller: "scan",
              kind: "usage"
            });
          }
        }
      } catch { /* skip unreadable */ }
    };

    for (const f of primaryScan) scanFile(f);

    // Phase 3: If still no results, scan remaining files not yet scanned
    if (references.length === 0) {
      const scanned = new Set(primaryScan);
      for (const f of allIndexedFiles) { if (!scanned.has(f)) scanFile(f); }
    }

    // Sort by file then line
    references.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ name, type, referencesCount: references.length, references }, null, 2)
      }],
    };
  }
);

// --- Intl and Reindex Commands ---

server.registerTool("flutter_run_intl_generate", {
  description: "Manually trigger Intl generation (l10n.dart, messages_*.dart) via the built-in IntlGenerator. This will read the ARB files and write the generated Dart files.",
  inputSchema: z.object({})
}, async () => {
  try {
    const { IntlGenerator } = await import('./indexer/intlGenerator');
    const generator = new IntlGenerator(currentProjectPath);
    if (!generator.isEnabled()) {
      return { content: [{ type: "text", text: "Flutter Intl is not enabled in pubspec.yaml." }] };
    }
    const generated = generator.generate();
    return { content: [{ type: "text", text: `Generated ${generated.length} files:\n${generated.join('\n')}` }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error generating Intl: ${error.message}` }], isError: true };
  }
});

server.registerTool("flutter_rebuild_index", {
  description: "Manually trigger a full re-index of the Flutter project by the VS Code extension.",
  inputSchema: z.object({})
}, async () => {
  try {
    const triggerFile = path.join(currentProjectPath, '.vscode', '.flutter-explorer-trigger');
    fs.mkdirSync(path.dirname(triggerFile), { recursive: true });
    fs.writeFileSync(triggerFile, Date.now().toString());
    return { content: [{ type: "text", text: "Triggered full re-index in VS Code. The extension will now rebuild the index." }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error triggering re-index: ${error.message}` }], isError: true };
  }
});

// ─── External Package & Flutter SDK Exploration Tools ─────────────────────────

server.registerTool(
  "flutter_search_packages",
  {
    description: "Search across all cached third-party Dart/Flutter package dependencies in .pub-cache or Flutter SDK (similar to rip_grep_packages).",
    inputSchema: z.object({
      query: z.string().describe("Search term or regex pattern"),
      packageName: z.string().optional().describe("Optional package name to limit search (e.g. 'dio' or 'flutter')"),
      isRegex: z.boolean().optional().describe("Whether query is a regex (default: false)"),
      caseSensitive: z.boolean().optional().describe("Case-sensitive match (default: false)"),
      maxResults: z.number().optional().describe("Max number of matches to return (default: 50)")
    }),
  },
  async ({ query, packageName, isRegex, caseSensitive, maxResults }) => {
    try {
      const resolver = getPackageResolver();
      const results = resolver.searchInPackages(query, { packageName, isRegex, caseSensitive, maxResults });
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error searching packages: ${error.message}` }], isError: true };
    }
  }
);

server.registerTool(
  "flutter_read_package_source",
  {
    description: "Read the source code of any cached third-party package or Flutter SDK library by package URI (e.g. package:flutter/material.dart or package:dio/dio.dart).",
    inputSchema: z.object({
      uri: z.string().describe("Package URI (e.g. package:flutter/widgets.dart or package:provider/provider.dart)"),
      startLine: z.number().optional().describe("Starting line number (1-based, default: 1)"),
      lineCount: z.number().optional().describe("Number of lines to read (default: 100)")
    }),
  },
  async ({ uri, startLine, lineCount }) => {
    try {
      const resolver = getPackageResolver();
      const result = resolver.readPackageSource(uri, startLine, lineCount);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error reading package source: ${error.message}` }], isError: true };
    }
  }
);

server.registerTool(
  "flutter_pub_dev_search",
  {
    description: "Live search for packages on pub.dev to discover libraries, popularity, descriptions, and latest versions.",
    inputSchema: z.object({
      query: z.string().describe("Search query for pub.dev (e.g. 'state management' or 'sqlite')"),
      page: z.number().optional().describe("Page number (default: 1)")
    }),
  },
  async ({ query, page }) => {
    try {
      const resolver = getPackageResolver();
      const result = await resolver.searchPubDev(query, page);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error querying pub.dev: ${error.message}` }], isError: true };
    }
  }
);

server.registerTool(
  "flutter_get_pub_package_info",
  {
    description: "Get detailed metrics for a package from pub.dev, including pub points, popularity score, likes, description, and repository.",
    inputSchema: z.object({
      packageName: z.string().describe("Package name on pub.dev (e.g. 'riverpod' or 'dio')")
    }),
  },
  async ({ packageName }) => {
    try {
      const resolver = getPackageResolver();
      const result = await resolver.getPubPackageInfo(packageName);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error fetching package info: ${error.message}` }], isError: true };
    }
  }
);

// ─── Live Runtime Bridge Tools (VM Service) ─────────────────────────────────

server.registerTool(
  "flutter_hot_reload",
  {
    description: "Trigger Hot Reload (ext.flutter.reassemble) on the running Flutter app via the Dart VM Service.",
    inputSchema: z.object({
      vmServiceUri: z.string().optional().describe("Optional WebSocket VM Service URI. If omitted, automatically discovered.")
    }),
  },
  async ({ vmServiceUri }) => {
    const bridge = getVmServiceBridge();
    const result = await bridge.hotReload(vmServiceUri);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_hot_restart",
  {
    description: "Trigger a full Hot Restart on the running Flutter application via the Dart VM Service.",
    inputSchema: z.object({
      vmServiceUri: z.string().optional().describe("Optional WebSocket VM Service URI. If omitted, automatically discovered.")
    }),
  },
  async ({ vmServiceUri }) => {
    const bridge = getVmServiceBridge();
    const result = await bridge.hotRestart(vmServiceUri);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_runtime_errors",
  {
    description: "Fetch real-time Flutter runtime errors, uncaught exceptions, and stderr logs from the running application.",
    inputSchema: z.object({
      vmServiceUri: z.string().optional().describe("Optional WebSocket VM Service URI. If omitted, automatically discovered.")
    }),
  },
  async ({ vmServiceUri }) => {
    const bridge = getVmServiceBridge();
    const result = await bridge.getRuntimeErrors(vmServiceUri);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_inspect_live_widgets",
  {
    description: "Inspect the live running widget tree and render objects of the active Flutter application.",
    inputSchema: z.object({
      vmServiceUri: z.string().optional().describe("Optional WebSocket VM Service URI. If omitted, automatically discovered."),
      objectGroup: z.string().optional().describe("Inspector object group name (default: 'flutter_explorer_group')")
    }),
  },
  async ({ vmServiceUri, objectGroup }) => {
    const bridge = getVmServiceBridge();
    const result = await bridge.inspectLiveWidgets(vmServiceUri, objectGroup);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── Advanced Localization Tools ─────────────────────────────────────────────

server.registerTool(
  "flutter_find_unused_translations",
  {
    description: "Scan all ARB translation keys and compare with lib/ code to find unused/dead translation keys.",
    inputSchema: z.object({}),
  },
  async () => {
    const arbEditor = new ArbEditor(currentProjectPath);
    const result = arbEditor.findUnusedTranslations();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_validate_icu_translations",
  {
    description: "Validate ICU syntax, placeholder consistency ({name}), and plural balance across all ARB translation files.",
    inputSchema: z.object({}),
  },
  async () => {
    const arbEditor = new ArbEditor(currentProjectPath);
    const result = arbEditor.validateIcuPlaceholders();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_auto_translate_missing",
  {
    description: "Generate structured translation payload for missing keys across locales, or batch apply translated keys.",
    inputSchema: z.object({
      action: z.enum(["generate_payload", "batch_apply"]).describe("Action to perform: generate_payload to get missing keys, or batch_apply to write translations"),
      sourceLocale: z.string().optional().describe("Base locale (default: 'en')"),
      translationsToApply: z.array(z.object({
        key: z.string(),
        translations: z.record(z.string(), z.string()),
        description: z.string().optional(),
        placeholders: z.record(z.string(), z.any()).optional()
      })).optional().describe("Translations to batch apply if action is 'batch_apply'")
    }),
  },
  async ({ action, sourceLocale, translationsToApply }) => {
    const arbEditor = new ArbEditor(currentProjectPath);
    if (action === "batch_apply") {
      if (!translationsToApply || translationsToApply.length === 0) {
        return { content: [{ type: "text" as const, text: "Error: translationsToApply array is required for batch_apply" }] };
      }
      const result = arbEditor.batchApplyTranslations(translationsToApply as any);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } else {
      const result = arbEditor.generateMissingTranslationsPayload(sourceLocale || "en");
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  }
);


// ─── Advanced Architectural & Static Analysis Tools ──────────────────────────

server.registerTool(
  "flutter_detect_circular_dependencies",
  {
    description: "Detect circular dependency cycles across project files (A -> B -> C -> A) to prevent architectural degradation.",
    inputSchema: z.object({}),
  },
  async () => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const result = analyzer.detectCircularDependencies(index);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_validate_architecture_rules",
  {
    description: "Validate layer boundary rules (e.g. Domain must not depend on Data/UI, Core must not depend on Features).",
    inputSchema: z.object({
      customRules: z.array(z.object({
        name: z.string(),
        fromLayer: z.string(),
        forbiddenLayers: z.array(z.string()),
        description: z.string()
      })).optional().describe("Optional custom layer boundary rules. If omitted, standard Clean Architecture rules are applied.")
    }),
  },
  async ({ customRules }) => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const result = analyzer.validateLayerBoundaries(index, customRules);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_detect_unused_assets",
  {
    description: "Scan pubspec.yaml asset directories and detect unused/unreferenced image, icon, or data assets.",
    inputSchema: z.object({}),
  },
  async () => {
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const result = analyzer.detectUnusedAssets();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_git_blast_radius",
  {
    description: "Automatically calculate blast radius and affected entry points/execution flows from current Git diff changes.",
    inputSchema: z.object({
      maxDepth: z.number().optional().describe("Max traversal depth (default: 25)")
    }),
  },
  async ({ maxDepth }) => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const result = analyzer.getGitDiffImpactAnalysis(index, maxDepth);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_analyze_widget_depth",
  {
    description: "Analyze widget hierarchy nesting depth across project files and detect excessive nesting exceeding thresholds (inspired by DCM widget-nesting-depth).",
    inputSchema: z.object({
      maxDepthThreshold: z.number().optional().describe("Maximum allowed nesting depth before raising a violation (default: 5)")
    }),
  },
  async ({ maxDepthThreshold }) => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const result = analyzer.analyzeWidgetDepth(index, maxDepthThreshold);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_detect_duplicate_widgets",
  {
    description: "Detect duplicate or near-identical widget subtrees across project files and generate proposals for extracting reusable custom widgets (inspired by DCM Duplicate Widget Analyzer).",
    inputSchema: z.object({
      minNodeCount: z.number().optional().describe("Minimum number of widgets in a subtree to consider for duplication (default: 3)")
    }),
  },
  async ({ minNodeCount }) => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const result = analyzer.detectDuplicateWidgets(index, minNodeCount);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_detect_memory_leaks",
  {
    description: "Detect potential memory leaks and undisposed controllers (TextEditingController, AnimationController, ScrollController, StreamSubscription, FocusNode, etc.) in State classes (inspired by leak_tracker & saropa_lints).",
    inputSchema: z.object({}),
  },
  async () => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const result = analyzer.detectMemoryLeaks(index);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_simulate_ui_action",
  {
    description: "Simulate user UI interactions (tap, enterText, scroll) on the live running Flutter app via VM Service (inspired by Marionette MCP & Flutter Driver).",
    inputSchema: z.object({
      action: z.enum(["tap", "enterText", "scroll"]).describe("Type of UI action to simulate"),
      target: z.string().describe("Target widget key, text, or identifier to interact with"),
      value: z.string().optional().describe("Text value to enter (for enterText) or scroll offset in pixels (for scroll, default: -300)"),
      vmUri: z.string().optional().describe("Optional VM Service URI override")
    }),
  },
  async ({ action, target, value, vmUri }) => {
    const bridge = getVmServiceBridge();
    const result = await bridge.simulateUiAction(action, target, value, vmUri);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "flutter_get_architectural_layers",
  {
    description: "Classify project files into Clean Architecture layers (Presentation, Domain, Data, Core), calculate Lakos coupling metrics (Ca, Ce, Instability), and detect cross-layer violations (inspired by Lakos Architecture Visualizer).",
    inputSchema: z.object({}),
  },
  async () => {
    const index = await readIndex();
    if (!index || !index.dart) return await handleIndexError();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    const result = analyzer.getArchitecturalLayers(index);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);


// Start the server
async function main() {
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
    net.setDefaultAutoSelectFamilyAttemptTimeout(1000);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.exit(1);
});