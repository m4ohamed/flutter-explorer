# Error Log & Fixes

## Pending Improvements
- [x] Add `enumUsages` and `mixinUsages` to `DartFileInfo`.
- [x] Enhance `analyzeUsages` to search for all new element types (extensions, typedefs, etc.).
- [x] Support `enum` and `mixin` in `flutter_get_reverse_deps`.
- [x] Fix `Extensions` method/property collection in `DartParser`.
- [x] Propagate all new usage types in `buildReverseDependencies`.

## Fixed Errors
- Fixed `DartFileInfo` initialization missing `enumUsages` and `mixinUsages`.
- Fixed `SearchResult` type union missing `'file'`.
- Fixed missing support for `enums` and `mixins` in reverse dependencies.
- [x] Fix extension method/property collection.

## New Tasks - Advanced MCP Tools
- [x] Implement `extractCodeBlock` in `DartParser`.
- [x] Implement `CodeAnalyzer` for logic flow and dependencies.
- [x] Register new tools in `mcp-server.ts`.


### Potential Issues to Avoid
- **Brace Mismatch**: `extractCodeBlock` must correctly track braces even inside strings or comments (though regex is used, the brace counter is separate).
- **Import Paths**: Ensure `mcp-server.ts` uses correct relative paths for new files (e.g., `./mcp-code-analyzer.js` for compiled JS).
- **Search Fallback**: Tools should search all files if `filePath` is not provided.
- **Type Safety**: Ensure `Zod` schemas match the expected input types.

