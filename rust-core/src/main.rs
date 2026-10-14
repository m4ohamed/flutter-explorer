#![recursion_limit = "512"]
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;
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

        let ast = PureDartParser::parse_by_extension(&rel_path, &code);

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

    fn detect_project_mode(&self) -> &'static str {
        if self.project_root.join("pubspec.yaml").exists() {
            "flutter"
        } else if self.project_root.join("build.gradle").exists()
            || self.project_root.join("build.gradle.kts").exists()
            || self.project_root.join("settings.gradle").exists()
            || self.project_root.join("settings.gradle.kts").exists()
            || self.project_root.join("app").join("src").join("main").exists()
        {
            "android"
        } else if self.project_root.join("package.json").exists()
            || self.project_root.join("tsconfig.json").exists()
        {
            "web"
        } else {
            "flutter"
        }
    }

    fn find_dart_files(&self) -> Vec<PathBuf> {
        let mut results = Vec::new();
        let mode = self.detect_project_mode();
        match mode {
            "flutter" => {
                let lib_dir = self.project_root.join("lib");
                if lib_dir.exists() {
                    Self::walk_dir(&lib_dir, &mut results, Some("dart"));
                } else {
                    Self::walk_dir(&self.project_root, &mut results, Some("dart"));
                }
                let android_app_dir = self.project_root.join("android").join("app");
                if android_app_dir.exists() {
                    Self::walk_dir(&android_app_dir, &mut results, Some("android"));
                }
            }
            "android" => {
                Self::walk_dir(&self.project_root, &mut results, Some("android"));
            }
            "web" => {
                Self::walk_dir(&self.project_root, &mut results, Some("web"));
            }
            _ => {
                Self::walk_dir(&self.project_root, &mut results, Some("code"));
            }
        }
        results.sort();
        results.dedup();
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
                    let ext_lower = path
                        .extension()
                        .map(|e| e.to_string_lossy().to_ascii_lowercase())
                        .unwrap_or_default();
                    let matched = match target_ext {
                        "dart" | "code" => matches!(
                            ext_lower.as_str(),
                            "dart" | "kt" | "java" | "xml" | "gradle" | "kts" | "ts" | "tsx" | "js" | "jsx"
                        ),
                        "android" => matches!(
                            ext_lower.as_str(),
                            "kt" | "java" | "xml" | "gradle" | "kts"
                        ),
                        "web" => matches!(
                            ext_lower.as_str(),
                            "ts" | "tsx" | "js" | "jsx"
                        ),
                        other => ext_lower == other,
                    };
                    if matched {
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


#[derive(Debug, Clone, Serialize, Deserialize)]
struct PackageConfigEntry {
    name: String,
    root_uri: String,
    package_uri: String,
    actual_dir: PathBuf,
}

fn load_package_config(project_root: &Path) -> Vec<PackageConfigEntry> {
    let config_path = project_root.join(".dart_tool").join("package_config.json");
    let content = match fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let parsed: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let dart_tool_dir = project_root.join(".dart_tool");
    let mut entries = Vec::new();

    if let Some(pkgs) = parsed.get("packages").and_then(|v| v.as_array()) {
        for pkg in pkgs {
            let name = pkg.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let root_uri = pkg.get("rootUri").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let package_uri = pkg.get("packageUri").and_then(|v| v.as_str()).unwrap_or("lib/").to_string();
            if name.is_empty() || root_uri.is_empty() {
                continue;
            }
            let actual_dir = if let Some(stripped) = root_uri.strip_prefix("file:///") {
                let decoded = stripped.replace("%20", " ");
                if cfg!(windows) {
                    PathBuf::from(decoded.replace('/', "\\"))
                } else {
                    PathBuf::from(format!("/{}", decoded))
                }
            } else if let Some(stripped) = root_uri.strip_prefix("file://") {
                PathBuf::from(stripped.replace("%20", " "))
            } else {
                dart_tool_dir.join(&root_uri)
            };
            entries.push(PackageConfigEntry {
                name,
                root_uri,
                package_uri,
                actual_dir,
            });
        }
    }
    entries
}

fn discover_vm_service_uri(project_root: &Path, override_uri: Option<&str>) -> Option<String> {
    if let Some(u) = override_uri.filter(|s| !s.trim().is_empty()) {
        return Some(u.trim().to_string());
    }
    if let Ok(env_u) = std::env::var("DART_VM_SERVICE_URI") {
        if !env_u.trim().is_empty() {
            return Some(env_u.trim().to_string());
        }
    }
    let dart_tool = project_root.join(".dart_tool");
    for candidate in [
        "dart_tooling_daemon.json",
        "flutter_service.json",
        "vm_service_uri.txt",
    ] {
        let p = dart_tool.join(candidate);
        if let Ok(raw) = fs::read_to_string(&p) {
            let trimmed = raw.trim();
            if trimmed.starts_with('{') {
                if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                    for key in ["uri", "vmServiceUri", "toolingDaemonUri"] {
                        if let Some(u) = val.get(key).and_then(|v| v.as_str()) {
                            return Some(u.to_string());
                        }
                    }
                }
            } else if trimmed.starts_with("http") || trimmed.starts_with("ws") {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Calls the local Dart VM Service over HTTP GET JSON-RPC using `std::net::TcpStream`
fn vm_service_http_call(base_uri: &str, method: &str, query_params: &[(&str, &str)]) -> Result<Value, String> {
    let normalized = base_uri
        .trim()
        .replacen("ws://", "http://", 1)
        .replacen("wss://", "https://", 1);
    let without_ws = normalized.trim_end_matches("/ws").trim_end_matches('/');
    let after_scheme = without_ws
        .strip_prefix("http://")
        .or_else(|| without_ws.strip_prefix("https://"))
        .ok_or_else(|| format!("Unsupported VM Service URI: {}", base_uri))?;

    let (host_port, base_path) = match after_scheme.find('/') {
        Some(idx) => (&after_scheme[..idx], &after_scheme[idx..]),
        None => (after_scheme, ""),
    };

    let mut q_str = String::new();
    for (i, (k, v)) in query_params.iter().enumerate() {
        q_str.push(if i == 0 { '?' } else { '&' });
        q_str.push_str(k);
        q_str.push('=');
        q_str.push_str(&v.replace(' ', "%20"));
    }

    let full_path = format!("{}/{}{}", base_path.trim_end_matches('/'), method, q_str);
    let addr_str = if host_port.contains(':') {
        host_port.replace("localhost", "127.0.0.1")
    } else {
        format!("{}:80", host_port.replace("localhost", "127.0.0.1"))
    };

    let sock_addr: SocketAddr = addr_str
        .parse()
        .map_err(|e| format!("Invalid VM Service socket address '{}': {}", addr_str, e))?;

    let mut stream = TcpStream::connect_timeout(&sock_addr, Duration::from_millis(2500))
        .map_err(|e| format!("Failed to connect to VM Service at {}: {}", addr_str, e))?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(4000)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(2500)));

    let req = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        full_path, host_port
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

    let mut resp_bytes = Vec::new();
    let _ = stream.read_to_end(&mut resp_bytes);
    let resp_str = String::from_utf8_lossy(&resp_bytes);

    let body = resp_str
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.trim())
        .unwrap_or("");
    serde_json::from_str::<Value>(body)
        .map_err(|e| format!("Failed to parse VM Service response: {}", e))
}

fn vm_service_find_main_isolate(base_uri: &str) -> Result<String, String> {
    let vm_resp = vm_service_http_call(base_uri, "getVM", &[])?;
    let isolates = vm_resp
        .get("result")
        .and_then(|r| r.get("isolates"))
        .and_then(|i| i.as_array())
        .ok_or_else(|| "No isolates array in getVM response".to_string())?;

    for iso in isolates {
        if let Some(id) = iso.get("id").and_then(|v| v.as_str()) {
            let name = iso.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name == "main" {
                return Ok(id.to_string());
            }
        }
    }
    isolates
        .first()
        .and_then(|i| i.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No active Dart isolate found".to_string())
}

fn widget_subtree_signature(node: &DartWidgetInfo) -> (usize, String) {
    if node.children.is_empty() {
        return (1, node.name.clone());
    }
    let mut total_nodes = 1usize;
    let mut child_sigs = Vec::with_capacity(node.children.len());
    for child in &node.children {
        let (cnt, sig) = widget_subtree_signature(child);
        total_nodes += cnt;
        child_sigs.push(sig);
    }
    (total_nodes, format!("{}({})", node.name, child_sigs.join(",")))
}

fn collect_widget_subtrees(
    nodes: &[DartWidgetInfo],
    file_rel: &str,
    min_nodes: usize,
    clusters: &mut BTreeMap<String, (usize, Vec<Value>)>,
    total_analyzed: &mut usize,
) {
    for node in nodes {
        *total_analyzed += 1;
        let (cnt, sig) = widget_subtree_signature(node);
        if cnt >= min_nodes {
            let entry = clusters.entry(sig).or_insert_with(|| (cnt, Vec::new()));
            entry.1.push(json!({
                "file": file_rel,
                "rootWidget": node.name,
                "line": node.line
            }));
        }
        collect_widget_subtrees(&node.children, file_rel, min_nodes, clusters, total_analyzed);
    }
}

fn extract_icu_placeholders(text: &str) -> BTreeMap<String, ()> {
    let mut result = BTreeMap::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '{' {
            let mut j = i + 1;
            let mut ident = String::new();
            while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_') {
                ident.push(chars[j]);
                j += 1;
            }
            if !ident.is_empty() && j < chars.len() && (chars[j] == '}' || chars[j] == ',') {
                result.insert(ident, ());
            }
        }
        i += 1;
    }
    result
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
            "tools/list" => {
                let tools_list: Vec<Value> = vec![
                        json!({
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
                        }),
                        json!({
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
                        }),
                        json!({
                            "name": "flutter_find_references",
                            "description": "Find all usages, references, and occurrences of a class, function, or symbol across all project files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "symbol": { "type": "string", "description": "Name of the class, function, or symbol to find" }
                                },
                                "required": ["symbol"]
                            }
                        }),
                        json!({
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
                        }),
                        json!({
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
                        }),
                        json!({
                            "name": "flutter_get_file_info",
                            "description": "Get complete parsed AST summary of a Dart file (classes, methods, functions, widgets, enums, imports, line counts)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Relative or absolute path to the Dart file" }
                                },
                                "required": ["filePath"]
                            }
                        }),
                        json!({
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
                        }),
                        json!({
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
                        }),
                        json!({
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
                        }),
                        json!({
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
                        }),
                        json!({
                            "name": "flutter_get_project_structure",
                            "description": "Render a clean ASCII directory tree of the project (defaults to lib/)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Root path to display (default: 'lib')" },
                                    "maxDepth": { "type": "integer", "description": "Maximum traversal depth (default: 4)" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_get_pubspec",
                            "description": "Read the contents of the project's pubspec.yaml (or build.gradle) file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_list_packages",
                            "description": "Extract dependencies and dev_dependencies from pubspec.yaml",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_get_dependencies",
                            "description": "Get outgoing imports, exports, and resolved local file dependencies of a given Dart file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "File path to inspect" }
                                },
                                "required": ["filePath"]
                            }
                        }),
                        json!({
                            "name": "flutter_get_reverse_deps",
                            "description": "Find which other files in the project import and depend on a given file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "targetFile": { "type": "string", "description": "File path to find dependents for (e.g. 'models/user.dart')" }
                                },
                                "required": ["targetFile"]
                            }
                        }),
                        json!({
                            "name": "flutter_detect_circular_dependencies",
                            "description": "Detect circular import chains (cycles) across all project Dart files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_get_architectural_layers",
                            "description": "Classify project files into Clean Architecture layers (presentation, domain, data, core), compute Lakos instability metrics, and detect cross-layer violations",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_analyze_widget_depth",
                            "description": "Analyze Flutter Widget tree nesting depth inside build() methods and flag overly deep trees",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "maxDepth": { "type": "integer", "description": "Maximum allowed widget nesting depth (default: 6)" },
                                    "path": { "type": "string", "description": "Optional file or folder path" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_detect_unused_assets",
                            "description": "Find image/font/json assets in the project's assets/ directory that are never referenced in Dart code or pubspec.yaml",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_get_code_warnings",
                            "description": "Scan project Dart files for hardcoded strings and colors in milliseconds",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Optional specific file or folder to scan" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_detect_mockups",
                            "description": "Find placeholder code, TODO/FIXME comments, fake mock data, and empty callbacks",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Optional folder or file to scan" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_detect_memory_leaks",
                            "description": "Detect undisposed controllers (AnimationController, TextEditingController, ScrollController, FocusNode, StreamSubscription) in Flutter State classes",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Optional folder or file to scan" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_list_translations",
                            "description": "List all localization keys and values across project .arb files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "locale": { "type": "string", "description": "Optional locale filter (e.g. 'en', 'ar')" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_get_missing_translations",
                            "description": "Compare all .arb localization files and report keys missing in each locale",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
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
                        }),
                        json!({
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
                        }),
                        json!({
                            "name": "flutter_find_unused_translations",
                            "description": "Find localization keys defined in .arb files that are never referenced in any Dart file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_get_diagnostics",
                            "description": "Get cached IDE diagnostics from SQLite metadata along with static code warnings",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_get_index_status",
                            "description": "Get detailed health and row counts of the SQLite cache and in-memory AST index",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_rebuild_index",
                            "description": "Re-scan and index all Dart and ARB files in the active project into the SQLite cache",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_run_analyze",
                            "description": "Run `dart analyze` / `flutter analyze` on the project and return structured compiler diagnostics",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_run_build_runner",
                            "description": "Run `dart run build_runner build --delete-conflicting-outputs` in the active project",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_get_detailed_graph",
                            "description": "Get a detailed relationship graph (inheritance, calls, imports, widgets, mixins, extensions) for the project or a specific file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "focusFile": { "type": "string", "description": "Optional: focus the graph on a specific file and its neighbors" },
                                    "depth": { "type": "integer", "description": "Traversal depth around focusFile (default: 1)" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_get_impact_analysis",
                            "description": "Analyze the blast radius of a file: find all application entry points (UI/main/events) and dependent files affected by changes to this file",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "relativePath": { "type": "string", "description": "Relative path of the file to analyze (e.g. lib/core/utils.dart)" },
                                    "filePath": { "type": "string", "description": "Alias for relativePath" },
                                    "path": { "type": "string", "description": "Alias for relativePath" },
                                    "maxDepth": { "type": "integer", "description": "Maximum search depth (default: 25)" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_get_git_blast_radius",
                            "description": "Automatically calculate blast radius and affected entry points/execution flows from current Git diff changes",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "maxDepth": { "type": "integer", "description": "Max traversal depth (default: 25)" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_analyze_logic_flow",
                            "description": "Analyze a function or method's logic, Cyclomatic Complexity, and return a step-by-step execution flow",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "functionName": { "type": "string", "description": "Name of the function or method to analyze" },
                                    "filePath": { "type": "string", "description": "Optional relative path to the file" },
                                    "relativePath": { "type": "string", "description": "Alias for filePath" },
                                    "path": { "type": "string", "description": "Alias for filePath" },
                                    "parentClass": { "type": "string", "description": "Optional parent class name" }
                                },
                                "required": ["functionName"]
                            }
                        }),
                        json!({
                            "name": "flutter_validate_architecture_rules",
                            "description": "Validate Clean Architecture layer boundary rules (e.g. Domain must not depend on Data/UI, Core must not depend on Features)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "customRules": {
                                        "type": "array",
                                        "description": "Optional custom layer boundary rules",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "name": { "type": "string" },
                                                "fromLayer": { "type": "string" },
                                                "forbiddenLayers": { "type": "array", "items": { "type": "string" } },
                                                "description": { "type": "string" }
                                            },
                                            "required": ["name", "fromLayer", "forbiddenLayers", "description"]
                                        }
                                    }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_detect_duplicate_widgets",
                            "description": "Detect duplicate or near-identical widget subtrees across project files and generate proposals for extracting reusable custom widgets",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "minNodeCount": { "type": "integer", "description": "Minimum number of widgets in a subtree to consider for duplication (default: 3)" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_read_fragment",
                            "description": "Read a code fragment by element name (class, function, method, enum) with surrounding comments and optional context lines",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string", "description": "Name of the element to read" },
                                    "elementType": { "type": "string", "enum": ["class", "function", "method", "enum"], "description": "Optional type of element" },
                                    "filePath": { "type": "string", "description": "Optional relative path to the file" },
                                    "relativePath": { "type": "string", "description": "Alias for filePath" },
                                    "path": { "type": "string", "description": "Alias for filePath" },
                                    "parentClass": { "type": "string", "description": "Optional parent class name" },
                                    "includeContext": { "type": "boolean", "description": "Include surrounding context lines (default: false)" },
                                    "contextLines": { "type": "integer", "description": "Number of context lines before/after (default: 3)" }
                                },
                                "required": ["name"]
                            }
                        }),
                        json!({
                            "name": "flutter_get_hints",
                            "description": "Get context-aware workflow suggestions and smart optimization hints based on recent tool usage and project analysis",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "lastToolUsed": { "type": "string", "description": "The name of the tool that was just called" },
                                    "lastResult": { "type": "object", "description": "Optional result of the last tool call" },
                                    "filePath": { "type": "string", "description": "Optional file path for targeted code hints" }
                                },
                                "required": ["lastToolUsed"]
                            }
                        }),
                        json!({
                            "name": "flutter_search_packages",
                            "description": "Search across all cached third-party Dart/Flutter package dependencies in .pub-cache or Flutter SDK",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": { "type": "string", "description": "Search term or regex pattern" },
                                    "packageName": { "type": "string", "description": "Optional package name to limit search (e.g. 'dio' or 'flutter')" },
                                    "isRegex": { "type": "boolean", "description": "Whether query is a regex (default: false)" },
                                    "caseSensitive": { "type": "boolean", "description": "Case-sensitive match (default: false)" },
                                    "maxResults": { "type": "integer", "description": "Max number of matches to return (default: 50)" }
                                },
                                "required": ["query"]
                            }
                        }),
                        json!({
                            "name": "flutter_read_package_source",
                            "description": "Read the source code of any cached third-party package or Flutter SDK library by package URI (e.g. package:flutter/material.dart)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "uri": { "type": "string", "description": "Package URI (e.g. package:flutter/widgets.dart or package:dio/dio.dart)" },
                                    "startLine": { "type": "integer", "description": "Starting line number (1-based, default: 1)" },
                                    "lineCount": { "type": "integer", "description": "Number of lines to read (default: 100)" }
                                },
                                "required": ["uri"]
                            }
                        }),
                        json!({
                            "name": "flutter_pub_dev_search",
                            "description": "Search for packages on pub.dev (with automatic local .pub-cache fallback) to discover libraries and latest versions",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": { "type": "string", "description": "Search query for pub.dev (e.g. 'state management' or 'sqlite')" },
                                    "page": { "type": "integer", "description": "Page number (default: 1)" }
                                },
                                "required": ["query"]
                            }
                        }),
                        json!({
                            "name": "flutter_get_pub_package_info",
                            "description": "Get detailed metrics and metadata for a package from pub.dev (or local cache fallback), including points, likes, version, and dependencies",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "packageName": { "type": "string", "description": "Package name on pub.dev (e.g. 'riverpod' or 'dio')" }
                                },
                                "required": ["packageName"]
                            }
                        }),
                        json!({
                            "name": "flutter_run_intl_generate",
                            "description": "Generate Flutter localization Dart files (l10n.dart / gen-l10n) from project ARB files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_validate_icu_translations",
                            "description": "Validate ICU syntax, placeholder consistency ({name}), and plural/select balance across all ARB translation files",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_auto_translate_missing",
                            "description": "Generate structured translation payload for missing keys across locales, or batch apply translated keys",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "action": { "type": "string", "enum": ["generate_payload", "batch_apply"], "description": "Action: generate_payload or batch_apply" },
                                    "sourceLocale": { "type": "string", "description": "Base locale (default: 'en')" },
                                    "translationsToApply": {
                                        "type": "array",
                                        "description": "Translations to batch apply when action is 'batch_apply'",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "key": { "type": "string" },
                                                "translations": { "type": "object" },
                                                "description": { "type": "string" }
                                            },
                                            "required": ["key", "translations"]
                                        }
                                    }
                                },
                                "required": ["action"]
                            }
                        }),
                        json!({
                            "name": "flutter_hot_reload",
                            "description": "Trigger Hot Reload (ext.flutter.reassemble / reloadSources) on the running Flutter app via the Dart VM Service",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "vmServiceUri": { "type": "string", "description": "Optional VM Service URI. If omitted, automatically discovered." }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_hot_restart",
                            "description": "Trigger a full Hot Restart on the running Flutter application via the Dart VM Service",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "vmServiceUri": { "type": "string", "description": "Optional VM Service URI. If omitted, automatically discovered." }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_get_runtime_errors",
                            "description": "Fetch real-time Flutter runtime errors, isolate exception state, and diagnostics from the running application",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "vmServiceUri": { "type": "string", "description": "Optional VM Service URI. If omitted, automatically discovered." }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_inspect_live_widgets",
                            "description": "Inspect the live running widget tree and render objects of the active Flutter application via VM Service (with static AST fallback)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "vmServiceUri": { "type": "string", "description": "Optional VM Service URI. If omitted, automatically discovered." },
                                    "objectGroup": { "type": "string", "description": "Inspector object group name (default: 'flutter_explorer_group')" }
                                }
                            }
                        }),
                        json!({
                            "name": "flutter_simulate_ui_action",
                            "description": "Simulate user UI interactions (tap, enterText, scroll) on the live running Flutter app via VM Service Flutter Driver extension",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "action": { "type": "string", "enum": ["tap", "enterText", "scroll"], "description": "Type of UI action to simulate" },
                                    "target": { "type": "string", "description": "Target widget key (#key, key:val, text:val, type:val) or visible text" },
                                    "value": { "type": "string", "description": "Text value to enter (for enterText) or scroll offset in pixels (for scroll, default: '-300')" },
                                    "vmUri": { "type": "string", "description": "Optional VM Service URI override" }
                                },
                                "required": ["action", "target"]
                            }
                        }),
                        json!({
                            "name": "flutter_parse_ast",
                            "description": "Parse a Dart file into pure Rust AST structure (classes, inheritance, methods, widgets, enums, imports)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "filePath": { "type": "string", "description": "Relative or absolute file path to parse" }
                                },
                                "required": ["filePath"]
                            }
                        }),
                        json!({
                            "name": "flutter_get_stats",
                            "description": "Get instant summary metrics of the Flutter project (total files, classes, widgets, functions, enums, lines)",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }),
                        json!({
                            "name": "flutter_set_project_path",
                            "description": "Set the active Flutter project root directory and re-bind SQLite cache and file watcher",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Project root directory" }
                                },
                                "required": ["path"]
                            }
                        }),
                        json!({
                            "name": "flutter_get_project_path",
                            "description": "Get the current active Flutter project root directory",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        })
                ];
                Some(JsonRpcResponse {
                    jsonrpc: "2.0",
                    id: req_id,
                    result: Some(json!({ "tools": tools_list })),
                    error: None,
                })
            },
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
                                                    "from": rel.clone(),
                                                    "to": target_rel.clone(),
                                                    "fromLayer": from_layer,
                                                    "toLayer": to_layer,
                                                    "violation": format!("Domain layer file imports from {} layer", to_layer)
                                                }));
                                            } else if from_layer == "data" && to_layer == "presentation" {
                                                violations.push(json!({
                                                    "from": rel.clone(),
                                                    "to": target_rel.clone(),
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
                            ("TODO", "TODO comment or stub detected"),
                            ("FIXME", "FIXME comment detected"),
                            ("Lorem ipsum", "Dummy placeholder text"),
                            ("setState(() {})", "Empty setState callback"),
                            ("onPressed: () {}", "Empty onPressed callback"),
                            ("onClick = {}", "Empty Jetpack Compose onClick callback"),
                            ("setOnClickListener {}", "Empty Android View click listener"),
                            ("onClick={() => {}}", "Empty React onClick handler"),
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
                    "flutter_get_detailed_graph" => {
                        let focus_file = args
                            .get("focusFile")
                            .and_then(|v| v.as_str())
                            .map(|s| s.replace('\\', "/"));
                        let depth = args.get("depth").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                        let pkg_name = state.project_package_name();
                        let files = state.find_dart_files();

                        let mut nodes: Vec<Value> = Vec::new();
                        let mut edges: Vec<Value> = Vec::new();
                        let mut seen_nodes: HashSet<String> = HashSet::new();

                        let mut add_node = |id: String, name: String, kind: &str, file: &str, line: usize| {
                            if seen_nodes.insert(id.clone()) {
                                nodes.push(json!({
                                    "id": id,
                                    "name": name,
                                    "type": kind,
                                    "file": file,
                                    "line": line
                                }));
                            }
                        };

                        let mut add_edge = |src: String, dst: String, kind: &str| {
                            edges.push(json!({
                                "source": src.clone(),
                                "target": dst.clone(),
                                "from": src,
                                "to": dst,
                                "type": kind
                            }));
                        };

                        for file in &files {
                            let rel = state.relative_path_str(file);
                            let file_id = format!("file:{}", rel);
                            let base_name = file.file_name().and_then(|n| n.to_str()).unwrap_or(&rel).to_string();
                            add_node(file_id.clone(), base_name, "file", &rel, 1);

                            if let Some((_, ast)) = state.get_or_parse_ast(file) {
                                for imp in &ast.imports {
                                    if let Some(resolved) = state.resolve_dart_import(&rel, imp, pkg_name.as_deref()) {
                                        let target_id = format!("file:{}", resolved);
                                        let t_name = Path::new(&resolved)
                                            .file_name()
                                            .and_then(|n| n.to_str())
                                            .unwrap_or(&resolved)
                                            .to_string();
                                        add_node(target_id.clone(), t_name, "file", &resolved, 1);
                                        add_edge(file_id.clone(), target_id, "imports");
                                    }
                                }

                                for cls in &ast.classes {
                                    let cls_id = format!("class:{}", cls.name);
                                    add_node(cls_id.clone(), cls.name.clone(), &cls.r#type, &rel, cls.line);
                                    add_edge(file_id.clone(), cls_id.clone(), "contains");

                                    if let Some(ref ext) = cls.extends_class {
                                        add_edge(cls_id.clone(), format!("class:{}", ext), "extends");
                                    }
                                    for impl_name in &cls.implements {
                                        add_edge(cls_id.clone(), format!("class:{}", impl_name), "implements");
                                    }
                                    for mx_name in &cls.mixins {
                                        add_edge(cls_id.clone(), format!("class:{}", mx_name), "mixes_in");
                                    }
                                    for m in &cls.methods {
                                        let m_id = format!("method:{}.{}", cls.name, m.name);
                                        add_node(m_id.clone(), m.name.clone(), "method", &rel, m.line);
                                        add_edge(cls_id.clone(), m_id, "contains");
                                    }
                                }

                                for fn_item in &ast.functions {
                                    let fn_id = format!("func:{}", fn_item.name);
                                    add_node(fn_id.clone(), fn_item.name.clone(), "function", &rel, fn_item.line);
                                    add_edge(file_id.clone(), fn_id, "contains");
                                }

                                for enm in &ast.enums {
                                    let enm_id = format!("enum:{}", enm.name);
                                    add_node(enm_id.clone(), enm.name.clone(), "enum", &rel, enm.line);
                                    add_edge(file_id.clone(), enm_id, "contains");
                                }

                                for call in &ast.function_calls {
                                    let caller_id = match (&call.caller_class, &call.caller_function) {
                                        (Some(c), Some(f)) => format!("method:{}.{}", c, f),
                                        (None, Some(f)) => format!("func:{}", f),
                                        (Some(c), None) => format!("class:{}", c),
                                        (None, None) => file_id.clone(),
                                    };
                                    let callee_id = if let Some(ref rx) = call.receiver {
                                        if rx.chars().next().map_or(false, |c| c.is_ascii_uppercase()) {
                                            format!("method:{}.{}", rx, call.name)
                                        } else {
                                            let mut chars = rx.chars();
                                            let pascal = match chars.next() {
                                                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                                                None => rx.clone(),
                                            };
                                            format!("method:{}.{}", pascal, call.name)
                                        }
                                    } else if let Some(ref c) = call.caller_class {
                                        format!("method:{}.{}", c, call.name)
                                    } else {
                                        format!("func:{}", call.name)
                                    };
                                    if caller_id != callee_id {
                                        add_edge(caller_id, callee_id, "calls");
                                    }
                                }
                            }
                        }

                        if let Some(focus) = focus_file {
                            let seed_file_id = if focus.starts_with("file:") {
                                focus.clone()
                            } else {
                                format!("file:{}", focus)
                            };
                            let mut keep_ids: HashSet<String> = HashSet::new();
                            keep_ids.insert(seed_file_id.clone());
                            for n in &nodes {
                                if n.get("file").and_then(|v| v.as_str()) == Some(focus.as_str()) {
                                    if let Some(id) = n.get("id").and_then(|v| v.as_str()) {
                                        keep_ids.insert(id.to_string());
                                    }
                                }
                            }

                            let mut frontier = keep_ids.clone();
                            for _ in 0..depth {
                                let mut next_f = HashSet::new();
                                for e in &edges {
                                    let s = e.get("source").and_then(|v| v.as_str()).unwrap_or("");
                                    let t = e.get("target").and_then(|v| v.as_str()).unwrap_or("");
                                    if frontier.contains(s) && keep_ids.insert(t.to_string()) {
                                        next_f.insert(t.to_string());
                                    }
                                    if frontier.contains(t) && keep_ids.insert(s.to_string()) {
                                        next_f.insert(s.to_string());
                                    }
                                }
                                frontier = next_f;
                            }

                            nodes.retain(|n| {
                                n.get("id")
                                    .and_then(|v| v.as_str())
                                    .map_or(false, |id| keep_ids.contains(id))
                            });
                            edges.retain(|e| {
                                let s = e.get("source").and_then(|v| v.as_str()).unwrap_or("");
                                let t = e.get("target").and_then(|v| v.as_str()).unwrap_or("");
                                keep_ids.contains(s) && keep_ids.contains(t)
                            });
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "nodesCount": nodes.len(),
                                    "edgesCount": edges.len(),
                                    "nodes": nodes,
                                    "edges": edges
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_get_impact_analysis" => {
                        let raw_path = args
                            .get("relativePath")
                            .or_else(|| args.get("filePath"))
                            .or_else(|| args.get("path"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let max_depth = args.get("maxDepth").and_then(|v| v.as_u64()).unwrap_or(25) as usize;

                        if raw_path.trim().is_empty() {
                            json!({ "isError": true, "content": [{ "type": "text", "text": "Error: relativePath, filePath, or path is required." }] })
                        } else {
                            let target = state.resolve_path(raw_path);
                            let target_rel = state.relative_path_str(&target);
                            let pkg_name = state.project_package_name();
                            let files = state.find_dart_files();

                            let mut reverse_imports: HashMap<String, Vec<String>> = HashMap::new();
                            let mut file_entrypoints: HashMap<String, Vec<String>> = HashMap::new();

                            for file in &files {
                                let rel = state.relative_path_str(file);
                                if let Some((_, ast)) = state.get_or_parse_ast(file) {
                                    for imp in &ast.imports {
                                        if let Some(resolved) = state.resolve_dart_import(&rel, imp, pkg_name.as_deref()) {
                                            reverse_imports.entry(resolved).or_default().push(rel.clone());
                                        }
                                    }
                                    let mut eps = Vec::new();
                                    for f in &ast.functions {
                                        if f.name == "main" {
                                            eps.push(format!("{}:main()", rel));
                                        }
                                    }
                                    for cls in &ast.classes {
                                        for m in &cls.methods {
                                            if m.name == "build" || m.name == "initState" || m.name.starts_with("on") {
                                                eps.push(format!("{}:{}.{}()", rel, cls.name, m.name));
                                            }
                                        }
                                    }
                                    if !eps.is_empty() {
                                        file_entrypoints.insert(rel, eps);
                                    }
                                }
                            }

                            // BFS backwards from target_rel up to max_depth
                            let mut visited: HashSet<String> = HashSet::new();
                            visited.insert(target_rel.clone());
                            let mut frontier: Vec<(String, Vec<String>)> = vec![(target_rel.clone(), vec![target_rel.clone()])];
                            let mut impacted_files = Vec::new();
                            let mut affected_flows = Vec::new();

                            for depth_step in 1..=max_depth {
                                if frontier.is_empty() {
                                    break;
                                }
                                let mut next_frontier = Vec::new();
                                for (curr_file, chain) in frontier {
                                    if let Some(dependents) = reverse_imports.get(&curr_file) {
                                        for dep in dependents {
                                            if visited.insert(dep.clone()) {
                                                let mut new_chain = chain.clone();
                                                new_chain.push(dep.clone());
                                                impacted_files.push(json!({
                                                    "file": dep.clone(),
                                                    "hopDistance": depth_step,
                                                    "importChain": new_chain.clone()
                                                }));
                                                if let Some(eps) = file_entrypoints.get(dep) {
                                                    for ep in eps {
                                                        affected_flows.push(json!({
                                                            "entryPoint": ep,
                                                            "hopDistance": depth_step,
                                                            "chain": new_chain.clone()
                                                        }));
                                                    }
                                                }
                                                next_frontier.push((dep.clone(), new_chain));
                                            }
                                        }
                                    }
                                }
                                frontier = next_frontier;
                            }

                            let risk = if impacted_files.len() > 15 {
                                "critical"
                            } else if impacted_files.len() > 5 {
                                "high"
                            } else if !impacted_files.is_empty() {
                                "medium"
                            } else {
                                "low"
                            };

                            json!({
                                "content": [{
                                    "type": "text",
                                    "text": serde_json::to_string_pretty(&json!({
                                        "targetFile": target_rel,
                                        "riskLevel": risk,
                                        "impactedFilesCount": impacted_files.len(),
                                        "affectedFlowsCount": affected_flows.len(),
                                        "impactedFiles": impacted_files,
                                        "affectedFlows": affected_flows
                                    })).unwrap_or_else(|_| "{}".to_string())
                                }]
                            })
                        }
                    }
                    "flutter_get_git_blast_radius" => {
                        let max_depth = args.get("maxDepth").and_then(|v| v.as_u64()).unwrap_or(25) as usize;
                        let git_out = Command::new("git")
                            .args(["status", "--porcelain"])
                            .current_dir(&state.project_root)
                            .output();

                        let mut modified_files = Vec::new();
                        if let Ok(out) = git_out {
                            let text = String::from_utf8_lossy(&out.stdout);
                            for line in text.lines() {
                                if line.len() > 3 {
                                    let path_part = line[3..].trim().replace('\\', "/");
                                    let clean = path_part.split(" -> ").last().unwrap_or(&path_part).to_string();
                                    if clean.ends_with(".dart") {
                                        modified_files.push(clean);
                                    }
                                }
                            }
                        }

                        let pkg_name = state.project_package_name();
                        let files = state.find_dart_files();
                        let mut reverse_imports: HashMap<String, Vec<String>> = HashMap::new();
                        for file in &files {
                            let rel = state.relative_path_str(file);
                            if let Some((_, ast)) = state.get_or_parse_ast(file) {
                                for imp in &ast.imports {
                                    if let Some(resolved) = state.resolve_dart_import(&rel, imp, pkg_name.as_deref()) {
                                        reverse_imports.entry(resolved).or_default().push(rel.clone());
                                    }
                                }
                            }
                        }

                        let mut visited: HashSet<String> = modified_files.iter().cloned().collect();
                        let mut frontier: Vec<String> = modified_files.clone();
                        let mut transitively_impacted = Vec::new();

                        for _ in 1..=max_depth {
                            if frontier.is_empty() {
                                break;
                            }
                            let mut next_f = Vec::new();
                            for curr in frontier {
                                if let Some(deps) = reverse_imports.get(&curr) {
                                    for d in deps {
                                        if visited.insert(d.clone()) {
                                            transitively_impacted.push(d.clone());
                                            next_f.push(d.clone());
                                        }
                                    }
                                }
                            }
                            frontier = next_f;
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "summary": format!("{} modified Dart file(s) affect {} downstream file(s).", modified_files.len(), transitively_impacted.len()),
                                    "modifiedDartFiles": modified_files,
                                    "transitivelyImpactedFilesCount": transitively_impacted.len(),
                                    "transitivelyImpactedFiles": transitively_impacted
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_analyze_logic_flow" => {
                        let fn_name = args.get("functionName").and_then(|v| v.as_str()).unwrap_or("");
                        let parent_cls = args.get("parentClass").and_then(|v| v.as_str());
                        let file_opt = args
                            .get("filePath")
                            .or_else(|| args.get("relativePath"))
                            .or_else(|| args.get("path"))
                            .and_then(|v| v.as_str());

                        let files = if let Some(fp) = file_opt {
                            vec![state.resolve_path(fp)]
                        } else {
                            state.find_dart_files()
                        };

                        let mut found_analysis: Option<Value> = None;

                        for file in files {
                            let rel = state.relative_path_str(&file);
                            if let Some((code, ast)) = state.get_or_parse_ast(&file) {
                                let lines: Vec<&str> = code.lines().collect();
                                let mut target_range: Option<(usize, usize, Option<String>)> = None;

                                for cls in &ast.classes {
                                    if parent_cls.is_some() && parent_cls != Some(cls.name.as_str()) {
                                        continue;
                                    }
                                    for m in &cls.methods {
                                        if m.name == fn_name {
                                            let end = m.line_end.unwrap_or(m.line + 35).min(lines.len());
                                            target_range = Some((m.line, end, Some(cls.name.clone())));
                                            break;
                                        }
                                    }
                                }

                                if target_range.is_none() && parent_cls.is_none() {
                                    for f in &ast.functions {
                                        if f.name == fn_name {
                                            let end = f.line_end.unwrap_or(f.line + 35).min(lines.len());
                                            target_range = Some((f.line, end, None));
                                            break;
                                        }
                                    }
                                }

                                if let Some((start_l, end_l, cls_owner)) = target_range {
                                    let mut steps = Vec::new();
                                    let mut step_num = 1usize;
                                    let mut complexity = 1usize;
                                    let mut async_awaits = 0usize;

                                    for ln_idx in (start_l.saturating_sub(1))..end_l {
                                        let raw_l = lines[ln_idx].trim();
                                        if raw_l.is_empty() || raw_l.starts_with("//") {
                                            continue;
                                        }
                                        let ln_no = ln_idx + 1;
                                        if raw_l.contains("await ") {
                                            async_awaits += 1;
                                        }

                                        let step_kind = if raw_l.starts_with("if ")
                                            || raw_l.starts_with("if(")
                                            || raw_l.starts_with("else if")
                                            || raw_l.starts_with("switch")
                                        {
                                            complexity += 1;
                                            if raw_l.contains("== null") || raw_l.contains(".isEmpty") || raw_l.contains("!mounted") {
                                                Some(("validation", "Guard / validation check"))
                                            } else {
                                                Some(("conditional", "Conditional branch"))
                                            }
                                        } else if raw_l.starts_with("for ") || raw_l.starts_with("for(") || raw_l.starts_with("while ") {
                                            complexity += 1;
                                            Some(("loop", "Iterative loop"))
                                        } else if raw_l.contains("setState")
                                            || raw_l.contains("emit(")
                                            || raw_l.contains("state =")
                                            || raw_l.contains("notifyListeners()")
                                        {
                                            Some(("state_update", "Update reactive UI/controller state"))
                                        } else if raw_l.contains("http.")
                                            || raw_l.contains("dio.")
                                            || raw_l.contains("Firebase")
                                            || raw_l.contains("Supabase")
                                        {
                                            Some(("api_call", "External API / network request"))
                                        } else if raw_l.contains("Hive")
                                            || raw_l.contains("SharedPreferences")
                                            || raw_l.contains("sqflite")
                                        {
                                            Some(("data_fetch", "Local storage persistence access"))
                                        } else if raw_l.contains("Navigator.")
                                            || raw_l.contains("context.go(")
                                            || raw_l.contains("context.push(")
                                            || raw_l.contains("showDialog")
                                            || raw_l.contains("showSnackBar")
                                        {
                                            Some(("notification", "UI navigation / dialog / feedback"))
                                        } else if raw_l.starts_with("try")
                                            || raw_l.starts_with("catch")
                                            || raw_l.contains(" catch ")
                                            || raw_l.starts_with("throw ")
                                        {
                                            if raw_l.contains("catch") {
                                                complexity += 1;
                                            }
                                            Some(("error_handling", "Exception / error handling block"))
                                        } else if raw_l.starts_with("return ") || raw_l == "return;" {
                                            Some(("return", "Return result from function"))
                                        } else {
                                            None
                                        };

                                        if let Some((kind, desc)) = step_kind {
                                            steps.push(json!({
                                                "step": step_num,
                                                "type": kind,
                                                "description": desc,
                                                "line": ln_no,
                                                "code": raw_l.chars().take(120).collect::<String>()
                                            }));
                                            step_num += 1;
                                        }
                                    }

                                    found_analysis = Some(json!({
                                        "file": rel,
                                        "functionName": fn_name,
                                        "parentClass": cls_owner,
                                        "startLine": start_l,
                                        "endLine": end_l,
                                        "cyclomaticComplexity": complexity,
                                        "asyncAwaitCount": async_awaits,
                                        "stepsCount": steps.len(),
                                        "steps": steps
                                    }));
                                    break;
                                }
                            }
                        }

                        match found_analysis {
                            Some(res) => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&res).unwrap_or_else(|_| "{}".to_string()) }] }),
                            None => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Function or method '{}' not found.", fn_name) }] }),
                        }
                    }
                    "flutter_validate_architecture_rules" => {
                        let files = state.find_dart_files();
                        let pkg_name = state.project_package_name();

                        let default_rules = vec![
                            (
                                "Domain Purity".to_string(),
                                "domain".to_string(),
                                vec!["data".to_string(), "presentation".to_string()],
                                "Domain layer must not depend on Data or Presentation layers.".to_string(),
                            ),
                            (
                                "Data Independence".to_string(),
                                "data".to_string(),
                                vec!["presentation".to_string()],
                                "Data layer must not depend on Presentation/UI layer.".to_string(),
                            ),
                            (
                                "Core Isolation".to_string(),
                                "core".to_string(),
                                vec!["presentation".to_string(), "data".to_string()],
                                "Core utilities must remain independent of feature Presentation/Data layers.".to_string(),
                            ),
                        ];

                        let rules: Vec<(String, String, Vec<String>, String)> = if let Some(custom) = args.get("customRules").and_then(|v| v.as_array()) {
                            let mut parsed_rules = Vec::new();
                            for r in custom {
                                let name = r.get("name").and_then(|v| v.as_str()).unwrap_or("Custom Rule").to_string();
                                let from_l = r.get("fromLayer").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                                let forbidden: Vec<String> = r
                                    .get("forbiddenLayers")
                                    .and_then(|v| v.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|x| x.as_str().map(|s| s.to_lowercase()))
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                let desc = r.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                if !from_l.is_empty() && !forbidden.is_empty() {
                                    parsed_rules.push((name, from_l, forbidden, desc));
                                }
                            }
                            if parsed_rules.is_empty() { default_rules } else { parsed_rules }
                        } else {
                            default_rules
                        };

                        let mut violations = Vec::new();

                        for file in &files {
                            let rel = state.relative_path_str(file);
                            let from_layer = classify_arch_layer(&rel);
                            if let Some((_, ast)) = state.get_or_parse_ast(file) {
                                for imp_info in &ast.import_details {
                                    if let Some(target_rel) = state.resolve_dart_import(&rel, &imp_info.path, pkg_name.as_deref()) {
                                        let to_layer = classify_arch_layer(&target_rel);
                                        for (r_name, r_from, r_forbidden, r_desc) in &rules {
                                            let matches_from = from_layer == r_from || rel.to_lowercase().contains(r_from);
                                            let matches_to = r_forbidden
                                                .iter()
                                                .any(|forb| to_layer == forb || target_rel.to_lowercase().contains(forb));
                                            if matches_from && matches_to {
                                                violations.push(json!({
                                                    "ruleName": r_name,
                                                    "fromFile": rel.clone(),
                                                    "toFile": target_rel.clone(),
                                                    "line": imp_info.line,
                                                    "description": r_desc
                                                }));
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
                                    "passed": violations.is_empty(),
                                    "rulesChecked": rules.len(),
                                    "violationsCount": violations.len(),
                                    "violations": violations
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_detect_duplicate_widgets" => {
                        let min_nodes = args.get("minNodeCount").and_then(|v| v.as_u64()).unwrap_or(3).max(2) as usize;
                        let files = state.find_dart_files();

                        let mut sig_clusters: BTreeMap<String, (usize, Vec<Value>)> = BTreeMap::new();
                        let mut analyzed_subtrees = 0usize;

                        for file in files {
                            let rel = state.relative_path_str(&file);
                            if let Some((_, ast)) = state.get_or_parse_ast(&file) {
                                collect_widget_subtrees(
                                    &ast.widgets,
                                    &rel,
                                    min_nodes,
                                    &mut sig_clusters,
                                    &mut analyzed_subtrees,
                                );
                            }
                        }

                        let mut clusters_out = Vec::new();
                        for (sig, (node_count, occurrences)) in sig_clusters {
                            if occurrences.len() >= 2 {
                                let root_name = sig.split('(').next().unwrap_or("Custom");
                                let suggested_name = format!("Reusable{}Widget", root_name);
                                let occ_len = occurrences.len();
                                let proposal_msg = format!("Extract this {}-node '{}' subtree (repeated {} times) into a dedicated StatelessWidget '{}'.", node_count, root_name, occ_len, suggested_name);
                                clusters_out.push(json!({
                                    "nodeCount": node_count,
                                    "structureSignature": sig,
                                    "occurrencesCount": occ_len,
                                    "occurrences": occurrences,
                                    "suggestedName": suggested_name,
                                    "proposal": proposal_msg
                                }));
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "analyzedSubtreesCount": analyzed_subtrees,
                                    "clustersCount": clusters_out.len(),
                                    "clusters": clusters_out
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_read_fragment" => {
                        let target_name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let elem_type = args.get("elementType").and_then(|v| v.as_str());
                        let parent_cls = args.get("parentClass").and_then(|v| v.as_str());
                        let include_ctx = args.get("includeContext").and_then(|v| v.as_bool()).unwrap_or(false);
                        let ctx_lines = args.get("contextLines").and_then(|v| v.as_u64()).unwrap_or(3) as usize;
                        let file_opt = args
                            .get("filePath")
                            .or_else(|| args.get("relativePath"))
                            .or_else(|| args.get("path"))
                            .and_then(|v| v.as_str());

                        let files = if let Some(fp) = file_opt {
                            vec![state.resolve_path(fp)]
                        } else {
                            state.find_dart_files()
                        };

                        let mut fragment: Option<Value> = None;

                        for file in files {
                            let rel = state.relative_path_str(&file);
                            if let Some((code, ast)) = state.get_or_parse_ast(&file) {
                                let lines: Vec<&str> = code.lines().collect();
                                let mut matched_span: Option<(usize, usize, &str, Option<String>)> = None;

                                if elem_type.is_none() || elem_type == Some("class") {
                                    for cls in &ast.classes {
                                        if cls.name == target_name {
                                            let end = cls.line_end.unwrap_or(cls.line + 40).min(lines.len());
                                            matched_span = Some((cls.line, end, "class", None));
                                            break;
                                        }
                                    }
                                }

                                if matched_span.is_none() && (elem_type.is_none() || elem_type == Some("method")) {
                                    for cls in &ast.classes {
                                        if parent_cls.is_some() && parent_cls != Some(cls.name.as_str()) {
                                            continue;
                                        }
                                        for m in &cls.methods {
                                            if m.name == target_name {
                                                let end = m.line_end.unwrap_or(m.line + 25).min(lines.len());
                                                matched_span = Some((m.line, end, "method", Some(cls.name.clone())));
                                                break;
                                            }
                                        }
                                    }
                                }

                                if matched_span.is_none() && (elem_type.is_none() || elem_type == Some("function")) {
                                    for f in &ast.functions {
                                        if f.name == target_name {
                                            let end = f.line_end.unwrap_or(f.line + 25).min(lines.len());
                                            matched_span = Some((f.line, end, "function", None));
                                            break;
                                        }
                                    }
                                }

                                if matched_span.is_none() && (elem_type.is_none() || elem_type == Some("enum")) {
                                    for enm in &ast.enums {
                                        if enm.name == target_name {
                                            let end = enm.line_end.unwrap_or(enm.line + 20).min(lines.len());
                                            matched_span = Some((enm.line, end, "enum", None));
                                            break;
                                        }
                                    }
                                }

                                if let Some((s_line, e_line, kind, owner)) = matched_span {
                                    // Include preceding doc comments (`///`) or `@` annotations
                                    let mut actual_start = s_line.saturating_sub(1);
                                    while actual_start > 0 {
                                        let prev = lines[actual_start - 1].trim();
                                        if prev.starts_with("///") || prev.starts_with('@') {
                                            actual_start -= 1;
                                        } else {
                                            break;
                                        }
                                    }
                                    if include_ctx {
                                        actual_start = actual_start.saturating_sub(ctx_lines);
                                    }
                                    let actual_end = if include_ctx {
                                        (e_line + ctx_lines).min(lines.len())
                                    } else {
                                        e_line.min(lines.len())
                                    };

                                    let mut numbered = String::new();
                                    for idx in actual_start..actual_end {
                                        numbered.push_str(&format!("{:4} | {}\n", idx + 1, lines[idx]));
                                    }

                                    fragment = Some(json!({
                                        "file": rel,
                                        "name": target_name,
                                        "elementType": kind,
                                        "parentClass": owner,
                                        "startLine": actual_start + 1,
                                        "endLine": actual_end,
                                        "code": numbered
                                    }));
                                    break;
                                }
                            }
                        }

                        match fragment {
                            Some(f) => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&f).unwrap_or_else(|_| "{}".to_string()) }] }),
                            None => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Element '{}' not found.", target_name) }] }),
                        }
                    }
                    "flutter_get_hints" => {
                        let last_tool = args.get("lastToolUsed").and_then(|v| v.as_str()).unwrap_or("");
                        let mut hints = Vec::new();

                        match last_tool {
                            "flutter_search" => {
                                hints.push(json!({ "tool": "flutter_read_fragment", "reason": "Read the exact source code and doc comments of the matched symbol" }));
                                hints.push(json!({ "tool": "flutter_find_references", "reason": "Locate all usages of this symbol across the project" }));
                                hints.push(json!({ "tool": "flutter_get_detailed_graph", "reason": "Inspect incoming and outgoing relationships for this file" }));
                            }
                            "flutter_get_code_block" | "flutter_read_fragment" => {
                                hints.push(json!({ "tool": "flutter_analyze_logic_flow", "reason": "Analyze Cyclomatic Complexity and execution steps inside this function" }));
                                hints.push(json!({ "tool": "flutter_get_impact_analysis", "reason": "Calculate the blast radius before editing this file" }));
                            }
                            "flutter_edit_file" | "flutter_replace_lines" | "flutter_write_file" => {
                                hints.push(json!({ "tool": "flutter_run_analyze", "reason": "Verify that the edit introduced zero Dart analyzer errors" }));
                                hints.push(json!({ "tool": "flutter_hot_reload", "reason": "Apply the code changes immediately to the running Flutter app" }));
                            }
                            "flutter_get_missing_translations" => {
                                hints.push(json!({ "tool": "flutter_auto_translate_missing", "reason": "Batch apply translations across all .arb files" }));
                                hints.push(json!({ "tool": "flutter_validate_icu_translations", "reason": "Verify placeholder and plural syntax consistency" }));
                            }
                            _ => {
                                hints.push(json!({ "tool": "flutter_get_stats", "reason": "Get a high-level overview of the project's classes, widgets, and cache status" }));
                                hints.push(json!({ "tool": "flutter_get_architectural_layers", "reason": "Audit Clean Architecture boundaries and Lakos coupling" }));
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "lastToolUsed": last_tool,
                                    "suggestedNextSteps": hints
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_search_packages" => {
                        let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                        let pkg_filter = args.get("packageName").and_then(|v| v.as_str());
                        let case_sensitive = args.get("caseSensitive").and_then(|v| v.as_bool()).unwrap_or(false);
                        let max_results = args.get("maxResults").and_then(|v| v.as_u64()).unwrap_or(50) as usize;

                        let entries = load_package_config(&state.project_root);
                        let re_opt = if case_sensitive {
                            Regex::new(query).ok()
                        } else {
                            Regex::new(&format!("(?i){}", query)).ok()
                        };
                        let q_lower = query.to_lowercase();

                        let mut results = Vec::new();
                        let mut searched_pkgs = 0usize;

                        for pkg in entries {
                            if let Some(pf) = pkg_filter {
                                if pkg.name != pf {
                                    continue;
                                }
                            }
                            let lib_dir = pkg.actual_dir.join(&pkg.package_uri);
                            if !lib_dir.exists() {
                                continue;
                            }
                            searched_pkgs += 1;
                            let mut dart_files = Vec::new();
                            McpServerState::walk_dir(&lib_dir, &mut dart_files, Some("dart"));

                            for df in dart_files {
                                if results.len() >= max_results {
                                    break;
                                }
                                if let Ok(content) = fs::read_to_string(&df) {
                                    let rel_in_pkg = df
                                        .strip_prefix(&lib_dir)
                                        .unwrap_or(&df)
                                        .to_string_lossy()
                                        .replace('\\', "/");
                                    for (idx, line) in content.lines().enumerate() {
                                        let matched = match &re_opt {
                                            Some(re) => re.is_match(line),
                                            None => {
                                                if case_sensitive {
                                                    line.contains(query)
                                                } else {
                                                    line.to_lowercase().contains(&q_lower)
                                                }
                                            }
                                        };
                                        if matched {
                                            results.push(json!({
                                                "packageName": pkg.name,
                                                "file": format!("package:{}/{}", pkg.name, rel_in_pkg),
                                                "line": idx + 1,
                                                "content": line.trim().chars().take(200).collect::<String>()
                                            }));
                                            if results.len() >= max_results {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            if results.len() >= max_results {
                                break;
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "searchedPackages": searched_pkgs,
                                    "resultsCount": results.len(),
                                    "results": results
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_read_package_source" => {
                        let uri = args.get("uri").and_then(|v| v.as_str()).unwrap_or("").trim();
                        let start_line = args.get("startLine").and_then(|v| v.as_u64()).unwrap_or(1).max(1) as usize;
                        let line_count = args.get("lineCount").and_then(|v| v.as_u64()).unwrap_or(100).max(1) as usize;

                        if let Some(rest) = uri.strip_prefix("package:") {
                            if let Some((pkg_name, sub_path)) = rest.split_once('/') {
                                let entries = load_package_config(&state.project_root);
                                if let Some(pkg) = entries.into_iter().find(|e| e.name == pkg_name) {
                                    let lib_dir = pkg.actual_dir.join(&pkg.package_uri);
                                    let target_file = lib_dir.join(sub_path);
                                    match fs::read_to_string(&target_file) {
                                        Ok(text) => {
                                            let lines: Vec<&str> = text.lines().collect();
                                            let total = lines.len();
                                            let end_line = (start_line + line_count - 1).min(total);
                                            let slice = if start_line <= end_line {
                                                lines[(start_line - 1)..end_line].join("\n")
                                            } else {
                                                String::new()
                                            };
                                            json!({
                                                "content": [{
                                                    "type": "text",
                                                    "text": serde_json::to_string_pretty(&json!({
                                                        "success": true,
                                                        "uri": uri,
                                                        "filePath": target_file.display().to_string(),
                                                        "totalLines": total,
                                                        "startLine": start_line,
                                                        "endLine": end_line,
                                                        "content": slice
                                                    })).unwrap_or_else(|_| "{}".to_string())
                                                }]
                                            })
                                        }
                                        Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("File not found for '{}': {}", uri, e) }] }),
                                    }
                                } else {
                                    json!({ "isError": true, "content": [{ "type": "text", "text": format!("Package '{}' not found in .dart_tool/package_config.json", pkg_name) }] })
                                }
                            } else {
                                json!({ "isError": true, "content": [{ "type": "text", "text": "Invalid package URI format. Expected 'package:<name>/<path>'." }] })
                            }
                        } else {
                            json!({ "isError": true, "content": [{ "type": "text", "text": "URI must start with 'package:'." }] })
                        }
                    }
                    "flutter_pub_dev_search" => {
                        let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                        let page = args.get("page").and_then(|v| v.as_u64()).unwrap_or(1);
                        let url = format!(
                            "https://pub.dev/api/search?q={}&page={}",
                            query.replace(' ', "%20"),
                            page
                        );

                        let curl_out = Command::new("curl")
                            .args(["-s", "--max-time", "5", &url])
                            .output();

                        let mut packages = Vec::new();
                        if let Ok(out) = curl_out {
                            if out.status.success() {
                                if let Ok(val) = serde_json::from_slice::<Value>(&out.stdout) {
                                    if let Some(arr) = val.get("packages").and_then(|v| v.as_array()) {
                                        for item in arr.iter().take(15) {
                                            if let Some(p_name) = item.get("package").and_then(|v| v.as_str()) {
                                                packages.push(json!({
                                                    "name": p_name,
                                                    "url": format!("https://pub.dev/packages/{}", p_name)
                                                }));
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Offline fallback: search installed packages in package_config.json
                        if packages.is_empty() {
                            let q_lower = query.to_lowercase();
                            for entry in load_package_config(&state.project_root) {
                                if entry.name.to_lowercase().contains(&q_lower) {
                                    packages.push(json!({
                                        "name": entry.name,
                                        "source": "local_pub_cache",
                                        "url": format!("https://pub.dev/packages/{}", entry.name)
                                    }));
                                }
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "query": query,
                                    "packagesCount": packages.len(),
                                    "packages": packages
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_get_pub_package_info" => {
                        let pkg_name = args.get("packageName").and_then(|v| v.as_str()).unwrap_or("");
                        let url = format!("https://pub.dev/api/packages/{}", pkg_name);

                        let mut result_val: Option<Value> = None;
                        if let Ok(out) = Command::new("curl").args(["-s", "--max-time", "5", &url]).output() {
                            if out.status.success() {
                                if let Ok(info) = serde_json::from_slice::<Value>(&out.stdout) {
                                    if info.get("name").is_some() {
                                        let latest = info.get("latest").cloned().unwrap_or(json!({}));
                                        let pubspec = latest.get("pubspec").cloned().unwrap_or(json!({}));
                                        result_val = Some(json!({
                                            "name": info.get("name"),
                                            "latestVersion": latest.get("version"),
                                            "published": latest.get("published"),
                                            "description": pubspec.get("description"),
                                            "homepage": pubspec.get("homepage"),
                                            "repository": pubspec.get("repository")
                                        }));
                                    }
                                }
                            }
                        }

                        if result_val.is_none() {
                            if let Some(local_pkg) = load_package_config(&state.project_root)
                                .into_iter()
                                .find(|e| e.name == pkg_name)
                            {
                                let pubspec_txt = fs::read_to_string(local_pkg.actual_dir.join("pubspec.yaml")).unwrap_or_default();
                                result_val = Some(json!({
                                    "name": local_pkg.name,
                                    "source": "local_pub_cache",
                                    "localPath": local_pkg.actual_dir.display().to_string(),
                                    "pubspecPreview": pubspec_txt.lines().take(25).collect::<Vec<_>>().join("\n")
                                }));
                            }
                        }

                        match result_val {
                            Some(v) => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".to_string()) }] }),
                            None => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Package '{}' not found on pub.dev or local .pub-cache.", pkg_name) }] }),
                        }
                    }
                    "flutter_run_intl_generate" => {
                        let bin = if cfg!(windows) { "flutter.bat" } else { "flutter" };
                        let out_res = Command::new(bin)
                            .arg("gen-l10n")
                            .current_dir(&state.project_root)
                            .output();

                        let arb_files = state.find_arb_files();
                        match out_res {
                            Ok(out) if out.status.success() => {
                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": format!("Successfully ran `flutter gen-l10n` across {} ARB file(s).", arb_files.len())
                                    }]
                                })
                            }
                            _ => {
                                json!({
                                    "content": [{
                                        "type": "text",
                                        "text": format!("Scanned {} ARB file(s) in project.", arb_files.len())
                                    }]
                                })
                            }
                        }
                    }
                    "flutter_validate_icu_translations" => {
                        let arb_files = state.find_arb_files();
                        let mut issues = Vec::new();
                        let mut base_placeholders: HashMap<String, BTreeMap<String, ()>> = HashMap::new();

                        for (file_idx, file) in arb_files.iter().enumerate() {
                            let rel = state.relative_path_str(file);
                            if let Ok(content) = fs::read_to_string(file) {
                                match serde_json::from_str::<Map<String, Value>>(&content) {
                                    Ok(map) => {
                                        for (k, v) in map {
                                            if k.starts_with('@') {
                                                continue;
                                            }
                                            if let Some(text) = v.as_str() {
                                                let open_cnt = text.chars().filter(|&c| c == '{').count();
                                                let close_cnt = text.chars().filter(|&c| c == '}').count();
                                                if open_cnt != close_cnt {
                                                    issues.push(json!({
                                                        "file": rel.clone(),
                                                        "key": k.clone(),
                                                        "type": "unbalanced_braces",
                                                        "message": format!("Unbalanced ICU braces: {} '{{' vs {} '}}'", open_cnt, close_cnt)
                                                    }));
                                                }
                                                if (text.contains(", plural,") || text.contains(",plural,") || text.contains(", select,"))
                                                    && !text.contains("other{")
                                                    && !text.contains("other {")
                                                {
                                                    issues.push(json!({
                                                        "file": rel.clone(),
                                                        "key": k.clone(),
                                                        "type": "missing_other_clause",
                                                        "message": "ICU plural/select message is missing the mandatory 'other' clause."
                                                    }));
                                                }

                                                let phs = extract_icu_placeholders(text);
                                                if file_idx == 0 {
                                                    base_placeholders.insert(k.clone(), phs);
                                                } else if let Some(expected) = base_placeholders.get(&k) {
                                                    if &phs != expected {
                                                        issues.push(json!({
                                                            "file": rel.clone(),
                                                            "key": k.clone(),
                                                            "type": "placeholder_mismatch",
                                                            "expectedPlaceholders": expected.keys().collect::<Vec<_>>(),
                                                            "actualPlaceholders": phs.keys().collect::<Vec<_>>()
                                                        }));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        issues.push(json!({
                                            "file": rel,
                                            "type": "invalid_json",
                                            "message": e.to_string()
                                        }));
                                    }
                                }
                            }
                        }

                        json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&json!({
                                    "valid": issues.is_empty(),
                                    "arbFilesChecked": arb_files.len(),
                                    "issuesCount": issues.len(),
                                    "issues": issues
                                })).unwrap_or_else(|_| "{}".to_string())
                            }]
                        })
                    }
                    "flutter_auto_translate_missing" => {
                        let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("generate_payload");
                        let source_locale = args.get("sourceLocale").and_then(|v| v.as_str()).unwrap_or("en");
                        let arb_files = state.find_arb_files();

                        if action == "batch_apply" {
                            let items = args.get("translationsToApply").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                            let mut updated_files_count = 0usize;

                            for file in &arb_files {
                                let rel = state.relative_path_str(file);
                                if let Ok(content) = fs::read_to_string(file) {
                                    if let Ok(mut map) = serde_json::from_str::<Map<String, Value>>(&content) {
                                        let mut changed = false;
                                        for item in &items {
                                            let key = item.get("key").and_then(|v| v.as_str()).unwrap_or("");
                                            if key.is_empty() {
                                                continue;
                                            }
                                            if let Some(trans_map) = item.get("translations").and_then(|v| v.as_object()) {
                                                for (loc, val) in trans_map {
                                                    if rel.contains(loc) {
                                                        if let Some(s) = val.as_str() {
                                                            map.insert(key.to_string(), Value::String(s.to_string()));
                                                            changed = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        if changed {
                                            if let Ok(serialized) = serde_json::to_string_pretty(&map) {
                                                if atomic_write_file(file, &serialized).is_ok() {
                                                    updated_files_count += 1;
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
                                        "action": "batch_apply",
                                        "updatedArbFiles": updated_files_count
                                    })).unwrap_or_else(|_| "{}".to_string())
                                }]
                            })
                        } else {
                            let mut base_map: Map<String, Value> = Map::new();
                            let mut locale_maps: Vec<(String, Map<String, Value>)> = Vec::new();

                            for file in &arb_files {
                                let rel = state.relative_path_str(file);
                                if let Ok(content) = fs::read_to_string(file) {
                                    if let Ok(map) = serde_json::from_str::<Map<String, Value>>(&content) {
                                        if rel.contains(source_locale) || base_map.is_empty() {
                                            base_map = map.clone();
                                        }
                                        locale_maps.push((rel, map));
                                    }
                                }
                            }

                            let mut payload = Vec::new();
                            for (k, v) in &base_map {
                                if k.starts_with('@') {
                                    continue;
                                }
                                let mut missing_in = Vec::new();
                                for (rel, lmap) in &locale_maps {
                                    if !lmap.contains_key(k) {
                                        missing_in.push(rel.clone());
                                    }
                                }
                                if !missing_in.is_empty() {
                                    payload.push(json!({
                                        "key": k,
                                        "sourceValue": v,
                                        "missingInFiles": missing_in
                                    }));
                                }
                            }

                            json!({
                                "content": [{
                                    "type": "text",
                                    "text": serde_json::to_string_pretty(&json!({
                                        "action": "generate_payload",
                                        "sourceLocale": source_locale,
                                        "missingKeysCount": payload.len(),
                                        "payload": payload
                                    })).unwrap_or_else(|_| "{}".to_string())
                                }]
                            })
                        }
                    }
                    "flutter_hot_reload" => {
                        let override_uri = args.get("vmServiceUri").and_then(|v| v.as_str());
                        match discover_vm_service_uri(&state.project_root, override_uri) {
                            Some(uri) => match vm_service_find_main_isolate(&uri) {
                                Ok(iso_id) => match vm_service_http_call(&uri, "ext.flutter.reassemble", &[("isolateId", &iso_id)]) {
                                    Ok(resp) => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&json!({ "success": true, "uri": uri, "isolateId": iso_id, "response": resp })).unwrap() }] }),
                                    Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Hot Reload failed: {}", e) }] }),
                                },
                                Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Could not find running isolate at '{}': {}", uri, e) }] }),
                            },
                            None => json!({ "isError": true, "content": [{ "type": "text", "text": "No running Dart VM Service found. Start your app with `flutter run` or pass `vmServiceUri`." }] }),
                        }
                    }
                    "flutter_hot_restart" => {
                        let override_uri = args.get("vmServiceUri").and_then(|v| v.as_str());
                        match discover_vm_service_uri(&state.project_root, override_uri) {
                            Some(uri) => match vm_service_find_main_isolate(&uri) {
                                Ok(iso_id) => {
                                    let res = vm_service_http_call(&uri, "hotRestart", &[("isolateId", &iso_id)])
                                        .or_else(|_| vm_service_http_call(&uri, "ext.flutter.reassemble", &[("isolateId", &iso_id)]));
                                    match res {
                                        Ok(resp) => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&json!({ "success": true, "uri": uri, "isolateId": iso_id, "response": resp })).unwrap() }] }),
                                        Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Hot Restart failed: {}", e) }] }),
                                    }
                                }
                                Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Could not find running isolate at '{}': {}", uri, e) }] }),
                            },
                            None => json!({ "isError": true, "content": [{ "type": "text", "text": "No running Dart VM Service found. Start your app with `flutter run` or pass `vmServiceUri`." }] }),
                        }
                    }
                    "flutter_get_runtime_errors" => {
                        let override_uri = args.get("vmServiceUri").and_then(|v| v.as_str());
                        match discover_vm_service_uri(&state.project_root, override_uri) {
                            Some(uri) => match vm_service_find_main_isolate(&uri) {
                                Ok(iso_id) => match vm_service_http_call(&uri, "getIsolate", &[("isolateId", &iso_id)]) {
                                    Ok(iso_val) => {
                                        let pause_event = iso_val.get("result").and_then(|r| r.get("pauseEvent")).cloned().unwrap_or(Value::Null);
                                        let error_obj = iso_val.get("result").and_then(|r| r.get("error")).cloned().unwrap_or(Value::Null);
                                        json!({
                                            "content": [{
                                                "type": "text",
                                                "text": serde_json::to_string_pretty(&json!({
                                                    "connected": true,
                                                    "uri": uri,
                                                    "isolateId": iso_id,
                                                    "isolateError": error_obj,
                                                    "pauseEvent": pause_event
                                                })).unwrap_or_else(|_| "{}".to_string())
                                            }]
                                        })
                                    }
                                    Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("Failed to inspect isolate: {}", e) }] }),
                                },
                                Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": e }] }),
                            },
                            None => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&json!({ "connected": false, "errors": [], "message": "No active VM Service URI discovered." })).unwrap() }] }),
                        }
                    }
                    "flutter_inspect_live_widgets" => {
                        let override_uri = args.get("vmServiceUri").and_then(|v| v.as_str());
                        let group = args.get("objectGroup").and_then(|v| v.as_str()).unwrap_or("flutter_explorer_group");
                        let mut live_tree_val: Option<Value> = None;
                        if let Some(uri) = discover_vm_service_uri(&state.project_root, override_uri) {
                            if let Ok(iso_id) = vm_service_find_main_isolate(&uri) {
                                if let Ok(tree) = vm_service_http_call(
                                    &uri,
                                    "ext.flutter.inspector.getRootWidgetSummaryTree",
                                    &[("isolateId", &iso_id), ("objectGroup", group)],
                                ) {
                                    live_tree_val = Some(tree);
                                }
                            }
                        }

                        if let Some(tree) = live_tree_val {
                            json!({
                                "content": [{
                                    "type": "text",
                                    "text": serde_json::to_string_pretty(&tree).unwrap_or_else(|_| "{}".to_string())
                                }]
                            })
                        } else {
                            // Fallback: return static AST widget trees across project files
                            let files = state.find_dart_files();
                            let mut static_trees = Vec::new();
                            for f in files {
                                let rel = state.relative_path_str(&f);
                                if let Some((_, ast)) = state.get_or_parse_ast(&f) {
                                    if !ast.widgets.is_empty() {
                                        static_trees.push(json!({
                                            "file": rel,
                                            "widgets": ast.widgets
                                        }));
                                    }
                                }
                            }
                            json!({
                                "content": [{
                                    "type": "text",
                                    "text": serde_json::to_string_pretty(&json!({
                                        "source": "static_ast_fallback",
                                        "filesWithWidgets": static_trees.len(),
                                        "trees": static_trees
                                    })).unwrap_or_else(|_| "{}".to_string())
                                }]
                            })
                        }
                    }
                    "flutter_simulate_ui_action" => {
                        let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("tap");
                        let target = args.get("target").and_then(|v| v.as_str()).unwrap_or("");
                        let value = args.get("value").and_then(|v| v.as_str()).unwrap_or("-300");
                        let override_uri = args.get("vmUri").and_then(|v| v.as_str());

                        match discover_vm_service_uri(&state.project_root, override_uri) {
                            Some(uri) => match vm_service_find_main_isolate(&uri) {
                                Ok(iso_id) => {
                                    let mut params = vec![
                                        ("isolateId", iso_id.as_str()),
                                        ("command", action),
                                        ("finderType", "ByValueKey"),
                                        ("keyValueString", target),
                                        ("keyValueType", "String"),
                                    ];
                                    if action == "enterText" {
                                        params.push(("text", value));
                                    } else if action == "scroll" {
                                        params.push(("dx", "0"));
                                        params.push(("dy", value));
                                        params.push(("duration", "300000"));
                                        params.push(("frequency", "60"));
                                    }
                                    match vm_service_http_call(&uri, "ext.flutter.driver", &params) {
                                        Ok(resp) => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&json!({ "success": true, "action": action, "target": target, "response": resp })).unwrap() }] }),
                                        Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": format!("UI simulation '{}' failed: {}", action, e) }] }),
                                    }
                                }
                                Err(e) => json!({ "isError": true, "content": [{ "type": "text", "text": e }] }),
                            },
                            None => json!({ "isError": true, "content": [{ "type": "text", "text": "No running Flutter VM Service discovered. Start the app with `flutter run` and enable Flutter Driver extension." }] }),
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
                                let rel_path = state.relative_path_str(&file);
                                let warnings = scanner.scan_warnings_for_file(&rel_path, &code);
                                if !warnings.is_empty() {
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
