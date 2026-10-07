import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generateSkills } from './skillsGenerator';
import { upsertMcpServer, upsertMarkedBlock, writeFileAtomic, WriteResult } from './configWriter';

const SERVER_NAME = 'flutter-explorer-mcp';
const RULE_HEADER = '# 📑 تعليمات وقواعد التطوير البرمجي لـ Gemini Agent';

function buildGeminiRules(homedir: string): string {
    const skillPath = path.join(homedir, '.gemini', 'config', 'skills', 'flutter-explorer-mcp', 'SKILL.md').replace(/\\/g, '/');
    const formattedPath = skillPath.startsWith('/') ? skillPath : `/${skillPath}`;
    const skillUrl = `file://${formattedPath}`;

    return `${RULE_HEADER}

مجموعة من القواعد الأساسية والإلزامية لضمان جودة الأكواد، وتسريع عملية التطوير، وتفادي الأخطاء المتكررة. **يجب قراءة هذا الملف وملفات الأخطاء والدروس عند بدء أي جلسة عمل.**

---

## 🎯 1. الخطوة الأولى عند بدء الجلسة (إجباري)
1. **قراءة ملف الأخطاء**: قم فوراً بفتح وقراءة [error.md](./error.md) لفحص المشاكل السابقة وتجنبها.
2. **قراءة ملف الدروس**: قم بفتح [lessons.md](./lessons.md) لاستيعاب الأنماط البرمجية الخاطئة والمصححة حتى لا تكررها رياضياً.
3. **استكشاف الفهرس**: احرص على استخدام أدوات الـ MCP الخاصة بالمشروع \`@mcp:flutter-explorer-mcp:\` بشكل أساسي ومستمر للبحث عن المراجع، وفهم البنية، واستكشاف العلاقات البرمجية لضمان أقصى درجات الدقة والتوافق.
4. **الاعتماد على المهارات (Skills)**: قبل البدء بأي مهمة متخصصة، قم بالرجوع إلى وقراءة ملفات الإرشادات الخاصة بالمهارات المتاحة (تجدها في مجلد \`skills/\` أو المسار العالمي \`~/.gemini/config/skills/\`). على سبيل المثال، اقرأ ملف المهارة الشامل لـ [flutter-explorer-mcp](${skillUrl}) لفهم سير العمل والأدوات وقواعد معالجة الأخطاء.

---

## 🛠️ 2. التحقق من جودة الكود وبناء المشروع
بعد أي تعديل في الأكواد المصدرية (وليس ملفات التوثيق مثل \`.md\` أو \`.txt\`)، يجب إجراء التحققات التالية تلقائياً ودون طلب إذن:

* **مشاريع TypeScript / React**:
  شغل الأمر التالي فوراً للتحقق من سلامة الأنواع وتوافقها:
  \`\`\`bash
  npx tsc --noEmit 2>&1
  \`\`\`
  *إذا كان هناك نظام بناء أو تجميع (مثل \`esbuild\` في هذه الإضافة)، فقم بتشغيل أمر البناء للتأكد من نجاح تجميع الحزمة بالكامل (مثل \`npm run compile\`).*
* **مشاريع Flutter / Dart**:
  استخدم أدوات الـ MCP الخاصة بـ Dart (إن وجدت) لفحص الأخطاء لأنها أسرع، أو قم بتشغيل الفحص العام:
  \`\`\`bash
  flutter analyze
  \`\`\`
* **المشاريع الأخرى**:
  شغل أداة التحليل والتدقيق الخاصة بنوع ولغة المشروع الفعلي.

---

## 📝 3. توثيق الأخطاء والتطور المستمر

### 1️⃣ ملف الأخطاء والحلول ([error.md](./error.md))
قبل كتابة الأكواد المصدرية الجديدة أو إجراء تعديلات كبيرة، قم بتسجيل الأخطاء المتوقعة أو التي واجهتها وكيفية إصلاحها متبعاً هذا الهيكل:
* **الخطأ (The Bug)**: رسالة الخطأ والسطر المسبب.
* **السبب الجذري (Root Cause)**: تحليل المشكلة ولماذا حدثت.
* **الحل الفعلي (The Fix)**: الكود قبل وبعد التعديل أو التعديل البرمجي المتخذ.

### 2️⃣ ملف خريطة الطريق ([development_roadmap.md](./development_roadmap.md))
سجل تقدم العمل اليومي بشكل دوري ونظم المهام في أقسام واضحة (المهام المكتملة، المهام الحالية، والمهام المستقبلية) لضمان سهولة استئناف العمل في الجلسات القادمة.

### 3️⃣ ملف الدروس المستفادة ([lessons.md](./lessons.md))
يمثل حلقة تحسين ذاتي مستمر (Self-optimizing loop). عندما يرتكب وكيل الذكاء الاصطناعي خطأً ويقوم المطور البشري بتصحيحه، **يجب صياغة الدرس وتوثيقه رياضياً وبرمجياً فوراً** لمنع تكراره مستقبلاً بالصيغة التالية:
* **النمط الخاطئ (Anti-pattern)**: الكود أو السلوك المسبب للمشكلة.
* **النمط الصحيح (Approved Pattern)**: الكود السليم والآمن المعتمد.
`;
}

function setupGeminiMd(homedir: string): WriteResult {
    const geminiMdPath = path.join(homedir, '.gemini', 'GEMINI.md');
    // The block is delimited by markers, so content that other tools (or the user) keep in this
    // file is never touched. Files written by older versions (no markers) are migrated in place.
    return upsertMarkedBlock(geminiMdPath, 'rules', buildGeminiRules(homedir), RULE_HEADER);
}

function writeActiveProject(homedir: string, workspaceRoot: string): WriteResult {
    const target = path.join(homedir, '.gemini', 'active-project.txt');
    try {
        if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === workspaceRoot) {
            return { path: target, status: 'unchanged' };
        }
        const existed = fs.existsSync(target);
        writeFileAtomic(target, workspaceRoot);
        return { path: target, status: existed ? 'updated' : 'created' };
    } catch (err) {
        return { path: target, status: 'error', message: String(err) };
    }
}

export interface McpSetupOptions {
    /** Show a notification even when nothing had to change (used by the explicit command). */
    verbose?: boolean;
}

export async function setupMcpConfig(
    extensionPath: string,
    workspaceRoot: string,
    options: McpSetupOptions = {},
): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    try {
        const config = vscode.workspace.getConfiguration('flutterExplorer');
        const writeWorkspaceSkills = config.get<boolean>('writeWorkspaceSkills', false);

        // AI skill documents. Files inside the user's repository are only written when opted in.
        // `generateSkills` learns about the options argument in the skillsGenerator patch; until then
        // the extra argument is ignored and the old behaviour (workspace files too) stays in place.
        await (generateSkills as (root: string, opts?: { writeWorkspaceFiles?: boolean }) => Promise<void>)(
            workspaceRoot,
            { writeWorkspaceFiles: writeWorkspaceSkills },
        );

        const homedir = os.homedir();

        results.push(setupGeminiMd(homedir));
        results.push(writeActiveProject(homedir, workspaceRoot));

        const mcpServerPath = path.join(extensionPath, 'out', 'mcp-server.js').replace(/\\/g, '/');

        const entryDynamic = {
            command: 'node',
            args: [mcpServerPath],
            env: { FLUTTER_PROJECT_PATH: '${workspaceFolder}' },
        };
        // Claude Desktop cannot expand ${workspaceFolder}.
        const entryStatic = {
            command: 'node',
            args: [mcpServerPath],
            env: { FLUTTER_PROJECT_PATH: workspaceRoot },
        };

        // 1. Global Gemini & Antigravity configs
        results.push(upsertMcpServer(path.join(homedir, '.gemini', 'config', 'mcp_config.json'), SERVER_NAME, entryDynamic, false));
        results.push(upsertMcpServer(path.join(homedir, '.gemini', 'antigravity', 'mcp_config.json'), SERVER_NAME, entryDynamic, false));
        results.push(upsertMcpServer(path.join(homedir, '.gemini', 'antigravity-ide', 'mcp_config.json'), SERVER_NAME, entryDynamic, false));

        // 2. Workspace .vscode/mcp.json (VS Code validates the "servers" key)
        results.push(upsertMcpServer(path.join(workspaceRoot, '.vscode', 'mcp.json'), SERVER_NAME, entryDynamic, true));

        // 3. Workspace .cursor/mcp.json
        results.push(upsertMcpServer(path.join(workspaceRoot, '.cursor', 'mcp.json'), SERVER_NAME, entryDynamic, false));

        // 4. Claude Desktop global config
        const appData = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
        results.push(upsertMcpServer(path.join(appData, 'Claude', 'claude_desktop_config.json'), SERVER_NAME, entryStatic, false));

        for (const r of results) {
            if (r.status === 'error') { console.error(`[FlutterExplorer] ${r.path}: ${r.message}`); }
        }

        const changed = results.filter(r => r.status === 'created' || r.status === 'updated');
        const skipped = results.filter(r => r.status === 'skipped');
        const failed = results.filter(r => r.status === 'error');

        if (changed.length > 0 || options.verbose) {
            const names = changed.map(r => path.basename(path.dirname(r.path)) + '/' + path.basename(r.path));
            vscode.window.showInformationMessage(
                changed.length > 0
                    ? `Flutter Explorer: MCP configuration updated (${names.join(', ')}). Backups: ~/.flutter-explorer/backups`
                    : 'Flutter Explorer: MCP configuration is already up to date.',
            );
        }
        if (skipped.length > 0) {
            vscode.window.showWarningMessage(
                `Flutter Explorer left ${skipped.length} config file(s) untouched because they are not strict JSON: ` +
                skipped.map(r => r.path).join(', '),
            );
        }
        if (failed.length > 0) {
            vscode.window.showErrorMessage(`Flutter Explorer could not write ${failed.length} config file(s); see the extension log.`);
        }
    } catch (error) {
        console.error('Error setting up MCP config:', error);
        vscode.window.showErrorMessage('Failed to setup MCP config automatically.');
    }
    return results;
}
