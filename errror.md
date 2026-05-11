# Error Log (errror.md)

## [2026-05-11] Flutter MCP Extensions

### Problem: Index missing Enums and Mixins
- **Error**: `flutter_search` was unable to find `Enum` and `Mixin` definitions because the `DartParser` doesn't fully index them yet, and the MCP tools didn't have filters for them.
- **Fix**: 
    1. Extended `mcp-server.ts` to include manual filtering for `enums` and `mixins` in the index.
    2. Updated `mcp-direct-search.ts` to search for `enum Name` and `mixin Name` using Regex.
    3. Added `enum_definition` and `mixin_definition` types to `SearchResult`.

### Problem: ARB Key Ordering
- **Error**: Updating ARB files manually often leads to disorganized keys or missing metadata.
- **Fix**: Implemented `ArbEditor` with `updateTranslation` that:
    1. Reads existing JSON.
    2. Updates/Adds keys and metadata.
    3. Sorts keys alphabetically.
    4. Writes back with proper formatting.

### Problem: Search Filter Type Mismatch
- **Error**: `IndexManager.search` filter parameter was missing new types (`extension`, `typedef`, etc.), causing TypeScript errors during build.
- **Fix**: Updated `filter` type definition in `search` method to include all supported granular Dart elements.

### Problem: Missing Extension and Typedef Parsing
- **Error**: `DartParser` had interfaces for extensions and typedefs but no actual regex logic to extract them in `parse()`.
- **Fix**: Adding regex patterns for `extension Name on Type` and `typedef Name = ...` to the main loop in `DartParser.ts`.
