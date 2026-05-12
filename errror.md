# Error Log & Fixes

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

## Pending Improvements
- [ ] Performance testing with large codebases.
- [x] Ensure `better-sqlite3` native binaries are correctly handled in extension packaging (Fixed by marking as external in esbuild).
- [ ] Add more granular indexing for method calls inside class methods.
