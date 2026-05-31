# Flutter Explorer 🚀
![Flutter Explorer Icon](resources/icon.png)

**Flutter Explorer** is a high-performance, intelligent VS Code extension designed to streamline the development of large-scale Flutter applications. It provides deep project insights, advanced search capabilities, and automated code quality analysis directly within your editor.

---

## ✨ Key Features

### 🔍 Smart Project Indexing
*   **Granular Search**: Blazing fast search for Classes, Functions, Widgets, Enums, Mixins, **Extensions, Typedefs, Variables, Constructors, and Annotations**.
*   **Deep Context**: Understands project structure using lightweight, regex-based parsing that keeps your RAM usage low.
*   **Automatic Updates**: Files are watched in real-time, ensuring your index is always up-to-date.

### 📚 Dependency Management
*   **Library Indexing**: Automatically parses `pubspec.lock` to index all project dependencies, including hosted, git, and path sources.
*   **Smart ARB Editor**: Unified management of localization files with automated key sorting and gap analysis.

### ⚠️ Advanced Code Analysis
*   **Hardcoded Value Detection**: Automatically identifies hardcoded strings and colors, helping you maintain a clean, themeable, and localized codebase.
*   **ARB Translation Audit**: Compares multiple `.arb` files (e.g., `app_en.arb` vs `app_ar.arb`) to find missing keys in any language.
*   **One-Click Navigation**: Jump directly from a warning to the exact line of code needing attention.

### 🌳 Structural Visualization
*   **Live Widget Tree**: See a hierarchical view of widgets in your active Dart file.
*   **Dependency Explorer**: Visualize how your files are interconnected to better understand your architecture.
*   **Pubspec Manager**: View dependencies and assets with a quick-refresh interface.

### 🤖 AI-Ready with MCP
Flutter Explorer exposes its powerful indexing engine via the **Model Context Protocol (MCP)**. This allows AI agents (like Claude or ChatGPT) to:
*   `flutter_search`: Search for classes, functions, widgets, and other Dart elements. Use flutter_get_code_block to get full function/class bodies.
*   `flutter_get_stats`: Get summary statistics of the Flutter project index.
*   `flutter_get_project_structure`: Get the structure of the project (folders and files), specifically focusing on the lib/ directory.
*   `flutter_get_file_info`: Get detailed information about a specific Dart file.
*   `flutter_get_pubspec`: Read and analyze the project's pubspec.yaml file.
*   `flutter_get_code_warnings`: Get all code warnings (like hardcoded text and colors) from the Dart project.
*   `flutter_get_diagnostics`: Get all VS Code diagnostics (errors and warnings) for the project.
*   `flutter_get_missing_translations`: Find missing translation keys across all ARB files.
*   `flutter_update_translation`: Update or add a translation key across all ARB files.
*   `flutter_delete_translation`: Delete a translation key from all ARB files.
*   `flutter_list_translations`: List all translation keys and check for missing keys across ARB files.
*   `flutter_get_impact_analysis`: Analyze the 'blast radius' of a file: find all application entry points (UI/Main/Events) that eventually call code in this file.
*   `flutter_get_reverse_deps`: Get reverse dependencies for a class or function (what depends on this element).
*   `flutter_set_project_path`: Set the Flutter project root path for the MCP server.
*   `flutter_get_project_path`: Get the current Flutter project root path.
*   `flutter_get_node_at_cursor`: Find the Dart element (class/function) at a specific cursor position in a file.
*   `flutter_list_packages`: List all project dependencies from pubspec.lock.
*   `flutter_get_code_block`: Get the full body of a class, function, or method including comments.
*   `flutter_analyze_logic_flow`: Analyze a function's logic and return a summarized flow of steps.
*   `flutter_get_dependencies`: Get the dependencies (repositories, services, etc.) that a class depends on from its constructor.
*   `flutter_read_fragment`: Read a code fragment by element name (class, function, method) with surrounding comments.
*   `flutter_search_text`: Search for specific text, strings, or comments across all Dart files.
*   `flutter_get_index_status`: Check the status and last update time of the project index.
*   `flutter_get_detailed_graph`: Get a detailed relationship graph (inheritance, calls, imports) for the project or a specific file.
*   `flutter_get_hints`: Get context-aware suggestions for the next steps based on recent analysis.
*   `flutter_run_analyze`: Run compiler checks or linters on the current project based on its detected type (Flutter, TS/JS, Android).
*   `flutter_run_build_runner`: Run 'dart run build_runner build --delete-conflicting-outputs' to generate code for Freezed, Riverpod, etc.
*   `flutter_find_references`: Find all usages/references of a class, function, variable, enum, mixin, extension, or typedef in the project.
*   `flutter_run_intl_generate`: Manually trigger Intl generation (l10n.dart, messages_*.dart) via the built-in IntlGenerator.
*   `flutter_rebuild_index`: Manually trigger a full re-index of the Flutter project by the VS Code extension.

---

## 🚀 Getting Started

### Requirements
*   **VS Code 1.85.0+**
*   **Dart SDK** (Optional - enables 100% accurate indexing via `package:analyzer`).
*   **Flutter SDK** (For Flutter projects).

### Installation
1. Open **VS Code**.
2. Go to **Extensions** (Ctrl+Shift+X).
3. Search for `Flutter Explorer`.
4. Click **Install**.

### Usage
Once installed, a new **Flutter Explorer** icon will appear in your Activity Bar. 
*   **Full Build**: On first launch, click "Build Index" if prompted.
*   **Search**: Use the search bar at the top of the sidebar.
*   **Analysis**: Switch to the "Analysis" tab to see code quality warnings.

---

## 🛠️ Development

If you'd like to contribute or build from source:

1. Clone the repository:
   ```bash
   git clone https://github.com/m4ohamed/flutter-explorer.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the extension in Debug mode:
   Press `F5` or use the **Run and Debug** sidebar.
4. Watch for changes:
   ```bash
   npm run watch
   ```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

*Built with ❤️ for the Flutter community.*
