const fs = require('fs');

const mcpSkillBody = fs.readFileSync('skills/mcp/SKILL.md', 'utf8');
// Strip frontmatter
const mcpBody = mcpSkillBody.split(/^---\s*$/m).slice(2).join('---').trim();

const exploreBody = fs.readFileSync('skills/explore-flutter-project/SKILL.md', 'utf8').split(/^---\s*$/m).slice(2).join('---').trim();
const debugBody = fs.readFileSync('skills/debug-flutter-issue/SKILL.md', 'utf8').split(/^---\s*$/m).slice(2).join('---').trim();
const impactBody = fs.readFileSync('skills/impact-analysis/SKILL.md', 'utf8').split(/^---\s*$/m).slice(2).join('---').trim();
const l10nBody = fs.readFileSync('skills/localization-management/SKILL.md', 'utf8').split(/^---\s*$/m).slice(2).join('---').trim();
const depsBody = fs.readFileSync('skills/project-dependencies-management/SKILL.md', 'utf8').split(/^---\s*$/m).slice(2).join('---').trim();
const searchBody = fs.readFileSync('skills/advanced-code-search/SKILL.md', 'utf8').split(/^---\s*$/m).slice(2).join('---').trim();

function escapeForTemplateLiteral(str) {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const fileContent = `import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface SkillDef {
    name: string;
    description: string;
    body: string;
}

const SKILLS: Record<string, SkillDef> = {
    'mcp': {
        name: 'flutter-explorer-mcp',
        description: "How to use the flutter-explorer-mcp MCP server's 50+ tools to explore, search, analyze, and safely modify Flutter/Dart projects (also JS/TS and Android modules in the same repo) instead of guessing from memory, grepping by hand, or reading whole files. ALWAYS consult this skill whenever flutter-explorer-mcp tools are connected and the task involves finding a class, function, widget, enum, mixin, or extension; reading or explaining Dart code; figuring out what a change would break (impact/blast-radius); hunting mockup/placeholder/TODO/hardcoded-string-or-color code; checking Clean Architecture layer violations or circular dependencies; undisposed controllers or memory leaks; ARB translation gaps; running flutter analyze or build_runner; or driving a live running Flutter app (hot reload/restart, runtime errors, widget inspection, simulated taps) via the VM service. Prefer these tools over raw bash/grep/view on Dart files whenever the project is indexed.",
        body: \`${escapeForTemplateLiteral(mcpBody)}\`
    },
    'explore-flutter-project': {
        name: 'Explore Flutter Project',
        description: 'Navigate and understand Flutter codebase structure, Clean Architecture layers, Lakos coupling metrics, widget trees, and external dependencies',
        body: \`${escapeForTemplateLiteral(exploreBody)}\`
    },
    'debug-flutter-issue': {
        name: 'Debug Flutter Issue',
        description: 'Systematically debug Flutter issues using diagnostics, compiler checks, live VM runtime errors, memory leak detection, widget inspection, and UI simulation',
        body: \`${escapeForTemplateLiteral(debugBody)}\`
    },
    'impact-analysis': {
        name: 'Impact Analysis',
        description: 'Analyze the blast radius of changes, uncommitted git diff impact, reverse dependencies, and architectural regressions in Flutter apps',
        body: \`${escapeForTemplateLiteral(impactBody)}\`
    },
    'localization-management': {
        name: 'Localization Management',
        description: 'Manage ARB translations, batch auto-translation, ICU syntax validation, unused key cleanup, and intl code generation in Flutter',
        body: \`${escapeForTemplateLiteral(l10nBody)}\`
    },
    'project-dependencies-management': {
        name: 'Project Dependencies Management',
        description: 'Manage pubspec dependencies, live pub.dev research, cached package source inspection, asset cleanup, and code generation in Flutter',
        body: \`${escapeForTemplateLiteral(depsBody)}\`
    },
    'advanced-code-search': {
        name: 'Advanced Code Search',
        description: 'Deep dive into the codebase using BM25 ranked symbol search, full-text regex, index-backed references, code fragments, and external package search',
        body: \`${escapeForTemplateLiteral(searchBody)}\`
    }
};

export async function generateSkills(workspaceRoot: string): Promise<void> {
    try {
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
            const genericSkillFile = path.join(genericSkillSubdir, 'SKILL.md');
            
            // Generate standard frontmatter + body
            const standardContent = [
                '---',
                \`name: \${skill.name}\`,
                \`description: "\${skill.description.replace(/"/g, '\\\\"')}"\`,
                '---',
                '',
                skill.body
            ].join('\\n');

            try {
                fs.writeFileSync(genericSkillFile, standardContent, 'utf8');
            } catch (e) {
                console.error(\`[Skills] Failed to write generic skill \${id}:\`, e);
            }

            // --- B. Generate for Cursor (.mdc format) ---
            const cursorContent = [
                '---',
                \`description: "\${skill.description.replace(/"/g, '\\\\"')}"\`,
                'globs: *.dart, *.kt, *.java, *.ts, *.tsx, *.js, *.jsx',
                '---',
                '',
                \`# \${skill.name}\`,
                '',
                skill.body
            ].join('\\n');
            try {
                fs.writeFileSync(path.join(cursorRulesDir, \`\${id}.mdc\`), cursorContent, 'utf8');
            } catch (e) {
                console.error(\`[Skills] Failed to write cursor skill \${id}:\`, e);
            }

            // --- C. Generate for Claude/Roo (cline_docs folder) ---
            const clineContent = [
                \`# \${skill.name}\`,
                '',
                \`*Description: \${skill.description}*\`,
                '',
                skill.body
            ].join('\\n');
            try {
                fs.writeFileSync(path.join(clineDocsDir, \`\${id}.md\`), clineContent, 'utf8');
            } catch (e) {
                console.error(\`[Skills] Failed to write cline skill \${id}:\`, e);
            }

            // --- D. Generate for Antigravity (Global SKILL.md) ---
            const agSkillSubdir = path.join(antigravitySkillsDir, id === 'mcp' ? 'flutter-explorer-mcp' : \`flutter-explorer-\${id}\`);
            ensureDir(agSkillSubdir);
            try {
                fs.writeFileSync(path.join(agSkillSubdir, 'SKILL.md'), standardContent, 'utf8');
            } catch (e) {
                console.error(\`[Skills] Failed to write antigravity skill \${id}:\`, e);
            }
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
`;

fs.writeFileSync('src/utils/skillsGenerator.ts', fileContent, 'utf8');
console.log('Successfully updated src/utils/skillsGenerator.ts with complete 52 tools!');
