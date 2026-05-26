import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface SkillDef {
    name: string;
    description: string;
    body: string;
}

const SKILLS: Record<string, SkillDef> = {
    'explore-flutter-project': {
        name: 'Explore Flutter Project',
        description: 'Navigate and understand Flutter codebase structure, widget trees, and dependencies',
        body: `## Explore Flutter Project

Use the flutter-explorer-mcp tools to explore and understand the codebase.

### Steps

1. Run \`flutter_get_stats\` to see overall codebase metrics (classes, functions, widgets).
2. Check if the index is up-to-date using \`flutter_get_index_status\`. If needed, run \`flutter_rebuild_index\`.
3. Run \`flutter_get_project_structure\` to explore the directory layout and key files.
4. Use \`flutter_get_detailed_graph\` to visualize inheritance, calls, and imports.
5. Use \`flutter_search\` to find specific widgets, classes, or functions by name.
6. Use \`flutter_get_file_info\` for a deep dive into a specific file.

### Tips

- Start with \`flutter_get_stats\` to understand the scale of the project.
- Use \`flutter_get_detailed_graph\` with \`focusFile\` to understand the context of a specific component.
- The widget tree is a great way to understand the UI structure. Use \`flutter_get_project_structure\` to find UI-related files.
`
    },
    'debug-flutter-issue': {
        name: 'Debug Flutter Issue',
        description: 'Systematically debug Flutter issues using diagnostics, logs, and logic analysis',
        body: `## Debug Flutter Issue

Use the flutter-explorer-mcp tools to systematically trace and debug Flutter issues.

### Steps

1. Run \`flutter_get_diagnostics\` to see all current VS Code errors and warnings.
2. Run \`flutter_run_analyze\` for a fresh, comprehensive compiler check on the whole project.
3. Use \`flutter_get_code_warnings\` to find potential issues like hardcoded colors or text.
4. If a specific function is suspected, use \`flutter_analyze_logic_flow\` to get a summary of its behavior.
5. Use \`flutter_get_node_at_cursor\` or \`flutter_search\` to find the relevant code blocks.
6. Use \`flutter_get_code_block\` to read the full implementation including comments.

### Tips

- Check \`flutter_get_diagnostics\` first to see if the compiler is already pointing at the problem.
- Hardcoded values often cause UI inconsistencies; use \`flutter_get_code_warnings\` to find them.
- \`flutter_analyze_logic_flow\` is perfect for understanding complex business logic without reading every line.
`
    },
    'impact-analysis': {
        name: 'Impact Analysis',
        description: 'Analyze the blast radius of changes to prevent regressions in Flutter apps',
        body: `## Impact Analysis

Analyze the 'blast radius' of your changes to ensure you don't break distant parts of the application.

### Steps

1. Before modifying a file, run \`flutter_get_impact_analysis\` to see which entry points (main, widgets) eventually call this file.
2. Use \`flutter_get_reverse_deps\` for a specific class or function to see exactly what depends on it.
3. Use \`flutter_find_references\` to find all exact usages/references of a specific variable, class, or function across the project.
4. Check the \`flutter_get_detailed_graph\` to see visual connections.
5. If refactoring, use \`flutter_get_hints\` to get suggestions on related areas that might need updates.

### Safety Checks

- Always check the blast radius before major refactors.
- If a file is used by many entry points, be extra careful with changes to its public API.
- Use \`flutter_get_reverse_deps\` to find all call sites that need to be updated after a signature change.
`
    },
    'localization-management': {
        name: 'Localization Management',
        description: 'Manage ARB translations, find missing keys, and update localizations',
        body: `## Localization Management

Efficiently manage Flutter localization (ARB files) and ensure all keys are translated.

### Steps

1. Run \`flutter_get_missing_translations\` to identify keys present in some languages but missing in others.
2. Use \`flutter_list_translations\` to get a full overview of all translation keys.
3. Use \`flutter_update_translation\` to add or update translations for multiple languages at once.
4. If a feature is removed, use \`flutter_delete_translation\` to clean up the ARB files.

### Best Practices

- Always run \`flutter_get_missing_translations\` before a release.
- Use descriptive keys for translations to make them easier to find via \`flutter_search\`.
`
    },
    'project-dependencies-management': {
        name: 'Project Dependencies Management',
        description: 'Manage pubspec dependencies, analyze package usage, and run code generation',
        body: `## Project Dependencies Management

Analyze and manage the project's external packages and internal architectural dependencies.

### Steps

1. Run \`flutter_get_project_path\` to verify the current workspace root, or \`flutter_set_project_path\` if working in a monorepo.
2. Use \`flutter_get_pubspec\` to read and analyze the project's pubspec.yaml file.
3. Run \`flutter_list_packages\` to list all resolved dependencies from pubspec.lock.
4. If a class relies on specific services/repositories, use \`flutter_get_dependencies\` to extract its constructor dependencies.
5. If you modify generated files (Freezed, Riverpod, etc.), use \`flutter_run_build_runner\` to safely regenerate the conflicting outputs.

### Tips
- Use \`flutter_list_packages\` to quickly verify the exact version of a package installed.
- \`flutter_run_build_runner\` is essential after updating models or states that rely on code generation.
`
    },
    'advanced-code-search': {
        name: 'Advanced Code Search',
        description: 'Deep dive into the codebase using semantic search, text search, and references',
        body: `## Advanced Code Search

Perform precise codebase searches to find hard-to-reach implementations and usages.

### Steps

1. Use \`flutter_search\` for general symbol lookups (classes, functions, widgets).
2. For specific strings, URLs, or comments, use \`flutter_search_text\` to scan all Dart files globally.
3. Need to see how a specific function/class is implemented? Use \`flutter_read_fragment\` to extract just that fragment with its surrounding comments.
4. Want to know everywhere a specific enum or typedef is used? Use \`flutter_find_references\`.

### Tips
- \`flutter_search_text\` is perfect for finding hidden API endpoints, hardcoded strings, or specific comment tags like TODOs.
- \`flutter_read_fragment\` is much faster and cleaner than reading an entire 1000-line file when you only need one specific method.
`
    }
};

export async function generateSkills(workspaceRoot: string): Promise<void> {
    try {
        const username = os.userInfo().username;
        const homedir = os.homedir();
        
        // 1. Generic workspace fallback (skills/ folder)
        const genericSkillsDir = path.join(workspaceRoot, 'skills');
        ensureDir(genericSkillsDir);

        // 2. Cursor AI (.cursor/rules/)
        const cursorRulesDir = path.join(workspaceRoot, '.cursor', 'rules');
        ensureDir(cursorRulesDir);

        // 3. Claude/Roo (cline_docs/)
        const clineDocsDir = path.join(workspaceRoot, 'cline_docs');
        ensureDir(clineDocsDir);

        // 4. Antigravity Global Config (~/.gemini/config/skills/)
        const antigravitySkillsDir = path.join(homedir, '.gemini', 'config', 'skills');
        ensureDir(antigravitySkillsDir);

        for (const [id, skill] of Object.entries(SKILLS)) {
            // --- A. Generate for Generic/Workspace (Standard Markdown) ---
            const genericSkillSubdir = path.join(genericSkillsDir, id);
            ensureDir(genericSkillSubdir);
            const standardContent = [
                '---',
                `name: ${skill.name}`,
                `description: ${skill.description}`,
                '---',
                '',
                skill.body
            ].join('\n');
            fs.writeFileSync(path.join(genericSkillSubdir, 'SKILL.md'), standardContent, 'utf8');

            // --- B. Generate for Cursor (.mdc format) ---
            const cursorContent = [
                '---',
                `description: ${skill.description}`,
                'globs: *.dart, *.kt, *.java, *.ts, *.tsx, *.js, *.jsx',
                '---',
                '',
                `# ${skill.name}`,
                '',
                skill.body
            ].join('\n');
            fs.writeFileSync(path.join(cursorRulesDir, `${id}.mdc`), cursorContent, 'utf8');

            // --- C. Generate for Claude/Roo (cline_docs folder) ---
            const clineContent = [
                `# ${skill.name}`,
                '',
                `*Description: ${skill.description}*`,
                '',
                skill.body
            ].join('\n');
            fs.writeFileSync(path.join(clineDocsDir, `${id}.md`), clineContent, 'utf8');

            // --- D. Generate for Antigravity (Global SKILL.md) ---
            const agSkillSubdir = path.join(antigravitySkillsDir, `flutter-explorer-${id}`);
            ensureDir(agSkillSubdir);
            fs.writeFileSync(path.join(agSkillSubdir, 'SKILL.md'), standardContent, 'utf8');
        }

        console.log('AI Skills distributed successfully to Gemini, Cursor, and Roo/Claude!');
    } catch (error) {
        console.error('Error generating AI skills:', error);
    }
}

function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
