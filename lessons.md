# 📋 Lessons

- Ensure all variables are typed before pushing.
- When editing ARB files, preserve global metadata (`@@`) and per-key metadata (`@key`) entirely.
- Avoid side effects like re-sorting keys unless explicitly requested, to minimize diffs and preserve user formatting.
- For high-performance I/O operations (like file indexing), always use a bounded worker pool (`runConcurrent`) and batch database operations within a single transaction (`batchUpsertDartFiles`) to prevent WAL commit bottlenecks.
- **better-sqlite3 ABI rebuild**: When NODE_MODULE_VERSION mismatch occurs, you MUST stop `npm run watch` first (it locks the `.node` file with EBUSY). Only after stopping the watcher can you run `npm rebuild better-sqlite3` successfully. If node-gyp fails, use `npx @mapbox/node-pre-gyp install --fallback-to-build` as a fallback.
- **flutter-explorer-mcp project path**: Always call `flutter_set_project_path` with the target Flutter project path (e.g. `E:\New folder\sad\sadara`) before any tool calls — the MCP server defaults to the wrong path (Antigravity app dir).
