import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { DirectSearch } from './mcp-direct-search.js';
import { ArbEditor } from './mcp-arb-editor.js';
import { CodeAnalyzer } from './mcp-code-analyzer.js';
import { DartParser, DartFileInfo, ClassInfo, FunctionInfo } from './indexer/dartParser.js';



/**
 * Flutter Explorer MCP Server
 * Exposes indexed Dart/Flutter data to AI agents via stdio
 */

import { SqliteCache } from './indexer/sqliteCache.js';

// Current project path, defaults to environment variable or current working directory
let currentProjectPath = process.env.FLUTTER_PROJECT_PATH || process.cwd();
const PUBSPEC_PATH = () => path.join(currentProjectPath, "pubspec.yaml");

let sqliteCache: SqliteCache | null = null;

function getSqliteCache() {
  if (!sqliteCache) {
    sqliteCache = new SqliteCache(currentProjectPath);
  }
  return sqliteCache;
}

const server = new McpServer({
  name: "flutter-explorer-mcp",
  version: "1.0.0",
});

// Helper to read the index file (Prioritizes SQLite)
function readIndex() {
  try {
    const cache = getSqliteCache();
    if (cache.isAvailable) {
      const dartRows = cache.getAllDartFiles();
      const arbRows = cache.getAllArbFiles();
      
      if (dartRows.length > 0 || arbRows.length > 0) {
        const index: any = {
          dart: {},
          arb: {},
          packages: cache.getMeta<any[]>('packages') ?? [],
          diagnostics: cache.getMeta<any[]>('diagnostics') ?? []
        };

        for (const row of dartRows) index.dart[row.path] = row.info;
        for (const row of arbRows) index.arb[row.path] = row.translations;

        return index;
      }
    }
    return null;
  } catch (error) {
    console.error("Error reading index:", error);
  }
  return null;
}

// Helper to recursively get directory structure
function getDirectoryStructure(dirPath: string, relativePath: string = ""): any[] {
  const results: any[] = [];
  try {
    if (!fs.existsSync(dirPath)) return [];
    
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      // Skip hidden files and common ignore folders
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

// --- Tools ---

// 1. Search Tool
server.registerTool(
  "flutter_search",
  {
    description: "Search for classes, functions, widgets, and other Dart elements. Use flutter_get_code_block to get full function/class bodies.",

    inputSchema: z.object({
      query: z.string().describe("The search term (class name, function name, etc.)"),
      filter: z.enum(["class", "function", "widget", "enum", "mixin", "extension", "ext", "typedef", "type", "variable", "vars", "constructor", "property", "annotation", "file", "call", "translation"]).optional().describe("Filter by type (aliases: ext, type, vars)"),
      searchMode: z.enum(["definitions", "calls", "both"]).optional().describe("Search in definitions, calls, or both (default: both)"),
      useDirectSearch: z.boolean().optional().describe("Force direct file search even if index exists (default: false)"),
    }),
  },
  async ({ query, filter, searchMode = "both", useDirectSearch = false }: { 
    query: string; 
    filter?: "class" | "function" | "widget" | "enum" | "mixin" | "extension" | "ext" | "typedef" | "type" | "variable" | "vars" | "constructor" | "property" | "annotation" | "file" | "call" | "translation";
    searchMode?: "definitions" | "calls" | "both";
    useDirectSearch?: boolean;
  }) => {
    const index = readIndex();
    const results: any[] = [];
    const q = query.toLowerCase();
    const mode = searchMode || "both";
  
    // Normalize filter aliases
    let normalizedFilter = filter;
    if (filter === "ext") normalizedFilter = "extension";
    else if (filter === "type") normalizedFilter = "typedef";
    else if (filter === "vars") normalizedFilter = "variable";
    else if (filter === "call") normalizedFilter = "function"; // calls are handled in function block
    
    const targetFilter = normalizedFilter;
  
    // Try indexed search first  
    if (index && !useDirectSearch) {
      for (const file in index.dart) {
        const info = index.dart[file];
          
        if (!targetFilter || targetFilter === "class" || targetFilter === "widget") {
          if (mode === "definitions" || mode === "both") {
            for (const c of info.classes) {
              if (c.name.toLowerCase().includes(q)) {
                if (filter === "widget" && c.type === "plain") continue;
                if (targetFilter === "widget" && c.type === "plain") continue;
                results.push({ name: c.name, type: "class_definition", subtype: c.type, file, line: c.line });
              }
            }
          }
        }
  
        if (!targetFilter || targetFilter === "function") {
          if (mode === "definitions" || mode === "both") {
            for (const f of info.functions) {
              if (f.name.toLowerCase().includes(q)) {
                results.push({ name: f.name, type: "function_definition", parent: f.parentClass, file, line: f.line });
              }
            }
          }
            
          if ((mode === "calls" || mode === "both") && info.functionCalls) {
            for (const call of info.functionCalls) {
              if (call.name.toLowerCase().includes(q)) {
                results.push({ 
                  name: call.name, 
                  type: "function_call", 
                  callerClass: call.callerClass, 
                  callerFunction: call.callerFunction,
                  file, 
                  line: call.line,
                  context: call.context,
                });
              }
            }
          }
        }

        // Search Enums
        if (!targetFilter || targetFilter === "enum") {
          if (mode === "definitions" || mode === "both") {
            for (const e of info.enums || []) {
              if (e.name.toLowerCase().includes(q)) {
                results.push({ name: e.name, type: "enum_definition", file, line: e.line, values: e.values });
              }
            }
          }
        }

        // Search Mixins
        if (!targetFilter || targetFilter === "mixin") {
          if (mode === "definitions" || mode === "both") {
            for (const m of info.mixins || []) {
              if (m.name.toLowerCase().includes(q)) {
                results.push({ name: m.name, type: "mixin_definition", file, line: m.line, on: m.on });
              }
            }
          }
        }

        // Search Extensions
        if (!targetFilter || targetFilter === "extension") {
          if (mode === "definitions" || mode === "both") {
            for (const e of info.extensions || []) {
              if (e.name.toLowerCase().includes(q)) {
                results.push({ name: e.name, type: "extension_definition", file, line: e.line, on: e.onType });
              }
            }
          }
        }

        // Search Typedefs
        if (!targetFilter || targetFilter === "typedef") {
          if (mode === "definitions" || mode === "both") {
            for (const t of info.typedefs || []) {
              if (t.name.toLowerCase().includes(q)) {
                results.push({ name: t.name, type: "typedef_definition", file, line: t.line, signature: t.signature });
              }
            }
          }
        }

        // Search Top-level Variables
        if (!targetFilter || targetFilter === "variable") {
          if (mode === "definitions" || mode === "both") {
            for (const v of info.variables || []) {
              if (v.name.toLowerCase().includes(q)) {
                results.push({ name: v.name, type: "variable_definition", file, line: v.line, varType: v.type, isConst: v.isConst, isFinal: v.isFinal });
              }
            }
          }
        }

        // Search Constructors
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

        // Search Properties (Fields, Getters, Setters)
        if (!targetFilter || targetFilter === "property") {
          if (mode === "definitions" || mode === "both") {
            for (const p of info.properties || []) {
              if (p.name.toLowerCase().includes(q)) {
                results.push({ name: p.name, type: "property_definition", file, line: p.line, propType: p.type, className: p.className, isStatic: p.isStatic, isGetter: p.isGetter, isSetter: p.isSetter });
              }
            }
          }
        }

        // Search Annotations
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
      
      // Search Files
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

      // Search Translations
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
  
    // Fallback to direct search if no results or index not found  
    if (results.length === 0 || !index || useDirectSearch) {
      const directSearch = new DirectSearch(currentProjectPath);
      const directResults = directSearch.search(query, filter, mode);
        
      // Add source indicator  
      for (const result of directResults) {
        results.push({
          ...result,
          _source: !index || useDirectSearch ? "direct_search" : "index",
        });
      }
    }
  
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          results: results.slice(0, 50),
          source: !index || useDirectSearch ? "direct_search" : "index",
          note: !index ? "Index not found. Using direct file search (slower)." : "",
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
    const index = readIndex();
    if (!index) return { content: [{ type: "text", text: "Index not found." }] };

    let files = 0, classes = 0, functions = 0, widgets = 0, enums = 0, mixins = 0;
    let extensions = 0, typedefs = 0, variables = 0, constructors = 0, properties = 0, annotations = 0;

    for (const file in index.dart || {}) {
      const info = index.dart[file];
      files++;
      classes += info.classes.length;
      functions += info.functions.length;
      widgets += info.widgets.length;
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
      `Functions: ${functions}`,
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

    return {
      content: [{ type: "text", text: stats }],
    };
  }
);

// New Tool: Project Structure
server.registerTool(
  "flutter_get_project_structure",
  {
    description: "Get the structure of the project (folders and files), specifically focusing on the lib/ directory.",
    inputSchema: z.object({
      targetPath: z.string().optional().describe("Specific subdirectory to explore (defaults to 'lib')"),
    }),
  },
  async ({ targetPath = "lib" }) => {
    const fullPath = path.join(currentProjectPath, targetPath);
    if (!fs.existsSync(fullPath)) {
      return { content: [{ type: "text", text: `Path not found: ${targetPath}` }] };
    }
    
    const structure = getDirectoryStructure(fullPath, targetPath);
    
    // Return as a formatted string for better readability by AI
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
    return {
      content: [{ type: "text", text: formatted || "Directory is empty." }],
    };
  }
);

// 3. File Info Tool
server.registerTool(
  "flutter_get_file_info",
  {
    description: "Get detailed information about a specific Dart file",
    inputSchema: z.object({
      relativePath: z.string().describe("The relative path of the file (e.g. lib/main.dart)"),
    }),
  },
  async ({ relativePath }: { relativePath: string }) => {
    const index = readIndex();
    if (!index) return { content: [{ type: "text", text: "Index not found." }] };

    const info = index.dart?.[relativePath];
    if (!info) return { content: [{ type: "text", text: `File not found in index: ${relativePath}` }] };

    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
    };
  }
);

// 4. Pubspec Tool
server.registerTool(
  "flutter_get_pubspec",
  {
    description: "Read and analyze the project's pubspec.yaml file",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const pubspecPath = PUBSPEC_PATH();
      if (fs.existsSync(pubspecPath)) {
        const content = fs.readFileSync(pubspecPath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      }
      return { content: [{ type: "text", text: `pubspec.yaml not found at: ${pubspecPath}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading pubspec: ${error}` }] };
    }
  }
);

// 5. Code Warnings Tool
server.registerTool(
  "flutter_get_code_warnings",
  {
    description: "Get all code warnings (like hardcoded text and colors) from the Dart project",
    inputSchema: z.object({}),
  },
  async () => {
    const index = readIndex();
    if (!index || !index.dart) return { content: [{ type: "text", text: "Index not found." }] };

    const warnings = [];
    for (const file in index.dart) {
      if (index.dart[file].warnings && index.dart[file].warnings.length > 0) {
        warnings.push({ filePath: file, warnings: index.dart[file].warnings });
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(warnings, null, 2) }] };
  }
);

// 5b. Get Diagnostics Tool
server.registerTool(
  "flutter_get_diagnostics",
  {
    description: "Get all VS Code diagnostics (errors and warnings) for the project",
    inputSchema: z.object({}),
  },
  async () => {
    const index = readIndex();
    if (!index || !index.diagnostics) return { content: [{ type: "text", text: "No diagnostics found in index." }] };
    return { content: [{ type: "text", text: JSON.stringify(index.diagnostics, null, 2) }] };
  }
);

// 6. Missing Translations Tool
server.registerTool(
  "flutter_get_missing_translations",
  {
    description: "Find missing translation keys across all ARB files",
    inputSchema: z.object({}),
  },
  async () => {
    const index = readIndex();
    if (!index || !index.arb) return { content: [{ type: "text", text: "Index not found." }] };

    const allKeys = new Set<string>();
    const fileKeys = new Map<string, Set<string>>();

    for (const file in index.arb) {
      const keys = new Set<string>();
      for (const t of index.arb[file]) {
        allKeys.add(t.key);
        keys.add(t.key);
      }
      fileKeys.set(file, keys);
    }

    const results = [];
    for (const [filePath, keys] of fileKeys.entries()) {
      const missing = [];
      for (const k of allKeys) {
        if (!keys.has(k)) missing.push(k);
      }
      if (missing.length > 0) {
        results.push({ filePath, missingKeys: missing });
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// 7. Reverse Dependencies Tool
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
    const index = readIndex();
    if (!index || !index.dart) return { content: [{ type: "text", text: "Index not found." }] };
      
    const results: any[] = [];
      
    for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
      let usages: any[] = [];
      let matchField = "";

      switch (type) {
        case "class":
          usages = info.classUsages || [];
          matchField = "className";
          break;
        case "function":
          usages = info.functionUsages || [];
          matchField = "functionName";
          break;
        case "extension":
          usages = info.extensionUsages || [];
          matchField = "extensionName";
          break;
        case "typedef":
          usages = info.typedefUsages || [];
          matchField = "typedefName";
          break;
        case "variable":
          usages = info.variableUsages || [];
          matchField = "variableName";
          break;
        case "constructor":
          usages = info.constructorUsages || [];
          matchField = "constructorName";
          break;
        case "property":
          usages = info.propertyUsages || [];
          matchField = "propertyName";
          break;
        case "annotation":
          usages = info.annotationUsages || [];
          matchField = "annotationName";
          break;
        case "enum":
          usages = info.enumUsages || [];
          matchField = "enumName";
          break;
        case "mixin":
          usages = info.mixinUsages || [];
          matchField = "mixinName";
          break;
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

      if (usage) {
        results.push({
          filePath,
          ...usage
        });
      }
    }
      
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// 8. Set Project Path Tool
server.registerTool(
  "flutter_set_project_path",
  {
    description: "Set the Flutter project root path for the MCP server",
    inputSchema: z.object({
      projectPath: z.string().describe("Absolute path to the Flutter project root (directory containing pubspec.yaml)"),
    }),
  },
  async ({ projectPath }: { projectPath: string }) => {
    if (!fs.existsSync(path.join(projectPath, "pubspec.yaml"))) {
      return { content: [{ type: "text", text: "Error: pubspec.yaml not found in the specified path. Please provide a valid Flutter project root." }] };
    }
    currentProjectPath = projectPath;
    return { content: [{ type: "text", text: `Project path set to: ${projectPath}` }] };
  }
);

// 9. Get Project Path Tool
server.registerTool(
  "flutter_get_project_path",
  {
    description: "Get the current Flutter project root path",
    inputSchema: z.object({}),
  },
  async () => {
    return { content: [{ type: "text", text: `Current project path: ${currentProjectPath}` }] };
  }
);

// 10. Translation Tools
server.registerTool(
  "flutter_update_translation",
  {
    description: "Add or update a translation key in all ARB files",
    inputSchema: z.object({
      key: z.string().describe("Translation key (e.g., 'welcome_message')"),
      arValue: z.string().describe("Arabic translation value"),
      enValue: z.string().describe("English translation value"),
      description: z.string().optional().describe("Optional description for translators"),
    }),
  },
  async ({ key, arValue, enValue, description }: { 
    key: string; 
    arValue: string; 
    enValue: string; 
    description?: string;
  }) => {
    try {
      const arbEditor = new ArbEditor(currentProjectPath);
      const result = arbEditor.updateTranslation(key, arValue, enValue, description);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error updating translation: ${error}` }] };
    }
  }
);

server.registerTool(
  "flutter_list_translations",
  {
    description: "List all translation keys and check for missing keys across ARB files",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const arbEditor = new ArbEditor(currentProjectPath);
      const result = arbEditor.getAllTranslations();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error listing translations: ${error}` }] };
    }
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
  async ({ key }: { key: string }) => {
    try {
      const arbEditor = new ArbEditor(currentProjectPath);
      const result = arbEditor.deleteTranslation(key);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error deleting translation: ${error}` }] };
    }
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
    const index = readIndex();
    if (!index || !index.packages) {
      return { content: [{ type: "text", text: "No packages found in index. Try rebuilding the index." }] };
    }

    let packages = index.packages;

    if (filter !== "all") {
      packages = packages.filter((p: any) => p.dependencyType === filter);
    }
    if (source !== "all") {
      packages = packages.filter((p: any) => p.source === source);
    }

    return { content: [{ type: "text", text: JSON.stringify(packages, null, 2) }] };
  }
);


// 11. Code Block Extractor Tool
server.registerTool(
  "flutter_get_code_block",
  {
    description: "Get the full body of a class, function, or method including comments",
    inputSchema: z.object({
      elementType: z.enum(["class", "function", "method", "enum", "mixin", "extension"]).describe("Type of element to extract"),
      name: z.string().describe("Name of the class, function, or method"),
      filePath: z.string().optional().describe("Relative path to the file (optional, will search all files if not provided)"),
      parentClass: z.string().optional().describe("Parent class name (required for methods)"),
    }),
  },
  async ({ elementType, name, filePath, parentClass }: { 
    elementType: "class" | "function" | "method" | "enum" | "mixin" | "extension";
    name: string;
    filePath?: string;
    parentClass?: string;
  }) => {
    const index = readIndex();
    if (!index || !index.dart) {
      return { content: [{ type: "text", text: "Index not found." }] };
    }

    const parser = new DartParser();
    let targetFile = filePath;
    let targetContent = '';

    // If filePath not provided, search for the element
    if (!targetFile) {
      for (const file in index.dart) {
        const info = index.dart[file] as DartFileInfo;
        let found = false;

        if (elementType === 'class') {
          found = info.classes.some((c: ClassInfo) => c.name === name);
        } else if (elementType === 'enum') {
          found = (info.enums || []).some((e: any) => e.name === name);
        } else if (elementType === 'mixin') {
          found = (info.mixins || []).some((m: any) => m.name === name);
        } else if (elementType === 'extension') {
          found = (info.extensions || []).some((e: any) => e.name === name || (name === 'unnamed extension' && !e.name));
        } else if (elementType === 'function') {
          found = info.functions.some((f: FunctionInfo) => f.name === name && !f.parentClass);
        } else if (elementType === 'method') {
          found = info.functions.some((f: FunctionInfo) => f.name === name && f.parentClass === parentClass);
        }

        if (found) {
          targetFile = file;
          break;
        }
      }
    }

    if (!targetFile) {
      return { content: [{ type: "text", text: `Element not found: ${elementType} ${name}` }] };
    }

    // Read the file content
    const fullPath = path.join(currentProjectPath, targetFile);
    try {
      targetContent = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error}` }] };
    }

    // Extract the code block
    const result = parser.extractCodeBlock(targetContent, elementType, name, parentClass);

    if (!result) {
      return { content: [{ type: "text", text: `Could not extract code block for ${elementType} ${name}` }] };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          elementType,
          name,
          filePath: targetFile,
          startLine: result.startLine,
          endLine: result.endLine,
          comments: result.comments,
          body: result.body
        }, null, 2)
      }],
    };
  }
);

// 12. Logic Flow Summarizer Tool
server.registerTool(
  "flutter_analyze_logic_flow",
  {
    description: "Analyze a function's logic and return a summarized flow of steps",
    inputSchema: z.object({
      functionName: z.string().describe("Name of the function to analyze"),
      filePath: z.string().optional().describe("Relative path to the file (optional, will search if not provided)"),
      parentClass: z.string().optional().describe("Parent class name (required for methods)"),
    }),
  },
  async ({ functionName, filePath, parentClass }: {
    functionName: string;
    filePath?: string;
    parentClass?: string;
  }) => {
    const index = readIndex();
    if (!index || !index.dart) {
      return { content: [{ type: "text", text: "Index not found." }] };
    }

    const parser = new DartParser();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    let targetFile = filePath;
    let targetContent = '';

    // If filePath not provided, search for the function
    if (!targetFile) {
      for (const file in index.dart) {
        const info = index.dart[file] as DartFileInfo;
        const found = info.functions.some((f: FunctionInfo) => 
          f.name === functionName && 
          (parentClass ? f.parentClass === parentClass : !f.parentClass)
        );


        if (found) {
          targetFile = file;
          break;
        }
      }
    }

    if (!targetFile) {
      return { content: [{ type: "text", text: `Function not found: ${functionName}` }] };
    }

    // Read the file content
    const fullPath = path.join(currentProjectPath, targetFile);
    try {
      targetContent = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error}` }] };
    }

    // Extract the function body
    const elementType = parentClass ? 'method' : 'function';
    const result = parser.extractCodeBlock(targetContent, elementType, functionName, parentClass);

    if (!result) {
      return { content: [{ type: "text", text: `Could not extract function body for ${functionName}` }] };
    }

    // Analyze the logic flow
    const logicSteps = analyzer.analyzeLogicFlow(result.body);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          functionName,
          filePath: targetFile,
          startLine: result.startLine,
          endLine: result.endLine,
          logicSteps,
          summary: logicSteps.length > 0 
            ? `Function has ${logicSteps.length} logical steps: ` + logicSteps.map(s => s.description).join(', ')
            : 'No clear logical steps detected'
        }, null, 2)
      }],
    };
  }
);

// 13. Contextual Dependency Map Tool
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
    const index = readIndex();
    if (!index || !index.dart) {
      return { content: [{ type: "text", text: "Index not found." }] };
    }

    const parser = new DartParser();
    const analyzer = new CodeAnalyzer(currentProjectPath);
    let targetFile = filePath;
    let targetContent = '';

    // If filePath not provided, search for the class
    if (!targetFile) {
      for (const file in index.dart) {
        const info = index.dart[file] as DartFileInfo;
        if (info.classes.some((c: ClassInfo) => c.name === className)) {
          targetFile = file;
          break;
        }
      }
    }


    if (!targetFile) {
      return { content: [{ type: "text", text: `Class not found: ${className}` }] };
    }

    // Read the file content
    const fullPath = path.join(currentProjectPath, targetFile);
    try {
      targetContent = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error}` }] };
    }

    // Extract the class body
    const result = parser.extractCodeBlock(targetContent, 'class', className);

    if (!result) {
      return { content: [{ type: "text", text: `Could not extract class body for ${className}` }] };
    }

    // Extract constructor dependencies
    const dependencies = analyzer.extractConstructorDependencies(result.body);

    // Also extract imports that might indicate dependencies
    const importDependencies: string[] = [];
    const lines = targetContent.split('\n');
    for (const line of lines) {
      const importMatch = line.match(/import\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const importPath = importMatch[1];
        if (importPath.includes('repository') || importPath.includes('service') || importPath.includes('provider')) {
          importDependencies.push(importPath);
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          className,
          filePath: targetFile,
          constructorDependencies: dependencies,
          importDependencies,
          totalDependencies: dependencies.length + importDependencies.length
        }, null, 2)
      }],
    };
  }
);

// 14. Smart Fragment Reader Tool
server.registerTool(
  "flutter_read_fragment",
  {
    description: "Read a code fragment by element name (class, function, method) with surrounding comments",
    inputSchema: z.object({
      name: z.string().describe("Name of the element to read"),
      elementType: z.enum(["class", "function", "method"]).optional().describe("Type of element (auto-detected if not provided)"),
      filePath: z.string().optional().describe("Relative path to the file (optional, will search if not provided)"),
      parentClass: z.string().optional().describe("Parent class name (required for methods)"),
      includeContext: z.boolean().optional().describe("Include surrounding context lines (default: false)"),
      contextLines: z.number().optional().describe("Number of context lines before/after (default: 3)"),
    }),
  },
  async ({ name, elementType, filePath, parentClass, includeContext = false, contextLines = 3 }: {
    name: string;
    elementType?: "class" | "function" | "method";
    filePath?: string;
    parentClass?: string;
    includeContext?: boolean;
    contextLines?: number;
  }) => {
    const index = readIndex();
    if (!index || !index.dart) {
      return { content: [{ type: "text", text: "Index not found." }] };
    }

    const parser = new DartParser();
    let targetFile = filePath;
    let targetContent = '';
    let detectedType = elementType;

    // If filePath not provided, search for the element
    if (!targetFile) {
      for (const file in index.dart) {
        const info = index.dart[file] as DartFileInfo;
        
        if (!detectedType) {
          // Auto-detect type
          if (info.classes.some((c: ClassInfo) => c.name === name)) {
            detectedType = 'class';
          } else if (info.functions.some((f: FunctionInfo) => f.name === name && !f.parentClass)) {
            detectedType = 'function';
          } else if (info.functions.some((f: FunctionInfo) => f.name === name && f.parentClass)) {
            detectedType = 'method';
          }
        }

        let found = false;
        if (detectedType === 'class') {
          found = info.classes.some((c: ClassInfo) => c.name === name);
        } else if (detectedType === 'function') {
          found = info.functions.some((f: FunctionInfo) => f.name === name && !f.parentClass);
        } else if (detectedType === 'method') {
          found = info.functions.some((f: FunctionInfo) => f.name === name && f.parentClass === parentClass);
        }


        if (found) {
          targetFile = file;
          break;
        }
      }
    }

    if (!targetFile) {
      return { content: [{ type: "text", text: `Element not found: ${name}` }] };
    }

    // Read the file content
    const fullPath = path.join(currentProjectPath, targetFile);
    try {
      targetContent = fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error}` }] };
    }

    // Extract the code block
    const result = parser.extractCodeBlock(targetContent, detectedType || 'function', name, parentClass);

    if (!result) {
      return { content: [{ type: "text", text: `Could not extract code block for ${name}` }] };
    }

    let finalBody = result.body;

    // Add context if requested
    if (includeContext) {
      const lines = targetContent.split('\n');
      const contextStart = Math.max(0, result.startLine - 1 - contextLines);
      const contextEnd = Math.min(lines.length, result.endLine + contextLines);
      finalBody = lines.slice(contextStart, contextEnd).join('\n');
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          name,
          elementType: detectedType,
          filePath: targetFile,
          startLine: result.startLine,
          endLine: result.endLine,
          comments: result.comments,
          body: finalBody,
          hasContext: includeContext
        }, null, 2)
      }],
    };
  }
);

// 15. Text Search Tool
server.registerTool(
  "flutter_search_text",
  {
    description: "Search for specific text, strings, or comments across all Dart files",
    inputSchema: z.object({
      query: z.string().describe("The text or regex to search for"),
      isRegex: z.boolean().optional().describe("Whether to treat query as a regular expression (default: false)"),
      caseInsensitive: z.boolean().optional().describe("Whether the search should be case-insensitive (default: true)"),
      includeComments: z.boolean().optional().describe("Whether to include comments in the search (default: true)"),
      includeStrings: z.boolean().optional().describe("Whether to include string literals in the search (default: true)"),
    }),
  },
  async (options: {
    query: string;
    isRegex?: boolean;
    caseInsensitive?: boolean;
    includeComments?: boolean;
    includeStrings?: boolean;
  }) => {
    const directSearch = new DirectSearch(currentProjectPath);
    const results = directSearch.searchText(options.query, options);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          results,
          totalResults: results.length,
          query: options.query
        }, null, 2)
      }],
    };
  }
);

// 16. Index Management Tools
server.registerTool(
  "flutter_get_index_status",
  {
    description: "Check the status and last update time of the project index",
    inputSchema: z.object({}),
  },
  async () => {
    const dbPath = path.join(currentProjectPath, ".vscode", "flutter-explorer.db");
    if (!fs.existsSync(dbPath)) {
      return { content: [{ type: "text", text: "Index database not found. A full rebuild is required." }] };
    }

    try {
      const stats = fs.statSync(dbPath);
      const index = readIndex();
      const fileCount = index ? Object.keys(index.dart || {}).length : 0;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            exists: true,
            lastModified: stats.mtime,
            sizeBytes: stats.size,
            indexedFiles: fileCount,
            path: dbPath
          }, null, 2)
        }],
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Error checking index status: ${error}` }] };
    }
  }
);

server.registerTool(
  "flutter_rebuild_index",
  {
    description: "Request a manual rebuild of the project index (Note: Requires the VS Code extension to be active for a full background rebuild)",
    inputSchema: z.object({}),
  },
  async () => {
    // In a real scenario, we might trigger a message to the VS Code extension
    // For the MCP standalone, we can only report that it needs the extension
    return {
      content: [{
        type: "text",
        text: "Rebuild request received. Please ensure the Flutter Explorer VS Code extension is active to perform a full project re-indexing. The MCP server will automatically pick up the new index once completed."
      }],
    };
  }
);


// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Flutter Explorer MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in MCP server:", error);
  process.exit(1);
});
