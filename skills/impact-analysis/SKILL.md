---
name: Impact Analysis
description: "Analyze the blast radius of changes, uncommitted git diff impact, reverse dependencies, and architectural regressions in Flutter apps"
---

# Impact Analysis

Safely refactor Flutter/Dart code by determining the exact blast radius to UI entry points, callers, and architectural boundaries before committing changes.

## Workflow

### 1. Pre-Change Blast Radius
1. **Forward Impact**: Before editing a shared file, call `flutter_get_impact_analysis` with `filePath` to trace all UI entry points (main, widgets, events) that depend on this file.
2. **Reverse Dependencies**: Call `flutter_get_reverse_deps` for specific classes or methods to identify direct callers.
3. **Exact Usages**: Call `flutter_find_references` to locate exact line numbers and code snippets across the codebase where a symbol is referenced.

### 2. Post-Change Git Blast Radius
1. **Uncommitted Git Diff Impact**: Call `flutter_get_git_blast_radius` right before committing to audit all uncommitted changes across the git staging tree and verify which app flows are affected.
2. **Layer Regressions**: Run `flutter_validate_architecture_rules` to ensure changes didn't violate Clean Architecture layers (e.g., Domain importing Presentation).
3. **Cycle Check**: Run `flutter_detect_circular_dependencies` to ensure no circular dependency loops were created.