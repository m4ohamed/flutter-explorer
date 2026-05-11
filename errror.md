# Error Log

## Missing Import Error
- **Error:** `error TS2304: Cannot find name 'SearchResult'.` in `sidebarProvider.ts`.
- **Cause:** Added `SearchResult` as a parameter type in `getSearchResultsForWebview` but forgot to import it from `indexManager.ts`.
- **Fix:** Added `SearchResult` to the existing `IndexManager` import in `sidebarProvider.ts`.
- **Prevention:** Always check if types used in new/modified functions are imported in the file.
