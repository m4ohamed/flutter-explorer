# Flutter Explorer 🚀

<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Flutter Explorer Icon">
</p>


**Flutter Explorer** is a high-performance, intelligent VS Code extension designed to streamline the development of large-scale Flutter applications. It provides deep project insights, advanced search capabilities, and automated code quality analysis directly within your editor.

---

## ✨ Key Features

### 🔍 Smart Project Indexing
*   **Instant Search**: Blazing fast search for Classes, Functions, Widgets, Enums, and Mixins.
*   **Deep Context**: Understands project structure using lightweight, regex-based parsing that keeps your RAM usage low.
*   **Automatic Updates**: Files are watched in real-time, ensuring your index is always up-to-date.

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
*   Query project statistics.
*   Search for specific code patterns.
*   Retrieve analysis warnings and translation gaps programmatically.

---

## 🚀 Getting Started

### Prerequisites
*   VS Code 1.75+
*   Flutter & Dart SDK installed

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
