# Error Log & Fixes

## [2026-05-17] RESOLVED: ENOENT node-sqlite3-wasm.wasm & Obsolete better-sqlite3 Scripts
- **Problem**: Activating extension failed with `ENOENT: no such file or directory, open 'c:\Users\m4oha\OneDrive\Desktop\new\out\node-sqlite3-wasm.wasm'`. Also, obsolete `better-sqlite3` rebuild scripts remained in `package.json`.
- **Cause**: When `esbuild` bundles `node-sqlite3-wasm` (or when loaded from `out/extension.js`), `__dirname` becomes `out/`, causing the WASM loader to look for `node-sqlite3-wasm.wasm` in `out/`. Meanwhile, `package.json` still had `postinstall` and `rebuild` scripts for `better-sqlite3` even though the project switched to `node-sqlite3-wasm`.
- **Solution**:
    1. Removed `rebuild` and `postinstall` scripts from `package.json`.
    2. Updated `esbuild.js` `external` array to include `node-sqlite3-wasm` instead of `better-sqlite3`.
    3. Added a dedicated copy step in `esbuild.js` to automatically copy `node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm` to `out/node-sqlite3-wasm.wasm`, guaranteeing 100% availability regardless of whether the module is bundled or external.
- **Lessons**: Always ensure WASM binary assets are copied to the build output directory (`out/`) when using bundlers like esbuild, and clean up obsolete native rebuild scripts when migrating to WASM-based solutions.

## [2026-05-17] RESOLVED: better-sqlite3 ABI Mismatch & Hardcoded Electron Version
- **Problem**: `better-sqlite3` native module rebuilding was hardcoded to `-v 39.2.3` in `package.json`. When VS Code updates its internal Electron/Node version (e.g. NODE_MODULE_VERSION 140), the rebuild script fails to match the new ABI, requiring manual version updates.
- **Solution**:
    1. Added `"electron": "32.2.6"` to `devDependencies` in `package.json` so `@electron/rebuild` automatically detects the correct target version matching VS Code.
    2. Updated `"rebuild"` script to `"electron-rebuild -f -w better-sqlite3"`.
    3. Added `"postinstall": "npm run rebuild"` to automatically rebuild native modules on every `npm install`.
- **Lessons**: Never hardcode Electron versions in rebuild scripts. Provide the matching `electron` package in `devDependencies` and use `postinstall` to automate ABI matching.

## [2026-05-17] RESOLVED: MCP stdio Protocol Corruption
- **Problem**: `flutter-explorer-mcp` tools failed with `invalid character 'F' looking for beginning of value`.
- **Cause**: The MCP server initialization code called `console.error("Flutter Explorer MCP Server running on stdio");` and `sqliteCache` called `console.log("[FlutterExplorer] ...")`. Some MCP clients (or environments) merge `stdout` and `stderr` or get corrupted when any non-JSON string is printed to `stdout`.
- **Solution**: 
    1. Overwrote `console.log` at the top of `mcp-server.ts` to redirect to `console.error` (`console.log = function(...args) { console.error(...args); };`).
    2. Completely removed the startup `console.error` message to ensure absolute silence before JSON-RPC.
- **Lessons**: NEVER use `console.log` for debugging inside an MCP server that communicates over `stdio`. Always redirect `stdout` to `stderr` globally at the start of the file.

## [2026-05-17] RESOLVED: Dual ABI Environment (Electron vs Node)
- **Problem**: `better-sqlite3` native module can only be compiled for one ABI at a time. The MCP Server runs on Node.js (needs Node ABI), while the VS Code Extension runs on Electron (needs Electron ABI).
- **Cause**: Running `npm rebuild better-sqlite3` compiled it for Node.js, which fixed the MCP server but broke the VS Code extension. Running `electron-rebuild` fixes the VS Code extension but breaks the MCP server.
- **Solution**: Documented the limitation. In production, extensions either ship prebuilt binaries for both environments or use an IPC/RPC method where the extension acts as the MCP server directly. For local development, be aware of which environment you just compiled for.

## [2026-05-17] RESOLVED: Sequential Indexing Bottleneck & Typo Fix
- **Problem**: `IndexManager.buildFullIndex` processed files sequentially, causing significant performance bottlenecks during full project indexing. A typo (`rel(Path)`) also caused TypeScript build failure.
- **Solution**:
    1. Implemented a robust worker pool concurrency helper (`runConcurrent`) in `IndexManager`.
    2. Batched SQLite upserts (`batchUpsertDartFiles`) to execute within a single transaction, eliminating individual WAL disk commit overhead.
    3. Fixed the `rel(Path)` typo to `relPath` and verified a clean build with `npx tsc --noEmit`.
- **Result**: Indexing now processes files concurrently based on the `flutterExplorer.indexingConcurrency` setting (default: 3) and performs blazing fast batched SQLite inserts.

## [2026-05-14] RESOLVED: Metadata loss in ARB files
- **Problem**: Current `readArb`/`writeArb` only supports specific metadata keys and ignores `@@` keys.
- **Solution**: Refactored to preserve all JSON keys and only modify targeted ones.
- **Lessons**: When editing ARB files, preserve global metadata (`@@`) and per-key metadata (`@key`) entirely.

## [2026-05-14] RESOLVED: Automatic re-sorting
- **Problem**: `writeArb` explicitly sorts keys, which violates "do not modify anything existing".
- **Solution**: Removed explicit sorting unless necessary, or maintain original order.
- **Lessons**: Avoid side effects like re-sorting keys unless explicitly requested, to minimize diffs and preserve user formatting.

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

## [2026-05-14] RESOLVED: Improved Impact Analysis Accuracy
- **Problem**: Impact analysis returned "No direct execution flows found" due to shallow BFS (depth 5), incomplete entry point detection, and inefficient forward BFS logic.
- **Solution**: 
    1. Implemented a robust backward BFS (`findImpactBackwards`) in `CodeAnalyzer` starting from all entities in the target file back to entry points.
    2. Expanded `findEntryPoints` to include Bloc, Cubit, Notifier, and common lifecycle/event methods (dispose, onInit, mapEventToState, etc.).
    3. Increased default `maxDepth` from 5 to 25 and exposed it as a parameter in the MCP tool.
    4. Replaced the non-existent `findPathToTargets` call in `mcp-server.ts` with the new optimized logic.
- **Result**: "Blast radius" analysis is now significantly more accurate and captures deep UI-to-Logic dependency chains common in Flutter projects.
- **Lessons**: Backward BFS is almost always better for "what depends on this" or "how do I reach this" queries in large graphs. Always include framework-specific lifecycle methods as valid entry points.

## [2026-05-13] Improving "Index not found" Error Messages
- **Problem**: The MCP server tools often return a generic "Index not found" message when the SQLite database is missing, inaccessible, or empty.
- **Solution**: Implemented `SqliteCache.getDiagnostics()` which checks file existence, row counts, and captures specific SQLite open errors.
- **Lessons**: Always differentiate between "Missing File", "Access Denied", and "Empty Data" for better UX.

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
