# Advanced Code Search

*Description: Deep dive into the codebase using semantic search, text search, and references*

## Advanced Code Search

Perform precise codebase searches to find hard-to-reach implementations and usages.

### Steps

1. Use `flutter_search` for general symbol lookups (classes, functions, widgets).
2. For specific strings, URLs, or comments, use `flutter_search_text` to scan all Dart files globally.
3. Need to see how a specific function/class is implemented? Use `flutter_read_fragment` to extract just that fragment with its surrounding comments.
4. Want to know everywhere a specific enum or typedef is used? Use `flutter_find_references`.

### Tips
- `flutter_search_text` is perfect for finding hidden API endpoints, hardcoded strings, or specific comment tags like TODOs.
- `flutter_read_fragment` is much faster and cleaner than reading an entire 1000-line file when you only need one specific method.
