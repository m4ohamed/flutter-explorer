# Development Roadmap

## Completed
- [x] Integrate Dart Analyzer for accurate AST indexing
- [x] Improve incremental Regex parser
- [x] Configure VS Code Webview for Dependency Graph
- [x] Implement robust SQLite caching with read/write modes
- [x] Handle SQLite DB file locking between Extension and MCP Server
- [x] Optimize index generation performance (concurrent batch processing)
- [x] Fix MCP Server `stdio` JSON-RPC corruption by overriding `console.log`

## Today's Progress
- SQLite cache is already updated incrementally during indexing. JSON fallback is no longer needed as MCP server now reads from SQLite.
- Fixed `better-sqlite3` ABI mismatch issues.
- Configured separate environments awareness (Electron for VSCode Extension vs Node for MCP Server).

## Upcoming
- [ ] Test the full suite of MCP tools (Search, Pubspec, Impact Analysis, Logic Flow, etc.)
- [ ] Finalize UI/UX for the interactive graph (D3.js)
- [ ] Add extensive Error Logging to `.flutter-explorer`
