use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

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
use parser::{DartParsedAst, PureDartParser};
use scanner::CodeScanner;
#[cfg(not(target_arch = "wasm32"))]
use watcher::{FileWatchEvent, NativeFileWatcher, WatcherHandle};

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
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

struct ControllerPatterns {
    controller_type: &'static str,
    assign_re: Regex,
    decl_re: Regex,
}

fn memory_leak_patterns() -> &'static Vec<ControllerPatterns> {
    static PATTERNS: OnceLock<Vec<ControllerPatterns>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        let controller_types = [
            "AnimationController",
            "TextEditingController",
            "ScrollController",
            "TabController",
            "PageController",
            "FocusNode",
            "StreamSubscription",
            "StreamController",
            "ValueNotifier",
        ];

        controller_types
            .iter()
            .filter_map(|&ctrl| {
                let assign_pat = format!(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*{}\b", ctrl);
                let decl_pat = format!(
                    r"(?:late\s+)?(?:final\s+)?{}\s*(?:<[^>]+>)?\??\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:;|=)",
                    ctrl
                );
                Some(ControllerPatterns {
                    controller_type: ctrl,
                    assign_re: Regex::new(&assign_pat).ok()?,
                    decl_re: Regex::new(&decl_pat).ok()?,
                })
            })
            .collect()
    })
}

struct McpServerState {
    project_root: PathBuf,
    // rel_path -> (content_hash, parsed_ast)
    ast_cache: HashMap<String, (String, DartParsedAst)>,
    #[cfg(not(target_arch = "wasm32"))]
    db_conn: Option<rusqlite::Connection>,
    #[cfg(not(target_arch = "wasm32"))]
    watcher_handle: Option<WatcherHandle>,
    #[cfg(not(target_arch = "wasm32"))]
    watcher_rx: Option<std::sync::mpsc::Receiver<FileWatchEvent>>,
}

impl McpServerState {
    fn new() -> Self {
        let current = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut state = Self {
            project_root: current.clone(),
            ast_cache: HashMap::new(),
            #[cfg(not(target_arch = "wasm32"))]
            db_conn: None,
            #[cfg(not(target_arch = "wasm32"))]
            watcher_handle: None,
            #[cfg(not(target_arch = "wasm32"))]
            watcher_rx: None,
        };
        state.init_project_services(&current);
        state
    }

    fn init_project_services(&mut self, root: &Path) {
        self.project_root = root.to_path_buf();
        self.ast_cache.clear();

        #[cfg(not(target_arch = "wasm32"))]
        {
            if let Some(old_handle) = self.watcher_handle.take() {
                old_handle.stop();
            }

            let db_path = root.join(".flutter-explorer").join("flutter-explorer.db");
            self.db_conn = match NativeSqliteCache::open(&db_path) {
                Ok(conn) => {
                    eprintln!(
                        "[Rust Core] 💾 Native SQLite cache connected at '{}'",
                        db_path.display()
                    );
                    Some(conn)
                }
                Err(e) => {
                    eprintln!("[Rust Core] ⚠️ SQLite cache not available: {}", e);
                    None
                }
            };

            let (handle, rx) = NativeFileWatcher::start_managed(root.to_path_buf());
            self.watcher_handle = Some(handle);
            self.watcher_rx = Some(rx);
        }
    }

    /// Drain pending file system watcher events and incrementally update/invalidate caches
    fn process_watcher_events(&mut self) {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let mut events = Vec::new();
            if let Some(ref rx) = self.watcher_rx {
                while let Ok(evt) = rx.try_recv() {
                    events.push(evt);
                }
            }

            for evt in events {
                match evt {
                    FileWatchEvent::Modified(path) => {
                        let rel = self.relative_path_str(&path);
                        self.ast_cache.remove(&rel);
                        let _ = self.get_or_parse_ast(&path);
                        eprintln!("[Rust Watcher] ⚡ Incremental cache refresh for '{}'", rel);
                    }
                    FileWatchEvent::Removed(path) => {
                        let rel = self.relative_path_str(&path);
                        self.ast_cache.remove(&rel);
                        if let Some(ref conn) = self.db_conn {
                            let _ = NativeSqliteCache::delete_dart_file(conn, &rel);
                        }
                        eprintln!("[Rust Watcher] 🗑️ Removed deleted file from cache: '{}'", rel);
                    }
                }
            }
        }
    }

    /// Reads a Dart file and returns `(source_code, DartParsedAst)`, utilizing in-memory and SQLite caches
    fn get_or_parse_ast(&mut self, file_path: &Path) -> Option<(String, DartParsedAst)> {
        let code = fs::read_to_string(file_path).ok()?;
        let rel_path = self.relative_path_str(file_path);

        #[cfg(not(target_arch = "wasm32"))]
        let hash = NativeSqliteCache::compute_hash(&code);
        #[cfg(target_arch = "wasm32")]
        let hash = format!("{:x}", code.len());

        // 1. Check fast in-memory AST cache
        if let Some((cached_hash, cached_ast)) = self.ast_cache.get(&rel_path) {
            if *cached_hash == hash {
                return Some((code, cached_ast.clone()));
            }
        }

        // 2. Check persistent SQLite cache if hash matches
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(ref conn) = self.db_conn {
            if let Ok(Some(cached_json)) =
                NativeSqliteCache::get_dart_file_if_hash_matches(conn, &rel_path, &hash)
            {
                if let Ok(ast) = serde_json::from_str::<DartParsedAst>(&cached_json) {
                    self.ast_cache.insert(rel_path, (hash, ast.clone()));
                    return Some((code, ast));
                }
            }
        }

        // 3. Parse fresh AST and persist in both caches
        let ast = PureDartParser::parse(&code);

        #[cfg(not(target_arch = "wasm32"))]
        if let Some(ref conn) = self.db_conn {
            if let Ok(serialized) = serde_json::to_string(&ast) {
                let _ = NativeSqliteCache::upsert_dart_file(conn, &rel_path, &hash, &serialized);
            }
        }

        self.ast_cache.insert(rel_path, (hash, ast.clone()));
        Some((code, ast))
    }

    fn resolve_path(&self, p: &str) -> PathBuf {
        let path = Path::new(p);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.project_root.join(p)
        }
    }

    /// Ensures target path for write/edit operations does not escape `project_root` via `..`
    fn resolve_safe_write_path(&self, p: &str) -> Result<PathBuf, String> {
        let raw_path = Path::new(p);
        if raw_path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err("Path traversal ('..') is not allowed in write/edit operations.".to_string());
        }
        let resolved = self.resolve_path(p);
        if raw_path.is_absolute() && !resolved.starts_with(&self.project_root) {
            return Err(format!(
                "Target path '{}' is outside the active project root '{}'.",
                resolved.display(),
                self.project_root.display()
            ));
        }
        Ok(resolved)
    }

    fn relative_path_str(&self, path: &Path) -> String {
        path.strip_prefix(&self.project_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }

    fn find_dart_files(&self) -> Vec<PathBuf> {
        let mut results = Vec::new();
        let lib_dir = self.project_root.join("lib");
        if lib_dir.exists() {
            Self::walk_dir(&lib_dir, &mut results, Some("dart"));
        } else {
            Self::walk_dir(&self.project_root, &mut results, Some("dart"));
        }
        results.sort();
        results
    }

    fn files_for_optional_path(&self, path_opt: Option<&str>, ext_filter: Option<&str>) -> Vec<PathBuf> {
        if let Some(p) = path_opt.filter(|s| !s.trim().is_empty()) {
            let resolved = self.resolve_path(p);
            if resolved.is_dir() {
                let mut res = Vec::new();
                Self::walk_dir(&resolved, &mut res, ext_filter);
                res.sort();
                res
            } else if resolved.exists() {
                vec![resolved]
            } else {
                Vec::new()
            }
        } else {
            self.find_dart_files()
        }
    }

    fn walk_dir(dir: &Path, results: &mut Vec<PathBuf>, ext_filter: Option<&str>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let file_name = entry.file_name();
                    let name_str = file_name.to_string_lossy();
                    if !name_str.starts_with('.')
                        && name_str != "node_modules"
                        && name_str != "build"
                        && name_str != "target"
                    {
                        Self::walk_dir(&path, results, ext_filter);
                    }
                } else if let Some(target_ext) = ext_filter {
                    if path.extension().map_or(false, |ext| ext == target_ext) {
                        results.push(path);
                    }
                } else {
                    results.push(path);
                }
            }
        }
    }

    fn render_tree(dir: &Path, prefix: &str, depth: usize, max_depth: usize, out: &mut String) {
        if depth > max_depth {
            return;
        }
        if let Ok(mut entries) = fs::read_dir(dir) {
            let mut items: Vec<_> = entries
                .by_ref()
                .flatten()
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().to_string();
                    !n.starts_with('.') && n != "node_modules" && n != "build" && n != "target"
                })
                .collect();
            items.sort_by_key(|e| e.file_name());

            for (idx, entry) in items.iter().enumerate() {
                let is_last = idx + 1 == items.len();
                let name = entry.file_name().to_string_lossy().to_string();

                let connector = if is_last { "└── " } else { "├── " };
                let child_prefix = if is_last { "    " } else { "│   " };

                let path = entry.path();
                if path.is_dir() {
                    out.push_str(&format!("{}{}{}/\n", prefix, connector, name));
                    Self::render_tree(
                        &path,
                        &format!("{}{}", prefix, child_prefix),
                        depth + 1,
                        max_depth,
                        out,
                    );
                } else {
                    out.push_str(&format!("{}{}{}\n", prefix, connector, name));
                }
            }
        }
    }
}

/// Atomically writes content to `target` using a sibling temporary file + rename
fn atomic_write_file(target: &Path, content: &str) -> io::Result<()> {
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp_path = target.with_extension("flutter_explorer_tmp");
    fs::write(&tmp_path, content)?;
    if let Err(rename_err) = fs::rename(&tmp_path, target) {
        // Fallback to direct write if cross-device or OS lock prevents rename
        let _ = fs::remove_file(&tmp_path);
        fs::write(target, content).map_err(|_| rename_err)?;
    }
    Ok(())
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
            "initialize" => Some(JsonRpcResponse {
                jsonrpc: "2.0",
                id: req_id,
                result: Some(json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "flutter-explorer-rust-mcp",
                        "version": "1.1.0"
                    }
                })),
                error: None,
            }),
            "notifications/initialized" => None,
            "ping" => Some(JsonRpcResponse {
                jsonrpc: "2.0",
                id: req_id,
                result: Some(json!({})),
                error: None,
            }),
            "tools/list" => Some(JsonRpcResponse {
                jsonrpc: "2.0",
                id: req_id,
                result: Some(json!({
                    "tools": [
                        {
                            "name": "flutter_search",
                            "description": "Ultra-fast search for Dart/Flutter classes, widgets, functions, methods, and enums across the project using Rust AST & BM25 ranking",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": { "type": "string", "description": "Symbol name or search query" },
                                    "filter": { "type": "string", "enum": ["class", "widget", "function", "enum"], "description": "Optional type filter" }
                                },
                                "required": ["query"]
                            }
                        },
                        {
                            "name": "flutter_search_text",
                            "description": "Fast regex or plain-text search across all Dart and project files (comments, strings, code)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": { "type": "string", "description": "Search pattern or regex" },
                                    "caseSensitive": { "type": "boolean", "description": "Case-sensitive search (default false)" },
                                    "path": { "type": "string", "description": "Optional folder or file path to limit search" }
                                },
                                "required": ["query"]
                            }
                        },
                        {
                            "name": "flutter_find_references",
                            "description": "Find all usages, references, and occurrences of a class, function, or symbol across all project files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "symbol": { "type": "string", "description": "Name of the class, function, or symbol to find" }
                                },
                                "required": ["symbol"]
                            }
                        },
                        {
                            "name": "flutter_get_code_block",
                            "description": "Extract full body, signature, and comments of a class, method, function, or enum by name from any file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string", "description": "Class, method, function, or enum name" },
                                    "filePath": { "type": "string", "description": "Optional specific file path" }
                                },
                                "required": ["name"]
                            }
                        },
                        {
                            "name": "flutter_read_lines",
                            "description": "Read an exact line range from any file with line numbers (cost-effective code reading)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Relative or absolute file path" },
                                    "startLine": { "type": "integer", "description": "Start line (1-based, default: 1)" },
                                    "endLine": { "type": "integer", "description": "End line (1-based)" },
                                    "maxLines": { "type": "integer", "description": "Maximum lines to read (default: 100)" }
                                },
                                "required": ["filePath"]
                            }
                        },
                        {
                            "name": "flutter_get_file_info",
                            "description": "Get complete parsed AST summary of a Dart file (classes, methods, functions, widgets, enums, line counts)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Relative or absolute path to the Dart file" }
                                },
                                "required": ["filePath"]
                            }
                        },
                        {
                            "name": "flutter_edit_file",
                            "description": "Safely replace an exact string in a project file with atomic write verification",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Path to file" },
                                    "oldText": { "type": "string", "description": "Exact text to replace" },
                                    "newText": { "type": "string", "description": "New replacement text" },
                                    "replaceAll": { "type": "boolean", "description": "Replace all occurrences (default false)" }
                                },
                                "required": ["filePath", "oldText", "newText"]
                            }
                        },
                        {
                            "name": "flutter_write_file",
                            "description": "Create or overwrite a file in the project, automatically creating parent directories",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "File path to create" },
                                    "content": { "type": "string", "description": "File contents" },
                                    "overwrite": { "type": "boolean", "description": "Allow overwriting existing files (default false)" }
                                },
                                "required": ["filePath", "content"]
                            }
                        },
                        {
                            "name": "flutter_get_project_structure",
                            "description": "Render a clean ASCII directory tree of the project (defaults to lib/)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Root path to display (default: 'lib')" },
                                    "maxDepth": { "type": "integer", "description": "Maximum traversal depth (default: 4)" }
                                }
                            }
                        },
                        {
                            "name": "flutter_get_pubspec",
                            "description": "Read the contents of the project's pubspec.yaml file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_list_packages",
                            "description": "Extract dependencies from pubspec.yaml / pubspec.lock",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_get_reverse_deps",
                            "description": "Find which other files in the project import and depend on a given file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "targetFile": { "type": "string", "description": "File path to find dependents for (e.g. 'models/user.dart')" }
                                },
                                "required": ["targetFile"]
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
                            "name": "flutter_detect_mockups",
                            "description": "Find placeholder code, TODO/FIXME comments, fake mock data, and empty callbacks",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Optional folder or file to scan" }
                                }
                            }
                        },
                        {
                            "name": "flutter_detect_memory_leaks",
                            "description": "Detect undisposed controllers (AnimationController, TextEditingController, ScrollController) in Flutter State classes",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Optional folder or file to scan" }
                                }
                            }
                        },
                        {
                            "name": "flutter_parse_ast",
                            "description": "Parse a Dart file into pure Rust AST structure (classes, inheritance, methods, widgets, enums)",
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
            }),
            "tools/call" => {
                state.process_watcher_events();

                let params = request.params.unwrap_or(Value::Null);
                let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));

                let tool_result = match tool_name {
                    "flutter_set_project_path" => {
                        let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                        let candidate = PathBuf::from(path_str);
                        if !candidate.exists() || !candidate.is_dir() {
                            json!({
                                "isError": true,
                                "content": [{
                                    "type": "text",
                                    "text": format!("Directory '{}' does not exist or is not a valid directory.", candidate.display())
                                }]
                            })
                        } else {
                            let canonical = fs::canonicalize(&candidate).unwrap_or(candidate);
                            state.init_project_services(&canonical);
                            json!({
                                "content": [{
                                    "type": "text",
                                    "text": format!("Project path successfully set to: {}", state.project_root.display())
                                }]
                            })
                        }
                    }
                    "flutter_get_project_path" => {
                        json!({
                            "content": [{
                                "type": "text",
                                "text": format!("{}", state.project_root.display())
                            }]
                        })
                    }
                    "flutter_read_lines" => {
                        let file_path = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let target = state.resolve_path(file_path);
                        match fs::read_to_string(&target) {
                            Ok(content) => {
                                let lines: Vec<&str> = content.lines().collect();
                                let total = lines.len();
                                let start_line = args
                                    .get("startLine")
                                    .and_then(|v| v.as_i64())
                                    .unwrap_or(1)
                                    .max(1) as usize;
                                let max_lines = args
                                    .get("maxLines")
                                    .and_then(|v| v.as_i64())
                                    .unwrap_or(100)
                                    .max(1) as usize;
                                let default_end = (start_line + max_lines - 1).min(total);
                                let end_line = args
                                    .get("endLine")
                                    .and_then(|v| v.as_i64())
                                    .map(|v| (v as usize).min(total))
                                    .unwrap_or(default_end);

                                let mut output = format!(
                                    "File: {} (Lines {}-{} of {})\n\n",
                                    state.relative_path_str(&target),
                                    start_line,
                                    end_line,
                                    total
                                );
                                if start_line <= end_line {
                                    for idx in (start_line - 1)..end_line {
                                        if idx < total {
                                            output.push_str(&format!(
                                                "{:4} | {}\n",
                                                idx + 1,
                                                lines[idx]
                                            ));
                                        }
                                    }
                                }
                                json!({ "content": [{ "type": "text", "text": output }] })
                            }
                            Err(e) => {
                                json!({ "isError": true, "content": [{ "type": "text", "text": format!("Error reading '{}': {}", target.display(), e) }] })
                            }
                        }
                    }
                    "flutter_get_code_block" => {
                        let target_name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let file_path_opt = args.get("filePath").and_then(|v| v.as_str());

                        let files_to_scan = if let Some(fp) = file_path_opt {
                            vec![state.resolve_path(fp)]
                        } else {
                            state.find_dart_files()
                        };

                        let mut found_blocks = Vec::new();
                        for file in files_to_scan {
                            let rel_path = state.relative_path_str(&file);
                            if let Some((code, ast)) = state.get_or_parse_ast(&file) {
                                let lines: Vec<&str> = code.lines().collect();

                                for cls in ast.classes {
                                    if cls.name == target_name {
                                        let start = cls.line.saturating_sub(1);
                                        let end = cls.line_end.unwrap_or(cls.line + 40).min(lines.len());
                                        let block = lines[start..end].join("\n");
                                        found_blocks.push(format!(
                                            "// File: {} (Class {} : Lines {}-{})\n{}",
                                            rel_path, cls.name, cls.line, end, block
                                        ));
                                    }
                                    for m in cls.methods {
                                        if m.name == target_name {
                                            let start = m.line.saturating_sub(1);
                                            let end = m.line_end.unwrap_or(m.line + 25).min(lines.len());
                                            let block = lines[start..end].join("\n");
                                            found_blocks.push(format!(
                                                "// File: {} (Method {}.{} : Lines {}-{})\n{}",
                                                rel_path, cls.name, m.name, m.line, end, block
                                            ));
                                        }
                                    }
                                }

                                for fn_item in ast.functions {
                                    if fn_item.name == target_name {
                                        let start = fn_item.line.saturating_sub(1);
                                        let end = fn_item.line_end.unwrap_or(fn_item.line + 25).min(lines.len());
                                        let block = lines[start..end].join("\n");
                                        found_blocks.push(format!(
                                            "// File: {} (Function {} : Lines {}-{})\n{}",
                                            rel_path, fn_item.name, fn_item.line, end, block
                                        ));
                                    }
                                }

                                for enm in ast.enums {
                                    if enm.name == target_name {
                                        let start = enm.line.saturating_sub(1);
                                        let end = enm.line_end.unwrap_or(enm.line + 20).min(lines.len());
                                        let block = lines[start..end].join("\n");
                                        found_blocks.push(format!(
                                            "// File: {} (Enum {} : Lines {}-{})\n{}",
                                            rel_path, enm.name, enm.line, end, block
                                        ));
                                    }
                                }
                            }
                        }

                        if found_blocks.is_empty() {
                            json!({ "content": [{ "type": "text", "text": format!("Symbol '{}' not found in scanned files.", target_name) }] })
                        } else {
                            json!({ "content": [{ "type": "text", "text": found_blocks.join("\n\n---\n\n") }] })
                        }
                    }
                    "flutter_search_text" => {
                        let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                        let case_sensitive = args
                            .get("caseSensitive")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let path_filter = args.get("path").and_then(|v| v.as_str());

                        let files = state.files_for_optional_path(path_filter, None);

                        let re_res = if case_sensitive {
                            Regex::new(query)
                        } else {
                            Regex::new(&format!("(?i){}", query))
                        };

                        let query_lower = query.to_lowercase();
                        let mut matches = Vec::new();
                        for file in files {
                            if let Ok(content) = fs::read_to_string(&file) {
                                let rel = state.relative_path_str(&file);
                                for (idx, line_content) in content.lines().enumerate() {
                                    let matched = match &re_res {
                                        Ok(re) => re.is_match(line_content),
                                        Err(_) => {
                                            if case_sensitive {
                                                line_content.contains(query)
                                            } else {
                                                line_content.to_lowercase().contains(&query_lower)
                                            }
                                        }
                                    };
                                    if matched {
                                        matches.push(json!({
                                            "file": rel,
                                            "line": idx + 1,
                                            "content": line_content.trim()
                                        }));
                                        if matches.len() >= 100 {
                                            break;
                                        }
                                    }
                                }
                            }
                            if matches.len() >= 100 {
                                break;
                            }
                        }

                        json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&matches).unwrap_or_else(|_| "[]".to_string()) }] })
                    }
                    "flutter_find_references" => {
                        let symbol = args.get("symbol").and_then(|v| v.as_str()).unwrap_or("");
                        if symbol.is_empty() {
                            json!({ "isError": true, "content": [{ "type": "text", "text": "Symbol is required" }] })
                        } else {
                            let word_pattern = format!(r"\b{}\b", regex::escape(symbol));
                            let re = Regex::new(&word_pattern).unwrap();
                            let files = state.find_dart_files();
                            let mut refs = Vec::new();

                            for file in files {
                                if let Ok(code) = fs::read_to_string(&file) {
                                    let rel = state.relative_path_str(&file);
                                    for (idx, line_str) in code.lines().enumerate() {
                                        if re.is_match(line_str) {
                                            refs.push(json!({
                                                "file": rel,
                                                "line": idx + 1,
                                                "context": line_str.trim()
                                            }));
                                        }
                                    }
                                }
                            }

                            json!({
                                "content": [{
                                    "type": "text",
                                    "text": serde_json::to_string_pretty(&json!({
                                        "symbol": symbol,
                                        "occurrencesCount": refs.len(),
                                        "usages": refs
                                    })).unwrap_or_else(|_| "{}".to_string())
                                }]
                            })
                        }
                    }
                    "flutter_get_file_info" => {
                        let file_path = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let target = state.resolve_path(file_path);
                        let rel = state.relative_path_str(&target);
                        match state.get_or_parse_ast(&target) {
                            Some((_, ast)) => {
                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": serde_json::to_string_pretty(&json!({
                                            "file": rel,
                                            "linesCount": ast.total_lines,
                                            "classesCount": ast.classes.len(),
                                            "functionsCount": ast.functions.len(),
                                            "enumsCount": ast.enums.len(),
                                            "classes": ast.classes,
                                            "functions": ast.functions,
                                            "enums": ast.enums
                                        })).unwrap_or_else(|_| "{}".to_string())
                                    }]
                                })
                            }
                            None => {
                                json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to read or parse '{}'", target.display()) }] })
                            }
                        }
                    }
                    "flutter_edit_file" => {
                        let file_path = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let old_text = args.get("oldText").and_then(|v| v.as_str()).unwrap_or("");
                        let new_text = args.get("newText").and_then(|v| v.as_str()).unwrap_or("");
                        let replace_all = args
                            .get("replaceAll")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);

                        match state.resolve_safe_write_path(file_path) {
                            Ok(target) => match fs::read_to_string(&target) {
                                Ok(content) => {
                                    let count = content.matches(old_text).count();
                                    if count == 0 {
                                        json!({ "isError": true, "content": [{ "type": "text", "text": format!("oldText not found in '{}'", target.display()) }] })
                                    } else if count > 1 && !replace_all {
                                        json!({ "isError": true, "content": [{ "type": "text", "text": format!("oldText matches {} times in '{}'. Use replaceAll: true or provide more surrounding context.", count, target.display()) }] })
                                    } else {
                                        let new_content = if replace_all {
                                            content.replace(old_text, new_text)
                                        } else {
                                            content.replacen(old_text, new_text, 1)
                                        };
                                        match atomic_write_file(&target, &new_content) {
                                            Ok(_) => {
                                                let rel = state.relative_path_str(&target);
                                                state.ast_cache.remove(&rel);
                                                if target.extension().map_or(false, |e| e == "dart") {
                                                    let _ = state.get_or_parse_ast(&target);
                                                }
                                                let replaced = if replace_all { count } else { 1 };
                                                json!({ "content": [{ "type": "text", "text": format!("Successfully edited '{}' ({} occurrence(s) replaced).", rel, replaced) }] })
                                            }
                                            Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to write file: {}", e) }] }),
                                        }
                                    }
                                }
                                Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to read file: {}", e) }] }),
                            },
                            Err(err_msg) => json!({ "isError": true, "content": [{ "type": "text", "text": err_msg }] }),
                        }
                    }
                    "flutter_write_file" => {
                        let file_path = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        let overwrite = args
                            .get("overwrite")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);

                        match state.resolve_safe_write_path(file_path) {
                            Ok(target) => {
                                if target.exists() && !overwrite {
                                    json!({ "isError": true, "content": [{ "type": "text", "text": format!("File '{}' already exists and overwrite is false.", target.display()) }] })
                                } else {
                                    match atomic_write_file(&target, content) {
                                        Ok(_) => {
                                            let rel = state.relative_path_str(&target);
                                            state.ast_cache.remove(&rel);
                                            if target.extension().map_or(false, |e| e == "dart") {
                                                let _ = state.get_or_parse_ast(&target);
                                            }
                                            json!({ "content": [{ "type": "text", "text": format!("Successfully wrote '{}'.", rel) }] })
                                        }
                                        Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to write file: {}", e) }] }),
                                    }
                                }
                            }
                            Err(err_msg) => json!({ "isError": true, "content": [{ "type": "text", "text": err_msg }] }),
                        }
                    }
                    "flutter_get_project_structure" => {
                        let path_arg = args.get("path").and_then(|v| v.as_str()).unwrap_or("lib");
                        let max_depth = args.get("maxDepth").and_then(|v| v.as_i64()).unwrap_or(4) as usize;
                        let target_dir = state.resolve_path(path_arg);

                        if !target_dir.exists() {
                            json!({ "isError": true, "content": [{ "type": "text", "text": format!("Directory '{}' does not exist.", target_dir.display()) }] })
                        } else {
                            let mut tree = format!("{}/\n", path_arg);
                            McpServerState::render_tree(&target_dir, "", 1, max_depth, &mut tree);
                            json!({ "content": [{ "type": "text", "text": tree }] })
                        }
                    }
                    "flutter_get_pubspec" => {
                        let pubspec = state.project_root.join("pubspec.yaml");
                        match fs::read_to_string(&pubspec) {
                            Ok(content) => json!({ "content": [{ "type": "text", "text": content }] }),
                            Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("pubspec.yaml not found: {}", e) }] }),
                        }
                    }
                    "flutter_list_packages" => {
                        let pubspec_path = state.project_root.join("pubspec.yaml");
                        let mut packages = Vec::new();
                        if let Ok(content) = fs::read_to_string(&pubspec_path) {
                            let mut section: Option<&str> = None;
                            let mut dep_indent: Option<usize> = None;

                            for line in content.lines() {
                                let trimmed = line.trim();
                                if trimmed.is_empty() || trimmed.starts_with('#') {
                                    continue;
                                }

                                let indent = line.chars().take_while(|&c| c == ' ' || c == '\t').count();

                                if indent == 0 && trimmed.ends_with(':') {
                                    if trimmed == "dependencies:" {
                                        section = Some("dependencies");
                                        dep_indent = None;
                                    } else if trimmed == "dev_dependencies:" {
                                        section = Some("dev_dependencies");
                                        dep_indent = None;
                                    } else {
                                        section = None;
                                        dep_indent = None;
                                    }
                                    continue;
                                }

                                if let Some(sec) = section {
                                    let target_indent = *dep_indent.get_or_insert(indent);
                                    // Only capture direct child keys under dependencies / dev_dependencies, skipping nested git/path/sdk sub-keys
                                    if indent == target_indent && trimmed.contains(':') {
                                        let mut parts = trimmed.splitn(2, ':');
                                        let name = parts.next().unwrap_or("").trim();
                                        let raw_version = parts
                                            .next()
                                            .unwrap_or("")
                                            .split('#')
                                            .next()
                                            .unwrap_or("")
                                            .trim();
                                        if !name.is_empty() && name != "flutter" && name != "flutter_test" && name != "sdk" {
                                            packages.push(json!({
                                                "name": name,
                                                "version": if raw_version.is_empty() { "complex/sub-spec" } else { raw_version },
                                                "dev": sec == "dev_dependencies"
                                            }));
                                        }
                                    }
                                }
                            }
                        }
                        json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&packages).unwrap_or_else(|_| "[]".to_string()) }] })
                    }
                    "flutter_get_reverse_deps" => {
                        let target_file = args.get("targetFile").and_then(|v| v.as_str()).unwrap_or("");
                        let target_base = Path::new(target_file)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(target_file);
                        let clean_target = target_file.replace('\\', "/");

                        let files = state.find_dart_files();
                        let mut importing_files = Vec::new();

                        for file in files {
                            if let Ok(code) = fs::read_to_string(&file) {
                                let rel = state.relative_path_str(&file);
                                if rel == clean_target {
                                    continue;
                                }
                                for (idx, line) in code.lines().enumerate() {
                                    let trimmed = line.trim();
                                    if (trimmed.starts_with("import ")
                                        || trimmed.starts_with("export ")
                                        || trimmed.starts_with("part "))
                                        && (trimmed.contains(&clean_target) || trimmed.contains(target_base))
                                    {
                                        importing_files.push(json!({
                                            "file": rel.clone(),
                                            "line": idx + 1,
                                            "statement": trimmed
                                        }));
                                        break;
                                    }
                                }
                            }
                        }

                        json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&importing_files).unwrap_or_else(|_| "[]".to_string()) }] })
                    }
                    "flutter_detect_mockups" => {
                        let path_arg = args.get("path").and_then(|v| v.as_str());
                        let files = state.files_for_optional_path(path_arg, Some("dart"));

                        let mock_patterns = [
                            ("TODO", "TODO comment detected"),
                            ("FIXME", "FIXME comment detected"),
                            ("Lorem ipsum", "Dummy placeholder text"),
                            ("setState(() {})", "Empty setState callback"),
                            ("throw UnimplementedError", "Unimplemented stub"),
                            ("Mock", "Potential mock class/object in production code"),
                        ];

                        let mut findings = Vec::new();
                        for file in files {
                            if let Ok(code) = fs::read_to_string(&file) {
                                let rel = state.relative_path_str(&file);
                                for (idx, line) in code.lines().enumerate() {
                                    for (pat, desc) in &mock_patterns {
                                        if line.contains(pat) {
                                            findings.push(json!({
                                                "file": rel.clone(),
                                                "line": idx + 1,
                                                "type": pat,
                                                "description": desc,
                                                "snippet": line.trim()
                                            }));
                                        }
                                    }
                                }
                            }
                        }

                        json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&findings).unwrap_or_else(|_| "[]".to_string()) }] })
                    }
                    "flutter_detect_memory_leaks" => {
                        let path_arg = args.get("path").and_then(|v| v.as_str());
                        let files = state.files_for_optional_path(path_arg, Some("dart"));
                        let patterns = memory_leak_patterns();

                        let mut leaks = Vec::new();
                        for file in files {
                            if let Ok(code) = fs::read_to_string(&file) {
                                let rel = state.relative_path_str(&file);
                                let has_state = code.contains("State<") || code.contains("ConsumerState<");
                                if !has_state {
                                    continue;
                                }

                                let mut reported_vars = HashSet::new();

                                for pat in patterns {
                                    let mut candidate_vars = Vec::new();
                                    for cap in pat.assign_re.captures_iter(&code) {
                                        if let Some(m) = cap.get(1) {
                                            candidate_vars.push(m.as_str().to_string());
                                        }
                                    }
                                    for cap in pat.decl_re.captures_iter(&code) {
                                        if let Some(m) = cap.get(1) {
                                            candidate_vars.push(m.as_str().to_string());
                                        }
                                    }

                                    for var_name in candidate_vars {
                                        if !reported_vars.insert(var_name.clone()) {
                                            continue;
                                        }
                                        let dispose_call = format!("{}.dispose()", var_name);
                                        let null_safe_dispose = format!("{}?.dispose()", var_name);
                                        let cancel_call = format!("{}.cancel()", var_name);
                                        let null_safe_cancel = format!("{}?.cancel()", var_name);
                                        let close_call = format!("{}.close()", var_name);

                                        if !code.contains(&dispose_call)
                                            && !code.contains(&null_safe_dispose)
                                            && !code.contains(&cancel_call)
                                            && !code.contains(&null_safe_cancel)
                                            && !code.contains(&close_call)
                                        {
                                            leaks.push(json!({
                                                "file": rel.clone(),
                                                "controllerType": pat.controller_type,
                                                "variableName": var_name,
                                                "severity": "high",
                                                "warning": format!("Controller '{}' of type '{}' is declared in a State class but never disposed/cancelled in dispose().", var_name, pat.controller_type)
                                            }));
                                        }
                                    }
                                }
                            }
                        }

                        json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&leaks).unwrap_or_else(|_| "[]".to_string()) }] })
                    }
                    "flutter_parse_ast" => {
                        let file_path_str = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let target_path = state.resolve_path(file_path_str);

                        match state.get_or_parse_ast(&target_path) {
                            Some((_, ast)) => {
                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": serde_json::to_string_pretty(&ast).unwrap_or_else(|_| "{}".to_string())
                                    }]
                                })
                            }
                            None => {
                                json!({
                                    "isError": true,
                                    "content": [{
                                        "type": "text",
                                        "text": format!("Failed to read file '{}'", target_path.display())
                                    }]
                                })
                            }
                        }
                    }
                    "flutter_get_code_warnings" => {
                        let path_arg = args.get("path").and_then(|v| v.as_str());
                        let files = state.files_for_optional_path(path_arg, Some("dart"));
                        let scanner = CodeScanner::new();
                        let mut all_warnings = Vec::new();

                        for file in files {
                            if let Ok(code) = fs::read_to_string(&file) {
                                let warnings = scanner.scan_warnings(&code);
                                if !warnings.is_empty() {
                                    let rel_path = state.relative_path_str(&file);
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
                        let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("").trim();
                        let filter = args.get("filter").and_then(|v| v.as_str());
                        let files = state.find_dart_files();

                        let mut bm25_docs = Vec::new();
                        let mut item_by_id: HashMap<String, Value> = HashMap::new();

                        for file in files {
                            let rel_path = state.relative_path_str(&file);
                            if let Some((_, ast)) = state.get_or_parse_ast(&file) {
                                // 1. Classes & Widgets
                                if filter.is_none() || filter == Some("class") || filter == Some("widget") {
                                    for cls in &ast.classes {
                                        if filter == Some("widget") && cls.r#type != "widget" {
                                            continue;
                                        }
                                        if filter == Some("class") && cls.r#type != "class" {
                                            continue;
                                        }
                                        let id = format!("class:{}:{}:{}", rel_path, cls.line, cls.name);
                                        bm25_docs.push(BM25Document {
                                            id: id.clone(),
                                            fields: BM25DocumentFields {
                                                name: cls.name.clone(),
                                                path: Some(rel_path.clone()),
                                                superclass: cls.extends_class.clone(),
                                                comments: cls.doc_comment.clone(),
                                            },
                                        });
                                        item_by_id.insert(
                                            id,
                                            json!({
                                                "name": cls.name,
                                                "type": cls.r#type,
                                                "file": rel_path,
                                                "line": cls.line,
                                                "lineEnd": cls.line_end,
                                                "extends": cls.extends_class
                                            }),
                                        );
                                    }
                                }

                                // 2. Top-level Functions & Class Methods
                                if filter.is_none() || filter == Some("function") {
                                    for fn_item in &ast.functions {
                                        let id = format!("fn:{}:{}:{}", rel_path, fn_item.line, fn_item.name);
                                        bm25_docs.push(BM25Document {
                                            id: id.clone(),
                                            fields: BM25DocumentFields {
                                                name: fn_item.name.clone(),
                                                path: Some(rel_path.clone()),
                                                superclass: Some(fn_item.return_type.clone()),
                                                comments: fn_item.doc_comment.clone(),
                                            },
                                        });
                                        item_by_id.insert(
                                            id,
                                            json!({
                                                "name": fn_item.name,
                                                "type": "function",
                                                "file": rel_path,
                                                "line": fn_item.line,
                                                "lineEnd": fn_item.line_end,
                                                "returnType": fn_item.return_type
                                            }),
                                        );
                                    }

                                    for cls in &ast.classes {
                                        for method in &cls.methods {
                                            let id = format!(
                                                "method:{}:{}:{}.{}",
                                                rel_path, method.line, cls.name, method.name
                                            );
                                            bm25_docs.push(BM25Document {
                                                id: id.clone(),
                                                fields: BM25DocumentFields {
                                                    name: method.name.clone(),
                                                    path: Some(rel_path.clone()),
                                                    superclass: Some(cls.name.clone()),
                                                    comments: method.doc_comment.clone(),
                                                },
                                            });
                                            item_by_id.insert(
                                                id,
                                                json!({
                                                    "name": method.name,
                                                    "type": "method",
                                                    "parentClass": cls.name,
                                                    "file": rel_path,
                                                    "line": method.line,
                                                    "lineEnd": method.line_end,
                                                    "returnType": method.return_type
                                                }),
                                            );
                                        }
                                    }
                                }

                                // 3. Enums
                                if filter.is_none() || filter == Some("enum") {
                                    for enm in &ast.enums {
                                        let id = format!("enum:{}:{}:{}", rel_path, enm.line, enm.name);
                                        let values_comment = if enm.values.is_empty() {
                                            enm.doc_comment.clone()
                                        } else {
                                            Some(format!(
                                                "{} {}",
                                                enm.values.join(" "),
                                                enm.doc_comment.as_deref().unwrap_or("")
                                            ))
                                        };
                                        bm25_docs.push(BM25Document {
                                            id: id.clone(),
                                            fields: BM25DocumentFields {
                                                name: enm.name.clone(),
                                                path: Some(rel_path.clone()),
                                                superclass: None,
                                                comments: values_comment,
                                            },
                                        });
                                        item_by_id.insert(
                                            id,
                                            json!({
                                                "name": enm.name,
                                                "type": "enum",
                                                "values": enm.values,
                                                "file": rel_path,
                                                "line": enm.line,
                                                "lineEnd": enm.line_end
                                            }),
                                        );
                                    }
                                }
                            }
                        }

                        // Rank all candidate symbols using BM25Engine
                        let mut ranked_results = Vec::new();
                        if !bm25_docs.is_empty() {
                            let engine = BM25Engine::new(bm25_docs);
                            let ranked = engine.search(query, 50);
                            for hit in ranked {
                                if let Some(mut entry) = item_by_id.remove(&hit.id) {
                                    if let Some(obj) = entry.as_object_mut() {
                                        obj.insert("score".to_string(), json!(hit.score));
                                    }
                                    ranked_results.push(entry);
                                }
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&ranked_results).unwrap_or_else(|_| "[]".to_string())
                            }]
                        })
                    }
                    "flutter_get_stats" => {
                        let files = state.find_dart_files();
                        let total_files = files.len();
                        let mut total_lines = 0;
                        let mut total_classes = 0;
                        let mut total_widgets = 0;
                        let mut total_functions = 0;
                        let mut total_enums = 0;
                        let mut active_paths = HashSet::new();

                        for file in files {
                            let rel = state.relative_path_str(&file);
                            active_paths.insert(rel);
                            if let Some((_, ast)) = state.get_or_parse_ast(&file) {
                                total_lines += ast.total_lines;
                                total_functions += ast.functions.len();
                                total_enums += ast.enums.len();
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
                            let _ = NativeSqliteCache::prune_missing_files(conn, &active_paths);
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
                                    "functionsCount": total_functions,
                                    "enumsCount": total_enums,
                                    "cachedInSqlite": cached_dart_files,
                                    "cachedInMemory": state.ast_cache.len(),
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
            unknown_method => Some(JsonRpcResponse {
                jsonrpc: "2.0",
                id: req_id,
                result: None,
                error: Some(json!({
                    "code": -32601,
                    "message": format!("Method not found: '{}'", unknown_method)
                })),
            }),
        };

        if let Some(resp) = response {
            let serialized = serde_json::to_string(&resp).unwrap();
            let _ = writeln!(stdout, "{}", serialized);
            let _ = stdout.flush();
        }
    }
}
