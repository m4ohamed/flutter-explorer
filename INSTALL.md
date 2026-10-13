# تركيب أدوات التعديل في flutter-explorer-mcp

المجلد الهدف: `C:\Users\m4oha\OneDrive\Desktop\new`

## 1) انسخ الملفات الأربعة بنفس المسارات النسبية

| من هذه الحزمة | إلى |
|---|---|
| `src/utils/fileEditor.ts` | `new\src\utils\fileEditor.ts` |
| `src/mcp-edit-tools.ts` | `new\src\mcp-edit-tools.ts` |
| `tests/fileEditor.test.ts` | `new\tests\fileEditor.test.ts` |
| `tests/mcpEditTools.test.ts` | `new\tests\mcpEditTools.test.ts` |

## 2) عدّل `src/mcp-server.ts` (سطران)

بعد سطر الاستيراد `import { runProjectAnalysis, runBuildRunner } from './utils/analysisRunner';` (السطر 17) أضف:

```ts
import { registerEditTools } from './mcp-edit-tools';
```

وبعد إنشاء الخادم مباشرة (السطور 180-183):

```ts
const server = new McpServer({
  name: "flutter-explorer-mcp",
  version: "1.0.0",
});
```

أضف:

```ts
registerEditTools(server, () => currentProjectPath);
```

الدالة السهمية مقصودة: `currentProjectPath` يتغير عند استدعاء `flutter_set_project_path`، فتتبع الأدوات المشروع الحالي دائمًا.

## 3) أصلح `backupFile` في `src/utils/configWriter.ts` (إصلاح خطأ موجود)

الدالة الحالية تسمّي النسخة بطابع زمني بدقة الميلي‑ثانية، فنسختان في نفس الميلي‑ثانية تكتب الثانية فوق الأولى (ظهر هذا في الاختبار: 13 تعديلًا أعطت 7 نسخ). استبدل هذين السطرين:

```ts
    const target = path.join(backupDir, `${stamp}__${safeName}.bak`);
    fs.copyFileSync(filePath, target);
```

بهذا:

```ts
    let target = path.join(backupDir, `${stamp}__${safeName}.bak`);
    // Two backups inside the same millisecond must not overwrite each other. '~' sorts after '_',
    // so "<stamp>~001__<name>" is correctly seen as newer than "<stamp>__<name>" when pruning.
    for (let n = 1; fs.existsSync(target); n++) {
      target = path.join(backupDir, `${stamp}~${String(n).padStart(3, '0')}__${safeName}.bak`);
    }
    fs.copyFileSync(filePath, target);
```

## 4) ابنِ واختبر

```
npm run typecheck
npm test
npm run compile
```

ثم أعد تشغيل خادم MCP من العميل الذي تستخدمه (أو Reload Window في VS Code)، لأن الخادم حزمة مبنية في `out\`.

## 5) (اختياري) أضف الأدوات إلى جدول `src/utils/skillsGenerator.ts` قرب السطر 239

```
| `flutter_edit_file` | Exact-string replace in a project text file; must match one place unless `replaceAll`; `dryRun`, `expectedCount`. |
| `flutter_replace_lines` | Replace/insert/delete an inclusive 1-based line range; `expectedOldText` guards stale line numbers. |
| `flutter_write_file` | Create a new text file (or `overwrite: true`); parent folders are created. |
```

## ملاحظات الأمان

- كل مسار محصور داخل جذر المشروع النشط (بعد حل الـ symlinks)، و`.git` و`node_modules` و`.dart_tool` و`.flutter-explorer` ممنوعة.
- ملفات UTF‑8 النصية فقط حتى 2 ميجابايت؛ الثنائية وUTF‑16 والترميزات القديمة تُرفض بدل أن تتلف.
- يُحفظ BOM ونهايات الأسطر (CRLF/LF)، ولا يتغير أي بايت خارج الجزء المعدَّل.
- نسخة احتياطية قبل كل تعديل في `%USERPROFILE%\.flutter-explorer\backups` (آخر 10 لكل ملف).
- لتعطيل الكتابة كليًا: عرّف المتغير `FLUTTER_EXPLORER_READONLY=1` في بيئة خادم MCP.
