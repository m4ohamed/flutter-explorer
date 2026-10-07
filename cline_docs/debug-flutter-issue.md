# Debug Flutter Issue

*Description: Systematically debug Flutter issues using diagnostics, compiler checks, live VM runtime errors, memory leak detection, widget inspection, and UI simulation*

# Debug Flutter Issue

Systematically trace, diagnose, and fix Flutter and Dart issues using `flutter-explorer-mcp` tools across static analysis and live VM runtime.

## Workflow

### 1. Static Analysis & Diagnostics
1. **VS Code Diagnostics**: Call `flutter_get_diagnostics` to inspect all active compiler errors, warnings, and hints.
2. **Fresh Compiler Pass**: Run `flutter_run_analyze` for a real-time `flutter analyze` / `tsc --noEmit` check.
3. **Memory Leaks**: Run `flutter_detect_memory_leaks` to find undisposed `TextEditingController`, `AnimationController`, `ScrollController`, `StreamSubscription`, and `FocusNode` instances in `State` classes.
4. **Mockups & Incomplete Logic**: Run `flutter_detect_mockups` to catch no-op callbacks (`onPressed: () {}`), stub widgets (`Placeholder`), and fake async delays.

### 2. Live Runtime Debugging (VM Service)
1. **Uncaught Crashes**: Call `flutter_get_runtime_errors` to view live uncaught exceptions and stack traces directly from the running app.
2. **Inspect Widget Hierarchy**: Call `flutter_inspect_live_widgets` to inspect live widget properties, layout boundaries, and state objects.
3. **Reproduce Issues**: Call `flutter_simulate_ui_action` with `action: "tap"` | `"enterText"` | `"scroll"` to drive the live UI and trigger edge cases.
4. **Apply Fixes**: Use `flutter_hot_reload` (or `flutter_hot_restart` for structural/state changes) to immediately verify fixes without restarting the app.

### 3. Deep Code Investigation
1. **Logic Analysis**: Run `flutter_analyze_logic_flow` to summarize branch conditions and state mutations inside complex methods.
2. **Read Code Blocks**: Use `flutter_get_code_block` or `flutter_read_fragment` to inspect the exact implementation with comments.
3. **Inspect Line Range**: Use `flutter_read_lines` to inspect surrounding context around stack trace line numbers without token waste.