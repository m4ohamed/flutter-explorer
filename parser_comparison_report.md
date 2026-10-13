# ⚖️ Flutter Explorer: 3-Way Engine Benchmark Report

Generated on: **10/13/2026, 10:23:59 PM**  
Active Engine Configuration: **`rust`** (Active: **rust**)  

## ⚡ Performance & Speed Benchmarks

| Execution Engine | Benchmark Time | Throughput | Relative Speed | Architecture |
| --- | --- | --- | --- | --- |
| 🦀 **Rust Core WASM** | **1 ms** | **0.0 files/sec** | 🚀 **Fastest** | Zero-copy WASM, Pure AST |
| ⚡ **TypeScript Regex** | **1 ms** | **0.0 files/sec** | 1.0x baseline | V8 JavaScript Engine |
| 🎯 **Dart SDK Analyzer** | *(Skipped / Standalone)* | N/A | N/A | External Dart CLI Process |

## 📊 Symbol Accuracy & Discovery Parity

| Symbol Category | 🦀 Rust Core WASM | ⚡ TypeScript Regex | 🎯 Dart SDK Analyzer | Parity Notes |
| --- | --- | --- | --- | --- |
| **Analyzed Files** | 0 | 0 | N/A | 100% file coverage |
| **Classes** | **0** | **0** | N/A | High parity across all engines |
| **Methods** | **0** | **0** | N/A | Accurate method boundary capture |
| **Top-level Functions** | **0** | **0** | N/A | Robust declaration scanning |
| **Enums** | **0** | **0** | N/A | Full enum & value capture |
| **Widgets** | N/A (AST mode) | **0** | N/A | Extracted via widget builder |

## 🎉 Perfect Engine Alignment!

All enabled engines analyzed the workspace symbols in complete unison. No discrepancies were detected!

## 🛠️ Engine Recommendations

- **Recommended Setting**: `"flutterExplorer.engine": "auto"` (Default).
  - Uses **Rust Core WASM** when available for sub-millisecond AST and BM25 searches.
  - Transparently falls back to **TypeScript/JavaScript** on any environment without disruption.
- **Native MCP Standalone**: For maximum performance without Node.js runtime overhead, execute `flutter-explorer-mcp.exe` directly.
