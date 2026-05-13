---
name: Impact Analysis
description: Analyze the blast radius of changes to prevent regressions in Flutter apps
---

## Impact Analysis

Analyze the 'blast radius' of your changes to ensure you don't break distant parts of the application.

### Steps

1. Before modifying a file, run `flutter_get_impact_analysis` to see which entry points (main, widgets) eventually call this file.
2. Use `flutter_get_reverse_deps` for a specific class or function to see exactly what depends on it.
3. Check the `flutter_get_detailed_graph` to see visual connections.
4. If refactoring, use `flutter_get_hints` to get suggestions on related areas that might need updates.

### Safety Checks

- Always check the blast radius before major refactors.
- If a file is used by many entry points, be extra careful with changes to its public API.
- Use `flutter_get_reverse_deps` to find all call sites that need to be updated after a signature change.
