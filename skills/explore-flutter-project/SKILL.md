---
name: Explore Flutter Project
description: Navigate and understand Flutter codebase structure, widget trees, and dependencies
---

## Explore Flutter Project

Use the flutter-explorer-mcp tools to explore and understand the codebase.

### Steps

1. Run `flutter_get_stats` to see overall codebase metrics (classes, functions, widgets).
2. Run `flutter_get_project_structure` to explore the directory layout and key files.
3. Use `flutter_get_detailed_graph` to visualize inheritance, calls, and imports.
4. Use `flutter_search` to find specific widgets, classes, or functions by name.
5. Use `flutter_get_file_info` for a deep dive into a specific Dart file.

### Tips

- Start with `flutter_get_stats` to understand the scale of the project.
- Use `flutter_get_detailed_graph` with `focusFile` to understand the context of a specific component.
- The widget tree is a great way to understand the UI structure. Use `flutter_get_project_structure` to find UI-related files.
