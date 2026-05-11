import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { DirectSearch } from './mcp-direct-search.js';
import { ArbEditor } from './mcp-arb-editor.js';

/**
 * Flutter Explorer MCP Server
 * Exposes indexed Dart/Flutter data to AI agents via stdio
 */

// Current project path, defaults to environment variable or current working directory
let currentProjectPath = process.env.FLUTTER_PROJECT_PATH || process.cwd();
const INDEX_PATH = () => path.join(currentProjectPath, ".vscode", "flutter-explorer-index.json");
const PUBSPEC_PATH = () => path.join(currentProjectPath, "pubspec.yaml");

const server = new McpServer({
  name: "flutter-explorer-mcp",
  version: "1.0.0",
});

// Helper to read the index file
function readIndex() {
  try {
    const indexPath = INDEX_PATH();
    if (fs.existsSync(indexPath)) {
      const data = fs.readFileSync(indexPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error reading index:", error);
  }
  return null;
}

// --- Tools ---

// 1. Search Tool
server.registerTool(
  "flutter_search",
  {
    description: "Search for classes, functions, or widgets in the Flutter project",
    inputSchema: z.object({
      query: z.string().describe("The search term (class name, function name, etc.)"),
      filter: z.enum(["class", "function", "widget", "enum", "mixin"]).optional().describe("Filter by type"),
      searchMode: z.enum(["definitions", "calls", "both"]).optional().describe("Search in definitions, calls, or both (default: both)"),
      useDirectSearch: z.boolean().optional().describe("Force direct file search even if index exists (default: false)"),
    }),
  },
  async ({ query, filter, searchMode = "both", useDirectSearch = false }) => {
    const index = readIndex();
    const results: any[] = [];
    const q = query.toLowerCase();
    const mode = searchMode || "both";
  
    // Try indexed search first  
    if (index && !useDirectSearch) {
      for (const file in index.dart) {
        const info = index.dart[file];
          
        if (!filter || filter === "class" || filter === "widget") {
          if (mode === "definitions" || mode === "both") {
            for (const c of info.classes) {
              if (c.name.toLowerCase().includes(q)) {
                if (filter === "widget" && c.type === "plain") continue;
                results.push({ name: c.name, type: "class_definition", subtype: c.type, file, line: c.line });
              }
            }
          }
        }
  
        if (!filter || filter === "function") {
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
        if (!filter || filter === "enum") {
          if (mode === "definitions" || mode === "both") {
            for (const e of info.enums || []) {
              if (e.name.toLowerCase().includes(q)) {
                results.push({ name: e.name, type: "enum_definition", file, line: e.line, values: e.values });
              }
            }
          }
        }

        // Search Mixins
        if (!filter || filter === "mixin") {
          if (mode === "definitions" || mode === "both") {
            for (const m of info.mixins || []) {
              if (m.name.toLowerCase().includes(q)) {
                results.push({ name: m.name, type: "mixin_definition", file, line: m.line, on: m.on });
              }
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
    for (const file in index.dart || {}) {
      files++;
      classes += index.dart[file].classes.length;
      functions += index.dart[file].functions.length;
      widgets += index.dart[file].widgets.length;
      enums += (index.dart[file].enums || []).length;
      mixins += (index.dart[file].mixins || []).length;
    }
    let translations = 0;
    for (const file in index.arb || {}) {
      translations += index.arb[file].length;
    }

    return {
      content: [{ type: "text", text: `Files: ${files}, Classes: ${classes}, Functions: ${functions}, Widgets: ${widgets}, Enums: ${enums}, Mixins: ${mixins}, Translations: ${translations}` }],
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
  async ({ relativePath }) => {
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
      name: z.string().describe("Class or function name"),
      type: z.enum(["class", "function"]).describe("Type of element"),
      parentClass: z.string().optional().describe("Parent class name (required for functions inside classes)"),
    }),
  },
  async ({ name, type, parentClass }) => {
    const index = readIndex();
    if (!index || !index.dart) return { content: [{ type: "text", text: "Index not found." }] };
      
    const results: any[] = [];
      
    if (type === "class") {
      for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
        if (info.classUsages) {
          const usage = info.classUsages.find((u: any) => u.className === name);
          if (usage) {
            results.push({
              filePath,
              usedByClasses: usage.usedByClasses,
              usedByFunctions: usage.usedByFunctions,
              usedInFiles: usage.usedInFiles,
              confidence: usage.confidence,
            });
          }
        }
      }
    } else if (type === "function") {
      for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
        if (info.functionUsages) {
          const usage = info.functionUsages.find((u: any) => u.functionName === name && u.parentClass === (parentClass || null));
          if (usage) {
            results.push({
              filePath,
              calledByFunctions: usage.calledByFunctions,
              calledInFiles: usage.calledInFiles,
              confidence: usage.confidence,
            });
          }
        }
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
  async ({ projectPath }) => {
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
  async ({ key, arValue, enValue, description }) => {
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
  async ({ key }) => {
    try {
      const arbEditor = new ArbEditor(currentProjectPath);
      const result = arbEditor.deleteTranslation(key);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error deleting translation: ${error}` }] };
    }
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
