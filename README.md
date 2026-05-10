# Flutter Explorer

A powerful VS Code extension designed to enhance Flutter development efficiency with advanced project indexing, search, and analysis tools.

## Features

- **🔍 Smart Search**: Instantly find Classes, Functions, Widgets, Enums, and Mixins across your entire project.
- **🌳 Widget Tree**: Visualize the widget hierarchy of your current Dart file.
- **📊 Dependency Graph**: See how your project files are connected.
- **📦 Pubspec Analysis**: View and refresh your project's dependencies and assets directly from the sidebar.
- **⚠️ Code Analysis**:
  - **Hardcoded Text & Colors**: Detect hardcoded strings and color values that should be in localization or theme files.
  - **Missing Translations**: Automatically compare ARB files to find missing keys across different languages.
- **🤖 MCP Integration**: Exposes project metadata and analysis tools to AI agents via the Model Context Protocol.

## Installation

(Add installation instructions once published to the Marketplace)

## Usage

1. Open a Flutter project in VS Code.
2. The extension will automatically index your project.
3. Use the Flutter Explorer icon in the sidebar to access all features.
4. Click on statistics to filter search results instantly.

## Development

- `npm install`: Install dependencies.
- `F5`: Start debugging the extension.
- `npm run watch`: Automatically recompile on changes.

## License

[MIT](LICENSE)
