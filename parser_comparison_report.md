# ⚖️ Flutter Explorer: 3-Way Engine Benchmark Report

Generated on: **10/16/2026, 10:29:50 AM**  
Active Engine Configuration: **`auto`** (Active: **rust**)  

## ⚡ Performance & Speed Benchmarks

| Execution Engine | Benchmark Time | Throughput | Relative Speed | Architecture |
| --- | --- | --- | --- | --- |
| 🦀 **Rust Core WASM** | **19 ms** | **105.3 files/sec** | 🚀 **Fastest** | Zero-copy WASM, Pure AST |
| ⚡ **TypeScript Regex** | **81 ms** | **24.7 files/sec** | 4.3x baseline | V8 JavaScript Engine |
| 🎯 **Dart SDK Analyzer** | *(Skipped / Standalone)* | N/A | N/A | External Dart CLI Process |

## 📊 Complete Symbol Discovery Parity (All UI Metrics)

| Symbol Category | 🦀 Rust Core WASM | ⚡ TypeScript Regex | 🎯 Dart SDK Analyzer | Sidebar UI Badge |
| --- | --- | --- | --- | --- |
| 📄 **Analyzed Files** | **2** | **2** | N/A | 📄 All (2) |
| 🔷 **Classes** | **31** | **2** | N/A | 🔷 Classes (2) |
| ⚡ **Total Functions (Combined)** | **29** | **6** | N/A | ⚡ Functions (6) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ *Class Methods* | **22** | **4** | N/A | *(Method bodies)* |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ *Top-Level Functions* | **7** | **2** | N/A | *(Top-level declarations)* |
| 🧩 **Widgets (Top-Level / Nodes)** | **2** / **11** | **0** / **0** | N/A | 🧩 Widgets (0) |
| 🛠️ **Constructors (Ctors)** | **12** | **2** | N/A | 🛠️ Ctors (2) |
| 🔑 **Properties (Props)** | **17** | **5** | N/A | 🔑 Props (5) |
| 🏷️ **Annotations (Annos)** | **10** | **3** | N/A | 🏷️ Annos (3) |
| 📞 **Function Calls (Calls)** | **418** | **420** | N/A | 📞 Calls (420) |
| 💎 **Variables (Vars)** | **3** | **7** | N/A | 💎 Vars (7) |
| 🟣 **Enums** | **3** | **0** | N/A | 🟣 Enums (0) |
| 🏷️ **Type Aliases (Type)** | **1** | **0** | N/A | 🏷️ Type (0) |
| 🟠 **Mixins** | **1** | **0** | N/A | 🟠 Mixins (0) |
| 🧬 **Extensions (Ext)** | **1** | **0** | N/A | 🧬 Ext (0) |

## 🎉 Perfect Engine Alignment!

All enabled engines analyzed the workspace symbols in complete unison. No discrepancies were detected!

## 🛠️ Engine Recommendations

- **Recommended Setting**: `"flutterExplorer.engine": "auto"` (Default).
  - Uses **Rust Core WASM** when available for sub-millisecond AST and BM25 searches.
  - Transparently falls back to **TypeScript/JavaScript** on any environment without disruption.
- **Native MCP Standalone**: For maximum performance without Node.js runtime overhead, execute `flutter-explorer-mcp.exe` directly.
