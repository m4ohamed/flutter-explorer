import * as fs from 'fs';
import * as path from 'path';

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
2. Run \`flutter_get_project_structure\` to explore the directory layout and key files.
3. Use \`flutter_get_detailed_graph\` to visualize inheritance, calls, and imports.
4. Use \`flutter_search\` to find specific widgets, classes, or functions by name.
5. Use \`flutter_get_file_info\` for a deep dive into a specific Dart file.

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
2. Use \`flutter_get_code_warnings\` to find potential issues like hardcoded colors or text.
3. If a specific function is suspected, use \`flutter_analyze_logic_flow\` to get a summary of its behavior.
4. Use \`flutter_get_node_at_cursor\` or \`flutter_search\` to find the relevant code blocks.
5. Use \`flutter_get_code_block\` to read the full implementation including comments.

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
3. Check the \`flutter_get_detailed_graph\` to see visual connections.
4. If refactoring, use \`flutter_get_hints\` to get suggestions on related areas that might need updates.

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
    }
};

export async function generateSkills(workspaceRoot: string): Promise<void> {
    try {
        const skillsDir = path.join(workspaceRoot, 'skills');
        if (!fs.existsSync(skillsDir)) {
            fs.mkdirSync(skillsDir, { recursive: true });
        }

        for (const [id, skill] of Object.entries(SKILLS)) {
            const skillSubdir = path.join(skillsDir, id);
            if (!fs.existsSync(skillSubdir)) {
                fs.mkdirSync(skillSubdir, { recursive: true });
            }

            const skillFilePath = path.join(skillSubdir, 'SKILL.md');
            const content = [
                '---',
                `name: ${skill.name}`,
                `description: ${skill.description}`,
                '---',
                '',
                skill.body
            ].join('\n');

            fs.writeFileSync(skillFilePath, content, 'utf8');
        }

        console.log('Skills generated successfully in:', skillsDir);
    } catch (error) {
        console.error('Error generating skills:', error);
    }
}
