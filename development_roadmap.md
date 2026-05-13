# Development Roadmap

## Completed
- [x] Initial Project Setup
- [x] SQLite Cache Implementation
- [x] BM25 Search v2
- [x] Automated MCP Configuration (VS Code, Cursor, Claude, Gemini)
- [x] **Blast Radius Analysis (Impact Analysis)**: Traces impact of changes back to `main` or Widgets.
- [x] **Advanced Dart Call Detection**: Improved regex to capture receivers and handle dotted calls.
- [x] **Interactive Visualization**: D3.js force-directed graph with search and zoom.
- [x] **Performance Overhaul**: O(N) indexing with static RegExp caching and masking.
- [x] **Professional Widget Tree**: Interactive expand/collapse, guide lines, and semantic details.
- [x] **Blast Radius Analysis (Impact Analysis)**: Traces impact of changes back to `main` or Widgets via BFS traversal.
- [x] Multi-line class and build method detection (Robustness)
- [x] Riverpod/Hooks support in Widget Tree
- [x] Consolidated file navigation logic (Windows Fix)
- [x] Detailed Graph Edges (Inheritance, Calls, Imports) & MCP Integration
- [x] Refactored Modular MCP Server (Arb, Logic, Search)
- [x] New MCP Tools (Update/Delete Translation, Impact Analysis, Smart Hints)
- [x] ABI Resilience & JSON Fallback: Stable persistence across different Node.js environments (Fully verified with electron-rebuild).
- [x] **SQLite WAL Mode Support**: Confirmed stability of `.db-wal` and `.db-shm` files for concurrent access.
- [x] **Robust Project Discovery**: Integrated VCS-aware root detection (looks for `pubspec.yaml` or `.git`).
- [x] **Standardized Data Directory**: Moved database and index files to a dedicated `.flutter-explorer/` directory.
- [x] **Automated DB Migration**: Safe migration of legacy databases and SQLite side-files from `.vscode/`.
- [x] **AI Skills System**: Automated generation of AI instruction sets (skills) for project exploration, debugging, and impact analysis.
- [x] **Legacy Artifact Cleanup**: Automated deletion of old JSON cache files from `.vscode/`.
- [x] **Incremental SQLite Updates**: SQLite cache is already updated incrementally during indexing.
- [x] **Direct SQLite MCP Access**: JSON fallback is no longer needed as MCP server now reads from SQLite.
- [x] **Type-Safe Indexing**: Fixed type mismatch (TS2345) in `IndexManager` for optional content hashes.
- [x] **MCP Path Synchronization**: Fixed singleton cache reset bug in `flutter_set_project_path`.
- [x] **Automated SQLite Proactive Checkpointing**: Implemented `PASSIVE` checkpoints after every write for immediate MCP visibility.
- [x] **Manual SQLite Maintenance**: Added `checkpoint()` (TRUNCATE) for major indexing operations.
- [x] **Detailed Index Error Reporting**: MCP server now provides granular feedback on database existence, accessibility, and content state.
- [x] **High-Accuracy Dart Indexing**: Integrated `package:analyzer` via a dedicated Dart tool and TypeScript wrapper for 100% accuracy in `lib/`.
- [x] **Hybrid Indexing Strategy**: Real-time regex updates combined with periodic/initial high-accuracy Dart analysis.
- [x] **Robust Tool Discovery**: Improved path resolution in `dartAnalyzerWrapper` using VS Code's `extensionPath` to support various execution environments.





## In Progress
- [ ] Semantic Search (Vector Embeddings)

## Future
- [ ] Surprise Scoring: Detect unexpected coupling.
- [ ] Hub & Bridge Detection: Identify architectural chokepoints.
