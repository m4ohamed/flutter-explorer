---
name: Explore Flutter Project
description: "Navigate and understand Flutter codebase structure, Clean Architecture layers, Lakos coupling metrics, widget trees, and external dependencies"
---

# Explore Flutter Project

Deeply understand the architecture, layer boundaries, dependencies, and UI structure of any Flutter or Dart project.

## Workflow

### 1. High-Level Metrics & Architecture
1. **Overview Metrics**: Call `flutter_get_stats` to inspect counts of files, classes, methods, widgets, enums, mixins, extensions, and variables.
2. **Architecture & Coupling**: Run `flutter_get_architectural_layers` to classify files into `Presentation`, `Domain`, `Data`, and `Core` layers, compute Lakos Ca/Ce metrics, and evaluate package instability.
3. **Layer Boundary Violations**: Run `flutter_validate_architecture_rules` to ensure domain isolation from data/presentation.
4. **Circular Dependencies**: Run `flutter_detect_circular_dependencies` to catch circular import loops (A → B → C → A).

### 2. UI & Widget Architecture
1. **Widget Nesting Depth**: Call `flutter_analyze_widget_depth` to audit deeply nested widget trees (> 5 levels) and get extraction suggestions.
2. **Duplicate Widgets**: Call `flutter_detect_duplicate_widgets` to find structural duplicates and propose reusable components.
3. **Directory Structure**: Call `flutter_get_project_structure` to inspect project organization (`lib/`, `android/`, `src/`).

### 3. Detailed Component & Dependency Exploration
1. **Visual Graph**: Call `flutter_get_detailed_graph` with `focusFile` and `depth: 2` to trace imports, calls, and inheritance.
2. **Symbol Search**: Use `flutter_search` with filters (`class`, `function`, `widget`, `enum`, `mixin`) for targeted lookups.
3. **External Packages**: Use `flutter_search_packages` and `flutter_read_package_source` to read implementation details directly from `.pub-cache` or the Flutter SDK.