---
name: Project Dependencies Management
description: Manage pubspec dependencies, analyze package usage, and run code generation
---

## Project Dependencies Management

Analyze and manage the project's external packages and internal architectural dependencies.

### Steps

1. Run `flutter_get_project_path` to verify the current workspace root, or `flutter_set_project_path` if working in a monorepo.
2. Use `flutter_get_pubspec` to read and analyze the project's pubspec.yaml file.
3. Run `flutter_list_packages` to list all resolved dependencies from pubspec.lock.
4. If a class relies on specific services/repositories, use `flutter_get_dependencies` to extract its constructor dependencies.
5. If you modify generated files (Freezed, Riverpod, etc.), use `flutter_run_build_runner` to safely regenerate the conflicting outputs.

### Tips
- Use `flutter_list_packages` to quickly verify the exact version of a package installed.
- `flutter_run_build_runner` is essential after updating models or states that rely on code generation.
