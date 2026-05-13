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



## In Progress
- [ ] Semantic Search (Vector Embeddings)

## Future
- [ ] Surprise Scoring: Detect unexpected coupling.
- [ ] Hub & Bridge Detection: Identify architectural chokepoints.
