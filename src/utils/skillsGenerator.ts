import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface SkillDef {
    name: string;
    description: string;
    body: string;
}

const SKILLS: Record<string, SkillDef> = {
    'mcp': {
        name: 'flutter-explorer-mcp',
        description: "How to use the flutter-explorer-mcp MCP server's 50+ tools to explore, search, analyze, and safely modify Flutter/Dart projects (also JS/TS and Android modules in the same repo) instead of guessing from memory, grepping by hand, or reading whole files. ALWAYS consult this skill whenever flutter-explorer-mcp tools are connected and the task involves finding a class, function, widget, enum, mixin, or extension; reading or explaining Dart code; figuring out what a change would break (impact/blast-radius); hunting mockup/placeholder/TODO/hardcoded-string-or-color code; checking Clean Architecture layer violations or circular dependencies; undisposed controllers or memory leaks; ARB translation gaps; running flutter analyze or build_runner; or driving a live running Flutter app (hot reload/restart, runtime errors, widget inspection, simulated taps) via the VM service. Prefer these tools over raw bash/grep/view on Dart files whenever the project is indexed.",
        body: `# Flutter Explorer MCP

\`flutter-explorer-mcp\` is a VS Code extension + MCP server that keeps a SQLite-backed
index (BM25 search, Flutter-aware camelCase tokenization) of a Dart/Flutter project
(and, for mixed repos, JS/TS and Android/Gradle files too). It exposes ~50 tools for
searching, reading, analyzing, refactoring-safety-checking, localizing, and
live-debugging the project — almost always faster and more precise than reading
whole files or shelling out to \`grep\`.

**Use these tools instead of:** \`bash grep\`/\`find\` on the repo, opening whole files
with \`view\` just to locate one function, manually re-deriving what a symbol is used
by, or guessing whether \`flutter analyze\` currently passes.

## 0. Before anything else: is the project set and indexed?

1. Call \`flutter_get_project_path\` (or just try a tool — errors will say if the path
   is wrong). If the wrong project is active, call \`flutter_set_project_path\` with
   the **absolute** path to the project root (must contain \`pubspec.yaml\`,
   \`package.json\`, a Gradle file, or \`.git\`). This is persisted across restarts, so
   you usually only need to do this once per conversation/project switch.
2. Call \`flutter_get_index_status\` to confirm the index is populated (\`indexedFiles\`
   count, \`source\`: SQLite vs JSON fallback vs empty). If it's empty or stale after
   you or the user just created/renamed files, call \`flutter_rebuild_index\` — this
   only *triggers* the VS Code extension to reindex; it isn't instant, so re-check
   \`flutter_get_index_status\` a moment later rather than assuming it's done.
3. If a tool returns an "Index not found" style error, that error already contains
   the specific diagnosis (missing DB file vs 0 indexed files vs access error) —
   act on it directly rather than re-asking the user what's wrong.
4. Most read tools silently fall back to a slower direct filesystem search
   (\`flutter_search\` with \`useDirectSearch\`, or the direct-search path when the
   index is missing) so they still work with no index — just expect it to be
   slower and less precise. Don't treat a working-but-slow tool call as broken.

## 1. Core exploration loop

For "find/explain/understand X":
\`flutter_search\` (or \`flutter_search_text\` for arbitrary strings/comments) →
\`flutter_get_code_block\` or \`flutter_read_fragment\` (full body with comments) →
\`flutter_analyze_logic_flow\` (summarized steps) or \`flutter_get_dependencies\`
(constructor-injected collaborators).

For "what happens if I change/delete X" (**always run before editing shared code**):
\`flutter_get_impact_analysis\` (blast radius to entry points), \`flutter_find_references\`
/ \`flutter_get_reverse_deps\` (who calls/uses it now). Skipping this step on a widely-used
symbol is the most common way this skill gets misused.

Useful shortcuts:
- \`flutter_get_node_at_cursor\` — "what's defined at file:line" instead of reading the
  whole file to figure out context.
- \`flutter_read_lines\` — precise line-range reads (cheap, avoids token bloat) for
  inspecting around an error instead of \`flutter_get_file_info\`'s full JSON dump.
- \`flutter_get_hints\` — pass the last tool you called and its result to get a
  suggested next tool; useful when you're not sure what to do after a search hit.
- Parameter names are forgiving: most file-path tools accept \`filePath\`,
  \`relativePath\`, or \`path\` interchangeably, and \`flutter_search\`'s \`filter\` accepts
  shorthand aliases (\`ext\`→extension, \`type\`→typedef, \`vars\`→variable, \`call\`→function).

## 2. Before calling a task "done": quality sweeps

Mohamed's own standard is complete, non-placeholder implementations — these tools
check that mechanically instead of relying on a manual re-read:

- \`flutter_detect_mockups\` — finds empty callbacks, hardcoded/fake mock data, stub
  widgets, unbound inputs, fake delays, and leftover TODO comments. Run this on any
  file or feature before considering it finished.
- \`flutter_get_code_warnings\` — hardcoded text/colors (should be going through
  intl/theme instead) and duplicated logic.
- \`flutter_detect_memory_leaks\` — undisposed \`TextEditingController\`,
  \`AnimationController\`, \`ScrollController\`, \`StreamSubscription\`, \`FocusNode\`, etc.
  in \`State\` classes.
- \`flutter_run_analyze\` — runs the right linter/compiler for the detected project
  type (Flutter/TS/Android) and returns structured diagnostics; check this instead
  of assuming code compiles.

\`flutter_analyze_logic_flow\` and \`flutter_get_dependencies\` are keyword/regex
heuristics, not real control-flow or type analysis — treat their output as a
starting-point summary to verify against \`flutter_get_code_block\`'s actual body,
not as ground truth. Likewise \`flutter_detect_memory_leaks\` only flags a class as
"safe" if it finds a literal \`field.dispose()/.cancel()/.close()\` call in the same
file's text — disposal routed through a helper method or a mixin won't be
recognized, so a clean report there isn't a guarantee.

## 3. Architecture & structure checks (Clean Architecture stacks)

- \`flutter_get_architectural_layers\` — classifies files into
  Presentation/Domain/Data/Core and reports Lakos coupling metrics (Ca/Ce/Instability).
- \`flutter_validate_architecture_rules\` — flags layer-boundary violations (e.g.
  Domain depending on Data/UI); pass \`customRules\` if the project's rules differ
  from the standard Clean Architecture defaults.
- \`flutter_detect_circular_dependencies\` — A→B→C→A cycles across files.
- \`flutter_analyze_widget_depth\` / \`flutter_detect_duplicate_widgets\` — excessive
  widget nesting and copy-pasted widget subtrees worth extracting.
- \`flutter_detect_unused_assets\` — assets declared in \`pubspec.yaml\` but never
  referenced.
- \`flutter_get_git_blast_radius\` — impact analysis scoped to the current git diff,
  useful right before a commit/PR (empty result if the project isn't a git repo, or
  has no HEAD yet).

Layer classification and boundary rules match on path *substrings* (e.g. a file
containing \`/data/\` anywhere in its path counts as Data layer), not a real module
system — a file like \`lib/core/data_formatter.dart\` can be misclassified. Treat a
reported violation as "worth a look", and double-check the actual import before
treating it as confirmed. \`flutter_get_impact_analysis\` / \`flutter_get_git_blast_radius\`
have the same caveat one level up: they only reach an "entry point" as heuristically
defined (top-level \`main\`/\`render\`, or a method named \`build\`/\`initState\`/\`dispose\`/
\`on*\`/etc. on a class whose hierarchy mentions Widget/State/Activity/Component/...).
Code that's only reached through, say, a background isolate or a testing harness
may legitimately show "no affected flows" even though it's very much in use.

## 4. Localization (ARB) workflow

\`flutter_get_missing_translations\` / \`flutter_list_translations\` (audit) →
\`flutter_auto_translate_missing\` with \`action: "generate_payload"\` (get the keys
needing translation) → translate → \`flutter_auto_translate_missing\` with
\`action: "batch_apply"\`, or \`flutter_update_translation\` for a single key →
\`flutter_run_intl_generate\` (regenerate \`l10n.dart\`/\`messages_*.dart\`) →
\`flutter_validate_icu_translations\` (ICU syntax/placeholder/plural consistency) and
\`flutter_find_unused_translations\` (dead keys) as a final sweep. \`flutter_delete_translation\`
removes a key from every ARB file at once.

## 5. Codegen & build

- \`flutter_run_build_runner\` — \`dart run build_runner build --delete-conflicting-outputs\`,
  needed after editing anything annotated for Freezed/Riverpod/json_serializable
  codegen. Only one instance runs at a time; if it's already running you'll get told
  to wait rather than getting silently queued.

## 6. Live app debugging (requires a running Flutter app, VM service)

\`flutter_get_runtime_errors\` (uncaught exceptions/stderr) and
\`flutter_inspect_live_widgets\` (live widget/render tree) for diagnosis;
\`flutter_hot_reload\` / \`flutter_hot_restart\` to apply a fix; \`flutter_simulate_ui_action\`
(tap/enterText/scroll by key or text) to drive the UI. All accept an optional
\`vmServiceUri\` — omit it to let the bridge auto-discover the running instance.

Caveats worth knowing before you rely on these:
- Auto-discovery only checks the \`DART_VM_SERVICE_URI\` env var and a few files under
  \`.dart_tool/\` (\`dart_tooling_daemon.json\`, \`flutter_service.json\`,
  \`vm_service_uri.txt\`). If the app was launched in a way that doesn't populate one
  of those, discovery fails and you must pass \`vmServiceUri\` explicitly (copy it
  from the \`flutter run\` console output).
- \`flutter_get_runtime_errors\` only returns errors that occurred **after** this
  bridge connected — a rolling buffer of the last 50, not app history. A fresh
  connection reporting "0 errors" doesn't mean the app never crashed.
- \`flutter_simulate_ui_action\` tries the Flutter Driver extension first; most apps
  outside a driver/integration-test harness don't expose it, so it silently falls
  back to an inspector "select by id" call — which is not a real tap/text-entry/scroll.
  A "success" response doesn't guarantee the UI actually reacted; verify with
  \`flutter_inspect_live_widgets\` or \`flutter_get_runtime_errors\` afterward.

## 7. Third-party package research

\`flutter_search_packages\` (regex/text search inside cached pub packages or the
Flutter SDK) and \`flutter_read_package_source\` (read a package/SDK file by
\`package:\` URI, e.g. \`package:flutter/material.dart\`) — use these instead of
guessing a package's API from training data, since versions drift.
\`flutter_pub_dev_search\` and \`flutter_get_pub_package_info\` hit pub.dev live for
discovering/vetting packages before adding a dependency (pub points, popularity,
likes).

Both \`flutter_search_packages\` and \`flutter_read_package_source\` resolve packages
via \`.dart_tool/package_config.json\` — if \`dart pub get\` / \`flutter pub get\` hasn't
been run yet, that file won't exist and both tools will report the package as not
found rather than something being wrong with the tool.

## Known quirks

- The SQLite cache uses \`node-sqlite3-wasm\`; WAL journal mode is unreliable with the
  WASM VFS, so the extension uses \`DELETE\` journal mode. If the index looks stale or
  locked, that's the usual cause — a rebuild (\`flutter_rebuild_index\`) fixes it, not
  a manual DB edit.
- The active project path persists to \`~/.gemini/active-project.txt\` regardless of
  which client is using this server — this is expected, not a bug.
- Search results are BM25-ranked but only when there are index hits; if \`flutter_search\`
  falls back to direct search (no index, or \`useDirectSearch: true\`), ranking is
  simpler substring matching, and results are capped at 50 (100 for \`flutter_search_text\`).
- The direct-search fallback scans \`lib/\`, \`android/app/src/main/\`, \`src/\`, \`app/\`,
  plus top-level \`App.tsx\`/\`index.*\`/\`main.*\` files — and, unlike the ARB/asset
  scanners, does **not** skip \`node_modules\`/\`build\`/\`.git\`. If one of those scan
  roots contains a vendored dependency tree, expect noisier/slower direct-search
  results until the real index is available again.
- ARB tooling (\`flutter_get_missing_translations\`, \`flutter_update_translation\`,
  etc.) only looks for \`.arb\` files under \`lib/\`, \`assets/\`, and the project root.
  Locale is read from the file's \`@@locale\` key first, falling back to a pattern
  match on the filename (e.g. \`app_ar.arb\` → \`ar\`) — an unconventionally-named ARB
  file with no \`@@locale\` key may be misidentified.
- \`flutter_find_unused_translations\` and \`flutter_detect_unused_assets\` both work
  by substring/whole-word matching against merged source text, so a key/asset only
  referenced through string concatenation or a generated indirection can show up as
  a false positive "unused".

---
# flutter-explorer-mcp — full tool reference

All ~52 tools, grouped by purpose. Consult this when the SKILL.md workflows don't
already point you at the right tool. Parameter names shown are the primary ones;
most file-path parameters also accept \`filePath\`/\`relativePath\`/\`path\` aliases.

## Project setup & index status
| Tool | Purpose |
|---|---|
| \`flutter_set_project_path\` | Set active project root (must contain pubspec.yaml / package.json / build.gradle(.kts) / .git). Persists to \`~/.gemini/active-project.txt\`. |
| \`flutter_get_project_path\` | Read the currently active project root. |
| \`flutter_get_index_status\` | Index source (SQLite/JSON/empty), file count, DB path & size. |
| \`flutter_rebuild_index\` | Trigger a full re-index via the VS Code extension (async — poll status after). |
| \`flutter_get_stats\` | Summary counts: files, classes, functions, methods, widgets, enums, mixins, extensions, typedefs, variables, constructors, properties, annotations, translations. |
| \`flutter_get_project_structure\` | Directory tree (defaults to \`lib/\`, \`src/\`, or \`app/src/main\`). |
| \`flutter_get_pubspec\` | Contents of pubspec.yaml / package.json / build.gradle(.kts), whichever applies. |
| \`flutter_list_packages\` | Dependencies from pubspec.lock; filter by \`direct\`/\`dev\`/\`transitive\` and \`hosted\`/\`git\`/\`path\`. |

## Search & discovery
| Tool | Purpose |
|---|---|
| \`flutter_search\` | Search classes/functions/widgets/enums/mixins/extensions/typedefs/variables/constructors/properties/annotations/files/calls/translations by name. \`searchMode\`: definitions/calls/both. BM25-ranked when index available. |
| \`flutter_search_text\` | Regex/plain-text search across file contents (comments, strings) — for things \`flutter_search\` doesn't model as a symbol. |
| \`flutter_find_references\` | All usages of a class/function/variable/enum/mixin/extension/typedef, index-based plus regex-verified. |
| \`flutter_get_reverse_deps\` | What depends on a given element (needs \`type\`; \`parentClass\` for members). |
| \`flutter_get_node_at_cursor\` | Resolve the Dart element at a specific \`relativePath\` + \`line\`. |

## Reading code
| Tool | Purpose |
|---|---|
| \`flutter_get_code_block\` | Full body + comments of a class/function/method/enum/mixin/extension. Auto-searches all files if \`filePath\` omitted. |
| \`flutter_read_fragment\` | Like above but auto-detects element type, with optional surrounding context lines. |
| \`flutter_read_lines\` | Raw line-range read of any file (\`startLine\`/\`endLine\`/\`maxLines\`, capped at 800). Cheapest way to inspect around an error. |
| \`flutter_get_file_info\` | Full parsed JSON for one file (classes, functions, imports, etc.) from the index. |

## Impact / dependency analysis
| Tool | Purpose |
|---|---|
| \`flutter_get_impact_analysis\` | Blast radius forward to app entry points (main/build/events) from a given file. |
| \`flutter_get_dependencies\` | Constructor-injected dependencies of a class (repositories/services/etc.) plus matching imports. |
| \`flutter_analyze_logic_flow\` | Summarized logical steps inside a function/method body. |
| \`flutter_get_detailed_graph\` | Full/partial (via \`focusFile\` + \`depth\`) relationship graph: imports, inheritance, calls, contains. |
| \`flutter_get_git_blast_radius\` | Impact analysis scoped to the current uncommitted git diff. |

## Code quality & architecture
| Tool | Purpose |
|---|---|
| \`flutter_get_code_warnings\` | Hardcoded text/colors, duplicated logic (filterable by type/search/file). |
| \`flutter_detect_mockups\` | Empty callbacks, fake/mock data, stub widgets, unbound inputs, fake delays, TODO comments. Category filter: callback/data/widget/input/async/comment. |
| \`flutter_detect_memory_leaks\` | Undisposed controllers/subscriptions/focus nodes in State classes. |
| \`flutter_detect_circular_dependencies\` | A→B→C→A file-level cycles. |
| \`flutter_validate_architecture_rules\` | Layer-boundary violations; accepts \`customRules\` to override Clean Architecture defaults. |
| \`flutter_get_architectural_layers\` | Classifies files into Presentation/Domain/Data/Core + Lakos Ca/Ce/Instability metrics. |
| \`flutter_analyze_widget_depth\` | Excessive widget nesting vs \`maxDepthThreshold\` (default 5). |
| \`flutter_detect_duplicate_widgets\` | Near-identical widget subtrees, with extraction proposals (\`minNodeCount\` default 3). |
| \`flutter_detect_unused_assets\` | Declared-but-unreferenced assets from pubspec.yaml asset dirs. |
| \`flutter_get_diagnostics\` | VS Code diagnostics from the index, filterable by file/severity. |
| \`flutter_run_analyze\` | Actually runs \`flutter analyze\` / \`tsc --noEmit\` / gradle lint (auto-detected), returns structured + raw output. One run at a time. |

## Codegen
| Tool | Purpose |
|---|---|
| \`flutter_run_build_runner\` | \`dart run build_runner build --delete-conflicting-outputs\` (Freezed/Riverpod/json_serializable). One run at a time. |

## Localization (ARB / intl)
| Tool | Purpose |
|---|---|
| \`flutter_get_missing_translations\` / \`flutter_list_translations\` | Audit keys across locales. |
| \`flutter_update_translation\` | Add/update one key; accepts \`arValue\`/\`enValue\` or a dynamic \`translations\` map for any locale set. |
| \`flutter_delete_translation\` | Remove a key from all ARB files. |
| \`flutter_find_unused_translations\` | Keys defined in ARB but never referenced in \`lib/\`. |
| \`flutter_validate_icu_translations\` | ICU syntax, \`{placeholder}\` consistency, plural balance across files. |
| \`flutter_auto_translate_missing\` | \`action: generate_payload\` to get missing-key payload, or \`batch_apply\` to write a batch of translations at once. |
| \`flutter_run_intl_generate\` | Regenerate \`l10n.dart\`/\`messages_*.dart\` from ARB (only if Flutter Intl is enabled). |

## Live runtime (Dart VM service — app must be running)
| Tool | Purpose |
|---|---|
| \`flutter_hot_reload\` / \`flutter_hot_restart\` | Apply code changes to the running app. |
| \`flutter_get_runtime_errors\` | Uncaught exceptions / stderr from the live app. |
| \`flutter_inspect_live_widgets\` | Live widget/render-object tree. |
| \`flutter_simulate_ui_action\` | \`tap\`/\`enterText\`/\`scroll\` a widget by key/text identifier. |

All five accept optional \`vmServiceUri\`; omit it for auto-discovery.

## Third-party packages & SDK
| Tool | Purpose |
|---|---|
| \`flutter_search_packages\` | Regex/text search inside cached pub packages or the Flutter SDK. |
| \`flutter_read_package_source\` | Read source by \`package:\` URI (e.g. \`package:dio/dio.dart\`) with line offset/count. |
| \`flutter_pub_dev_search\` | Live pub.dev search (paginated). |
| \`flutter_get_pub_package_info\` | pub points, popularity, likes, description, repo for one package. |

## Misc
| Tool | Purpose |
|---|---|
| \`flutter_get_hints\` | Suggests likely next tool given the last tool used and its result. |`
    },
    'explore-flutter-project': {
        name: 'Explore Flutter Project',
        description: 'Navigate and understand Flutter codebase structure, Clean Architecture layers, Lakos coupling metrics, widget trees, and external dependencies',
        body: `# Explore Flutter Project

Deeply understand the architecture, layer boundaries, dependencies, and UI structure of any Flutter or Dart project.

## Workflow

### 1. High-Level Metrics & Architecture
1. **Overview Metrics**: Call \`flutter_get_stats\` to inspect counts of files, classes, methods, widgets, enums, mixins, extensions, and variables.
2. **Architecture & Coupling**: Run \`flutter_get_architectural_layers\` to classify files into \`Presentation\`, \`Domain\`, \`Data\`, and \`Core\` layers, compute Lakos Ca/Ce metrics, and evaluate package instability.
3. **Layer Boundary Violations**: Run \`flutter_validate_architecture_rules\` to ensure domain isolation from data/presentation.
4. **Circular Dependencies**: Run \`flutter_detect_circular_dependencies\` to catch circular import loops (A → B → C → A).

### 2. UI & Widget Architecture
1. **Widget Nesting Depth**: Call \`flutter_analyze_widget_depth\` to audit deeply nested widget trees (> 5 levels) and get extraction suggestions.
2. **Duplicate Widgets**: Call \`flutter_detect_duplicate_widgets\` to find structural duplicates and propose reusable components.
3. **Directory Structure**: Call \`flutter_get_project_structure\` to inspect project organization (\`lib/\`, \`android/\`, \`src/\`).

### 3. Detailed Component & Dependency Exploration
1. **Visual Graph**: Call \`flutter_get_detailed_graph\` with \`focusFile\` and \`depth: 2\` to trace imports, calls, and inheritance.
2. **Symbol Search**: Use \`flutter_search\` with filters (\`class\`, \`function\`, \`widget\`, \`enum\`, \`mixin\`) for targeted lookups.
3. **External Packages**: Use \`flutter_search_packages\` and \`flutter_read_package_source\` to read implementation details directly from \`.pub-cache\` or the Flutter SDK.`
    },
    'debug-flutter-issue': {
        name: 'Debug Flutter Issue',
        description: 'Systematically debug Flutter issues using diagnostics, compiler checks, live VM runtime errors, memory leak detection, widget inspection, and UI simulation',
        body: `# Debug Flutter Issue

Systematically trace, diagnose, and fix Flutter and Dart issues using \`flutter-explorer-mcp\` tools across static analysis and live VM runtime.

## Workflow

### 1. Static Analysis & Diagnostics
1. **VS Code Diagnostics**: Call \`flutter_get_diagnostics\` to inspect all active compiler errors, warnings, and hints.
2. **Fresh Compiler Pass**: Run \`flutter_run_analyze\` for a real-time \`flutter analyze\` / \`tsc --noEmit\` check.
3. **Memory Leaks**: Run \`flutter_detect_memory_leaks\` to find undisposed \`TextEditingController\`, \`AnimationController\`, \`ScrollController\`, \`StreamSubscription\`, and \`FocusNode\` instances in \`State\` classes.
4. **Mockups & Incomplete Logic**: Run \`flutter_detect_mockups\` to catch no-op callbacks (\`onPressed: () {}\`), stub widgets (\`Placeholder\`), and fake async delays.

### 2. Live Runtime Debugging (VM Service)
1. **Uncaught Crashes**: Call \`flutter_get_runtime_errors\` to view live uncaught exceptions and stack traces directly from the running app.
2. **Inspect Widget Hierarchy**: Call \`flutter_inspect_live_widgets\` to inspect live widget properties, layout boundaries, and state objects.
3. **Reproduce Issues**: Call \`flutter_simulate_ui_action\` with \`action: "tap"\` | \`"enterText"\` | \`"scroll"\` to drive the live UI and trigger edge cases.
4. **Apply Fixes**: Use \`flutter_hot_reload\` (or \`flutter_hot_restart\` for structural/state changes) to immediately verify fixes without restarting the app.

### 3. Deep Code Investigation
1. **Logic Analysis**: Run \`flutter_analyze_logic_flow\` to summarize branch conditions and state mutations inside complex methods.
2. **Read Code Blocks**: Use \`flutter_get_code_block\` or \`flutter_read_fragment\` to inspect the exact implementation with comments.
3. **Inspect Line Range**: Use \`flutter_read_lines\` to inspect surrounding context around stack trace line numbers without token waste.`
    },
    'impact-analysis': {
        name: 'Impact Analysis',
        description: 'Analyze the blast radius of changes, uncommitted git diff impact, reverse dependencies, and architectural regressions in Flutter apps',
        body: `# Impact Analysis

Safely refactor Flutter/Dart code by determining the exact blast radius to UI entry points, callers, and architectural boundaries before committing changes.

## Workflow

### 1. Pre-Change Blast Radius
1. **Forward Impact**: Before editing a shared file, call \`flutter_get_impact_analysis\` with \`filePath\` to trace all UI entry points (main, widgets, events) that depend on this file.
2. **Reverse Dependencies**: Call \`flutter_get_reverse_deps\` for specific classes or methods to identify direct callers.
3. **Exact Usages**: Call \`flutter_find_references\` to locate exact line numbers and code snippets across the codebase where a symbol is referenced.

### 2. Post-Change Git Blast Radius
1. **Uncommitted Git Diff Impact**: Call \`flutter_get_git_blast_radius\` right before committing to audit all uncommitted changes across the git staging tree and verify which app flows are affected.
2. **Layer Regressions**: Run \`flutter_validate_architecture_rules\` to ensure changes didn't violate Clean Architecture layers (e.g., Domain importing Presentation).
3. **Cycle Check**: Run \`flutter_detect_circular_dependencies\` to ensure no circular dependency loops were created.`
    },
    'localization-management': {
        name: 'Localization Management',
        description: 'Manage ARB translations, batch auto-translation, ICU syntax validation, unused key cleanup, and intl code generation in Flutter',
        body: `# Localization Management

Efficiently audit, translate, validate, and generate code for Flutter localization (ARB files).

## Workflow

### 1. Audit & Gap Detection
1. **Find Missing Keys**: Call \`flutter_get_missing_translations\` or \`flutter_list_translations\` to identify untranslated keys across locales.
2. **Batch Payload Generation**: Call \`flutter_auto_translate_missing\` with \`action: "generate_payload"\` to extract all missing keys formatted for translation.

### 2. Updating & Batch Translation
1. **Batch Apply**: Call \`flutter_auto_translate_missing\` with \`action: "batch_apply"\` and \`translations\` map to write translated keys across all ARB files simultaneously.
2. **Single Key Update**: Use \`flutter_update_translation\` to add/modify an individual key with \`arValue\`, \`enValue\`, or custom locale maps.
3. **Delete Obsolete Keys**: Use \`flutter_delete_translation\` to remove deprecated keys from all ARB files at once.

### 3. Validation & Code Generation
1. **Validate ICU Formats**: Run \`flutter_validate_icu_translations\` to verify ICU plural syntax (\`zero\`, \`one\`, \`other\`), variable placeholders (\`{name}\`), and curly brace balancing across all languages.
2. **Detect Dead Keys**: Run \`flutter_find_unused_translations\` to flag keys declared in ARB but never referenced in \`lib/\`.
3. **Regenerate Code**: Run \`flutter_run_intl_generate\` to generate fresh \`l10n.dart\` and \`messages_*.dart\` files.`
    },
    'project-dependencies-management': {
        name: 'Project Dependencies Management',
        description: 'Manage pubspec dependencies, live pub.dev research, cached package source inspection, asset cleanup, and code generation in Flutter',
        body: `# Project Dependencies Management

Analyze, research, manage, and audit external packages, cached SDK sources, declared assets, and code generation in Flutter projects.

## Workflow

### 1. Research & Vetting Packages
1. **Explore pub.dev**: Call \`flutter_pub_dev_search\` to find high-quality packages matching your use case.
2. **Package Health & Metrics**: Call \`flutter_get_pub_package_info\` with \`packageName\` to inspect pub points, popularity score, likes, repository URL, and license before adding a dependency.

### 2. Inspecting Installed & Cached Dependencies
1. **List Resolved Dependencies**: Call \`flutter_list_packages\` (with optional \`dependencyType: "direct" | "dev" | "transitive"\`) to inspect versions locked in \`pubspec.lock\`.
2. **Search Inside Package Sources**: Call \`flutter_search_packages\` to grep for classes, functions, or patterns directly inside \`.pub-cache\` and the official Flutter SDK.
3. **Read Package Implementation**: Call \`flutter_read_package_source\` with a \`package:\` URI (e.g. \`package:flutter/material.dart\`) to inspect official library source code without guessing.

### 3. Pubspec & Asset Auditing
1. **Pubspec Inspection**: Call \`flutter_get_pubspec\` to review dependencies, environment SDK constraints, and assets.
2. **Unused Asset Cleanup**: Call \`flutter_detect_unused_assets\` to detect images, fonts, or assets declared in \`pubspec.yaml\` that are never referenced in Dart code.
3. **Run Code Generation**: Call \`flutter_run_build_runner\` to run \`dart run build_runner build --delete-conflicting-outputs\` after editing Freezed, Riverpod, or json_serializable models.`
    },
    'advanced-code-search': {
        name: 'Advanced Code Search',
        description: 'Deep dive into the codebase using BM25 ranked symbol search, full-text regex, index-backed references, code fragments, and external package search',
        body: `# Advanced Code Search

Perform ultra-precise, token-efficient searches across Flutter, Dart, TypeScript, and Android source code without reading entire files.

## Workflow

### 1. Symbol Search & Full-Text Search
1. **BM25 Symbol Search**: Call \`flutter_search\` with \`query\` and optional \`filter\` (\`class\`, \`function\`, \`widget\`, \`enum\`, \`mixin\`, \`extension\`, \`typedef\`, \`variable\`, \`constructor\`, \`property\`, \`annotation\`, \`call\`, \`translation\`).
   - Use \`searchMode: "definitions"\` (default), \`"calls"\` (find call-sites), or \`"both"\`.
2. **Regex & Content Search**: Call \`flutter_search_text\` for raw regex patterns, string literals, API endpoints, or comment tags across the repository.
3. **Resolve Node at Line**: Call \`flutter_get_node_at_cursor\` with \`filePath\` and \`line\` to instantly identify the symbol at a cursor position.

### 2. Reading Targeted Code
1. **Full Body with Comments**: Call \`flutter_get_code_block\` or \`flutter_read_fragment\` to retrieve only the relevant class, function, or method implementation without loading the full file into context.
2. **Precise Line Slicing**: Call \`flutter_read_lines\` (\`startLine\`, \`endLine\`) to inspect error zones cheaply without token bloat.

### 3. Usages & Package Code
1. **Symbol Usages**: Call \`flutter_find_references\` to retrieve all verified usages, line numbers, and context snippets across importing files.
2. **External Packages**: Call \`flutter_search_packages\` to grep for classes or methods directly inside cached pub dependencies or Flutter framework internals.`
    }
};

export async function generateSkills(workspaceRoot: string, options?: { writeWorkspace?: boolean }): Promise<void> {
    try {
        const homedir = os.homedir();
        const writeWorkspace = options?.writeWorkspace ?? false;

        // Antigravity Global Config (~/.gemini/config/skills/)
        const antigravitySkillsDir = path.join(homedir, '.gemini', 'config', 'skills');
        ensureDir(antigravitySkillsDir);

        let genericSkillsDir = '';
        let cursorRulesDir = '';
        let clineDocsDir = '';

        if (writeWorkspace) {
            genericSkillsDir = path.join(workspaceRoot, 'skills');
            ensureDir(genericSkillsDir);
            cursorRulesDir = path.join(workspaceRoot, '.cursor', 'rules');
            ensureDir(cursorRulesDir);
            clineDocsDir = path.join(workspaceRoot, 'cline_docs');
            ensureDir(clineDocsDir);
        }

        for (const [id, skill] of Object.entries(SKILLS)) {
            // Generate standard frontmatter + body
            const standardContent = [
                '---',
                `name: ${skill.name}`,
                `description: "${skill.description.replace(/"/g, '\\"')}"`,
                '---',
                '',
                skill.body
            ].join('\n');

            if (writeWorkspace) {
                // --- A. Generate for Generic/Workspace (Standard Markdown) ---
                const genericSkillSubdir = path.join(genericSkillsDir, id);
                ensureDir(genericSkillSubdir);
                const genericSkillFile = path.join(genericSkillSubdir, 'SKILL.md');
                try {
                    fs.writeFileSync(genericSkillFile, standardContent, 'utf8');
                } catch (e) {
                    console.error(`[Skills] Failed to write generic skill ${id}:`, e);
                }

                // --- B. Generate for Cursor (.mdc format) ---
                const cursorContent = [
                    '---',
                    `description: "${skill.description.replace(/"/g, '\\"')}"`,
                    'globs: *.dart, *.kt, *.java, *.ts, *.tsx, *.js, *.jsx',
                    '---',
                    '',
                    `# ${skill.name}`,
                    '',
                    skill.body
                ].join('\n');
                try {
                    fs.writeFileSync(path.join(cursorRulesDir, `${id}.mdc`), cursorContent, 'utf8');
                } catch (e) {
                    console.error(`[Skills] Failed to write cursor skill ${id}:`, e);
                }

                // --- C. Generate for Claude/Roo (cline_docs folder) ---
                const clineContent = [
                    `# ${skill.name}`,
                    '',
                    `*Description: ${skill.description}*`,
                    '',
                    skill.body
                ].join('\n');
                try {
                    fs.writeFileSync(path.join(clineDocsDir, `${id}.md`), clineContent, 'utf8');
                } catch (e) {
                    console.error(`[Skills] Failed to write cline skill ${id}:`, e);
                }
            }

            // --- D. Generate for Antigravity (Global SKILL.md) ---
            const agSkillSubdir = path.join(antigravitySkillsDir, id === 'mcp' ? 'flutter-explorer-mcp' : `flutter-explorer-${id}`);
            ensureDir(agSkillSubdir);
            try {
                fs.writeFileSync(path.join(agSkillSubdir, 'SKILL.md'), standardContent, 'utf8');
            } catch (e) {
                console.error(`[Skills] Failed to write antigravity skill ${id}:`, e);
            }
        }

        console.log('AI Skills distributed successfully to Gemini, Cursor, and Roo/Claude!');
    } catch (error) {
        console.error('Error generating AI skills:', error);
    }
}

function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
