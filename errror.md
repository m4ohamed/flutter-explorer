# Error Log & Fixes

## [2026-05-13] Improving "Index not found" Error Messages

### Issue
The MCP server tools often return a generic "Index not found" message when the SQLite database is missing, inaccessible, or empty. This makes it difficult for users (and AI agents) to understand the root cause.

### Analysis
- `readIndex()` returns `null` for multiple reasons: SQLite not available, database empty, or error during reading.
- Tools like `flutter_get_stats` just check `if (!index)` and return "Index not found."

### Planned Fix
1. Modify `readIndex` to provide more granular feedback.
2. Implement a `getIndexStatus()` function to check:
    - If the project root is correctly identified.
    - If the `.flutter-explorer/flutter-explorer.db` file exists.
    - If the database is accessible (via `SqliteCache.isAvailable`).
    - If the database contains any indexed files.
3. Update tools to use this detailed status instead of a generic message.

### Prevention
- Ensure all tools that require an index check the status first and provide helpful instructions (e.g., "Ensure the VS Code extension has finished indexing").

### [2026-05-13] RESOLVED: Improved Index Diagnostics
- **Problem**: "Index not found" was too generic, making it hard to know if the file was missing, locked, or empty.
- **Solution**: Implemented `SqliteCache.getDiagnostics()` which checks file existence, row counts, and captures specific SQLite open errors.
- **Result**: MCP server now reports exactly why the index is unavailable (e.g., specific file lock error message).
- **Lessons**: Always differentiate between "Missing File", "Access Denied", and "Empty Data" for better UX.

## 📋 Lessons - Ensure all variables are typed before pushing.
- Always provide actionable error messages when a resource (like a database) is unavailable.
- capture the exact error message from the database driver to aid in environment-specific troubleshooting (like SQLite ABI mismatches).

## [2026-05-13] Improving Regex Accuracy
- **Problem**: `DartParser` regex was missing complex class headers (e.g., with brackets or multi-line extends).
- **Solution**: Improved regex `([\w<>,\s]+?)` → `([\w<>,\s\[\]]+)` to handle generic types with arrays and ensure greedy matching.
- **Result**: Better fallback accuracy when Dart SDK is unavailable.


## [2026-05-13] RESOLVED: Dart Analyzer Progress & Spawn Fix
- **Problem**: Large projects gave no feedback during Dart analysis. Spawning `dart` on Windows failed with `ENOENT`.
- **Solution**: 
    1. Added `PROGRESS:` messages to `dart_analyzer.dart`.
    2. Switched from `exec` to `spawn` with `shell: true` in `dartAnalyzerWrapper.ts` to support streaming and correct command discovery.
    3. Updated `IndexManager` to report progress to the VS Code UI.
- **Result**: Users see real-time progress during indexing; Dart analyzer now starts correctly on Windows.
- **Lessons**: Use `spawn` with `shell: true` on Windows for reliable command execution when streaming output. Always provide progress feedback for long-running operations.
