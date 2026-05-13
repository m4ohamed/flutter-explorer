# Error Log & Fixes

## Historical Fixes (from error.md)
### 1. Wrong property name for base class
- **Error**: Used `superClass` instead of `extendsClass` in `IndexManager.ts` and `mcp-server.ts`.
- **Fix**: Replaced `superClass` with `extendsClass` to match the interface definition.

### 2. Missing closing brace in IndexManager
- **Error**: Accidentally deleted the closing brace of the `parseArb` method.
- **Fix**: Re-inserted the missing `}`.

### 3. Dart Call Site Detection Interface
- **Error**: `receiver` property wasn't defined in the `FunctionCall` interface.
- **Fix**: Added `receiver?: string;` to the `FunctionCall` interface.

### 4. Build Failure: Missing D3 dependency
- **Error**: `esbuild` failed to resolve `d3`.
- **Fix**: Re-ran `npm install d3` and updated `esbuild.js` to separate builds.


## SQLite Migration Status (2026-05-12)
- [x] Integrate `better-sqlite3` for index persistence.
- [x] Update `IndexManager` to use `SqliteCache` instead of legacy JSON.
- [x] Update `mcp-server.ts` to query SQLite directly.
- [x] Remove redundant JSON fallback from `mcp-server.ts`.
- [x] Remove redundant JSON cache logic from `IndexManager.ts`.
- [x] Fix MCP path synchronization bug (singleton reset).
- [ ] Investigate/Fix SQLite ABI mismatch for MCP server runtime.
- [ ] Bootstrap index for `sadara` project.
- [x] Expand BM25 indexing to cover all Dart element types.
- [x] Fix Widget classification in search results.

## Fixed Errors
- **Duplicate `loadCache`**: `IndexManager.ts` had two implementations of `loadCache`. Removed the first redundant one and fixed the second one which had syntax errors.
- **Missing `INDEX_PATH`**: `mcp-server.ts` was still using the removed `INDEX_PATH()` function in `flutter_get_index_status`. Updated to use the actual SQLite DB path.
- **Variable Name mismatch**: Fixed `indexPath` vs `dbPath` in `mcp-server.ts`.
- **Type Safety**: Verified all changes with `npx tsc --noEmit`.
- **Robust Project Discovery**: Fixed issue where MCP could not find the project root if started from a subdirectory. Implemented `ProjectDetector` to find `pubspec.yaml` or `.git`.
- **Database Migration**: Added logic to safely move `.db`, `.db-wal`, and `.db-shm` files from `.vscode/` to the new `.flutter-explorer/` directory.
- **AI Skills Generation Syntax**: Fixed `error TS1127: Invalid character` and `TS1160: Unterminated template literal` in `skillsGenerator.ts`.
    - **Fix**: Replaced backtick template construction for nested markdown content with `Array.join('\n')` to avoid double-escaping issues during code generation.
- **Legacy JSON Cleanup**: Fixed issue where the old `flutter-explorer.json` file remained in `.vscode/` after migrating to SQLite and the new `.flutter-explorer/` directory.
    - **Fix**: Added automated deletion of the legacy JSON file during `SqliteCache` initialization.

## Errors Encountered During Testing (2026-05-13)
- **Index not found for new project path**: Encountered `Index not found` when trying to get a graph for `E:\New folder\sad\sadara\`.
    - **Root Cause**: The project path was changed, but no index exists yet in the new path's `.flutter-explorer/` directory. The VS Code extension might not be active to trigger background indexing.
    - **Planned Fix**: Manually trigger `rebuild_index` via MCP tool to bootstrap the SQLite database in the new location.
- **Reverse Dependencies Missing in MCP**: Reverse dependency data (`usedInFiles`) is available in the extension but missing in the MCP server.
    - **Fix**: Updated `buildReverseDependencies` to perform a bulk upsert to SQLite after calculation and automated checkpointing.
- **MCP SQLite Access Reliability**: Resolved data visibility issues where updates were trapped in WAL files.
    - **Fix**: Implemented automated `SqliteCache.checkpoint()` (using `PRAGMA wal_checkpoint(TRUNCATE)`) at the end of major indexing tasks. The MCP server now reads a fully updated `.db` file in `readonly` mode.
- **TypeScript Type Mismatch (TS2345)**: `IndexManager.ts` failed to compile due to `string | undefined` hash being passed to `batchUpsertDartFiles`.
    - **Fix**: Updated `SqliteCache` methods (`upsertDartFile` and `batchUpsertDartFiles`) to accept `string | undefined` for the hash parameter, as `DartFileInfo.contentHash` is optional.
- **MCP Path Synchronization Bug**: `flutter_set_project_path` was not resetting the `sqliteCache` singleton, causing it to stick to the first project path it was initialized with.
    - **Fix**: Added `sqliteCache = null` in the `flutter_set_project_path` tool handler.
- **SQLite ABI Mismatch in MCP**: The MCP server fails to load `better-sqlite3` due to a Node.js version mismatch between the environment and the compiled binary.
    - **Status**: Identified. Rebuild failed due to file locks (likely VS Code). Workaround: Inform user or ensure Node versions match.
