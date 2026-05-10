# Instructions for AI Agents (AGENTS.md)

When working on this project, please follow these guidelines to ensure consistency and efficiency:

## 1. Project Context
This is a VS Code extension for Flutter developers. Use the `flutter-explorer-mcp` tools to gather context.

## 2. Analysis Tools
Always check for code warnings and missing translations:
- Use `flutter_get_code_warnings` for hardcoded strings/colors.
- Use `flutter_get_missing_translations` for ARB file gaps.

## 3. Error Handling
- Record any errors or fixes in `errror.md`.
- After modifying code, run `npx tsc --noEmit` to verify type safety.

## 4. MCP Feedback
If an MCP tool fails or lacks functionality you need, document it in `اقتراحات_mcp.md`.

## 5. Performance
Be mindful of RAM usage. The project uses regex-based indexing to stay lightweight.
