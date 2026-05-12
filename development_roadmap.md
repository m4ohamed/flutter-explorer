# Development Roadmap

## Phase 1: Core Functionality (Completed)
- [x] Basic Dart parsing (Classes, Functions, Widgets)
- [x] Simple JSON-based caching
- [x] Initial VS Code extension UI (Sidebar, Search)
- [x] Basic MCP Server integration

## Phase 2: Performance & Depth (Completed/Ongoing)
- [x] **SQLite Migration**: Replaced monolithic JSON cache with `better-sqlite3` for incremental, high-performance updates.
- [x] **Advanced Indexing**: Added support for 12+ Dart elements (Enums, Mixins, Extensions, Typedefs, Variables, etc.).
- [x] **Smart Search**: Integrated BM25 ranking algorithm for more relevant search results.
- [x] **Reverse Dependencies**: Implementation of high-confidence usage analysis for classes and functions.
- [x] **Incremental Updates**: Real-time indexing via file watchers without full project scans.

## Phase 3: Developer Experience & Reliability (Current)
- [x] **Standardized MCP Server**: Server now reads directly from SQLite, ensuring consistency between AI agents and the VS Code extension.
- [x] **Type Safety**: Full TypeScript validation across the project.
- [ ] **Data Integrity**: Implement periodic index validation and automatic repairs.
- [ ] **UI Polish**: Enhance the sidebar with more interactive dependency visualizations.

## Phase 4: Expansion & Integration (Next Steps)
- [ ] **Advanced Code Analysis**: Logic flow visualization and automated refactoring suggestions.
- [ ] **Performance Benchmarking**: Validate indexing speed on extremely large (1000+ files) projects.
- [x] **Extension Marketplace**: Prepared for distribution via `vsce package`.
- [ ] **Release**: Publish to VS Code Marketplace.
