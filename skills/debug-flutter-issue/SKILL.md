---
name: Debug Flutter Issue
description: Systematically debug Flutter issues using diagnostics, logs, and logic analysis
---

## Debug Flutter Issue

Use the flutter-explorer-mcp tools to systematically trace and debug Flutter issues.

### Steps

1. Run `flutter_get_diagnostics` to see all current VS Code errors and warnings.
2. Use `flutter_get_code_warnings` to find potential issues like hardcoded colors or text.
3. If a specific function is suspected, use `flutter_analyze_logic_flow` to get a summary of its behavior.
4. Use `flutter_get_node_at_cursor` or `flutter_search` to find the relevant code blocks.
5. Use `flutter_get_code_block` to read the full implementation including comments.

### Tips

- Check `flutter_get_diagnostics` first to see if the compiler is already pointing at the problem.
- Hardcoded values often cause UI inconsistencies; use `flutter_get_code_warnings` to find them.
- `flutter_analyze_logic_flow` is perfect for understanding complex business logic without reading every line.
