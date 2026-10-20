# Graph Report - new  (2026-10-20)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1166 nodes · 2398 edges · 70 communities (49 shown, 21 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 102 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `383c5a8f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dartParser.ts
- mcp-code-analyzer.ts
- test_dart_analyzer.dart
- fileEditor.ts
- PureDartParser
- bm25.rs
- ArbEditor
- VmServiceBridge
- graph.ts
- main.rs
- dart_analyzer.dart
- IntlGenerator
- watcher.rs
- SqliteCache
- main
- DartParser
- NativeSqliteCache
- package.json
- scanner.rs
- ref_path
- activate
- analysisRunner.ts
- IndexManager
- compilerOptions
- test-dart-parser-golden.js
- RustBridge
- mcp-server.ts
- indexManager.ts
- sidebar.js
- devDependencies
- BM25Search
- PackageResolver
- FileWatcher
- PubspecProvider
- Widget
- dartAnalyzerWrapper.ts
- SearchProvider
- scripts
- run-tests.js
- esbuild.js
- contributes
- mcp-direct-search.ts
- properties
- GraphWebviewPanel
- flutterExplorer.engine
- flutterExplorer.mcpServerMode
- PubspecLockProvider
- packageResolver.ts
- widgetTreeProvider.ts
- _CounterPageState
- flutter-explorer-mcp
- flutterExplorer.autoIndex
- flutterExplorer.debounceMs
- flutterExplorer.enableJsonIndex
- flutterExplorer.enableReverseDependencies
- flutterExplorer.indexingConcurrency
- flutterExplorer.useDartAnalyzer
- flutterExplorer.watchAndroidApp
- dependencyGraphProvider.ts
- repository
- patches.ts
- bm25Search.ts
- UserRepository
- bugs
- dependencies
- engines
- String
- flutter_explorer_core

## God Nodes (most connected - your core abstractions)
1. `IndexManager` - 66 edges
2. `activate()` - 45 edges
3. `DartFileInfo` - 36 edges
4. `IntlGenerator` - 31 edges
5. `PureDartParser` - 31 edges
6. `VmServiceBridge` - 28 edges
7. `SqliteCache` - 28 edges
8. `main()` - 26 edges
9. `ArbEditor` - 25 edges
10. `RustBridge` - 24 edges

## Surprising Connections (you probably didn't know these)
- `project()` --calls--> `ArbEditor`  [EXTRACTED]
  tests/arbEditor.test.ts → src/mcp-arb-editor.ts
- `makeCalls()` --calls--> `ImportResolver`  [EXTRACTED]
  tests/importResolver.test.ts → src/indexer/importResolver.ts
- `makeCalls()` --calls--> `CallResolver`  [EXTRACTED]
  tests/importResolver.test.ts → src/indexer/importResolver.ts
- `connect()` --calls--> `registerEditTools()`  [EXTRACTED]
  tests/mcpEditTools.test.ts → src/mcp-edit-tools.ts
- `activate()` --calls--> `IndexManager`  [EXTRACTED]
  src/extension.ts → src/indexer/indexManager.ts

## Import Cycles
- None detected.

## Communities (70 total, 21 thin omitted)

### Community 0 - "dartParser.ts"
Cohesion: 0.05
Nodes (50): AndroidParser, BaseParser, AnnotationInfo, AnnotationUsage, ClassInfo, ClassUsage, ConstructorInfo, ConstructorUsage (+42 more)

### Community 1 - "mcp-code-analyzer.ts"
Cohesion: 0.05
Nodes (34): CallResolver, CallSite, CallTarget, ClassEntry, ImportResolver, ImportResolverOptions, IndexedFileLike, JS_TO_TS (+26 more)

### Community 2 - "test_dart_analyzer.dart"
Cohesion: 0.03
Nodes (59): add, build, BuildContext, capitalized, check, Color, copyWith, count (+51 more)

### Community 3 - "fileEditor.ts"
Cohesion: 0.07
Nodes (50): @modelcontextprotocol/sdk, registerEditTools(), backupFile(), detectEol(), detectIndent(), upsertMarkedBlock(), upsertMcpServer(), writeFileAtomic() (+42 more)

### Community 4 - "PureDartParser"
Cohesion: 0.09
Nodes (27): count_widget_nodes(), measure_widget_tree_depth(), ActiveMethodState, DartAnnotationInfo, DartClass, DartConstructorInfo, DartEnum, DartExtensionInfo (+19 more)

### Community 5 - "bm25.rs"
Cohesion: 0.06
Nodes (16): B, BM25Document, BM25DocumentFields, BM25Engine, IDF_FLOOR, K1, SearchResult, split_identifier_subtokens() (+8 more)

### Community 6 - "ArbEditor"
Cohesion: 0.11
Nodes (13): ArbData, ArbEditor, ArbParseError, FORBIDDEN_KEYS, GENERATED_DART, IcuError, IcuIssue, LoadedArb (+5 more)

### Community 7 - "VmServiceBridge"
Cohesion: 0.12
Nodes (9): ws, getVmServiceBridge(), driverFinders(), isStaleIsolateError(), Pending, VmErrorLog, VmServiceBridge, VmServiceBridgeOptions (+1 more)

### Community 8 - "graph.ts"
Cohesion: 0.10
Nodes (30): d3, applyFilters(), buildGraph(), dragended(), dragged(), dragstarted(), escapeHtml(), filteredEdges (+22 more)

### Community 9 - "main.rs"
Cohesion: 0.10
Nodes (10): collect_widget_subtrees(), ControllerPatterns, JsonRpcRequest, JsonRpcResponse, load_package_config(), memory_leak_patterns(), PackageConfigEntry, vm_service_find_main_isolate() (+2 more)

### Community 10 - "dart_analyzer.dart"
Cohesion: 0.08
Nodes (15): calls, _extractMetadata, FunctionCallVisitor, _isInsideBuildMethod, libPath, lineInfo, main, projectPath (+7 more)

### Community 12 - "watcher.rs"
Cohesion: 0.11
Nodes (5): FileWatchEvent, Modified, Removed, NativeFileWatcher, WatcherHandle

### Community 14 - "main"
Cohesion: 0.17
Nodes (7): atomic_write_file(), classify_arch_layer(), dfs_find_cycles(), discover_vm_service_uri(), extract_icu_placeholders(), main(), McpServerState

### Community 17 - "package.json"
Cohesion: 0.10
Nodes (20): activationEvents, categories, description, displayName, homepage, icon, keywords, main (+12 more)

### Community 18 - "scanner.rs"
Cohesion: 0.24
Nodes (8): CodeScanner, CodeWarning, color_regex(), hardcoded_text_regex(), jsx_hardcoded_color_regex(), QuickSymbol, xml_hardcoded_color_regex(), xml_hardcoded_text_regex()

### Community 19 - "ref_path"
Cohesion: 0.15
Nodes (11): COMMANDS, MESSAGES, MONITORED_PATH_PREFIXES, DiagnosticInfo, ArbEntry, ArbFile, ArbPlaceholder, IcuSegment (+3 more)

### Community 20 - "activate"
Cohesion: 0.19
Nodes (6): activate(), runIndexProgressBuild(), sendWidgetTreeUpdate(), updateStatusBar(), getNonce(), SidebarProvider

### Community 21 - "analysisRunner.ts"
Cohesion: 0.23
Nodes (15): AnalysisOutcome, AnalysisReport, BuildRunnerReport, runBuildRunner(), runProjectAnalysis(), tail(), ALLOWED_COMMANDS, isSafeArg() (+7 more)

### Community 23 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir (+8 more)

### Community 24 - "test-dart-parser-golden.js"
Cohesion: 0.12
Nodes (12): assert, commentResult, { DartParser }, eitherResult, extResult, localFuncResult, parser, providerResult (+4 more)

### Community 26 - "mcp-server.ts"
Cohesion: 0.17
Nodes (12): buildDetailedGraph(), resolveClassMethodOwner(), buildMcpBM25(), getBM25Search(), getDirectoryStructure(), getIndexSignature(), getSqliteCache(), handleIndexError() (+4 more)

### Community 27 - "indexManager.ts"
Cohesion: 0.28
Nodes (6): DependencyNode, TranslationInfo, PackageIndexer, PackageInfo, ProjectDetector, WebviewMessage

### Community 28 - "sidebar.js"
Cohesion: 0.27
Nodes (13): copyToClipboard(), escapeHtml(), getWidgetIcon(), renderAnalysis(), renderAnalysisContent(), renderDependencyGraph(), renderOutlineNodes(), renderPackages() (+5 more)

### Community 29 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, d3, esbuild, @modelcontextprotocol/sdk, @types/d3, @types/node, @types/sqlite3, @types/vscode (+5 more)

### Community 35 - "Widget"
Cohesion: 0.18
Nodes (11): AppBar, Center, Column, ElevatedButton, FloatingActionButton, Icon, MyButton, Scaffold (+3 more)

### Community 36 - "dartAnalyzerWrapper.ts"
Cohesion: 0.22
Nodes (6): analyzeWithDart(), checkDartSdk(), { execSync }, fs, path, ROOT

### Community 37 - "SearchProvider"
Cohesion: 0.33
Nodes (3): SearchResult, SearchProvider, WebviewSearchResult

### Community 38 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, analyze-dart, build, compile, lint, test, typecheck, vscode:prepublish (+1 more)

### Community 39 - "run-tests.js"
Cohesion: 0.25
Nodes (8): esbuild, findTests(), fs, main(), outDir, path, root, { spawnSync }

### Community 40 - "esbuild.js"
Cohesion: 0.29
Nodes (7): esbuild, fs, main(), path, production, watch, esbuild

### Community 41 - "contributes"
Cohesion: 0.25
Nodes (8): contributes, commands, menus, views, viewsContainers, view/title, flutter-explorer, activitybar

### Community 42 - "mcp-direct-search.ts"
Cohesion: 0.32
Nodes (3): DirectSearch, SearchResult, TextSearchResult

### Community 43 - "properties"
Cohesion: 0.29
Nodes (7): properties, title, configuration, default, description, type, flutterExplorer.autoGenerateIntl

### Community 46 - "flutterExplorer.engine"
Cohesion: 0.33
Nodes (6): default, description, enum, enumDescriptions, type, flutterExplorer.engine

### Community 47 - "flutterExplorer.mcpServerMode"
Cohesion: 0.33
Nodes (6): default, description, enum, enumDescriptions, type, flutterExplorer.mcpServerMode

### Community 49 - "packageResolver.ts"
Cohesion: 0.40
Nodes (3): PackageConfigEntry, PackageSearchResult, PubDevPackageSummary

### Community 50 - "widgetTreeProvider.ts"
Cohesion: 0.40
Nodes (4): OutlineSymbolNode, SerializedWidget, WebviewTreeData, WidgetTreeNode

### Community 51 - "_CounterPageState"
Cohesion: 0.40
Nodes (5): CounterPage, _CounterPageState, Loggable, State, StatefulWidget

### Community 52 - "flutter-explorer-mcp"
Cohesion: 0.50
Nodes (3): flutter-explorer-mcp, FLUTTER_PROJECT_PATH, node

### Community 53 - "flutterExplorer.autoIndex"
Cohesion: 0.50
Nodes (4): default, description, type, flutterExplorer.autoIndex

### Community 54 - "flutterExplorer.debounceMs"
Cohesion: 0.50
Nodes (4): default, description, type, flutterExplorer.debounceMs

### Community 55 - "flutterExplorer.enableJsonIndex"
Cohesion: 0.50
Nodes (4): default, description, type, flutterExplorer.enableJsonIndex

### Community 56 - "flutterExplorer.enableReverseDependencies"
Cohesion: 0.50
Nodes (4): default, description, type, flutterExplorer.enableReverseDependencies

### Community 57 - "flutterExplorer.indexingConcurrency"
Cohesion: 0.50
Nodes (4): default, description, type, flutterExplorer.indexingConcurrency

### Community 58 - "flutterExplorer.useDartAnalyzer"
Cohesion: 0.50
Nodes (4): default, description, type, flutterExplorer.useDartAnalyzer

### Community 59 - "flutterExplorer.watchAndroidApp"
Cohesion: 0.50
Nodes (4): default, description, type, flutterExplorer.watchAndroidApp

### Community 60 - "dependencyGraphProvider.ts"
Cohesion: 0.50
Nodes (3): GraphData, GraphEdge, GraphNode

### Community 61 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 64 - "UserRepository"
Cohesion: 0.67
Nodes (3): Repository, UserModel, UserRepository

## Knowledge Gaps
- **83 isolated node(s):** `calls`, `_extractMetadata`, `_isInsideBuildMethod`, `libPath`, `lineInfo` (+78 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 414 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `IndexManager` connect `IndexManager` to `dartParser.ts`, `FileWatcher`, `PubspecProvider`, `SearchProvider`, `IntlGenerator`, `.getInstance`, `SqliteCache`, `GraphWebviewPanel`, `DartParser`, `widgetTreeProvider.ts`, `ref_path`, `activate`, `indexManager.ts`, `dependencyGraphProvider.ts`, `.buildFullIndex`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Are the 25 inferred relationships involving `activate()` (e.g. with `.setDebounceMs()` and `.start()`) actually correct?**
  _`activate()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **What connects `calls`, `_extractMetadata`, `_isInsideBuildMethod` to the rest of the system?**
  _83 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dartParser.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05444596443228454 - nodes in this community are weakly interconnected._
- **Why does `VmServiceBridge` connect `VmServiceBridge` to `mcp-server.ts`, `ref_path`, `activate`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Should `mcp-code-analyzer.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.051643192488262914 - nodes in this community are weakly interconnected._
- **Why does `d3` connect `graph.ts` to `package.json`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._