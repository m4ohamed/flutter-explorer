// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║               PATCHES — Flutter Explorer: mcp-server.ts                      ║
// ║  الجزء الأول: التغييرات المُتفق عليها (BM25 + resolveImportPath)             ║
// ║  الجزء الثاني: إصلاح المشاكل الحرجة من تقرير المراجعة                       ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 1 — استبدل السطرين 192-193 بهذا الكود
//           (تغيير lastIndexTimestamp → lastIndexSignature + إضافة getIndexSignature)
// ═══════════════════════════════════════════════════════════════════════════════

let cachedBM25: BM25Search | null = null;
let lastIndexSignature = '';

function getIndexSignature(index: any): string {
  let fileCount = 0;
  let hashAcc = '';
  for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
    fileCount++;
    // contentHash يتغير عند تعديل المحتوى حتى لو نفس عدد الملفات
    hashAcc += info.contentHash ?? String(info.lastModified ?? 0) + filePath;
  }
  for (const filePath of Object.keys(index.arb as Record<string, any>)) {
    fileCount++;
    hashAcc += filePath;
  }
  // آخر 64 حرف كـ fingerprint — كافٍ ولا overhead
  return `${fileCount}:${hashAcc.length}:${hashAcc.slice(-64)}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 2 — استبدل دالة getBM25Search (السطور 298-306)
// ═══════════════════════════════════════════════════════════════════════════════

async function getBM25Search(index: any): Promise<BM25Search> {
  const currentSignature = getIndexSignature(index);
  if (!cachedBM25 || lastIndexSignature !== currentSignature) {
    console.error('[MCP] Rebuilding BM25 Search Index for MCP...');
    cachedBM25 = buildMcpBM25(index);
    lastIndexSignature = currentSignature;
  }
  return cachedBM25;
}


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 3 — احذف الدالة المحلية في معالج flutter_get_dependencies (السطور 1524-1533)
// ═══════════════════════════════════════════════════════════════════════════════

/*  ← DELETE THIS ENTIRE BLOCK (10 lines) ↓
      const resolveImportPath = (fromFile: string, importPath: string, projName: string | null): string => {
        if (importPath.startsWith('package:')) {
          if (projName && importPath.startsWith(`package:${projName}/`)) {
            return 'lib/' + importPath.substring(`package:${projName}/`.length);
          }
          return importPath;
        }
        const dir = path.dirname(fromFile);
        return path.posix.normalize(path.posix.join(dir.replace(/\\/g, '/'), importPath));
      };
    DELETE THIS ENTIRE BLOCK ↑ →
*/


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 4 — السطر 1577: غيّر ترتيب معاملات الاستدعاء
// ═══════════════════════════════════════════════════════════════════════════════

// قبل:
// const resolvedPath = resolveImportPath(targetFile, imp.path, projectName);

// بعد:
// const resolvedPath = resolveImportPath(imp.path, targetFile, index);


// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║              إصلاح المشاكل الحرجة — من تقرير المراجعة                        ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 5 — [extension.ts السطور 300-315] double fileWatcher.start()
//
// المشكلة: في الـ else branch، fileWatcher.start() تُنادى داخل withProgress
//          ثم قد تُنادى مرة ثانية لو الـ callback انتهى بشكل غير متوقع.
//
// قبل (extension.ts):
// ─────────────────────────────────────────────────────────────────────────────
//   } else {
//     context.subscriptions.push(fileWatcher);
//     vscode.window.withProgress(
//       { location: ..., title: 'Building initial index...', cancellable: false },
//       async (progress) => {
//         await indexManager.buildFullIndex(progress);
//         updateStatusBar(indexManager);
//         fileWatcher.start();              // ← مرة داخل الـ callback
//       },
//     );
//   }
// ─────────────────────────────────────────────────────────────────────────────
//
// بعد (extension.ts):
// ═══════════════════════════════════════════════════════════════════════════════

/*
  } else {
    context.subscriptions.push(fileWatcher);
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification,
        title: 'Flutter Explorer: Building initial index...',
        cancellable: false },
      async (progress) => {
        await indexManager.buildFullIndex(progress);
        updateStatusBar(indexManager);
        // ✅ start() تُنادى هنا فقط — داخل الـ callback بعد اكتمال الـ index
      },
    ).then(() => {
      // ✅ withProgress يُرجع Thenable — نضمن start() بعد اكتمال الـ Promise
      fileWatcher.start();
    });
  }
*/


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 6 — [extension.ts السطر ~320] setupMcpConfig بدون await
//
// قبل:
//   setupMcpConfig(context.extensionPath, workspaceRoot);
//
// بعد:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  setupMcpConfig(context.extensionPath, workspaceRoot).catch(err => {
    console.error('[FlutterExplorer] MCP setup failed:', err);
  });
*/


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 7 — [sqliteCache.ts السطر ~107] console.log → console.error في close()
//
// المشكلة: MCP server يعمل على stdio — أي console.log يكتب للـ stdout
//          ويُفسَّر كـ JSON message ويكسر البروتوكول.
//
// قبل (sqliteCache.ts):
//   this.db.close((err) => {
//     if (err) console.error('[FlutterExplorer] Error closing SQLite:', err);
//     else console.log('[FlutterExplorer] SQLite database connection closed cleanly.');
//     ────────────────────────────────────── ↑ console.LOG يكسر MCP stdio
//   });
//
// بعد:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  this.db.close((err) => {
    if (err) console.error('[FlutterExplorer] Error closing SQLite database:', err);
    else     console.error('[FlutterExplorer] SQLite database connection closed cleanly.');
    // ✅ console.ERROR → يكتب لـ stderr فقط، لا يلوّث MCP stdout
  });
*/


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 8 — [sqliteCache.ts السطور 415-440] getNodeAtCursor: offsets ثابتة
//
// المشكلة: cls.line + 50 و method.line + 20 fallback — method أطول من 20 سطر
//          تُفوَّت تماماً.
//
// قبل:
//   checkCandidate(cls.line,    cls.lineEnd    ?? (cls.line + 50),    { type: 'class', ... });
//   checkCandidate(method.line, method.lineEnd ?? (method.line + 20), { type: 'method', ... });
//
// بعد:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  // Classes
  for (const cls of fileInfo.info.classes) {
    checkCandidate(
      cls.line,
      cls.lineEnd ?? (cls.line + 100),   // ✅ 100 بدل 50 — أكثر أماناً للـ classes الكبيرة
      { type: 'class', name: cls.name }
    );
    if (cls.methods) {
      for (const method of cls.methods) {
        checkCandidate(
          method.line,
          method.lineEnd ?? (method.line + 80),  // ✅ 80 بدل 20 — يغطي methods المتوسطة
          { type: 'method', name: method.name, parentClass: cls.name }
        );
      }
    }
  }
  // نفس التغيير لـ Extensions وExtensionTypes
*/


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 9 — [indexManager.ts السطر ~870] buildReverseDependencies بدون _disposed guard
//
// المشكلة: لو dispose() اتنادى أثناء العملية، الكود يكمل ويكتب للـ SQLite بعد close.
//
// قبل (indexManager.ts):
//   public async buildReverseDependencies(): Promise<void> {
//     for (const [filePath, info] of this.index.entries()) { ... }
//     const filesToUpdate = ...;
//     await this.sqliteCache.batchUpsertDartFiles(filesToUpdate);  // ← crash بعد dispose
//     this.sqliteCache.checkpoint();
//   }
//
// بعد:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  public async buildReverseDependencies(): Promise<void> {
    if (this._disposed) return;  // ✅ guard أول الدالة

    for (const [filePath, info] of this.index.entries()) {
      if (this._disposed) return;  // ✅ guard داخل الـ loop
      for (const imp of info.imports) {
        // ... existing logic ...
      }
    }

    if (this._disposed) return;  // ✅ guard قبل الـ await

    const filesToUpdate = Array.from(this.index.entries()).map(([relPath, info]) => ({
      relPath, hash: info.contentHash, info
    }));
    await this.sqliteCache.batchUpsertDartFiles(filesToUpdate);

    if (this._disposed) return;  // ✅ guard بعد كل await

    this.sqliteCache.checkpoint();
  }
*/


// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║              تحسينات مهمة — من تقرير المراجعة                                ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝


// ═══════════════════════════════════════════════════════════════════════════════
// IMPROVEMENT 1 — [skillsGenerator.ts السطر 720] حذف username غير المُستخدم
//
// قبل:
//   const username = os.userInfo().username;  // ← تُحسب ولا تُستخدم
//   const homedir  = os.homedir();
//
// بعد:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  // ✅ احذف السطر التالي كاملاً:
  // const username = os.userInfo().username;

  const homedir = os.homedir();
*/


// ═══════════════════════════════════════════════════════════════════════════════
// IMPROVEMENT 2 — [fileWatcher.ts] إضافة onDidDelete لـ pubspecWatcher
//
// المشكلة: لو pubspec.yaml اتحذف أو المشروع نُقل، الـ index يفضل قديم.
//
// قبل:
//   pubspecWatcher.onDidChange(() => this.indexManager['onIndexChanged'].fire());
//   pubspecWatcher.onDidCreate(() => this.indexManager['onIndexChanged'].fire());
//
// بعد:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  pubspecWatcher.onDidChange(() => this.indexManager['onIndexChanged'].fire());
  pubspecWatcher.onDidCreate(() => this.indexManager['onIndexChanged'].fire());
  pubspecWatcher.onDidDelete(() => this.indexManager['onIndexChanged'].fire()); // ✅ جديد
*/


// ═══════════════════════════════════════════════════════════════════════════════
// IMPROVEMENT 3 — [buildFullIndex] إضافة cancellation check قبل batchUpsert
//
// المشكلة: لو isCancellationRequested أثناء batchUpsertDartFiles،
//          الـ transaction تكتمل ببيانات ناقصة.
//
// قبل (indexManager.ts):
//   if (dartFilesToUpsert.length > 0) {
//     await this.sqliteCache.batchUpsertDartFiles(dartFilesToUpsert);
//   }
//
// بعد:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  if (token.isCancellationRequested) return;  // ✅ تحقق قبل الكتابة

  if (dartFilesToUpsert.length > 0) {
    await this.sqliteCache.batchUpsertDartFiles(dartFilesToUpsert);
  }
*/


// ═══════════════════════════════════════════════════════════════════════════════
// IMPROVEMENT 4 — [skillsGenerator.ts] try/catch لكل writeFileSync في الـ loop
//
// المشكلة: فشل ملف واحد يوقف توليد باقي الـ skills.
//
// قبل:
//   for (const [id, skill] of Object.entries(SKILLS)) {
//     fs.writeFileSync(path.join(genericSkillSubdir, 'SKILL.md'), standardContent, 'utf8');
//     fs.writeFileSync(path.join(cursorRulesDir, `${id}.mdc`), cursorContent, 'utf8');
//     fs.writeFileSync(path.join(clineDocsDir,   `${id}.md`),  clineContent,  'utf8');
//     fs.writeFileSync(path.join(agSkillSubdir,  'SKILL.md'),  standardContent,'utf8');
//   }
//
// بعد:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  for (const [id, skill] of Object.entries(SKILLS)) {
    try {
      fs.writeFileSync(path.join(genericSkillSubdir, 'SKILL.md'), standardContent, 'utf8');
    } catch (e) { console.error(`[Skills] Failed to write generic skill ${id}:`, e); }

    try {
      fs.writeFileSync(path.join(cursorRulesDir, `${id}.mdc`), cursorContent, 'utf8');
    } catch (e) { console.error(`[Skills] Failed to write cursor skill ${id}:`, e); }

    try {
      fs.writeFileSync(path.join(clineDocsDir, `${id}.md`), clineContent, 'utf8');
    } catch (e) { console.error(`[Skills] Failed to write cline skill ${id}:`, e); }

    try {
      fs.writeFileSync(path.join(agSkillSubdir, 'SKILL.md'), standardContent, 'utf8');
    } catch (e) { console.error(`[Skills] Failed to write antigravity skill ${id}:`, e); }
  }
*/
