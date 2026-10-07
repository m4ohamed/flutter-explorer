const fs = require('fs');
const allTools = [
"flutter_search", "flutter_get_stats", "flutter_get_project_structure", "flutter_get_file_info",
"flutter_get_pubspec", "flutter_get_code_warnings", "flutter_detect_mockups", "flutter_get_diagnostics",
"flutter_get_missing_translations", "flutter_update_translation", "flutter_delete_translation",
"flutter_list_translations", "flutter_get_impact_analysis", "flutter_get_reverse_deps",
"flutter_set_project_path", "flutter_get_project_path", "flutter_get_node_at_cursor",
"flutter_list_packages", "flutter_get_code_block", "flutter_analyze_logic_flow",
"flutter_get_dependencies", "flutter_read_fragment", "flutter_search_text", "flutter_get_index_status",
"flutter_get_detailed_graph", "flutter_get_hints", "flutter_read_lines", "flutter_run_analyze",
"flutter_run_build_runner", "flutter_find_references", "flutter_run_intl_generate",
"flutter_rebuild_index", "flutter_search_packages", "flutter_read_package_source",
"flutter_pub_dev_search", "flutter_get_pub_package_info", "flutter_hot_reload",
"flutter_hot_restart", "flutter_get_runtime_errors", "flutter_inspect_live_widgets",
"flutter_find_unused_translations", "flutter_validate_icu_translations", "flutter_auto_translate_missing",
"flutter_detect_circular_dependencies", "flutter_validate_architecture_rules",
"flutter_detect_unused_assets", "flutter_get_git_blast_radius", "flutter_analyze_widget_depth",
"flutter_detect_duplicate_widgets", "flutter_detect_memory_leaks", "flutter_simulate_ui_action",
"flutter_get_architectural_layers"
];

const extracted = JSON.parse(fs.readFileSync('scratch/tools_extracted.json', 'utf8'));
const extractedNames = new Set(extracted.map(t => t.name));
const missing = allTools.filter(t => !extractedNames.has(t));
console.log('Unmatched tools:', missing);
