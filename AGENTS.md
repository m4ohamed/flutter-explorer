# Instructions for AI Agents (AGENTS.md)  
  
When working on this project, please follow these guidelines to ensure consistency and efficiency:  
  
## 1. Project Context  
This is a VS Code extension for Flutter developers that provides:  
- **Smart Project Indexing**: Fast search for 12+ Dart elements (Classes, Functions, Widgets, Enums, Mixins, Extensions, Typedefs, Variables, Constructors, Properties, Annotations, Files, Translations)  
- **Dependency Management**: Library indexing from pubspec.lock and Smart ARB Editor  
- **Code Analysis**: Hardcoded value detection and ARB translation audit  
- **Structural Visualization**: Widget tree viewer and dependency graph  
- **MCP Server**: Exposes indexing engine to AI agents via Model Context Protocol  
  
Use the `flutter-explorer-mcp` tools to gather context.  
  
## 2. MCP Tools Reference  
  
### Search & Discovery  
- **`flutter_search`**: Search for any Dart element with advanced filters  
  - Filters: `class`, `function`, `widget`, `enum`, `mixin`, `extension`, `typedef`, `variable`, `constructor`, `property`, `annotation`, `file`, `translation`  
  - Aliases: `ext` → `extension`, `type` → `typedef`, `vars` → `variable`, `call` → `function`  
  - Modes: `definitions`, `calls`, `both`  
  - Supports Direct Search Fallback when index is not available  
  
- **`flutter_get_stats`**: Get project statistics including all element types  
  - Returns: Files, Classes, Functions, Widgets, Enums, Mixins, Extensions, Typedefs, Variables, Constructors, Properties, Annotations, Translations  
  
- **`flutter_get_file_info`**: Get detailed information about a specific Dart file  
  
- **`flutter_search_text`**: Search for specific text, strings, or comments across all Dart files
  - Supports: Regex, Case-sensitivity, Filter by comments/strings
  
### Dependencies & Packages  
- **`flutter_list_packages`**: List all project dependencies from pubspec.lock  
  - Filters: `direct`, `dev`, `transitive`, `all`  
  - Source filters: `hosted`, `git`, `path`, `all`  
  
- **`flutter_get_pubspec`**: Read and analyze pubspec.yaml  
  
### Code Analysis  
- **`flutter_get_code_block`**: Get the full body of a class, function, or method including comments
  - Supports: `class`, `function`, `method`, `enum`, `mixin`, `extension`
  
- **`flutter_analyze_logic_flow`**: Analyze a function's logic and return a summarized flow of steps
  
- **`flutter_get_dependencies`**: Get the dependencies (repositories, services, etc.) that a class depends on from its constructor
  
- **`flutter_read_fragment`**: Read a code fragment by element name with surrounding context
  
- **`flutter_get_code_warnings`**: Get all code warnings (hardcoded strings/colors)  
  
- **`flutter_get_reverse_deps`**: Get reverse dependencies for any element  
  - Supports: `class`, `function`, `extension`, `typedef`, `variable`, `constructor`, `property`, `annotation`, `enum`, `mixin`  
  - Shows what depends on the specified element  
  
### Translation Management  
- **`flutter_list_translations`**: List all translation keys and check for missing keys across ARB files  
  
- **`flutter_get_missing_translations`**: Find missing translation keys across all ARB files  
  
- **`flutter_update_translation`**: Add or update a translation key in all ARB files  
  - Parameters: `key`, `arValue`, `enValue`, `description` (optional)  
  
- **`flutter_delete_translation`**: Delete a translation key from all ARB files  
  
### Index Management
- **`flutter_get_index_status`**: Check the status and last update time of the project index
- **`flutter_rebuild_index`**: Request a manual rebuild of the project index (requires active VS Code extension)

### Project Path Management  
- **`flutter_set_project_path`**: Set the Flutter project root path for the MCP server  
  - Validates that pubspec.yaml exists in the specified path  
  
- **`flutter_get_project_path`**: Get the current Flutter project root path  
  
## 3. Analysis Workflow  
  
When starting work on a Flutter project:  
  
1. **Set Project Path** (if needed):
flutter_set_project_path(projectPath: "/path/to/project")


2. **Get Project Overview**:
flutter_get_stats()
flutter_list_packages()


3. **Search for Specific Elements**:
flutter_search(query: "MyClass", filter: "class")
flutter_search(query: "markHoliday", filter: "function", searchMode: "calls")


4. **Check Code Quality**:
flutter_get_code_warnings()
flutter_get_missing_translations()


5. **Analyze Dependencies**:
flutter_get_reverse_deps(name: "MyClass", type: "class")


## 4. Error Handling  
- **Index Not Found**: MCP tools automatically fall back to Direct Search when index is not available  
- **Project Path Issues**: Use `flutter_set_project_path` to set the correct path  
- **Type Safety**: After modifying code, run `npx tsc --noEmit` to verify type safety  
- **Record Fixes**: Document any errors or fixes in `errror.md`  
## 5. Performance Considerations  
- **Hash-based Detection**: The extension uses MD5 hashing to avoid re-parsing unchanged files  
- **Reverse Dependencies**: Can be disabled in large projects via `flutterExplorer.enableReverseDependencies` setting  
- **Debouncing**: File changes are debounced (default 300ms) to avoid excessive re-indexing  
- **Regex-based Parsing**: Lightweight parsing keeps RAM usage low  
## 6. Development Guidelines  
- **Indexing**: The extension automatically indexes files on change. Use "Rebuild Full Index" command if needed  
- **MCP Server**: Runs independently and can be used without VS Code extension  
- **Environment Variable**: Set `FLUTTER_PROJECT_PATH` to specify project path for MCP server  
- **Direct Search**: Can be forced via `useDirectSearch: true` parameter in `flutter_search`  
## 7. Known Limitations  
- **Regex-based Parsing**: May not handle complex Dart syntax perfectly (e.g., nested generics, advanced patterns)  
- **Usage Tracking**: Reverse dependencies use pattern matching and may have false positives/negatives  
- **Git Info**: Package Git information may not be available for pub.dev packages  
- **Large Projects**: Reverse dependencies analysis may be slow in very large projects  
## 8. Documentation Files  
- **`errror.md`**: Error log and fixed issues  
- **`mcp_suggestions.md`**: MCP improvement suggestions
- **`README.md`**: User-facing documentation  
- **`AGENTS.md`**: This file - AI agent instructions