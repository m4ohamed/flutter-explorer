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


## Pending Improvements
- [ ] Performance testing with large codebases.
- [x] Ensure `better-sqlite3` native binaries are correctly handled in extension packaging (Fixed by marking as external in esbuild and adding electron-rebuild script).
- [x] Fix SQLite initialization error (ABI mismatch): Rebuilt `better-sqlite3` using `electron-rebuild -v 39.2.3`.
- [ ] Add more granular indexing for method calls inside class methods.
