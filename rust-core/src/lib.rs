pub mod bm25;
pub mod parser;
pub mod scanner;

use bm25::{BM25Document, BM25Engine};
use parser::PureDartParser;
use scanner::CodeScanner;
use wasm_bindgen::prelude::*;

const CORE_VERSION: &str = "0.1.0-wasm";

#[wasm_bindgen]
pub fn get_core_version() -> String {
    CORE_VERSION.to_string()
}

/// Run BM25 search on a JSON array of documents
#[wasm_bindgen]
pub fn bm25_search_json(docs_json: &str, query: &str, limit: usize) -> String {
    let docs: Vec<BM25Document> = match serde_json::from_str(docs_json) {
        Ok(d) => d,
        Err(e) => return format!("{{\"error\": \"Failed to parse documents JSON: {}\"}}", e),
    };

    let engine = BM25Engine::new(docs);
    let results = engine.search(query, limit);

    serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string())
}

/// Scan a Dart file for hardcoded colors and text
#[wasm_bindgen]
pub fn scan_warnings_json(source: &str) -> String {
    let scanner = CodeScanner::new();
    let warnings = scanner.scan_warnings(source);
    serde_json::to_string(&warnings).unwrap_or_else(|_| "[]".to_string())
}

/// Fast outline symbols scanner
#[wasm_bindgen]
pub fn scan_symbols_json(source: &str) -> String {
    let scanner = CodeScanner::new();
    let symbols = scanner.scan_symbols(source);
    serde_json::to_string(&symbols).unwrap_or_else(|_| "[]".to_string())
}

/// Pure Rust high-speed Dart AST parser
#[wasm_bindgen]
pub fn parse_dart_ast_json(source: &str) -> String {
    let ast = PureDartParser::parse(source);
    serde_json::to_string(&ast).unwrap_or_else(|_| "{}".to_string())
}

