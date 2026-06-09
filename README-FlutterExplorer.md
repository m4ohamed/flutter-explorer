# Flutter Explorer 🚀

**Flutter Explorer** is a high-performance, intelligent VS Code extension designed to streamline the development of large-scale Flutter applications. It provides deep project insights, advanced search capabilities, automated code quality analysis, and an AI-ready Model Context Protocol (MCP) server directly integrated into your workspace.

---

## ✨ Key Features

### 🔍 Intelligent Project Indexing & Querying
*   **Granular Element Search**: Search class structures, functions, widgets, enums, mixins, extensions, typedefs, variables, constructors, and annotations.
*   **Highly Performant Caching**: Utilizes a robust SQLite cache database to store AST information locally, minimizing memory footprint and indexing startup times.
*   **Concurrency Support**: Configurable worker-pool style concurrency to parse large-scale projects without locking resources.
*   **Real-time Watching**: Watches for file modifications to update database cache incrementally.

### 🤖 AI-Ready via Model Context Protocol (MCP)
Allows leading AI editors (like Cursor) or external models to query project statistics, find precise references, map constructor dependencies, run code analyses, and view/modify project localizations (ARB translation keys).

### ⚠️ Localization & Code Auditing
*   **Translation Key Sync**: Synchronizes translation keys across localized ARB files (e.g., `app_en.arb` and `app_ar.arb`), identifying missing translation gaps automatically.
*   **Hardcoded Warnings**: Automatically flags hardcoded strings and colors inside Dart files so you can keep your theme and language clean.

### 🌳 Structural Visualizer
*   **Interactive Widget Trees**: Real-time hierarchical widget representation.
*   **Dependency Graph View**: Visually explore project files, inheritance pathways, and import blast-radiuses using D3.js.

---

## 🚀 Getting Started

### 📋 Prerequisites
*   **VS Code 1.85.0+**
*   **Flutter & Dart SDK** (Make sure they are added to your system `PATH`).

---

## 🛠️ Usage & Operations

### 1️⃣ Initial Indexing
On opening a workspace containing a `pubspec.yaml`, the extension will automatically build the project index.
*   You can manually trigger a full rebuild at any time using the status bar item or running the command:
    **`Flutter Explorer: Rebuild Full Index`** (`flutterExplorer.reindex`) from the Command Palette (`Ctrl+Shift+P`).

### 2️⃣ Webview Sidebar
Access the Sidebar tab on the Activity Bar to:
*   **Search**: Perform instant queries across code definitions.
*   **Widget Tree**: Interactively traverse the active Dart file's widget hierarchy.
*   **Dependencies**: Explore files interacting with the active document.
*   **Localization (ARB)**: Add, edit, or remove translation keys across all language files with automatic sorting and conflict analysis.

### 3️⃣ Interactive Dependency Graph
Run the command **`Flutter Explorer: Open Interactive Dependency Graph`** (`flutterExplorer.openGraph`) from the Command Palette to visualize import patterns and relations.

---

## 🤖 Configuring the AI MCP Server (Cursor / Claude Desktop)

To enable AI models to query and code on your Flutter codebase using the high-performance index:

1. **Auto-Setup Config**:
   Run the command **`Flutter Explorer: Auto-Setup MCP Config`** (`flutterExplorer.setupMcp`) from the Command Palette.
   This writes the configuration path for the MCP server so AI editors like Cursor can find it.

2. **Manual Setup**:
   Add the following config snippet to your Cursor MCP settings (Settings -> Features -> MCP -> Add New MCP Server) or Claude Desktop Config:
   *   **Type**: `command`
   *   **Command**: `node "C:/path/to/extension/out/mcp-server.js"`

### Available MCP Tools for AI:
*   `flutter_search`: Search for classes, functions, widgets, and other Dart elements. Use flutter_get_code_block to get full function/class bodies.
*   `flutter_get_stats`: Get summary statistics of the Flutter project index.
*   `flutter_get_project_structure`: Get the structure of the project (folders and files), specifically focusing on the lib/ directory.
*   `flutter_get_file_info`: Get detailed information about a specific Dart file.
*   `flutter_get_pubspec`: Read and analyze the project's pubspec.yaml file.
*   `flutter_get_code_warnings`: Get all code warnings (like hardcoded text, colors, and duplicated code/logic) from the Dart project.
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

### 🤖 Automated AI Skills & Rules Generation
On activation or when running the Auto-Setup command, the extension automatically generates and distributes tailored AI skills and rules for your favorite AI assistants and editors:
*   **Cursor**: Generates `.cursor/rules/*.mdc` rule files with globs.
*   **Claude / Roo Code**: Generates `cline_docs/*.md` workspace documentation.
*   **Gemini Agent / Antigravity**: Generates global skill folders under `~/.gemini/config/skills/` and appends developer instructions to `~/.gemini/GEMINI.md`.
*   **Generic Workspace**: Generates standard markdown instructions under `skills/`.

This allows your AI coding assistants to instantly learn how and when to use the MCP tools, utilizing built-in step-by-step workflows for exploration, issue debugging, and translation management.

---

## ⚙️ Configuration Settings
Customize behavior via VS Code Settings (`Ctrl+,`):

*   `flutterExplorer.autoIndex` (default: `true`): Index files automatically on changes.
*   `flutterExplorer.indexingConcurrency` (default: `2`): Concurrency level during initial indexing.
*   `flutterExplorer.watchAndroidApp` (default: `true`): Index Android configuration changes.
*   `flutterExplorer.useDartAnalyzer` (default: `false`): Enable heavy analysis parser using the Dart SDK.
*   `flutterExplorer.debounceMs` (default: `300`): Delay in milliseconds before executing incremental indexing.

---

*Made with ❤️ for the Flutter & Dart Developer Community.*
