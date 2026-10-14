use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
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
use parser::{DartParsedAst, DartWidgetInfo, PureDartParser};
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
        let initial_root = std::env::var("FLUTTER_PROJECT_PATH")
            .ok()
            .filter(|s| !s.trim().is_empty() && s != "${workspaceFolder}")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

        let mut state = Self {
            project_root: initial_root.clone(),
            ast_cache: HashMap::new(),
            #[cfg(not(target_arch = "wasm32"))]
            db_conn: None,
            #[cfg(not(target_arch = "wasm32"))]
            watcher_handle: None,
            #[cfg(not(target_arch = "wasm32"))]
            watcher_rx: None,
        };
        state.init_project_services(&initial_root);
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

    fn get_or_parse_ast(&mut self, file_path: &Path) -> Option<(String, DartParsedAst)> {
        let code = fs::read_to_string(file_path).ok()?;
        let rel_path = self.relative_path_str(file_path);

        #[cfg(not(target_arch = "wasm32"))]
        let hash = NativeSqliteCache::compute_hash(&code);
        #[cfg(target_arch = "wasm32")]
        let hash = format!("{:x}", code.len());

        if let Some((cached_hash, cached_ast)) = self.ast_cache.get(&rel_path) {
            if *cached_hash == hash {
                return Some((code, cached_ast.clone()));
            }
        }

        #[cfg(not(target_arch = "wasm32"))]
        if let Some(ref conn) = self.db_conn {
            if let Ok(Some(cached_json)) =
                NativeSqliteCache::get_dart_file_if_hash_matches(conn, &rel_path, &hash)
            {
                if let Ok(mut ast) = serde_json::from_str::<DartParsedAst>(&cached_json) {
                    if ast.total_lines == 0 {
                        ast.total_lines = code.lines().count();
                    }
                    self.ast_cache.insert(rel_path, (hash, ast.clone()));
                    return Some((code, ast));
                }
            }
        }

        let ast = PureDartParser::parse(&code);

        #[cfg(not(target_arch = "wasm32"))]
        if let Some(ref conn) = self.db_conn {
            // Only write to SQLite if no rich VS Code entry exists for this path yet
            if NativeSqliteCache::get_dart_file(conn, &rel_path)
                .ok()
                .flatten()
                .is_none()
            {
                if let Ok(serialized) = serde_json::to_string(&ast) {
                    let _ = NativeSqliteCache::upsert_dart_file(conn, &rel_path, &hash, &serialized);
                }
            }
        }

        self.ast_cache.insert(rel_path, (hash, ast.clone()));
        Some((code, ast))
    }

    fn resolve_path(&self, p: &str) -> PathBuf {
        let clean = p.trim().trim_matches(|c| c == '\'' || c == '"');
        let path = Path::new(clean);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.project_root.join(clean)
        }
    }

    fn resolve_safe_write_path(&self, p: &str) -> Result<PathBuf, String> {
        let clean = p.trim().trim_matches(|c| c == '\'' || c == '"');
        let raw_path = Path::new(clean);
        if raw_path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err("Path traversal ('..') is not allowed in write/edit operations.".to_string());
        }
        let resolved = self.resolve_path(clean);
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

    fn find_arb_files(&self) -> Vec<PathBuf> {
        let mut results = Vec::new();
        let lib_dir = self.project_root.join("lib");
        if lib_dir.exists() {
            Self::walk_dir(&lib_dir, &mut results, Some("arb"));
        } else {
            Self::walk_dir(&self.project_root, &mut results, Some("arb"));
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

    fn project_package_name(&self) -> Option<String> {
        let pubspec = self.project_root.join("pubspec.yaml");
        let content = fs::read_to_string(pubspec).ok()?;
        for line in content.lines() {
            if let Some(rest) = line.strip_prefix("name:") {
                let name = rest.split('#').next().unwrap_or("").trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
        None
    }

    fn resolve_dart_import(&self, from_rel: &str, import_uri: &str, pkg_name: Option<&str>) -> Option<String> {
        if import_uri.starts_with("dart:") {
            return None;
        }
        if let Some(rest) = import_uri.strip_prefix("package:") {
            if let Some(proj) = pkg_name {
                let prefix = format!("{}/", proj);
                if let Some(sub) = rest.strip_prefix(&prefix) {
                    return Some(format!("lib/{}", sub));
                }
            }
            return None;
        }
        let from_dir = Path::new(from_rel).parent().unwrap_or_else(|| Path::new(""));
        let joined = from_dir.join(import_uri);
        let mut parts: Vec<String> = Vec::new();
        for comp in joined.components() {
            match comp {
                Component::Normal(os) => parts.push(os.to_string_lossy().to_string()),
                Component::ParentDir => {
                    parts.pop();
                }
                _ => {}
            }
        }
        Some(parts.join("/"))
    }
}

fn atomic_write_file(target: &Path, content: &str) -> io::Result<()> {
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp_path = target.with_extension("flutter_explorer_tmp");
    fs::write(&tmp_path, content)?;
    if let Err(rename_err) = fs::rename(&tmp_path, target) {
        let _ = fs::remove_file(&tmp_path);
        fs::write(target, content).map_err(|_| rename_err)?;
    }
    Ok(())
}

fn measure_widget_tree_depth(nodes: &[DartWidgetInfo]) -> (usize, String) {
    let mut best_depth = 0usize;
    let mut best_path = String::new();
    for node in nodes {
        let (child_depth, child_path) = measure_widget_tree_depth(&node.children);
        let current_depth = 1 + child_depth;
        if current_depth > best_depth {
            best_depth = current_depth;
            best_path = if child_path.is_empty() {
                node.name.clone()
            } else {
                format!("{} > {}", node.name, child_path)
            };
        }
    }
    (best_depth, best_path)
}

fn count_widget_nodes(nodes: &[DartWidgetInfo]) -> usize {
    nodes.iter().map(|n| 1 + count_widget_nodes(&n.children)).sum()
}

fn classify_arch_layer(rel_path: &str) -> &'static str {
    let lower = rel_path.to_ascii_lowercase();
    if lower.contains("/domain/")
        || lower.contains("/entities/")
        || lower.contains("/usecases/")
        || lower.contains("/use_cases/")
    {
        "domain"
    } else if lower.contains("/data/")
        || lower.contains("/datasources/")
        || lower.contains("/repositories/")
        || lower.contains("/models/")
        || lower.contains("/dto/")
    {
        "data"
    } else if lower.contains("/presentation/")
        || lower.contains("/ui/")
        || lower.contains("/screens/")
        || lower.contains("/pages/")
        || lower.contains("/views/")
        || lower.contains("/widgets/")
        || lower.contains("/bloc/")
        || lower.contains("/cubit/")
        || lower.contains("/controllers/")
        || lower.contains("/providers/")
    {
        "presentation"
    } else if lower.contains("/core/")
        || lower.contains("/common/")
        || lower.contains("/shared/")
        || lower.contains("/utils/")
        || lower.contains("/theme/")
        || lower.contains("/config/")
    {
        "core"
    } else {
        "other"
    }
}

fn dfs_find_cycles(
    node: &str,
    adj: &HashMap<String, Vec<String>>,
    visited: &mut HashSet<String>,
    stack: &mut Vec<String>,
    on_stack: &mut HashSet<String>,
    cycles: &mut Vec<Vec<String>>,
) {
    visited.insert(node.to_string());
    stack.push(node.to_string());
    on_stack.insert(node.to_string());

    if let Some(neighbors) = adj.get(node) {
        for next in neighbors {
            if !visited.contains(next) {
                dfs_find_cycles(next, adj, visited, stack, on_stack, cycles);
            } else if on_stack.contains(next) {
                if let Some(pos) = stack.iter().position(|x| x == next) {
                    let mut cycle: Vec<String> = stack[pos..].to_vec();
                    cycle.push(next.clone());
                    if cycles.len() < 50 {
                        cycles.push(cycle);
                    }
                }
            }
        }
    }

    stack.pop();
    on_stack.remove(node);
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
                        "version": "1.2.6"
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
                            "description": "Get complete parsed AST summary of a Dart file (classes, methods, functions, widgets, enums, imports, line counts)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Relative or absolute path to the Dart file" }
                                },
                                "required": ["filePath"]
                            }
                        },
                        {
                            "name": "flutter_get_node_at_cursor",
                            "description": "Find the innermost Dart declaration (class, method, function, enum) enclosing a specific 1-based line number",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Path to Dart file" },
                                    "line": { "type": "integer", "description": "1-based line number" }
                                },
                                "required": ["filePath", "line"]
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
                            "name": "flutter_replace_lines",
                            "description": "Safely replace a 1-based inclusive line range [startLine, endLine] in a file with optional expectedOldText guard",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Path to file" },
                                    "startLine": { "type": "integer", "description": "1-based start line (inclusive)" },
                                    "endLine": { "type": "integer", "description": "1-based end line (inclusive)" },
                                    "newText": { "type": "string", "description": "Replacement lines" },
                                    "expectedOldText": { "type": "string", "description": "Optional substring expected in the replaced range for safety" }
                                },
                                "required": ["filePath", "startLine", "endLine", "newText"]
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
                            "description": "Read the contents of the project's pubspec.yaml (or build.gradle) file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_list_packages",
                            "description": "Extract dependencies and dev_dependencies from pubspec.yaml",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_get_dependencies",
                            "description": "Get outgoing imports, exports, and resolved local file dependencies of a given Dart file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "File path to inspect" }
                                },
                                "required": ["filePath"]
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
                            "name": "flutter_detect_circular_dependencies",
                            "description": "Detect circular import chains (cycles) across all project Dart files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_get_architectural_layers",
                            "description": "Classify project files into Clean Architecture layers (presentation, domain, data, core), compute Lakos instability metrics, and detect cross-layer violations",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_analyze_widget_depth",
                            "description": "Analyze Flutter Widget tree nesting depth inside build() methods and flag overly deep trees",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "maxDepth": { "type": "integer", "description": "Maximum allowed widget nesting depth (default: 6)" },
                                    "path": { "type": "string", "description": "Optional file or folder path" }
                                }
                            }
                        },
                        {
                            "name": "flutter_detect_unused_assets",
                            "description": "Find image/font/json assets in the project's assets/ directory that are never referenced in Dart code or pubspec.yaml",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_get_code_warnings",
                            "description": "Scan project Dart files for hardcoded strings and colors in milliseconds",
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
                            "description": "Detect undisposed controllers (AnimationController, TextEditingController, ScrollController, FocusNode, StreamSubscription) in Flutter State classes",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Optional folder or file to scan" }
                                }
                            }
                        },
                        {
                            "name": "flutter_list_translations",
                            "description": "List all localization keys and values across project .arb files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "locale": { "type": "string", "description": "Optional locale filter (e.g. 'en', 'ar')" }
                                }
                            }
                        },
                        {
                            "name": "flutter_get_missing_translations",
                            "description": "Compare all .arb localization files and report keys missing in each locale",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_update_translation",
                            "description": "Add or update a localization key-value pair in an .arb file while preserving JSON structure",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Relative path to .arb file (e.g. 'lib/l10n/intl_en.arb')" },
                                    "key": { "type": "string", "description": "Translation key" },
                                    "value": { "type": "string", "description": "Translated text value" }
                                },
                                "required": ["filePath", "key", "value"]
                            }
                        },
                        {
                            "name": "flutter_delete_translation",
                            "description": "Delete a translation key (and its @key metadata) from a specific .arb file or all .arb files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "key": { "type": "string", "description": "Translation key to delete" },
                                    "filePath": { "type": "string", "description": "Optional specific .arb file path (if omitted, deletes from all .arb files)" }
                                },
                                "required": ["key"]
                            }
                        },
                        {
                            "name": "flutter_find_unused_translations",
                            "description": "Find localization keys defined in .arb files that are never referenced in any Dart file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_get_diagnostics",
                            "description": "Get cached IDE diagnostics from SQLite metadata along with static code warnings",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_get_index_status",
                            "description": "Get detailed health and row counts of the SQLite cache and in-memory AST index",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_rebuild_index",
                            "description": "Re-scan and index all Dart and ARB files in the active project into the SQLite cache",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_run_analyze",
                            "description": "Run `dart analyze` / `flutter analyze` on the project and return structured compiler diagnostics",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_run_build_runner",
                            "description": "Run `dart run build_runner build --delete-conflicting-outputs` in the active project",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_parse_ast",
                            "description": "Parse a Dart file into pure Rust AST structure (classes, inheritance, methods, widgets, enums, imports)",
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
                            "description": "Get instant summary metrics of the Flutter project (total files, classes, widgets, functions, enums, lines)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "flutter_set_project_path",
                            "description": "Set the active Flutter project root directory and re-bind SQLite cache and file watcher",
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
                    "flutter_get_node_at_cursor" => {
                        let file_path = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let line = args.get("line").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                        let target = state.resolve_path(file_path);
                        let rel = state.relative_path_str(&target);

                        match state.get_or_parse_ast(&target) {
                            Some((_, ast)) => {
                                let mut best_node: Option<Value> = None;
                                let mut best_span = usize::MAX;

                                let mut consider = |start: usize, end: usize, val: Value| {
                                    if start <= line && line <= end {
                                        let span = end.saturating_sub(start);
                                        if span < best_span {
                                            best_span = span;
                                            best_node = Some(val);
                                        }
                                    }
                                };

                                for cls in ast.classes {
                                    let cls_end = cls.line_end.unwrap_or(cls.line + 80);
                                    consider(
                                        cls.line,
                                        cls_end,
                                        json!({
                                            "type": cls.r#type,
                                            "name": cls.name,
                                            "file": rel,
                                            "line": cls.line,
                                            "lineEnd": cls_end
                                        }),
                                    );
                                    for m in cls.methods {
                                        let m_end = m.line_end.unwrap_or(m.line + 40);
                                        consider(
                                            m.line,
                                            m_end,
                                            json!({
                                                "type": "method",
                                                "name": m.name,
                                                "parentClass": cls.name,
                                                "returnType": m.return_type,
                                                "file": rel,
                                                "line": m.line,
                                                "lineEnd": m_end
                                            }),
                                        );
                                    }
                                }

                                for fn_item in ast.functions {
                                    let fn_end = fn_item.line_end.unwrap_or(fn_item.line + 40);
                                    consider(
                                        fn_item.line,
                                        fn_end,
                                        json!({
                                            "type": "function",
                                            "name": fn_item.name,
                                            "returnType": fn_item.return_type,
                                            "file": rel,
                                            "line": fn_item.line,
                                            "lineEnd": fn_end
                                        }),
                                    );
                                }

                                for enm in ast.enums {
                                    let enm_end = enm.line_end.unwrap_or(enm.line + 25);
                                    consider(
                                        enm.line,
                                        enm_end,
                                        json!({
                                            "type": "enum",
                                            "name": enm.name,
                                            "values": enm.values,
                                            "file": rel,
                                            "line": enm.line,
                                            "lineEnd": enm_end
                                        }),
                                    );
                                }

                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": serde_json::to_string_pretty(&best_node.unwrap_or_else(|| json!({ "node": null, "file": rel, "line": line }))).unwrap_or_else(|_| "{}".to_string())
                                    }]
                                })
                            }
                            None => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Could not read or parse '{}'", target.display()) }] }),
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
                                            "widgetsCount": count_widget_nodes(&ast.widgets),
                                            "importsCount": ast.imports.len(),
                                            "classes": ast.classes,
                                            "functions": ast.functions,
                                            "enums": ast.enums,
                                            "widgets": ast.widgets,
                                            "mixins": ast.mixins,
                                            "extensions": ast.extensions,
                                            "typedefs": ast.typedefs,
                                            "variables": ast.variables,
                                            "constructors": ast.constructors,
                                            "properties": ast.properties,
                                            "annotations": ast.annotations,
                                            "imports": ast.imports,
                                            "exports": ast.exports
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
                    "flutter_replace_lines" => {
                        let file_path = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let start_line = args.get("startLine").and_then(|v| v.as_i64()).unwrap_or(1).max(1) as usize;
                        let end_line = args.get("endLine").and_then(|v| v.as_i64()).unwrap_or(start_line as i64).max(1) as usize;
                        let new_text = args.get("newText").and_then(|v| v.as_str()).unwrap_or("");
                        let expected_old = args.get("expectedOldText").and_then(|v| v.as_str());

                        match state.resolve_safe_write_path(file_path) {
                            Ok(target) => match fs::read_to_string(&target) {
                                Ok(content) => {
                                    let line_ending = if content.contains("\r\n") { "\r\n" } else { "\n" };
                                    let lines: Vec<&str> = content.lines().collect();
                                    if start_line > end_line || start_line == 0 || end_line > lines.len() {
                                        json!({
                                            "isError": true,
                                            "content": [{
                                                "type": "text",
                                                "text": format!("Invalid line range {}..{} for file '{}' ({} lines).", start_line, end_line, target.display(), lines.len())
                                            }]
                                        })
                                    } else {
                                        let existing_slice = lines[(start_line - 1)..end_line].join("\n");
                                        if let Some(exp) = expected_old {
                                            if !existing_slice.contains(exp.trim()) {
                                                json!({
                                                    "isError": true,
                                                    "content": [{
                                                        "type": "text",
                                                        "text": format!("expectedOldText guard failed: target lines {}..{} did not contain expected text.", start_line, end_line)
                                                    }]
                                                })
                                            } else {
                                                let mut updated: Vec<String> = Vec::new();
                                                for l in &lines[..(start_line - 1)] {
                                                    updated.push((*l).to_string());
                                                }
                                                if !new_text.is_empty() {
                                                    for l in new_text.lines() {
                                                        updated.push(l.to_string());
                                                    }
                                                }
                                                for l in &lines[end_line..] {
                                                    updated.push((*l).to_string());
                                                }
                                                let final_str = updated.join(line_ending);
                                                match atomic_write_file(&target, &final_str) {
                                                    Ok(_) => {
                                                        let rel = state.relative_path_str(&target);
                                                        state.ast_cache.remove(&rel);
                                                        json!({ "content": [{ "type": "text", "text": format!("Successfully replaced lines {}..{} in '{}'.", start_line, end_line, rel) }] })
                                                    }
                                                    Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to write file: {}", e) }] }),
                                                }
                                            }
                                        } else {
                                            let mut updated: Vec<String> = Vec::new();
                                            for l in &lines[..(start_line - 1)] {
                                                updated.push((*l).to_string());
                                            }
                                            if !new_text.is_empty() {
                                                for l in new_text.lines() {
                                                    updated.push(l.to_string());
                                                }
                                            }
                                            for l in &lines[end_line..] {
                                                updated.push((*l).to_string());
                                            }
                                            let final_str = updated.join(line_ending);
                                            match atomic_write_file(&target, &final_str) {
                                                Ok(_) => {
                                                    let rel = state.relative_path_str(&target);
                                                    state.ast_cache.remove(&rel);
                                                    json!({ "content": [{ "type": "text", "text": format!("Successfully replaced lines {}..{} in '{}'.", start_line, end_line, rel) }] })
                                                }
                                                Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to write file: {}", e) }] }),
                                            }
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
                        if pubspec.exists() {
                            match fs::read_to_string(&pubspec) {
                                Ok(content) => json!({ "content": [{ "type": "text", "text": content }] }),
                                Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Error reading pubspec.yaml: {}", e) }] }),
                            }
                        } else {
                            let gradle = state.project_root.join("app/build.gradle.kts");
                            let gradle_groovy = state.project_root.join("app/build.gradle");
                            if let Ok(c) = fs::read_to_string(&gradle).or_else(|_| fs::read_to_string(&gradle_groovy)) {
                                json!({ "content": [{ "type": "text", "text": c }] })
                            } else {
                                json!({ "isError": true, "content": [{ "type": "text", "text": "pubspec.yaml not found in active project root." }] })
                            }
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
                    "flutter_get_dependencies" => {
                        let file_path = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let target = state.resolve_path(file_path);
                        let rel = state.relative_path_str(&target);
                        let pkg_name = state.project_package_name();

                        match state.get_or_parse_ast(&target) {
                            Some((_, ast)) => {
                                let mut local_deps = Vec::new();
                                let mut package_deps = Vec::new();
                                for imp in &ast.imports {
                                    if let Some(resolved) = state.resolve_dart_import(&rel, imp, pkg_name.as_deref()) {
                                        local_deps.push(resolved);
                                    } else {
                                        package_deps.push(imp.clone());
                                    }
                                }
                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": serde_json::to_string_pretty(&json!({
                                            "file": rel,
                                            "imports": ast.imports,
                                            "exports": ast.exports,
                                            "resolvedLocalFiles": local_deps,
                                            "externalPackages": package_deps
                                        })).unwrap_or_else(|_| "{}".to_string())
                                    }]
                                })
                            }
                            None => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Could not read '{}'", target.display()) }] }),
                        }
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
                    "flutter_detect_circular_dependencies" => {
                        let files = state.find_dart_files();
                        let pkg_name = state.project_package_name();
                        let mut adj: HashMap<String, Vec<String>> = HashMap::new();

                        for file in files {
                            let rel = state.relative_path_str(&file);
                            if let Some((_, ast)) = state.get_or_parse_ast(&file) {
                                let mut targets = Vec::new();
                                for imp in &ast.imports {
                                    if let Some(resolved) = state.resolve_dart_import(&rel, imp, pkg_name.as_deref()) {
                                        targets.push(resolved);
                                    }
                                }
                                adj.insert(rel, targets);
                            }
                        }

                        let mut visited = HashSet::new();
                        let mut stack = Vec::new();
                        let mut on_stack = HashSet::new();
                        let mut cycles = Vec::new();

                        let mut keys: Vec<String> = adj.keys().cloned().collect();
                        keys.sort();
                        for node in &keys {
                            if !visited.contains(node) {
                                dfs_find_cycles(node, &adj, &mut visited, &mut stack, &mut on_stack, &mut cycles);
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "filesAnalyzed": keys.len(),
                                    "cyclesCount": cycles.len(),
                                    "cycles": cycles
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_get_architectural_layers" => {
                        let files = state.find_dart_files();
                        let pkg_name = state.project_package_name();
                        let mut layer_counts: BTreeMap<String, usize> = BTreeMap::new();
                        let mut file_layer: HashMap<String, &'static str> = HashMap::new();
                        let mut outgoing: HashMap<String, HashSet<String>> = HashMap::new();
                        let mut incoming: HashMap<String, HashSet<String>> = HashMap::new();

                        for file in &files {
                            let rel = state.relative_path_str(file);
                            let layer = classify_arch_layer(&rel);
                            *layer_counts.entry(layer.to_string()).or_insert(0) += 1;
                            file_layer.insert(rel.clone(), layer);
                            outgoing.entry(rel.clone()).or_default();
                            incoming.entry(rel.clone()).or_default();
                        }

                        let mut violations = Vec::new();

                        for file in &files {
                            let rel = state.relative_path_str(file);
                            let from_layer = *file_layer.get(&rel).unwrap_or(&"other");
                            if let Some((_, ast)) = state.get_or_parse_ast(file) {
                                for imp in &ast.imports {
                                    if let Some(target_rel) = state.resolve_dart_import(&rel, imp, pkg_name.as_deref()) {
                                        if file_layer.contains_key(&target_rel) && target_rel != rel {
                                            outgoing.entry(rel.clone()).or_default().insert(target_rel.clone());
                                            incoming.entry(target_rel.clone()).or_default().insert(rel.clone());

                                            let to_layer = *file_layer.get(&target_rel).unwrap_or(&"other");
                                            if from_layer == "domain" && (to_layer == "data" || to_layer == "presentation") {
                                                violations.push(json!({
                                                    "from": rel,
                                                    "to": target_rel,
                                                    "fromLayer": from_layer,
                                                    "toLayer": to_layer,
                                                    "violation": format!("Domain layer file imports from {} layer", to_layer)
                                                }));
                                            } else if from_layer == "data" && to_layer == "presentation" {
                                                violations.push(json!({
                                                    "from": rel,
                                                    "to": target_rel,
                                                    "fromLayer": from_layer,
                                                    "toLayer": to_layer,
                                                    "violation": "Data layer file imports from presentation layer"
                                                }));
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Compute average Lakos instability per layer: I = Ce / (Ca + Ce)
                        let mut layer_instability: BTreeMap<String, Vec<f64>> = BTreeMap::new();
                        for (f, &layer) in &file_layer {
                            let ce = outgoing.get(f).map_or(0, |s| s.len()) as f64;
                            let ca = incoming.get(f).map_or(0, |s| s.len()) as f64;
                            let inst = if ca + ce > 0.0 { ce / (ca + ce) } else { 0.0 };
                            layer_instability.entry(layer.to_string()).or_default().push(inst);
                        }

                        let mut coupling_summary = Map::new();
                        for (layer, vals) in layer_instability {
                            let avg = if vals.is_empty() {
                                0.0
                            } else {
                                (vals.iter().sum::<f64>() / vals.len() as f64 * 100.0).round() / 100.0
                            };
                            coupling_summary.insert(
                                layer,
                                json!({
                                    "filesCount": vals.len(),
                                    "avgInstability": avg
                                }),
                            );
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "totalFiles": files.len(),
                                    "layerBreakdown": layer_counts,
                                    "layerCouplingSummary": coupling_summary,
                                    "detectedCrossLayerViolations": violations
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_analyze_widget_depth" => {
                        let max_depth = args.get("maxDepth").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
                        let path_arg = args.get("path").and_then(|v| v.as_str());
                        let files = state.files_for_optional_path(path_arg, Some("dart"));

                        let mut violations = Vec::new();
                        let mut max_observed = 0usize;
                        let mut analyzed_widgets = 0usize;

                        for file in files {
                            let rel = state.relative_path_str(&file);
                            if let Some((_, ast)) = state.get_or_parse_ast(&file) {
                                if ast.widgets.is_empty() {
                                    continue;
                                }
                                analyzed_widgets += ast.widgets.len();
                                let (file_max, deepest_path) = measure_widget_tree_depth(&ast.widgets);
                                if file_max > max_observed {
                                    max_observed = file_max;
                                }
                                if file_max > max_depth {
                                    violations.push(json!({
                                        "file": rel,
                                        "maxDepth": file_max,
                                        "deepestPath": deepest_path,
                                        "recommendation": "Extract deeply nested widget subtrees into dedicated StatelessWidget classes."
                                    }));
                                }
                            }
                        }
                        let analyzed_files = analyzed_widgets;

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "totalWidgetsAnalyzed": analyzed_files,
                                    "maxAllowedDepth": max_depth,
                                    "maxObservedDepth": max_observed,
                                    "violationsCount": violations.len(),
                                    "violations": violations
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_detect_unused_assets" => {
                        let assets_dir = state.project_root.join("assets");
                        if !assets_dir.exists() {
                            json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&json!({ "unusedAssets": [], "message": "No assets/ directory found in project." })).unwrap() }] })
                        } else {
                            let mut asset_files = Vec::new();
                            McpServerState::walk_dir(&assets_dir, &mut asset_files, None);

                            let dart_files = state.find_dart_files();
                            let mut all_code = String::new();
                            for df in dart_files {
                                if let Ok(c) = fs::read_to_string(&df) {
                                    all_code.push_str(&c);
                                    all_code.push('\n');
                                }
                            }

                            let mut unused = Vec::new();
                            for af in &asset_files {
                                let rel = state.relative_path_str(af);
                                let file_name = af.file_name().and_then(|n| n.to_str()).unwrap_or("");
                                if !file_name.is_empty()
                                    && !all_code.contains(&rel)
                                    && !all_code.contains(file_name)
                                {
                                    unused.push(rel);
                                }
                            }

                            json!({
                                "content": [{
                                    "type": "text",
                                    "text": serde_json::to_string_pretty(&json!({
                                        "totalAssetsScanned": asset_files.len(),
                                        "unusedCount": unused.len(),
                                        "unusedAssets": unused
                                    })).unwrap_or_else(|_| "{}".to_string())
                                }]
                            })
                        }
                    }
                    "flutter_detect_mockups" => {
                        let path_arg = args.get("path").and_then(|v| v.as_str());
                        let files = state.files_for_optional_path(path_arg, Some("dart"));

                        let mock_patterns = [
                            ("TODO", "TODO comment detected"),
                            ("FIXME", "FIXME comment detected"),
                            ("Lorem ipsum", "Dummy placeholder text"),
                            ("setState(() {})", "Empty setState callback"),
                            ("onPressed: () {}", "Empty onPressed callback"),
                            ("throw UnimplementedError", "Unimplemented stub"),
                            ("Placeholder(", "Placeholder widget in UI"),
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
                    "flutter_list_translations" => {
                        let locale_filter = args.get("locale").and_then(|v| v.as_str());
                        let arb_files = state.find_arb_files();
                        let mut result = Map::new();

                        for file in arb_files {
                            let rel = state.relative_path_str(&file);
                            if let Some(loc) = locale_filter {
                                if !rel.contains(loc) {
                                    continue;
                                }
                            }
                            if let Ok(content) = fs::read_to_string(&file) {
                                if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&content) {
                                    let mut clean_entries = Map::new();
                                    for (k, v) in map {
                                        if !k.starts_with('@') {
                                            clean_entries.insert(k, v);
                                        }
                                    }
                                    result.insert(rel, Value::Object(clean_entries));
                                }
                            }
                        }

                        json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string()) }] })
                    }
                    "flutter_get_missing_translations" => {
                        let arb_files = state.find_arb_files();
                        let mut all_keys: BTreeMap<String, ()> = BTreeMap::new();
                        let mut file_keys: BTreeMap<String, HashSet<String>> = BTreeMap::new();

                        for file in arb_files {
                            let rel = state.relative_path_str(&file);
                            if let Ok(content) = fs::read_to_string(&file) {
                                if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&content) {
                                    let mut ks = HashSet::new();
                                    for k in map.keys() {
                                        if !k.starts_with('@') {
                                            all_keys.insert(k.clone(), ());
                                            ks.insert(k.clone());
                                        }
                                    }
                                    file_keys.insert(rel, ks);
                                }
                            }
                        }

                        let mut report = Vec::new();
                        for (file_rel, ks) in &file_keys {
                            let missing: Vec<String> = all_keys
                                .keys()
                                .filter(|k| !ks.contains(*k))
                                .cloned()
                                .collect();
                            if !missing.is_empty() {
                                report.push(json!({
                                    "filePath": file_rel,
                                    "missingCount": missing.len(),
                                    "missingKeys": missing
                                }));
                            }
                        }

                        json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&report).unwrap_or_else(|_| "[]".to_string()) }] })
                    }
                    "flutter_update_translation" => {
                        let file_path = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                        let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("");
                        let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("");

                        match state.resolve_safe_write_path(file_path) {
                            Ok(target) => {
                                let existing = fs::read_to_string(&target).unwrap_or_else(|_| "{}\n".to_string());
                                match serde_json::from_str::<Map<String, Value>>(&existing) {
                                    Ok(mut obj) => {
                                        obj.insert(key.to_string(), Value::String(value.to_string()));
                                        let serialized = serde_json::to_string_pretty(&obj).unwrap_or_else(|_| "{}".to_string());
                                        match atomic_write_file(&target, &serialized) {
                                            Ok(_) => json!({ "content": [{ "type": "text", "text": format!("Updated key '{}' in '{}'.", key, state.relative_path_str(&target)) }] }),
                                            Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to write ARB file: {}", e) }] }),
                                        }
                                    }
                                    Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Invalid JSON in '{}': {}", target.display(), e) }] }),
                                }
                            }
                            Err(msg) => json!({ "isError": true, "content": [{ "type": "text", "text": msg }] }),
                        }
                    }
                    "flutter_delete_translation" => {
                        let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("");
                        let file_opt = args.get("filePath").and_then(|v| v.as_str());
                        let targets = if let Some(fp) = file_opt {
                            match state.resolve_safe_write_path(fp) {
                                Ok(t) => vec![t],
                                Err(_) => Vec::new(),
                            }
                        } else {
                            state.find_arb_files()
                        };

                        let meta_key = format!("@{}", key);
                        let mut modified_files = Vec::new();

                        for target in targets {
                            if let Ok(content) = fs::read_to_string(&target) {
                                if let Ok(mut obj) = serde_json::from_str::<Map<String, Value>>(&content) {
                                    let removed_main = obj.remove(key).is_some();
                                    let removed_meta = obj.remove(&meta_key).is_some();
                                    if removed_main || removed_meta {
                                        if let Ok(serialized) = serde_json::to_string_pretty(&obj) {
                                            if atomic_write_file(&target, &serialized).is_ok() {
                                                modified_files.push(state.relative_path_str(&target));
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "deletedKey": key,
                                    "modifiedFiles": modified_files
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_find_unused_translations" => {
                        let arb_files = state.find_arb_files();
                        let mut all_keys = HashSet::new();
                        for file in arb_files {
                            if let Ok(content) = fs::read_to_string(&file) {
                                if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&content) {
                                    for k in map.keys() {
                                        if !k.starts_with('@') {
                                            all_keys.insert(k.clone());
                                        }
                                    }
                                }
                            }
                        }

                        let dart_files = state.find_dart_files();
                        let mut all_code = String::new();
                        for df in dart_files {
                            let rel = state.relative_path_str(&df);
                            if rel.contains("/generated/") || rel.ends_with(".g.dart") {
                                continue;
                            }
                            if let Ok(c) = fs::read_to_string(&df) {
                                all_code.push_str(&c);
                                all_code.push('\n');
                            }
                        }

                        let mut unused: Vec<String> = all_keys
                            .into_iter()
                            .filter(|k| !all_code.contains(k.as_str()))
                            .collect();
                        unused.sort();

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "unusedCount": unused.len(),
                                    "unusedKeys": unused
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_get_diagnostics" => {
                        #[cfg(not(target_arch = "wasm32"))]
                        let cached_diags: Value = if let Some(ref conn) = state.db_conn {
                            NativeSqliteCache::get_metadata(conn, "diagnostics")
                                .ok()
                                .flatten()
                                .and_then(|s| serde_json::from_str(&s).ok())
                                .unwrap_or_else(|| json!([]))
                        } else {
                            json!([])
                        };
                        #[cfg(target_arch = "wasm32")]
                        let cached_diags = json!([]);

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "ideDiagnostics": cached_diags
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_get_index_status" => {
                        #[cfg(not(target_arch = "wasm32"))]
                        let (dart_cnt, arb_cnt, meta_cnt) = if let Some(ref conn) = state.db_conn {
                            (
                                NativeSqliteCache::count_table(conn, "dart_files"),
                                NativeSqliteCache::count_table(conn, "arb_files"),
                                NativeSqliteCache::count_table(conn, "metadata"),
                            )
                        } else {
                            (0, 0, 0)
                        };
                        #[cfg(target_arch = "wasm32")]
                        let (dart_cnt, arb_cnt, meta_cnt) = (0, 0, 0);

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "projectRoot": state.project_root.display().to_string(),
                                    "sqliteConnected": state.db_conn.is_some(),
                                    "inMemoryAstCount": state.ast_cache.len(),
                                    "sqliteCounts": {
                                        "dart_files": dart_cnt,
                                        "arb_files": arb_cnt,
                                        "metadata": meta_cnt
                                    }
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_rebuild_index" => {
                        state.ast_cache.clear();
                        let files = state.find_dart_files();
                        let mut indexed = 0usize;
                        for f in &files {
                            if state.get_or_parse_ast(f).is_some() {
                                indexed += 1;
                            }
                        }
                        json!({
                            "content": [{
                                "type": "text",
                                "text": format!("Rebuilt index for {} Dart files in '{}'.", indexed, state.project_root.display())
                            }]
                        })
                    }
                    "flutter_run_analyze" => {
                        let bin = if cfg!(windows) { "flutter.bat" } else { "flutter" };
                        let output_res = Command::new(bin)
                            .arg("analyze")
                            .current_dir(&state.project_root)
                            .output()
                            .or_else(|_| {
                                let dart_bin = if cfg!(windows) { "dart.bat" } else { "dart" };
                                Command::new(dart_bin)
                                    .arg("analyze")
                                    .current_dir(&state.project_root)
                                    .output()
                            });

                        match output_res {
                            Ok(out) => {
                                let stdout_str = String::from_utf8_lossy(&out.stdout).to_string();
                                let stderr_str = String::from_utf8_lossy(&out.stderr).to_string();
                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": serde_json::to_string_pretty(&json!({
                                            "success": out.status.success(),
                                            "exitCode": out.status.code(),
                                            "stdout": stdout_str,
                                            "stderr": stderr_str
                                        })).unwrap_or_else(|_| "{}".to_string())
                                    }]
                                })
                            }
                            Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to invoke flutter/dart analyze: {}", e) }] }),
                        }
                    }
                    "flutter_run_build_runner" => {
                        let dart_bin = if cfg!(windows) { "dart.bat" } else { "dart" };
                        match Command::new(dart_bin)
                            .args(["run", "build_runner", "build", "--delete-conflicting-outputs"])
                            .current_dir(&state.project_root)
                            .output()
                        {
                            Ok(out) => {
                                let stdout_str = String::from_utf8_lossy(&out.stdout).to_string();
                                let stderr_str = String::from_utf8_lossy(&out.stderr).to_string();
                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": serde_json::to_string_pretty(&json!({
                                            "success": out.status.success(),
                                            "exitCode": out.status.code(),
                                            "stdout": stdout_str,
                                            "stderr": stderr_str
                                        })).unwrap_or_else(|_| "{}".to_string())
                                    }]
                                })
                            }
                            Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to invoke build_runner: {}", e) }] }),
                        }
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
                                    total_functions += cls.methods.len();
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
