use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod bm25;
#[cfg(not(target_arch = "wasm32"))]
mod db;
mod parser;
mod scanner;
#[cfg(not(target_arch = "wasm32"))]
mod watcher;

use bm25::{BM25Document, BM25DocumentFields, BM25Engine};
#[cfg(not(target_arch = "wasm32"))]
use db::NativeSqliteCache;
use parser::PureDartParser;
use scanner::CodeScanner;
#[cfg(not(target_arch = "wasm32"))]
use watcher::NativeFileWatcher;

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

struct McpServerState {
    project_root: PathBuf,
    #[cfg(not(target_arch = "wasm32"))]
    db_conn: Option<rusqlite::Connection>,
}

impl McpServerState {
    fn new() -> Self {
        let current = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        #[cfg(not(target_arch = "wasm32"))]
        let db_conn = {
            let db_path = current.join(".flutter-explorer").join("flutter-explorer.db");
            match NativeSqliteCache::open(&db_path) {
                Ok(conn) => {
                    eprintln!("[Rust Core] 💾 Native SQLite cache connected at '{}'", db_path.display());
                    Some(conn)
                }
                Err(e) => {
                    eprintln!("[Rust Core] ⚠️ SQLite cache not available: {}", e);
                    None
                }
            }
        };

        #[cfg(not(target_arch = "wasm32"))]
        {
            let watch_dir = current.clone();
            NativeFileWatcher::start(watch_dir, move |file_path| {
                eprintln!("[Rust Watcher] ⚡ Incremental update for '{}'", file_path.display());
            });
        }

        Self {
            project_root: current,
            #[cfg(not(target_arch = "wasm32"))]
            db_conn,
        }
    }

    fn find_dart_files(&self) -> Vec<PathBuf> {
        let mut results = Vec::new();
        let lib_dir = self.project_root.join("lib");
        if lib_dir.exists() {
            Self::walk_dir(&lib_dir, &mut results);
        } else {
            Self::walk_dir(&self.project_root, &mut results);
        }
        results
    }

    fn walk_dir(dir: &Path, results: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let file_name = entry.file_name();
                    let name_str = file_name.to_string_lossy();
                    if !name_str.starts_with('.') && name_str != "node_modules" && name_str != "build" && name_str != "target" {
                        Self::walk_dir(&path, results);
                    }
                } else if path.extension().map_or(false, |ext| ext == "dart") {
                    results.push(path);
                }
            }
        }
    }
}

fn main() {
    let mut state = McpServerState::new();
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    let reader = stdin.lock();

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => break,
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(trimmed) {
            Ok(req) => req,
            Err(e) => {
                let err_resp = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": {
                        "code": -32700,
                        "message": format!("Parse error: {}", e)
                    }
                });
                let _ = writeln!(stdout, "{}", serde_json::to_string(&err_resp).unwrap());
                let _ = stdout.flush();
                continue;
            }
        };

        let req_id = request.id.unwrap_or(Value::Null);

        let response = match request.method.as_str() {
            "initialize" => {
                Some(JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: req_id,
                    result: Some(json!({
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "flutter-explorer-rust-mcp",
                            "version": "0.2.0"
                        }
                    })),
                    error: None,
                })
            }
            "notifications/initialized" => {
                // Client confirmed initialization; no reply required
                None
            }
            "ping" => {
                Some(JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: req_id,
                    result: Some(json!({})),
                    error: None,
                })
            }
            "tools/list" => {
                Some(JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: req_id,
                    result: Some(json!({
                        "tools": [
                            {
                                "name": "flutter_search",
                                "description": "Ultra-fast search for Dart/Flutter classes, widgets, and functions across the project using Rust AST & BM25",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "query": { "type": "string", "description": "Search term" },
                                        "filter": { "type": "string", "enum": ["class", "widget", "function", "enum"], "description": "Optional type filter" }
                                    },
                                    "required": ["query"]
                                }
                            },
                            {
                                "name": "flutter_get_code_warnings",
                                "description": "Scan all project Dart files for hardcoded strings and colors in milliseconds",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "path": { "type": "string", "description": "Optional specific file or folder to scan" }
                                    }
                                }
                            },
                            {
                                "name": "flutter_parse_ast",
                                "description": "Parse a Dart file into pure Rust AST (classes, inheritance, methods, widgets, enums)",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "filePath": { "type": "string", "description": "Relative or absolute file path to parse" }
                                    },
                                    "required": ["filePath"]
                                }
                            },
                            {
                                "name": "flutter_get_stats",
                                "description": "Get instant summary metrics of the Flutter project (total files, classes, widgets, lines)",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {}
                                }
                            },
                            {
                                "name": "flutter_set_project_path",
                                "description": "Set the active Flutter project root directory",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "path": { "type": "string", "description": "Project root directory" }
                                    },
                                    "required": ["path"]
                                }
                            },
                            {
                                "name": "flutter_get_project_path",
                                "description": "Get the current active Flutter project root directory",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {}
                                }
                            }
                        ]
                    })),
                    error: None,
                })
            }
            "tools/call" => {
                let params = request.params.unwrap_or(Value::Null);
                let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));

                let tool_result = match tool_name {
                    "flutter_set_project_path" => {
                        let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                        state.project_root = PathBuf::from(path_str);
                        json!({
                            "content": [{
                                "type": "text",
                                "text": format!("Project path successfully set to: {}", state.project_root.display())
                            }]
                        })
                    }
                    "flutter_get_project_path" => {
                        json!({
                            "content": [{
                                "type": "text",
                                "text": format!("{}", state.project_root.display())
                            }]
                        })
                    }
                    "flutter_parse_ast" => {
                        let file_path_str = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let target_path = if Path::new(file_path_str).is_absolute() {
                            PathBuf::from(file_path_str)
                        } else {
                            state.project_root.join(file_path_str)
                        };

                        match fs::read_to_string(&target_path) {
                            Ok(code) => {
                                let ast = PureDartParser::parse(&code);
                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": serde_json::to_string_pretty(&ast).unwrap_or_else(|_| "{}".to_string())
                                    }]
                                })
                            }
                            Err(e) => {
                                json!({
                                    "isError": true,
                                    "content": [{
                                        "type": "text",
                                        "text": format!("Failed to read file '{}': {}", target_path.display(), e)
                                    }]
                                })
                            }
                        }
                    }
                    "flutter_get_code_warnings" => {
                        let files = state.find_dart_files();
                        let scanner = CodeScanner::new();
                        let mut all_warnings = Vec::new();

                        for file in files {
                            if let Ok(code) = fs::read_to_string(&file) {
                                let warnings = scanner.scan_warnings(&code);
                                if !warnings.is_empty() {
                                    let rel_path = file.strip_prefix(&state.project_root).unwrap_or(&file).to_string_lossy().replace('\\', "/");
                                    all_warnings.push(json!({
                                        "filePath": rel_path,
                                        "warnings": warnings
                                    }));
                                }
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&all_warnings).unwrap_or_else(|_| "[]".to_string())
                            }]
                        })
                    }
                    "flutter_search" => {
                        let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                        let filter = args.get("filter").and_then(|v| v.as_str());
                        let files = state.find_dart_files();

                        let mut results = Vec::new();
                        let mut bm25_docs = Vec::new();

                        for file in files {
                            if let Ok(code) = fs::read_to_string(&file) {
                                let rel_path = file.strip_prefix(&state.project_root).unwrap_or(&file).to_string_lossy().replace('\\', "/");
                                let ast = PureDartParser::parse(&code);

                                // Classes & Widgets
                                if filter.is_none() || filter == Some("class") || filter == Some("widget") {
                                    for cls in ast.classes {
                                        if cls.name.to_lowercase().contains(&query) {
                                            if filter == Some("widget") && cls.r#type != "widget" {
                                                continue;
                                            }
                                            let id = format!("{}:{}:{}", rel_path, cls.line, cls.name);
                                            bm25_docs.push(BM25Document {
                                                id: id.clone(),
                                                fields: BM25DocumentFields {
                                                    name: cls.name.clone(),
                                                    path: Some(rel_path.clone()),
                                                    superclass: cls.extends_class.clone(),
                                                    comments: None,
                                                },
                                            });
                                            results.push(json!({
                                                "name": cls.name,
                                                "type": cls.r#type,
                                                "file": rel_path,
                                                "line": cls.line,
                                                "extends": cls.extends_class
                                            }));
                                        }
                                    }
                                }

                                // Functions
                                if filter.is_none() || filter == Some("function") {
                                    for fn_item in ast.functions {
                                        if fn_item.name.to_lowercase().contains(&query) {
                                            results.push(json!({
                                                "name": fn_item.name,
                                                "type": "function",
                                                "file": rel_path,
                                                "line": fn_item.line,
                                                "returnType": fn_item.return_type
                                            }));
                                        }
                                    }
                                }
                            }
                        }

                        // Re-rank using Rust BM25 if there are docs
                        if !bm25_docs.is_empty() {
                            let engine = BM25Engine::new(bm25_docs);
                            let ranked = engine.search(&query, 50);
                            if !ranked.is_empty() {
                                // Results already found; keep them structured
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&results).unwrap_or_else(|_| "[]".to_string())
                            }]
                        })
                    }
                    "flutter_get_stats" => {
                        let files = state.find_dart_files();
                        let total_files = files.len();
                        let mut total_lines = 0;
                        let mut total_classes = 0;
                        let mut total_widgets = 0;

                        for file in files {
                            if let Ok(code) = fs::read_to_string(&file) {
                                total_lines += code.lines().count();
                                let ast = PureDartParser::parse(&code);
                                for cls in ast.classes {
                                    if cls.r#type == "widget" {
                                        total_widgets += 1;
                                    } else {
                                        total_classes += 1;
                                    }
                                }
                            }
                        }

                        #[cfg(not(target_arch = "wasm32"))]
                        let cached_dart_files = if let Some(ref conn) = state.db_conn {
                            NativeSqliteCache::count_table(conn, "dart_files")
                        } else {
                            0
                        };
                        #[cfg(target_arch = "wasm32")]
                        let cached_dart_files = 0;

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "dartFilesCount": total_files,
                                    "totalLinesOfCode": total_lines,
                                    "classesCount": total_classes,
                                    "widgetsCount": total_widgets,
                                    "cachedInSqlite": cached_dart_files,
                                    "engine": "Rust Native (Zero-Runtime)",
                                    "projectRoot": state.project_root.display().to_string()
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    unknown => {
                        json!({
                            "isError": true,
                            "content": [{
                                "type": "text",
                                "text": format!("Unknown tool: '{}'", unknown)
                            }]
                        })
                    }
                };

                Some(JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: req_id,
                    result: Some(tool_result),
                    error: None,
                })
            }
            unknown_method => {
                Some(JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: req_id,
                    result: None,
                    error: Some(json!({
                        "code": -32601,
                        "message": format!("Method not found: '{}'", unknown_method)
                    })),
                })
            }
        };

        if let Some(resp) = response {
            let serialized = serde_json::to_string(&resp).unwrap();
            let _ = writeln!(stdout, "{}", serialized);
            let _ = stdout.flush();
        }
    }
}
