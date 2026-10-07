# Project Dependencies Management

*Description: Manage pubspec dependencies, live pub.dev research, cached package source inspection, asset cleanup, and code generation in Flutter*

# Project Dependencies Management

Analyze, research, manage, and audit external packages, cached SDK sources, declared assets, and code generation in Flutter projects.

## Workflow

### 1. Research & Vetting Packages
1. **Explore pub.dev**: Call `flutter_pub_dev_search` to find high-quality packages matching your use case.
2. **Package Health & Metrics**: Call `flutter_get_pub_package_info` with `packageName` to inspect pub points, popularity score, likes, repository URL, and license before adding a dependency.

### 2. Inspecting Installed & Cached Dependencies
1. **List Resolved Dependencies**: Call `flutter_list_packages` (with optional `dependencyType: "direct" | "dev" | "transitive"`) to inspect versions locked in `pubspec.lock`.
2. **Search Inside Package Sources**: Call `flutter_search_packages` to grep for classes, functions, or patterns directly inside `.pub-cache` and the official Flutter SDK.
3. **Read Package Implementation**: Call `flutter_read_package_source` with a `package:` URI (e.g. `package:flutter/material.dart`) to inspect official library source code without guessing.

### 3. Pubspec & Asset Auditing
1. **Pubspec Inspection**: Call `flutter_get_pubspec` to review dependencies, environment SDK constraints, and assets.
2. **Unused Asset Cleanup**: Call `flutter_detect_unused_assets` to detect images, fonts, or assets declared in `pubspec.yaml` that are never referenced in Dart code.
3. **Run Code Generation**: Call `flutter_run_build_runner` to run `dart run build_runner build --delete-conflicting-outputs` after editing Freezed, Riverpod, or json_serializable models.