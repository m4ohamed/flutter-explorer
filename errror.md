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

## [2026-05-14] RESOLVED: SQLite ABI Mismatch
- **Problem**: `better-sqlite3` fails to load with an ABI mismatch error (`NODE_MODULE_VERSION`).
- **Analysis**: The native module was compiled for a different Node.js/Electron version than the one running the extension.
- **Solution**: 
    1. Switched to `npx @electron/rebuild` for more reliable recompilation.
    2. Updated `package.json` to use the newer rebuild command.
    3. Enhanced `sqliteCache.ts` to log the full error message for better diagnostics.
- **Result**: `better-sqlite3` recompiled successfully for Electron v39.2.3. Detailed logs will now show the exact version mismatch if it persists.
- **Lessons**: Use `@electron/rebuild` instead of the legacy `electron-rebuild` for newer Electron versions. Always log the full exception message when catching ABI errors.
## [2026-05-14] RESOLVED: Advanced Dart 3.3+ Support (Extension Types & Multi-line)
- **Problem**: `DartParser` was missing `extension type` support, failed on multi-line definitions, had O(n²) bottlenecks in usage analysis, and incorrectly handled legacy `typedef` syntax.
- **Solution**: 
    1. Added `extensionType_` regex and `ExtensionTypeInfo` interface.
    2. Implemented lookahead (maskedLines slice) for multi-line support in classes, functions, and extension types.
    3. Replaced O(n²) backward-scanning with O(n) inline scope tracking in `analyzeUsages`.
    4. Added support for legacy `typedef Name(args)` syntax.
    5. Optimized masking to reuse preprocessed data across all analysis functions.
- **Result**: Accurate indexing of modern Dart features with significant performance gains on large files.
- **Lessons**: Always use lookahead for regex parsing of multi-line structures. Maintain O(n) complexity by tracking context statefully during a single pass. Clean up dead code (like `ctxClass`) and ensure all new types (like `extension type`) are registered in the usage tracking symbols map.

## [2026-05-14] RESOLVED: Indexing Concurrency Conflict
- **Problem**: Users could trigger multiple full re-index operations simultaneously, leading to redundant work and potential race conditions in the SQLite cache.
- **Solution**: 
    1. Implemented an `isIndexing` flag and a `CancellationTokenSource` in `IndexManager`.
    2. Added a modal UI prompt that appears if a re-index is requested while one is already running.
    3. Integrated full cancellation support throughout the indexing pipeline (file discovery, analysis, and processing).
- **Result**: Users have clear control over overlapping indexing tasks, and redundant operations are prevented.
- **Lessons**: Use VS Code's `CancellationToken` pattern to manage long-running async tasks. Always wrap state-dependent operations in `finally` blocks to ensure the system returns to a valid state even on failure or cancellation.
