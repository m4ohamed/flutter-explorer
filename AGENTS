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
  - Supports indexing and direct search for: `class`, `function`, `widget`, `enum`, `mixin`, `extension`, `typedef`, `variable`, `constructor`, `property`, `annotation`, `file`, `translation`
  - Supports Direct Search Fallback when index is not available  
  
- **`flutter_get_stats`**: Get project statistics including all element types  
  - Returns: Files, Classes, Functions, Widgets, Enums, Mixins, Extensions, Typedefs, Variables, Constructors, Properties, Annotations, Translations  
  
- **`flutter_get_file_info`**: Get detailed information about a specific Dart file  
  
- **`flutter_get_project_structure`**: Get the structure of the project (folders and files), specifically focusing on the `lib/` directory
  - Parameters: `targetPath` (optional, defaults to "lib")
  - Returns: A formatted tree structure of the specified directory
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
  
- **`flutter_get_diagnostics`**: Get all VS Code diagnostics (errors/warnings) from the project  
  
- **`flutter_get_reverse_deps`**: Get reverse dependencies for any element (what depends on this element)
  - Supports: `class`, `function`, `extension`, `typedef`, `variable`, `constructor`, `property`, `annotation`, `enum`, `mixin`  
  - Accuracy: Uses pattern matching with context-aware validation for high-confidence results
  
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


## 4. AI Agent Usage Patterns for Flutter Projects

When working on a Flutter project using flutter-explorer MCP tools, follow these patterns:

### Pattern 1: Adding a New Feature

**Scenario**: User wants to add a new feature (e.g., "Add compensatory leave support")

**Steps**:
1. **Understand the project structure**:
   ```
   flutter_get_stats()
   flutter_get_project_structure(targetPath: "lib")
   flutter_list_packages()
   ```

2. **Search for related existing code**:
   ```
   flutter_search(query: "leave", filter: "all")
   flutter_search(query: "compensatory", filter: "all")
   ```

3. **Find the relevant domain layer**:
   ```
   flutter_search(query: "UseCase", filter: "class")
   flutter_search(query: "Repository", filter: "class")
   ```

4. **Read the existing implementation**:
   ```
   flutter_get_code_block(name: "GetLeaveUseCase", elementType: "class")
   ```

5. **Check for dependencies**:
   ```
   flutter_get_dependencies(className: "GetLeaveUseCase")
   ```

6. **Verify translation keys**:
   ```
   flutter_list_translations()
   flutter_search_text(query: "leave")
   ```

7. **Add missing translations**:
   ```
   flutter_update_translation(key: "compensatory_leave", arValue: "إجازة تعويضية", enValue: "Compensatory Leave")
   ```

---

### Pattern 2: Fixing a Bug

**Scenario**: User reports a bug in a specific function

**Steps**:
1. **Locate the problematic code**:
   ```
   flutter_search(query: "functionName", filter: "function")
   ```

2. **Read the full function**:
   ```
   flutter_get_code_block(name: "functionName", elementType: "function")
   ```

3. **Analyze the logic flow**:
   ```
   flutter_analyze_logic_flow(functionName: "functionName")
   ```

4. **Check what depends on this function**:
   ```
   flutter_get_reverse_deps(name: "functionName", type: "function")
   ```

5. **Search for similar patterns**:
   ```
   flutter_search(query: "similarKeyword", filter: "function")
   ```

6. **Test the fix**:
   - After making changes, verify no hardcoded strings were introduced:
   ```
   flutter_get_code_warnings()
   ```

---

### Pattern 3: Understanding Code Structure

**Scenario**: User asks "How does payroll calculation work?"

**Steps**:
1. **Search for the main use case**:
   ```
   flutter_search(query: "payroll", filter: "class")
   flutter_search(query: "calculate", filter: "function")
   ```

2. **Get the use case implementation**:
   ```
   flutter_get_code_block(name: "CalculatePayrollUseCase", elementType: "class")
   ```

3. **Analyze dependencies**:
   ```
   flutter_get_dependencies(className: "CalculatePayrollUseCase")
   ```

4. **Trace the data flow**:
   ```
   flutter_get_reverse_deps(name: "CalculatePayrollUseCase", type: "class")
   ```

5. **Read related repository**:
   ```
   flutter_search(query: "PayrollRepository", filter: "class")
   flutter_get_code_block(name: "PayrollRepository", elementType: "class")
   ```

---

### Pattern 4: Refactoring Code

**Scenario**: User wants to refactor a class or function

**Steps**:
1. **Find all usages**:
   ```
   flutter_get_reverse_deps(name: "ClassName", type: "class")
   flutter_search(query: "ClassName", searchMode: "calls")
   ```

2. **Read the current implementation**:
   ```
   flutter_get_code_block(name: "ClassName", elementType: "class")
   ```

3. **Check for similar patterns**:
   ```
   flutter_search(query: "similarPattern", filter: "class")
   ```

4. **Verify no breaking changes**:
   - After refactoring, check if all usages still work
   - Use `flutter_search_text` to find any hardcoded references

---

### Pattern 5: Adding Localization

**Scenario**: User adds a new feature and needs translations

**Steps**:
1. **Check existing translations**:
   ```
   flutter_list_translations()
   ```

2. **Find missing keys**:
   ```
   flutter_get_missing_translations()
   ```

3. **Search for hardcoded strings**:
   ```
   flutter_get_code_warnings()
   flutter_search_text(query: "hardcoded text")
   ```

4. **Add new translations**:
   ```
   flutter_update_translation(key: "new_feature_title", arValue: "عنوان الميزة الجديدة", enValue: "New Feature Title")
   ```

5. **Verify all keys are present**:
   ```
   flutter_get_missing_translations()
   ```

---

### Pattern 6: Debugging Issues

**Scenario**: User reports an error in a specific screen

**Steps**:
1. **Find the screen/widget**:
   ```
   flutter_search(query: "ScreenName", filter: "widget")
   ```

2. **Read the widget code**:
   ```
   flutter_get_code_block(name: "ScreenName", elementType: "class")
   ```

3. **Check the build method**:
   ```
   flutter_get_code_block(name: "build", elementType: "method", parentClass: "ScreenName")
   ```

4. **Analyze logic flow**:
   ```
   flutter_analyze_logic_flow(functionName: "build", parentClass: "ScreenName")
   ```

5. **Check related providers/state**:
   ```
   flutter_search(query: "providerName", filter: "class")
   flutter_get_reverse_deps(name: "ScreenName", type: "class")
   ```

---

### Best Practices

1. **Always start with `flutter_get_stats` and `flutter_get_project_structure`** to understand the project scale and layout.
2. **Use `flutter_search` with appropriate filters** instead of generic text search.
3. **Use `flutter_get_code_block`** to read full implementations instead of guessing line numbers.
4. **Check `flutter_get_reverse_deps`** before modifying to understand impact.
5. **Verify translations** with `flutter_get_missing_translations` after adding new UI.
6. **Use `flutter_get_code_warnings`** to ensure code quality.
7. **When index is not available**, tools automatically fall back to direct search (slower but works).

## 5. Error Handling  
- **Index Not Found**: MCP tools automatically fall back to Direct Search when index is not available  
- **Project Path Issues**: Use `flutter_set_project_path` to set the correct path  
- **Type Safety**: After modifying code, run `npx tsc --noEmit` to verify type safety  
- **Record Fixes**: Document any errors or fixes in `errror.md`  
## 6. Performance Considerations  
- **Hash-based Detection**: The extension uses MD5 hashing to avoid re-parsing unchanged files  
- **Reverse Dependencies**: Can be disabled in large projects via `flutterExplorer.enableReverseDependencies` setting  
- **Debouncing**: File changes are debounced (default 300ms) to avoid excessive re-indexing  
- **Regex-based Parsing**: Lightweight parsing keeps RAM usage low  
## 7. Development Guidelines  
- **Indexing**: The extension automatically indexes files on change. Use "Rebuild Full Index" command if needed  
- **MCP Server**: Runs independently and can be used without VS Code extension  
- **Environment Variable**: Set `FLUTTER_PROJECT_PATH` to specify project path for MCP server  
- **Direct Search**: Can be forced via `useDirectSearch: true` parameter in `flutter_search`  
## 8. Known Limitations  
- **Regex-based Parsing**: May not handle complex Dart syntax perfectly (e.g., nested generics, advanced patterns)  
- **Usage Tracking**: Reverse dependencies use pattern matching and may have false positives/negatives  
- **Git Info**: Package Git information may not be available for pub.dev packages  
- **Large Projects**: Reverse dependencies analysis may be slow in very large projects  
## 9. Documentation Files  
- **`errror.md`**: Error log and fixed issues  
- **`mcp_suggestions.md`**: MCP improvement suggestions
- **`README.md`**: User-facing documentation  
- **`AGENTS.md`**: This file - AI agent instructions