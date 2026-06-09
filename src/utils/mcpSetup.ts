import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generateSkills } from './skillsGenerator';

async function setupGeminiMd(homedir: string): Promise<void> {
    try {
        const geminiDir = path.join(homedir, '.gemini');
        if (!fs.existsSync(geminiDir)) {
            fs.mkdirSync(geminiDir, { recursive: true });
        }
        const geminiMdPath = path.join(geminiDir, 'GEMINI.md');
        const ruleHeader = "# 📑 تعليمات وقواعد التطوير البرمجي لـ Gemini Agent";
        
        const skillPath = path.join(homedir, '.gemini', 'config', 'skills', 'flutter-explorer-mcp', 'SKILL.md').replace(/\\/g, '/');
        const formattedPath = skillPath.startsWith('/') ? skillPath : `/${skillPath}`;
        const skillUrl = `file://${formattedPath}`;

        const content = `${ruleHeader}

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

        if (!fs.existsSync(geminiMdPath)) {
            fs.writeFileSync(geminiMdPath, content, 'utf8');
            console.log(`Created GEMINI.md at: ${geminiMdPath}`);
        } else {
            const existing = fs.readFileSync(geminiMdPath, 'utf8');
            if (!existing.includes(ruleHeader)) {
                const updated = existing + "\n\n" + content;
                fs.writeFileSync(geminiMdPath, updated, 'utf8');
                console.log(`Appended Gemini Agent rules to existing GEMINI.md`);
            } else {
                const idx = existing.indexOf(ruleHeader);
                if (idx !== -1) {
                    const before = existing.substring(0, idx);
                    fs.writeFileSync(geminiMdPath, before + content, 'utf8');
                    console.log(`Updated Gemini Agent rules block in GEMINI.md`);
                }
            }
        }
    } catch (e) {
        console.error('Failed to setup GEMINI.md:', e);
    }
}

export async function setupMcpConfig(extensionPath: string, workspaceRoot: string): Promise<void> {
    try {
        // Generate AI Skills instructions
        await generateSkills(workspaceRoot);

        // Setup global GEMINI.md rules
        await setupGeminiMd(os.homedir());

        // Write the active project path to a global file for fallback resolution
        try {
            const geminiDir = path.join(os.homedir(), '.gemini');
            if (!fs.existsSync(geminiDir)) {
                fs.mkdirSync(geminiDir, { recursive: true });
            }
            const activeProjectPath = path.join(geminiDir, 'active-project.txt');
            fs.writeFileSync(activeProjectPath, workspaceRoot, 'utf8');
        } catch (e) {
            console.error('Failed to write active project fallback:', e);
        }

        const username = os.userInfo().username;
        const mcpServerPath = path.join(extensionPath, 'out', 'mcp-server.js').replace(/\\/g, '/');
        
        const mcpEntryDynamic = {
            command: "node",
            args: [mcpServerPath],
            env: {
                FLUTTER_PROJECT_PATH: "${workspaceFolder}"
            }
        };

        const mcpEntryStatic = {
            command: "node",
            args: [mcpServerPath],
            env: {
                FLUTTER_PROJECT_PATH: workspaceRoot
            }
        };

        // 1. Target: Global Gemini Configs
        const geminiConfigPath1 = `C:/Users/${username}/.gemini/config/mcp_config.json`;
        const geminiConfigPath2 = `C:/Users/${username}/.gemini/antigravity/mcp_config.json`;
        await updateJsonFile(geminiConfigPath1, "flutter-explorer-mcp", mcpEntryDynamic, false);
        await updateJsonFile(geminiConfigPath2, "flutter-explorer-mcp", mcpEntryDynamic, false);

        // 2. Target: Workspace .vscode/mcp.json (Uses 'servers' to satisfy VS Code validation)
        const vscodeMcpPath = path.join(workspaceRoot, '.vscode', 'mcp.json');
        await updateJsonFile(vscodeMcpPath, "flutter-explorer-mcp", mcpEntryDynamic, true);

        // 3. Target: Workspace .cursor/mcp.json
        const cursorMcpPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
        await updateJsonFile(cursorMcpPath, "flutter-explorer-mcp", mcpEntryDynamic, false);

        // 4. Target: Claude Desktop Global Config
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const claudeConfigPath = path.join(appData, 'Claude', 'claude_desktop_config.json').replace(/\\/g, '/');
        // Claude Desktop doesn't support ${workspaceFolder}, so we use the static workspaceRoot
        await updateJsonFile(claudeConfigPath, "flutter-explorer-mcp", mcpEntryStatic, false);

        vscode.window.showInformationMessage(`MCP Configured for user: ${username} (Gemini, Claude, Cursor, VS Code) 🚀`);
    } catch (error) {
        console.error('Error setting up MCP config:', error);
        vscode.window.showErrorMessage('Failed to setup MCP config automatically.');
    }
}

async function updateJsonFile(filePath: string, key: string, value: any, useServersKey: boolean): Promise<void> {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const mainKey = useServersKey ? "servers" : "mcpServers";
        let config: any = { [mainKey]: {} };

        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(content);
                
                // If it has 'servers' but not 'mcpServers', migrate it (or vice versa)
                const existingServers = parsed.mcpServers || parsed.servers || parsed;
                config[mainKey] = typeof existingServers === 'object' ? existingServers : {};
            } catch (e) {
                config = { [mainKey]: {} };
            }
        }

        // Ensure we are working with the correct nested structure
        if (!config[mainKey] || typeof config[mainKey] !== 'object') {
            config[mainKey] = {};
        }

        config[mainKey][key] = value;
        
        // Clean up: remove the other key if it exists to avoid validation errors
        const otherKey = useServersKey ? "mcpServers" : "servers";
        if (config[otherKey]) delete config[otherKey];

        // Write clean, validated JSON
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error(`Failed to update ${filePath}:`, e);
    }
}
