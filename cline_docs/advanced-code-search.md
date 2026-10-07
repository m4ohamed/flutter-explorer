# Advanced Code Search

*Description: Deep dive into the codebase using BM25 ranked symbol search, full-text regex, index-backed references, code fragments, and external package search*

# Advanced Code Search

Perform ultra-precise, token-efficient searches across Flutter, Dart, TypeScript, and Android source code without reading entire files.

## Workflow

### 1. Symbol Search & Full-Text Search
1. **BM25 Symbol Search**: Call `flutter_search` with `query` and optional `filter` (`class`, `function`, `widget`, `enum`, `mixin`, `extension`, `typedef`, `variable`, `constructor`, `property`, `annotation`, `call`, `translation`).
   - Use `searchMode: "definitions"` (default), `"calls"` (find call-sites), or `"both"`.
2. **Regex & Content Search**: Call `flutter_search_text` for raw regex patterns, string literals, API endpoints, or comment tags across the repository.
3. **Resolve Node at Line**: Call `flutter_get_node_at_cursor` with `filePath` and `line` to instantly identify the symbol at a cursor position.

### 2. Reading Targeted Code
1. **Full Body with Comments**: Call `flutter_get_code_block` or `flutter_read_fragment` to retrieve only the relevant class, function, or method implementation without loading the full file into context.
2. **Precise Line Slicing**: Call `flutter_read_lines` (`startLine`, `endLine`) to inspect error zones cheaply without token bloat.

### 3. Usages & Package Code
1. **Symbol Usages**: Call `flutter_find_references` to retrieve all verified usages, line numbers, and context snippets across importing files.
2. **External Packages**: Call `flutter_search_packages` to grep for classes or methods directly inside cached pub dependencies or Flutter framework internals.