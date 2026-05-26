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
*   `flutter_search`: Semantic & ranked BM25 search across all Dart elements.
*   `flutter_get_dependencies`: Extracts constructor parameters and matches them to smart import paths.
*   `flutter_find_references`: Scans files line-by-line using precise boundary RegEx patterns to return references with actual line numbers and code snippets.
*   `flutter_run_analyze`: Runs `flutter analyze` and returns parsed JSON warnings/errors.
*   `flutter_run_build_runner`: Executes `build_runner build` safely in the background with timeout guards.
*   `flutter_list_translations` / `flutter_update_translation` / `flutter_delete_translation`: Manage localized ARB files.

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
