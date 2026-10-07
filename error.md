# الأخطاء المتوقعة وإصلاحاتها (Error Log & Fixes)

سجل الأخطاء المتوقعة أثناء تحويل مكتبة SQLite من `node-sqlite3-wasm` إلى `sqlite3` وكيفية تجنبها/إصلاحها:

## 1. مشكلة عدم التوافق بين العمليات غير المتزامنة (Asynchronous API Mismatch)
- **الخطأ المتوقع:** مكتبة `sqlite3` تعتمد بشكل كامل على الـ Callbacks والعمليات غير المتزامنة (Asynchronous)، بينما كانت `node-sqlite3-wasm` تعمل بشكل متزامن (Synchronous). استدعاء الدوال القديمة مباشرة سيؤدي إلى إرجاع `undefined` أو حدوث استثناءات أثناء التنفيذ.
- **الإصلاح (Fix):** تغليف جميع استعلامات `sqlite3` (`db.run`, `db.get`, `db.all`) باستخدام `Promise` في ملف `sqliteCache.ts`، وتحويل الدوال لتكون `async` وترجع `Promise`. تعديل الاستدعاءات في `indexManager.ts` و `mcp-server.ts` لاستخدام `await`.

## 2. مشكلة قفل قاعدة البيانات أثناء الـ Transactions في وضع الـ Batch
- **الخطأ المتوقع:** حدوث `SQLITE_BUSY: database is locked` عند تنفيذ عمليات الإدراج المجمعة (`batchUpsertDartFiles`) إذا تم إرسال الأوامر دون تسلسل واضح أو محاولة عمل Commit قبل انتهاء الـ Statements.
- **الإصلاح (Fix):** استخدام `db.serialize()` لضمان تنفيذ أوامر `BEGIN TRANSACTION` و `INSERT` و `COMMIT` بالتسلسل الصحيح، وتغليف العملية بالكامل داخل `Promise` يكتمل عند نجاح الـ Commit.

## 3. مشكلة غياب أنواع TypeScript لمكتبة sqlite3 (Missing TypeScript Definitions)
- **الخطأ المتوقع:** ظهور خطأ من مترجم TypeScript (`tsc`) يفيد بعدم العثور على ملف تعريف الأنواع `Could not find a declaration file for module 'sqlite3'`.
- **الإصلاح (Fix):** تثبيت الحزمة `@types/sqlite3` كاعتمادية تطوير (devDependency) أو استيراد المكتبة بالطريقة المتوافقة مع إعدادات `tsconfig.json`.

## 4. مشكلة الـ Guard ضد الإغلاق المزدوج (Double Close Memory Leaks / Errors)
- **الخطأ المتوقع:** استدعاء `db.close()` أكثر من مرة قد يؤدي إلى خطأ أو تسريب في الذاكرة.
- **الإصلاح (Fix):** التحقق من وجود `this.db` أولاً، وتصفيره (`this.db = null`) فور استدعاء الإغلاق.

## 5. مشكلة استدعاء دوال SQLite غير المتزامنة بشكل متزامن (Un-awaited Async Method Calls / TS2339)
- **الخطأ المتوقع:** ظهور خطأ في TypeScript مثل `Property 'hash' does not exist on type 'Promise<{ hash: string; info: DartFileInfo; } | null>'` عند محاولة قراءة خصائص من دالة غير متزامنة دون استخدام `await`، بالإضافة إلى احتمالية تداخل المعاملات (Transactions) في SQLite إذا تم استدعاء `batchUpsertDartFiles` أو `clearAll` دون انتظار اكتمالها.
- **الإصلاح (Fix):** إضافة `await` قبل جميع استدعاءات دوال `sqliteCache` غير المتزامنة في `indexManager.ts` لضمان تسلسل العمليات وتجنب أخطاء التجميع والتشغيل.

## 6. مشكلة استعلامات SQLite قبل إنشاء الجداول (Race Condition in Table Creation / SQLITE_ERROR: no such table: metadata)
- **الخطأ المتوقع:** ظهور خطأ `SQLITE_ERROR: no such table: metadata` عند بدء تشغيل الإضافة. يحدث هذا لأن `this.available` يتم تعيينها إلى `true` فوراً في الـ `constructor`، فيقوم `IndexManager` باستدعاء `setMeta` وإرسال استعلام `INSERT INTO metadata` إلى قائمة انتظار `sqlite3`. ولكن دالة `_createTables()` كانت تُستدعى داخل الـ callback الخاص بفتح قاعدة البيانات `new sqlite3.Database`، مما يجعل استعلام `CREATE TABLE` يُدرج في قائمة الانتظار بعد استعلام `INSERT`.
- **الإصلاح (Fix):** استدعاء `this.db.serialize()` فور إنشاء الكائن `new sqlite3.Database` لجعل وضع التسلسل دائماً (Permanent Serialized Mode)، ونقل أوامر `PRAGMA` واستدعاء `this._createTables()` لتكون خارج الـ open callback ومباشرة في الـ constructor. هذا يضمن إدراج أوامر إنشاء الجداول في قائمة انتظار `sqlite3` كأول أوامر تتنفذ قبل أي استعلام قادم من الإضافة.

## 7. مشكلة غياب الحزم الخارجية (External Native Modules) عند حزم الإضافة (vsce package / Cannot find module 'sqlite3')
- **الخطأ المتوقع:** عند تشغيل أمر `vsce package` لإنشاء ملف `.vsix`، يتم حزم الإضافة بنجاح ولكن عند تثبيتها في VS Code يظهر خطأ تشغيل `Error: Cannot find module 'sqlite3'`. يحدث هذا لأن إعدادات `esbuild.js` تعين `sqlite3` كـ `external` (لأنها حزمة أصلية Native لا يمكن دمجها في ملف JS واحد)، بينما ملف `.vscodeignore` كان يتجاهل مجلد `node_modules/**` بالكامل، مما أدى إلى استبعاد حزمة `sqlite3` واعتماديّاتها من ملف الـ VSIX النهائي.
- **الإصلاح (Fix):** إزالة تجاهل `node_modules/**` من ملف `.vscodeignore`. أداة `vsce` تمتلك آلية ذكية مدمجة تقوم تلقائياً بقراءة `package.json` وتضمين حزم الـ `dependencies` الإنتاجية فقط (مثل `sqlite3` واعتمادياتها) واستبعاد كافة حزم التطوير `devDependencies` تلقائياً، مما يضمن وجود الحزم الخارجية المطلوبة عند التشغيل مع الحفاظ على حجم الإضافة صغيراً ومثاليّاً.

## 8. مشكلة تراجع كفاءة البحث في MCP Server بسبب غياب ترتيب النتائج (Unsorted/Plain Search Results)
- **الخطأ المتوقع:** في المشاريع الكبيرة (مثل Sadara)، قد يحتوي البحث عن عنصر مثل "Auth" على عشرات أو مئات النتائج غير المرتبة بأي معيار للأهمية، مما يربك العميل (AI agent) ويجعله يستغرق وقتاً طويلاً في قراءة نتائج غير ذات صلة.
- **الإصلاح (Fix):** استيراد محرك `BM25Search` في `mcp-server.ts` وبناء الفهرس في الخلفية عند تحميل الفهرس الرئيسي، وتطبيقه على نتائج `flutter_search` لفرزها وعرض الأكثر صلةً في البداية.

## 9. مشكلة تشغيل أدوات الطرفية بشكل متزامن أو بدون حماية (Command Execution & Process Locks in MCP Tools)
- **الخطأ المتوقع:** عند إطلاق أدوات مثل `flutter analyze` أو `build_runner` عبر خادم MCP، قد يؤدي استدعاءها المتكرر بالتزامن إلى قفل العمليات أو استهلاك موارد المعالج والذاكرة بالكامل، أو قد تتجمد العملية إذا لم يتم وضع حد أقصى للوقت (Timeout).
- **الإصلاح (Fix):** وضع حماية (Process Guard) لمنع تشغيل أكثر من عملية `build_runner` في نفس الوقت، وتحديد مهلة زمنية (Timeout) لكل عملية لضمان عدم تجمد خادم MCP واستجابته دائماً للطلبات.

## 10. مشكلة عدم العثور على المسار الصحيح للمشروع (Invalid Project Root PATH)
- **الخطأ المتوقع:** تعثر تشغيل أوامر `flutter analyze` أو `build_runner` بسبب تشغيلها في مسار خاطئ إذا لم يقم العميل بتعيين مسار المشروع باستخدام `flutter_set_project_path` قبلها.
- **الإصلاح (Fix):** التحقق دائماً من وجود ملف `pubspec.yaml` في المسار الحالي قبل تشغيل أي أمر خارجي، وإظهار رسالة خطأ واضحة ترشد العميل لاستخدام `flutter_set_project_path` لتعيين المسار الصحيح.

## 11. مشكلة تجاهل مسارات package:projectName/ في تتبع الاعتماديات العكسية (Skipping Local Package Imports in Reverse Dependencies)
- **الخطأ المتوقع:** في المشاريع الكبيرة التي تستخدم استيرادات الحزم الكاملة مثل `import 'package:projectName/core/notifier.dart';` بدلاً من المسارات النسبية، لا يتم تسجيل أي اعتماديات عكسية للكلاسات أو الدوال. يحدث هذا بسبب شرط الاستبعاد `if (!imp.path.startsWith('package:') && !imp.path.startsWith('dart:'))` في دالة `buildReverseDependencies` بملف `indexManager.ts`، مما يمنع تمرير هذه الاستيرادات إلى `resolveImportPath` التي بدورها تدعم وتترجم هذه المسارات بشكل صحيح إلى `lib/core/notifier.dart`.
- **الإصلاح (Fix):** إزالة شرط استبعاد `package:` والسماح بتمرير جميع الاستيرادات عدا `dart:` إلى `resolveImportPath`. إذا كان الاستيراد خاص بحزمة خارجية، ستعيده الدالة كما هو، ولن يجده الفهرس `this.index.get(...)` مما يمنع حدوث أي أخطاء، بينما سيتم استنباط وحل المسارات المحلية بنجاح وتسجيل الاعتماديات العكسية لها.

## 12. تضييق نطاق استخراج اعتماديات المشيد في تحليل الأكواد (Overly Restrictive Suffixes for Constructor Dependencies)
- **الخطأ المتوقع:** دالة `extractConstructorDependencies` في `mcp-code-analyzer.ts` تقتصر فقط على الكلاسات التي تنتهي بـ `Repository`, `Service`, `Provider`, أو `UseCase`. هذا يؤدي إلى إهمال وحذف الاعتماديات الأساسية الأخرى مثل `Source`, `Helper`, `Client`, `Api`, `Gateway`, `Bloc`, `Notifier`, `Controller` وغيرها.
- **الإصلاح (Fix):** تعميم محلل الاعتماديات بحيث يقبل جميع الأنواع المعرفة بواسطة كلاسات (التي تبدأ بحرف كبير وتتكون من أحرف وأرقام)، مع استبعاد الأنواع البدائية الخاصة بلغة Dart (مثل `String`, `int`, `double`, `bool`, `num`, `dynamic`, `void`, `List`, `Map`, `Set`, `DateTime`, `Duration`, `Widget`, `BuildContext`, `Key`, `Function`, `Future`, `Stream`).

## 13. قصور أداة البحث عن المراجع `flutter_find_references` في العثور على استخدامات الكلاسات كأنواع أو tear-offs
- **الخطأ المتوقع:** دالة البحث عن المراجع تعتمد فقط على الـ `classUsages` المستخرجة من الاستيرادات، وتفشل في العثور على أسطر الاستدعاء الدقيقة (مثل الإشارات كأنواع `final AuthNotifier notifier = ...` أو المشيدات بدون استدعاء مباشر `AuthNotifier.new` أو المعاملات الجينيريك `Provider<AuthNotifier>`).
- **الإصلاح (Fix):** تحسين خوارزمية `flutter_find_references` للقيام بفحص إضافي باستخدام تعبيرات نمطية دقيقة بحدود الكلمات `\bName\b` في محتوى الملفات التي تستورد الملف المعرّف للكلاس، لاستخراج أرقام الأسطر وسياق الاستخدام بدقة متناهية.

## 14. مشكلة عدم فتح صفحة التعليمات تلقائياً عند التثبيت أو التحديث الأول للإضافة (Not showing README-FlutterExplorer.md on install/update)
- **الخطأ المتوقع:** يثبت المستخدم الإضافة ولكنه قد لا يعلم كيفية البدء أو تشغيل خادم MCP. إذا لم يتم فتح ملف التعليمات تلقائياً، فقد يواجه صعوبة في استخدام الأدوات.
- **الإصلاح (Fix):** إضافة فحص في دالة التفعيل `activate()` في `src/extension.ts` بالاستعانة بـ `context.globalState`. إذا كان الإصدار الحالي يُشغل للمرة الأولى، يتم تشغيل أمر `markdown.showPreview` لفتح ملف `README-FlutterExplorer.md` بصيغة المعاينة تلقائياً. كما يجب استثناء الملف في `.vscodeignore` عبر إضافة `!README-FlutterExplorer.md` لضمان حزمه ضمن ملف الـ VSIX النهائي.
## 15. أداة `flutter_find_references` تُعيد صفراً عند البحث عن رموز تُستخدم عبر ملفات وسيطة (Zero Results via Re-exports)
- **الخطأ المتوقع:** استدعاء `flutter_find_references` على كلاس مثل `AuthNotifier` أو متغير مثل `authNotifierProvider` يُعيد `referencesCount: 0` حتى وإن كانت هناك 15+ استخداماً حقيقياً. يحدث هذا لأن الخوارزمية القديمة تعتمد فقط على `usedInFiles` المستخرجة من قائمة الاستيرادات المباشرة، بينما الملفات الفعلية تستورد الرمز عبر ملف وسيط (مثل `providers.dart`) لا مباشرةً من الملف المعرِّف له.
- **الإصلاح (Fix):** إعادة تصميم الخوارزمية بـ 3 مراحل:
  1. **Phase 1 (Index-based):** البحث في `functionCalls` و `classUsages` في الفهرس كما كان.
  2. **Phase 2 (Targeted scan):** مسح ملفات `usedInFiles` بـ Regex `\bName\b` مع تجاهل أسطر `import`/`export`.
  3. **Phase 3 (Full project scan):** إذا لم تُعطِ المرحلتان السابقتان أي نتائج، يُمسح جميع ملفات المشروع المفهرسة بنفس الـ Regex. النتائج مُرتَّبة حسب الملف والسطر، وسياق الأسطر مقطوعاً عند 200 حرف لمنع الاستجابات الضخمة.

## 16. مشكلة بطء أو فشل الاتصالات للـ dual-stack hosts (IPv4/IPv6) عند تفعيل autoSelectFamily افتراضياً
- **الخطأ المتوقع:** في بيئات معينة، يؤدي تفعيل `autoSelectFamily` تلقائياً في Node.js إلى محاولات اتصال متكررة تستغرق وقتاً طويلاً قبل الفشل أو الانتقال إلى IP البديل، خاصة إذا كان مهلة المحاولة (attempt timeout) قصيرة جداً أو طويلة جداً.
- **الإصلاح (Fix):** استدعاء `net.setDefaultAutoSelectFamilyAttemptTimeout(1000)` عند بدء تشغيل الإضافة (في دالة `activate()`) لضبط المهلة الزمنية الافتراضية لكل محاولة اتصال إلى 1000ms، مع التأكد من وجود الدالة قبل استدعائها لمنع الأخطاء في إصدارات Node القديمة.

## 17. عدم تحديث تحذيرات Hardcoded Text & Colors والترجمات تلقائياً وغياب زر التحديث في صفحة التحليل
- **الخطأ المتوقع:** التحذيرات الخاصة بالنصوص والألوان المكتوبة يدوياً (Hardcoded) والترجمات المفقودة لا تتحدث تلقائياً في صفحة التحليل (Analysis) عند إعادة الفهرسة أو عند تعديل الملفات وحفظها. كما أن زر التحديث (Refresh) غير موجود في واجهة التحليل (HTML) بالرغم من محاولة الكود البرمجي في `sidebar.js` الارتباط به.
- **الإصلاح (Fix):**
  1. إضافة ترويسة تبويب التحليل (Analysis Header) مع زر التحديث `refreshAnalysis` في ملف `sidebarProvider.ts` ليتطابق مع باقي التبويبات.
  2. تحديث مستمع حدث تغيير الفهرس `onDidChangeIndex` في `extension.ts` ليرسل بيانات التحليل المحدثة `analysisData` تلقائياً إلى واجهة الويب الجانبية (Webview) عند حدوث أي تغيير في الفهرس (سواء فهرسة كاملة أو جزئية).

## 18. عدم ظهور أو تحديث تحذيرات Hardcoded Text & Colors عند الفهرسة الكاملة (بسبب استخدام Dart SDK Analyzer) والاعتماديات في الرسم البياني
- **الخطأ المتوقع:** عند تفعيل Dart SDK Analyzer في الفهرسة الكاملة (`useDartAnalyzer = true`)، لا تُستخرج التحذيرات (Warnings) الخاصة بالنصوص والألوان المكتوبة يدوياً لأن محلل Dart SDK لا يبحث عنها في ملفاته، فتصبح التحذيرات فارغة في الفهرس وتفشل صفحة التحليل في عرضها حتى بعد الضغط على تحديث. كما أن واجهة الرسم البياني التفاعلي للملفات (`GraphWebviewPanel`) لا تقوم بتحديث بياناتها تلقائياً عند تعديل الفهرس أو إعادة الفهرسة.
- **الإصلاح (Fix):**
  1. تعديل مرحلة ما بعد المعالجة (Post-processing) لنتائج محلل Dart SDK في دالة `buildFullIndex` بملف `src/indexer/indexManager.ts` لاستخراج التحذيرات باستخدام الـ `DartParser` ودمجها مع مخرجات المحلل.
  2. إضافة مستمع لحدث تغيير الفهرس `indexManager.onDidChangeIndex` داخل `GraphWebviewPanel` بملف `src/views/graphWebview.ts` لإرسال البيانات المحدثة تلقائياً إلى صفحة الرسم البياني للحفاظ على مزامنتها في الوقت الفعلي.

## 19. عدم مطابقة تحذيرات النصوص المكتوبة يدوياً (Hardcoded Text) بسبب طمس النصوص في `preprocessSource`
- **الخطأ المتوقع:** تفشل دالة `parse()` في استخراج أي تحذيرات خاصة بالنصوص المكتوبة يدوياً (`hardcoded_text`) لأن فحص النمط `P.hardText` يتم تشغيله على الأسطر المطموسة (`maskedLine`) التي تم استبدال جميع علامات الاقتباس ومحتوياتها بمسافات خالية بواسطة `preprocessSource`، مما يجعل المطابقة ترجع `null` دائماً.
- **الإصلاح (Fix):** مطابقة النمط `P.hardText` على السطر الأصلي (`line`) بدلاً من `maskedLine`، ثم التحقق من أن موضع المطابقة في السطر لا يقع ضمن تعليق أو نص عن طريق فحص نفس المؤشر في `maskedLine` والتأكد من أنه ليس مسافة خالية (أو يطابق حرف `'T'`).

## 20. مشكلة عدم مطابقة العلاقات وتحديد المعرفات بشكل خاطئ في الرسم البياني لخادم MCP (Inconsistent Node IDs & Broken Call Edges in MCP Graph)
- **الخطأ المتوقع:** في خادم MCP (`mcp-server.ts`)، كانت دالة `buildDetailedGraph` تستخدم معرفات عقد (Node IDs) معتمدة على مسارات الملفات بشكل مباشر (مثل `${filePath}:${className}`)، وتفشل في ربط علاقات استدعاءات المشيدات والدوال الخارجية بشكل صحيح حيث كانت العلاقات تُربط باسم الدالة المجرد كمعرف هدف (مثل `source: callerId, target: call.name`) وهو معرف غير موجود كعقدة، مما يؤدي إلى رسم بياني تالف وغير مترابط عند الاستعلام عبر MCP.
- **الإصلاح (Fix):** تحديث دالة `buildDetailedGraph(index)` في `mcp-server.ts` لتعمل بنفس المنطق المتقدم والدقيق الموجود في `IndexManager.getDetailedGraph()` بملف `indexManager.ts`:
  1. بناء فهارس وراثة واستدعاءات سريعة لجميع الفئات والميثودات والـ Mixins والـ Enums على مستوى المشروع بالكامل.
  2. استخدام معرفات عقد عالمية مبسطة (Global Node IDs) مثل `class:${className}` و `method:${className}.${methodName}` لضمان ربط أي استدعاء أو استخدام للمشيد مباشرة بالعقدة الصحيحة.
  3. تنسيق النتائج بصيغة العقد (`id`, `name`, `type`, `file`, `line`) والروابط (`source`, `target`, `type`) لتتوافق بالكامل مع متطلبات خادم MCP.

## 21. مشكلة تباين معرفات ومفاتيح العقد والروابط بين indexManager و mcp-server وعدم توافق الرسم البياني التفاعلي
- **الخطأ المتوقع:** حدوث أخطاء تجميع تيب سكريبت (TypeScript compile errors) عند تعديل المعرفات والخصائص (مثل `label` إلى `name` و `path` إلى `file` و `from`/`to` إلى `source`/`target`) بسبب عدم توافق الأكواد في `graphWebview.ts` و `graph.ts`. وأيضاً عدم ظهور العلاقات الجديدة (`implements`, `uses_class`, `uses_variable`) في واجهة الرسم البياني لعدم تعريفها في مصفوفات الفلترة وواجهة المستخدم.
- **الإصلاح (Fix):**
  1. تحديث `getDetailedGraph` في `indexManager.ts` لترجع الهياكل بالصيغة الموحدة تماماً.
  2. تحديث `sendGraphData` في `graphWebview.ts` لاستخدام الحقول الجديدة (`name`, `file`, `source`, `target`).
  3. تعريف وتجهيز عناصر التحكم (Checkboxes) لجميع العلاقات والأنواع الجديدة في كل من ملفات الواجهة والـ D3 script.

## 22. مشاكل ترقية ومطابقة محلل JS/TS لتجنب أخطاء تجميع أو تفاوت هياكل البيانات (Upgrading and Aligning JS/TS Parser)
- **الخطأ المتوقع:** حدوث أخطاء تجميع TypeScript أو عدم توافق بين المخرجات عند استدعاء المحلل للغات JS/TS مقارنة بـ Dart. حيث يعتمد التكامل في `indexManager.ts` على هيكل بيانات `DartFileInfo` الموحد. غياب بعض الحقول مثل `classUsages`, `functionUsages`, `extensions` إلخ من المخرجات قد يؤدي لكسر التكامل أو فشل البناء أو حدوث استثناءات عند التشغيل. بالإضافة إلى إمكانية حدوث أخطاء ReDoS بسبب استخدام تعبيرات نمطية معقدة.
- **الإصلاح (Fix):**
  1. استيراد وتطبيق كافة الواجهات (Interfaces) الخاصة بـ `DartFileInfo` و `PropertyInfo` و `WidgetInfo` وغيرها مباشرة من `dartParser.ts` لضمان المطابقة الكاملة للأنواع.
  2. تمثيل الـ Interfaces في TS كـ `mixins` والـ Types كـ `typedefs` لملء الفئات المناسبة وتوفير بيانات كاملة للرسم البياني والتصفية.
  3. حماية تعبيرات التحليل من الـ ReDoS باستخدام تتبع النطاقات الديناميكي `ScopeFrame` و `syncBraces` والتعبيرات النمطية الخطية.
  4. التحقق من سلامة البناء وتوافقه بنسبة 100% بتشغيل `npx tsc --noEmit`.

## 23. مشكلة فهرسة ملفات `node_modules` بالكامل (Indexing node_modules — 8547+ files)
- **الخطأ المتوقع:** عند تشغيل المفهرس على مشروع TS/JS، يكتشف المحلل أكثر من 8000 ملف ويقوم بفهرسة محتويات مجلد `node_modules` بالكامل بما في ذلك ملفات `.d.ts` و `.js` الخارجية. يحدث هذا بسبب خطأ في صيغة `excludePattern` المُمررة لـ `vscode.workspace.findFiles` — حيث كانت الأنماط مفصولة بفاصلة كنص واحد (`'**/node_modules/**,**/out/**,...'`) بينما تطلب الـ API استخدام صيغة الأقواس المعقوصة `{pattern1,pattern2}` لمطابقة متعددة. كما أن `FileWatcher` لم يكن يستبعد `node_modules` من التغييرات المراقبة.
- **الإصلاح (Fix):**
  1. تصحيح صيغة `excludePattern` في `indexManager.ts` لتصبح `'**/{node_modules,out,dist,build,.git,.next}/**'`.
  2. إضافة حارس استبعاد (regex guard) في `fileWatcher.ts` لتجاهل أحداث الملفات التي تقع في `node_modules`, `out`, `dist`, `build`, `.git`, `.next` قبل إرسالها لعملية التحديث أو الحذف.

## 24. مشكلة انتهاء مهلة فحص مشروع Flutter بـ Timeout في أداة `flutter_run_analyze`
- **الخطأ (The Bug):** أداة `flutter_run_analyze` ترجع `exitCode: -1` و `success: true` مع مصفوفة تحذيرات فارغة `diagnostics: []` ولا تظهر أي نتائج بالرغم من وجود تحذيرات حقيقية في الكود، مع بقاء المخرجات كـ `"Analyzing stitch_app..."`.
- **السبب الجذري (Root Cause):** تحديد مهلة زمنية قصيرة (60 ثانية) لتشغيل `flutter analyze`. على الأجهزة ذات المواصفات العادية أو مع المشاريع الكبيرة، يستغرق المحلل أكثر من 60 ثانية مما يسبب تفعيل الـ Timeout وقتل العملية قسريًا. ولأن المخرجات تنقطع قبل طباعة التحذيرات، يظهر `diagnostics` فارغًا ويتم تقييم `success` بشكل خاطئ كـ `true` لأن عدد الأخطاء المكتشفة صفر.
- **الحل الفعلي (The Fix):** زيادة مهلة الـ Timeout إلى 5 دقائق (300 ثانية) لتوفير الوقت الكافي للتحليل للمشاريع الكبيرة دون التسبب في انتظار إضافي عند الانتهاء المبكر، وتحديث شرط الـ `success` ليعتمد على أن كود الخروج ليس `-1` (أي لم يحدث Timeout) بالإضافة لعدم وجود أخطاء.

## 25. مشكلة تكرار تسجيل أداة `flutter_rebuild_index` في خادم MCP (Duplicate Tool Registration Error in MCP Server)
- **الخطأ (The Bug):** عند محاولة تشغيل خادم MCP باستخدام Node، يفشل ويخرج بكود الخطأ 1 مع الرسالة `Error: Tool flutter_rebuild_index is already registered`.
- **السبب الجذري (Root Cause):** تم تسجيل الأداة `flutter_rebuild_index` مرتين في ملف `src/mcp-server.ts` (مرة في السطر 1705 ومرة أخرى في السطر 2144).
- **الحل الفعلي (The Fix):** إزالة التسجيل الأول للأداة `flutter_rebuild_index` (عند السطور 1705-1719) والاحتفاظ بالتسجيل الثاني الفعلي (عند السطور 2144-2156) والذي يقوم بإنشاء ملف التنبيه لإخطار إضافة VS Code بالبدء في إعادة الفهرسة.

## 26. فشل استخراج دوال الـ `void` وتوليد دوال وهمية في الـ Parser
- **الخطأ (The Bug):** المفهرس لا يتعرف على بعض الدوال التي لا ترجع قيمة (مثل `void _onCallUno()`) بعد أسطر معينة، وبدلاً من ذلك يستخرج دوال وهمية مثل `setState` أو `if`.
- **السبب الجذري (Root Cause):** في التعبير النمطي الخاص بالـ `method` والـ `topFunc` في `dartParser.ts`، مجموعة التقاط الـ Return Type كانت `([\w<>\[\]?,\s]+?)`. بسبب وجود `\s`، أصبح التعبير يطابق المسافات البادئة فقط كـ "Return Type" للدوال العادية مثل `setState(() {`، ويستخرجها كدالة وهمية. هذا يضيف Scope جديد يلتهم الأقواس `{}` القادمة عبر `syncBraces`، مما يدمر تزامن الأقواس (`braceDepth`) ويخفي الدوال الحقيقية اللاحقة.
- **الحل الفعلي (The Fix):** تعديل مجموعة التقاط الـ Return Type لتتطلب حرفاً أبجدياً رقمياً واحداً على الأقل قبل المسافات والاختصارات: `(\w[\w<>\[\]?,\s]*?)`. هذا يمنع مطابقة استدعاءات الدوال العادية والأسطر التي تبدأ بمسافات كتعريف لدوال.

## 27. مشكلة إخفاء دوال الكلاسات (Class Methods) من إحصائيات ونتائج البحث في الإضافة
- **الخطأ (The Bug):** عند البحث أو عرض عدد الدوال في الإضافة (VS Code Extension)، يتم عرض الدوال العادية فقط (Top-level Functions) ولا يتم إظهار دوال الكلاسات (Methods) مثل `initState` أو `_initGame`، فيظهر عدد الدوال في المشروع أقل بكثير من الواقع.
- **السبب الجذري (Root Cause):** في ملف `indexManager.ts`، كانت دالة `getStats()` ودالة `search()` تتنقل فقط عبر مصفوفة `info.functions` التي تحتوي على الدوال العامة. دوال الكلاسات يتم تخزينها في مصفوفة `methods` داخل كل كلاس/إضافة (Extensions/ExtensionTypes)، ولذلك لم يتم احتسابها.
- **الحل الفعلي (The Fix):** تم تحديث دالة `getStats` لتجمع طول مصفوفات `methods` من `classes` و `extensions` و `extensionTypes`. كما تم تحديث دالة `search` في `indexManager.ts` لإنشاء مصفوفة `allFunctions` تجمع `info.functions` مع دوال الكلاسات والإضافات باستخدام `flatMap`، ليتم البحث فيها جميعاً وتضمينها في نتائج الفلترة بـ `function`.

## 28. وجود سجل تتبع أخطاء مخصص (Debug Log) في كود الإنتاج لـ `dartParser.ts`
- **الخطأ (The Bug):** طباعة رسالة تتبع مخصصة لكلاس `_BattleshipScreenState` في وحدة التحكم (Console) عند إلغاء تكديس النطاقات (Pop Scope)، مما يتسبب في طباعة رسائل غير ضرورية في بيئة الإنتاج لأي مشروع يحتوي على كلاس بهذا الاسم.
- **السبب الجذري (Root Cause):** نسيت جملة طباعة من جلسة تصحيح سابقة (Debugging Session) في سطر 384 في `src/indexer/dartParser.ts`.
- **الحل الفعلي (The Fix):** إزالة جملة التحقق والطباعة بالكامل للحد من الرسائل الزائدة في بيئة التشغيل الفعلية.

## 29. قصر مطابقة العناصر عند المؤشر (getNodeAtCursor) على طول ثابت افتراضي
- **الخطأ (The Bug):** تفشل دالة `getNodeAtCursor` في تحديد الكلاس أو الدالة الحالية إذا تجاوز طول الكلاس 50 سطراً أو تجاوز طول الدالة 20 سطراً، لأن الفحص يعتمد على حد أقصى ثابت مبني على سطر البداية (`cls.line + 50` و `func.line + 20`).
- **السبب الجذري (Root Cause):** عدم استخدام القيمة المحسوبة الفعالة لنهاية العنصر `lineEnd` المتوفرة في هياكل البيانات المرجعة من المفهرس، والاعتماد بدلاً من ذلك على قيم تقريبية ثابتة ومحدودة.
- **الحل الفعلي (The Fix):** استخدام الحقل `lineEnd` إن وجد، مع الإبقاء على القيمة التقريبية كخيار احتياطي (Fallback) فقط: `(cls.lineEnd ?? cls.line + 50)` و `(func.lineEnd ?? func.line + 20)`. وتعميم الفحص ليشمل دوال الكلاسات والإضافات المختلفة بدلاً من قصرها على الدوال العامة.

## 30. سباق بيانات صامت (Silent Race Condition) وتراجع كفاءة فحص قاعدة البيانات في `getDiagnostics`
- **الخطأ (The Bug):** محاولة التحقق من إمكانية فتح قاعدة البيانات عبر استدعاء غير متزامن بدون استخدام `await` داخل `try/catch` في `getDiagnostics()`، مما يجعل التقاط الاستثناءات غير فعال ويغلق قاعدة البيانات فوراً في الـ callback دون انتظار أي عمليات، مما قد يؤدي لأخطاء غير مكتشفة أو تسريبات لمؤشرات الملفات.
- **السبب الجذري (Root Cause):** استدعاء منشئ `new sqlite3.Database` مع دالة callback تغلق الكائن مباشرة دون لف العملية في Promise ينتظر انتهاء الفتح والتحقق والاغلاق الفعلي.
- **الحل الفعلي (The Fix):** تغليف العملية بـ `Promise` يتم انتظاره بـ `await` في دالة `getDiagnostics()`، لضمان معالجة الأخطاء وإغلاق الملف بشكل صحيح ومتزامن.

## 31. سباق بيانات وبدء مراقب الملفات قبل اكتمال الفهرسة الأولية
- **الخطأ (The Bug):** يبدأ مراقب تغيير الملفات `fileWatcher` في استقبال ومعالجة أحداث التغيير أثناء عمل `buildFullIndex` في الخلفية عند تفعيل الإضافة لأول مرة (في مسار `else` بملف `extension.ts`)، مما يؤدي لتشغيل `updateFile` على فهرس ناقص وغير مكتمل وقد يسبب تضارباً في البيانات.
- **السبب الجذري (Root Cause):** استدعاء `fileWatcher.start()` خارج وبشكل متزامن بعد استدعاء `vscode.window.withProgress` بدلاً من استدعائه داخله بعد اكتمال الـ Promise لـ `buildFullIndex`.
- **الحل الفعلي (The Fix):** تسجيل `fileWatcher` في اشتراكات الإضافة للتخلص الآمن، مع إطلاق مراقبة الملفات `fileWatcher.start()` فقط من داخل الـ callback الخاص بـ `withProgress` بعد انتهاء `await indexManager.buildFullIndex(progress)`.

## 32. أخطاء مطابقة الاعتماديات المتداخلة في pubspec.yaml وتفسير الـ SDK بشكل عشوائي
- **الخطأ (The Bug):** يتم تفسير بعض أسطر التكوينات المتداخلة (مثل `version:` أو `path:`) كاعتماديات مستقلة بأسماء وهمية، كما أن التعرف على `sdk:` يطابق أي كلمة sdk في أي مكان بالملف وليس داخل قسم `environment:` حصراً.
- **السبب الجذري (Root Cause):** استخدام شرط مطابقة عام `indent > indentLevel` لمعالجة كافة الأسطر، مما أدى لمطابقة خصائص الاعتماديات المتداخلة.
- **الحل الفعلي (The Fix):** فحص قسم `environment:` بشكل صريح ومطابقة الـ SDK بداخله فقط، مع قصر التعرف على أسماء الحزم (Packages) على مسافة الإزاحة المطابقة لـ `indentLevel + 2` فقط وتمرير البقية لتعديل آخر حزمة مضافة.

## 33. حساسية مسار pubspec.lock للرموز والمسافات البادئة (Tabs vs Spaces) وتفسير الأقسام المستقبلية كحزم
- **الخطأ (The Bug):** تعثر قراءة الحزم من `pubspec.lock` إذا تم كتابة الملف باستخدام Tabs بدلاً من Spaces، بالإضافة لترجمة أي قسم مستقبلي يضاف للملف كحزمة.
- **السبب الجذري (Root Cause):** الاعتماد الحصري على فحص المسافات البادئة بالـ string matching `line.startsWith('  ')` وتجاهل التحقق من الوجود الفعلي داخل قسم `packages:`.
- **الحل الفعلي (The Fix):** تتبع حالة القسم الحالي `currentSection` ومعالجة الحزم فقط عندما يكون القسم هو `packages:` صراحة، مع دعم المسافات البادئة وعلامات الجدولة (Tabs) للترميز.

## 34. وجود كود ميت وأساليب غير مستخدمة (Unused Private Methods) في providers
- **الخطأ (The Bug):** وجود دوال خاصة مثل `getShortName` و `getGroup` في `dependencyGraphProvider.ts` لا يتم استدعاؤها نهائياً مما يزيد من حجم الكود الميت.
- **السبب الجذري (Root Cause):** مسارات برمجية قديمة بقيت في الكود بعد التعديلات السابقة.
- **الحل الفعلي (The Fix):** إزالة كافة الأساليب الميتة وتبسيط الكود.

## 35. غياب التحقق من أنواع الفلترة الممررة من واجهات الويب في `searchProvider.ts`
- **الخطأ (The Bug):** إمكانية إرسال قيم فلترة خاطئة أو غير مدعومة إلى `indexManager` عند استدعاء البحث من الواجهة الأمامية (Webview) بسبب التجاوز الكامل للأنواع بـ `as any`.
- **السبب الجذري (Root Cause):** استخدام `filter as any` لتخطي نظام الفحص البرمجي في TypeScript.
- **الحل الفعلي (The Fix):** إدخال مصفوفة التحقق `VALID_FILTERS` والتحقق من صحة الفلتر الممرر قبل استخدامه.

## 36. خطأ توليد أكواد لغة Dart غير الصالحة لصيغ الجمع ICU (=0, =1, =2) في `intlGenerator.ts`
- **الخطأ (The Bug):** عند تشغيل بناء التطبيق (`flutter build` أو `flutter run`)، يفشل التجميع مع أخطاء مثل `Error: Expected an identifier, but got '='` في ملفات `lib/generated/intl/messages_*.dart` و `l10n.dart` بسبب توليد `=1: '1 hour'` و `=0: 'No machines'` داخل استدعاءات `Intl.plural`. بالإضافة إلى خطأ `The getter 'hoursh' isn't defined` بسبب استبدال `{hours}h` بـ `$hoursh`.
- **السبب الجذري (Root Cause):** في صيغة ARB/ICU، تُستخدم المعرفات الرقمية `=0`, `=1`, `=2`. في كود Dart البرمجي، المعاملات المسماة في `Intl.plural` يجب أن تكون معرفات قانونية (`zero:`, `one:`, `two:`). تمرير `=1:` مباشرة يمثل خطأ نحوي (Syntax error). بالإضافة إلى ذلك، استخدام `$name` بدلاً من `${name}` في السلاسل النصية يتسبب في دمج الحروف الملاصقة مثل `{hours}h` -> `$hoursh`.
- **الحل الفعلي (The Fix):**
  1. إضافة دالة تحويل `mapPluralCaseName` لترجمة `=0` -> `zero` و `=1` -> `one` و `=2` -> `two` في كل من `l10n.dart` و `messages_XX.dart`.
  2. استخدام صيغة الأقواس المعقوفة `${n}` دائماً في استبدال المتغيرات النصية لتفادي دمج الحروف اللاحقة (`${hours}h`).
  3. دمج استخراج المتغيرات من نص الرسالة تلقائياً مع البيانات الوصفية `@key.placeholders` لضمان توليد الدوال بالمعاملات الصحيحة دائماً.

## 37. خطأ نوع معامل صيغ الجمع (The argument type 'String' can't be assigned to parameter type 'num') وتكرار المعاملات
- **الخطأ (The Bug):** فشل بناء التطبيق مع `lib/generated/l10n.dart: Error: The argument type 'String' can't be assigned to the parameter type 'num'` و `Error: Too few positional arguments: 3 required, 1 given`.
- **السبب الجذري (Root Cause):** دالة استخراج المتغيرات كانت تقوم بعمل regex scan داخل نصوص حالات الجمع ICU وإضافة الكلمات المكتوبة داخل الحالات كمعاملات نصية إضافية بنوع `String` افتراضياً، مما طغى على نوع المتغير الرقمي المستهدف `count` وحوله إلى `String` وتسبب في توليد 3 معاملات للدالة بدلاً من معامل واحد.
- **الحل الفعلي (The Fix):**
  1. إلزام نوع المتغير المستهدف في صيغ الجمع ICU (`icu.variable`) بأن يكون دائماً `num` (أو `int`).
  2. في الرسائل المعتمدة على ICU، قصر المعاملات المستخرجة على متغير الـ ICU الأساسي والبيانات الوصفية المعرفة صراحة في `@key.placeholders`، وعدم اعتبار الكلمات داخل نصوص الحالات كمعاملات إضافية.

## 38. عدم التعرف على مشاريع Android الأصلية وفشلها في الفهرسة ورفضها في MCP Server
- **الخطأ (The Bug):** عند محاولة استخدام الإضافة أو خادم MCP على مشروع Android أصلي (مثل `E:\ebda_pos`)، تُرجع أداة `flutter_set_project_path` خطأ `Error: No Flutter project (pubspec.yaml), JS/TS project (package.json), or repository root (.git) found` ويتم رفض المشروع. كما يتم العثور على 0 ملفات أثناء الفهرسة لأن `indexManager` و `fileWatcher` يعتبران أي مشروع غير فلاتر كمشروع `web` ويبحثان عن `.ts/.js` فقط، مما يترك قاعدة بيانات SQLite فارغة.
- **السبب الجذري (Root Cause):** 
  1. قصر فحص جذر المشروع في `mcp-server.ts` و `projectDetector.ts` على `pubspec.yaml`, `package.json`, `.git` دون فحص ملفات إعدادات Gradle (`build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`).
  2. قصر أوضاع المشروع في `indexManager.ts` على `'flutter' | 'web'` وافتراض وضع الويب افتراضياً عند غياب `pubspec.yaml`.
  3. قصر دالة `getParserForFile` في MCP على إرسال `.kt` و `.java` فقط لـ `AndroidParser` وترك `.xml` و `.gradle` لـ `DartParser`.
- **الحل الفعلي (The Fix):**
  1. توسيع `ProjectDetector.findProjectRoot` و `flutter_set_project_path` لدعم واكتشاف علامات مشاريع Android وإعدادات Gradle.
  2. إضافة وضع `'android'` في `indexManager.getProjectMode()` وتحديث `buildFullIndex()` لفهرسة ملفات `**/*.{kt,java,xml,gradle,gradle.kts}` باستبعاد مجلدات البناء (`build`, `.gradle`, `.idea`).
  3. تحديث `fileWatcher.ts` لمراقبة ملفات أندرويد وإعدادات Gradle، واستبعاد مجلدات `.gradle` و `.idea`.
  4. تحديث `getParserForFile` في `mcp-server.ts` ليوجه جميع ملفات أندرويد (`.kt`, `.java`, `.xml`, `.gradle`, `.gradle.kts`) إلى `AndroidParser`.
  5. دعم قراءة إعدادات Gradle في `flutter_get_pubspec` عند غياب `pubspec.yaml`.

## 39. غياب كشف واجهات الـ Mockup والأكواد الوهمية في مشاريع Android الأصلية (Jetpack Compose, Kotlin, XML)
- **الخطأ (The Bug):** عند فحص شاشات مشروع Android الأصلي (مثل شاشات Jetpack Compose في `E:\ebda_pos`) لا يتم كشف دوال الاستدعاء الفارغة مثل `onClick = {}` أو `onEdit = {}`، ولا يتم كشف كائنات ومصادر البيانات الوهمية مثل `object MockStore`، ولا علامات `TODO` في ملفات تخطيطات وموارد XML.
- **السبب الجذري (Root Cause):**
  1. صُمم `MockupAnalyzer` في البداية لدعم بيئة Dart/Flutter حصراً معتمداً على تراكيب مثل `onPressed: () {}` و `Placeholder()`.
  2. لم يكن `AndroidParser` ولا `JsTsParser` يستدعيان `MockupAnalyzer.analyze()` مطلقاً عند تحليل الملفات، مما جعل `warnings` فارغة دوماً من تحذيرات الموك أب.
  3. اختلاف تراكيب اللغات البرمجية؛ ففي Jetpack Compose تُمرر الدوال بعلامة المساواة (`onClick = {}`) بدلاً من النقطتين الرأسيتين (`onPressed: () {}`)، وفي Kotlin تُعرف البيانات الوهمية بـ `val/var` وكائنات أحادية `object Mock...`، وفي XML تُستخدم تعليقات `<!-- TODO -->` وسمات `tools:sample/...`.
- **الحل الفعلي (The Fix):**
  1. توسيع `mockupAnalyzer.ts` بإضافة أنماط regex متخصصة لـ Compose (`COMPOSE_EMPTY_CALLBACK_REGEX`)، ومستمعات Android Views التقليدية (`ANDROID_LISTENER_EMPTY_REGEX`)، ودوال Log/Toast فقط (`ANDROID_LOG_ONLY_CALLBACK_REGEX`)، وكائنات ومتغيرات Kotlin (`MOCK_VAR_REGEX` و `MOCK_OBJECT_REGEX`)، وعينات XML (`ANDROID_XML_SAMPLE_DATA_REGEX`)، وحالات Compose غير المربوطة (`Checkbox(checked = true, onCheckedChange = {})`).
  2. دمج استدعاء `MockupAnalyzer.analyze(filePath, content, masked)` في كل من `parseKotlinJava()` و `parseXml()` داخل `AndroidParser`، وفي `_parseInternal()` داخل `JsTsParser`.
  3. تحديث دالة فحص التعليقات `isInComment` لدعم تعليقات XML (`<!-- -->`) وقوالب النصوص الخلفية (` ` `).

## 40. تباين مفاتيح الحواف في `DependencyGraphProvider` وتعطل مخطط Mermaid وتصفير عدادات الواجهة
- **الخطأ (The Bug):** عند تصدير مخطط Mermaid عبر `getMermaidDiagram()` يتم رسم العقد دون أي روابط بينها (Zero Edges)، كما تظهر عدادات الأسهم `→` و `←` في الشريط الجانبي دائماً بصفر `0`، وتفشل محاولة فتح الملفات عند النقر على العقد برسالة `Could not open: file:lib/main.dart`.
- **السبب الجذري (Root Cause):** دالة `indexManager.getDetailedGraph()` ترجع الحواف بصيغة `{ source, target, type }`، بينما `dependencyGraphProvider.ts` يعتمد على الواجهة القديمة `{ from, to, type }` مما جعل `from` و `to` قيم غير معرفة `undefined`. كما أن معرّفات عقد الملفات تحتوي على بادئة `file:` التي لم تُزل عند تمريرها لأمر `openFile`.
- **الحل الفعلي (The Fix):**
  1. توحيد `GraphEdge` ليحمل الحقول الأربعة معاً (`source`, `target`, `from`, `to`).
  2. حساب `mostImported` ديناميكياً من خلال تتبع درجات العقد الداخلية (In-degrees).
  3. تنظيف معرّف المسار وحذف بادئة `file:` في المزود وفي واجهة الويب فيو وأمر `openFile` في `extension.ts`.
  4. تجميع عقد الملفات بحسب مسار المجلد الحقيقي بدلاً من النوع العام `file`.

## 41. تصنيف حزم فلاتر الرسمية كـ `'unknown'` وغياب دعم أندرويد في `PubspecLockProvider`
- **الخطأ (The Bug):** تظهر حزم Flutter الرسمية (مثل `flutter`, `flutter_test`, `sky_engine`) في تبويب المكتبات بشارة `unknown`. وفي مشاريع أندرويد الأصلية يظهر التبويب فارغاً مع رسالة تطلب تشغيل `flutter pub get`.
- **السبب الجذري (Root Cause):**
  1. قصر أنواع المصدر `source` في `PackageInfo` على `'hosted' | 'git' | 'path' | 'unknown'` وتجاهل نوع `'sdk'`.
  2. قصر فحص الحزم على `pubspec.lock` و `package-lock.json` دون فحص ملفات `build.gradle` لمشاريع أندرويد أو الـ Fallback لـ `package.json`.
- **الحل الفعلي (The Fix):**
  1. إضافة نوع `'sdk'` ودعم استخراجه من `pubspec.lock`.
  2. دعم قراءة السلاسل النصية الفردية لـ `description: flutter`.
  3. إضافة محلل اعتماديات Gradle لمشاريع Android (`build.gradle`, `build.gradle.kts`) لاستخراج حزم `implementation`, `api`, `kapt` وتصنيفها كـ `direct` أو `dev`.
  4. إضافة Fallback لقراءة الاعتماديات من `package.json` في مشاريع الويب عند غياب ملف القفل.

## 42. غياب فلاتر `extensionType` وترتيب الأهمية في `SearchProvider` و `flutter_search`
- **الخطأ (The Bug):** عند البحث عن الـ Extension Types (من ميزات Dart 3.0+) أو فلترة البحث بها، يتم تجاهل الفلتر أو سقوطه للبحث العام، وتظهر النتائج بترتيب عشوائي غير مرتب بالأهمية حيث تُدفن النتائج المطابقة تماماً أسفل عشرات النتائج الجزئية.
- **السبب الجذري (Root Cause):**
  1. إسقاط `extensionType` و `file` من مصفوفة التحقق `VALID_FILTERS` في `searchProvider.ts` ومن خيارات الـ enum في خادم MCP.
  2. عدم فرز النتائج حسب التطابق التام أو بداية الكلمة أو معدل الاستخدام (`usageCount`).
- **الحل الفعلي (The Fix):**
  1. إضافة `extensionType` و `file` إلى جميع الواجهات ومصفوفات التحقق في `searchProvider.ts` و `mcp-server.ts` و `mcp-direct-search.ts`.
  2. تطبيق خوارزمية ترتيب الأهمية: التطابق التام (Exact match) أولاً، ثم المطابقة البادئة (Starts with)، ثم الأكثر استخداماً (`usageCount`)، ثم الاسم الأقصر.

## 43. قصور التعرف على الرموز المعمارية في SQLite وتحليل الأثر الناقص
- **الخطأ (The Bug):** عند استدعاء `flutter_get_node_at_cursor` أثناء وقوف المؤشر داخل `enum` أو `mixin` أو `typedef`، تُرجع الأداة `null` وكأنه لا يوجد رمز. كما أن أداة `flutter_get_impact_analysis` تفشل في رصد تأثر الكلاسات التي تطبق واجهات (`implements`) أو تخلط ميكسينز (`with/mixins`) أو التوسعات (`extension onType`)، وتتجاهل الدوال العلوية التي تستدعي الرمز المعدل.
- **السبب الجذري (Root Cause):**
  1. قصر الفحص في `sqliteCache.getNodeAtCursor` على الكلاسات والتوسعات والدوال فقط، وإغفال `enums`, `mixins`, `typedefs`.
  2. قصر بذور التغيير `seeds` في `getImpactRadius` على الكلاسات والدوال دون إضافة الميكسينز والتوسعات وأنواع التوسعة والتايب ديفس.
  3. حلقة انتشار التأثير المعماري كانت تفحص فقط `extendsClass` وتتجاهل `c.implements` و `c.mixins` و `et.representationType` و `ext.onType`.
  4. فحص التشخيصات في `getDiagnostics()` كان يستدعي مسار قاعدة البيانات الافتراضي الثابت ويتجاهل الاسم المخصص عبر `options.dbName`.
- **الحل الفعلي (The Fix):**
  1. دعم فحص `enums`, `mixins`, `typedefs` في `getNodeAtCursor`.
  2. جمع كافة أنواع الرموز كبذور أولية في `getImpactRadius`.
  3. توسيع انتشار التأثير ليشمل الواجهات (`implements`)، والميكسينز (`mixins`)، ونوع تمثيل التوسعة (`representationType`)، وهدف التوسعة (`onType`)، وتتبع الدوال العلوية المستدعية للرمز وليس الكلاسات فقط.
  4. تخزين `dbPath` كخاصية فئة ديناميكية واستخدامها في `getDiagnostics()`.

## 44. أخطاء توليد كود Dart في Intl وتكرار معامِلات ICU Plural ومسح الإعدادات في MCP Setup
- **الخطأ (The Bug):** 
  1. عند وجود صيغ جمع ICU تحتوي على كلاً من `=0` و `zero` يفشل كود Dart المولّد بخطأ تجميع `The named parameter 'zero' is already specified`.
  2. عند وجود علامة دولار صريحة مثل `"$100"` في ملف ARB، يولد الكود كـ `"$100"` مما يدفع Dart لاعتباره متغير مجهول ويُسقط خطأ `Undefined name '100'`.
  3. في `mcpSetup.ts`، مسار إعدادات المستخدم كان صلباً `C:/Users/${username}/...` مما يُعطل الأنظمة الأخرى، ودالة `updateJsonFile` كانت تُعيد إنشاء الملف بـ `mcpServers` فقط مما يمسح أي إعدادات علوية أخرى في ملفات الـ JSON للمستخدم (Data Loss).
- **السبب الجذري (Root Cause):**
  1. دالة `mapPluralCaseName` كانت تُحوّل `=0` إلى `zero` دون منع التكرار في حلقة المعامِلات المسماة، ودون ضمان معامل `other` الإلزامي في `Intl.plural`.
  2. دوال الهروب لم تكن تُجري Escape لعلامة `\$` المنفصلة عن `{param}`.
  3. مسارات مجلد المستخدم لم تكن تستخدم `os.homedir()`، و `updateJsonFile` لم تكن تحافظ على كائن `parsed` الأصلي بكامل مفاتيحه الأخرى.
- **الحل الفعلي (The Fix):**
  1. فحص عدم تكرار المعامِلات المسماة في صيغ الجمع ICU وتوفير قيمة احتياطية لمعامل `other` الإلزامي.
  2. إنشاء دوال `formatDartSQ` و `formatDartDQ` التي تُجري Escape للـ `\$` الصريح وتُحوّل `{param}` إلى `${param}` بأمان تام.
  3. اعتماد نمط اكتشاف البادئة الديناميكية لملفات ARB (`app_` أو `intl_`) في `addLocale` و `removeLocale`.
  4. استبدال المسارات الصلبة بـ `os.homedir()` وإضافة مسار `antigravity-ide`.
  5. تعديل `updateJsonFile` لتحافظ بنسبة 100% على كافة المفاتيح والإعدادات الأخرى في ملف JSON دون أي مسح أو تعديل غير مقصود.

## 45. مشكلة تنصيص اسم الأمر في `cmd.exe /c` وفساد مسار `%~dp0` في ملفات Batch (Windows Batch Traversal Bug)
- **الخطأ (The Bug):** عند تشغيل أوامر أدوات مثل `npx` أو `flutter` على نظام Windows داخل `processRunner.ts`، يفشل الأمر برسالة خطأ مثل: `Cannot find module '.../npm-prefix.js'` أو `The Flutter directory is not a clone of the GitHub project`.
- **السبب الجذري (Root Cause):** عند تمرير الأمر إلى `cmd.exe /d /s /c` مع إحاطة اسم البرنامج بعلامات تنصيص مثل `cmd.exe /d /s /c "\"\npx.cmd\" \"tsc\"\""`، يقوم مفسر الأوامر `cmd.exe` في ويندوز بتخريب المتغير البيئي `%~dp0` داخل سكربت الباتش (`.cmd` / `.bat`)، مما يجعله يشير إلى مسار العمل الحالي `process.cwd()` بدلاً من المسار الحقيقي الذي يتواجد فيه ملف الباتش.
- **الحل الفعلي (The Fix):** بما أن أوامر `ALLOWED_COMMANDS` مفحوصة بقائمة بيضاء صارمة ومجرد معرفات آمنة، يجب عدم إحاطة اسم الأمر نفسه بعلامات تنصيص، وتنصيص الوسائط فقط:
  ```typescript
  const cmdLine = args.length > 0
    ? `${command} ${args.map(a => `"${a}"`).join(' ')}`
    : command;
  child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${cmdLine}"`], { ... });
  ```
  بالإضافة إلى التحقق من كود الخروج `9009` كرمز لعدم وجود الأمر في ويندوز بجانب `1`.

## 46. فقدان الاستيرادات والتصديرات بسبب مطابقة الـ Regex على السطور المطموسة في `dartParser` و `jsTsParser`
- **الخطأ (The Bug):** عند استخراج الاعتماديات أو فحص الدورات الاعتمادية (`detectCircularDependencies`)، كانت الاستيرادات والتصديرات ترجع فارغة تماماً للملفات المفهرسة.
- **السبب الجذري (Root Cause):** تقوم دالتا `preprocessSource` بطمس النصوص والتعليقات واستبدالها بمسافات خالية (` `). كانت دالتا التحليل تطبقان تعبيرات الاستيراد مثل `P.import_` و `P.importes6` على السطر المطموس `maskedLine.trim()`، وبما أن مسارات الملفات وعلامات الاقتباس طُمست بمسافات، فشلت الأنماط في استخراج المسار تماماً.
- **الحل الفعلي (The Fix):** تطبيق regex الاستيرادات والتصديرات على السطر الأصلي `line.trim()` مع استخدام `maskedLine` فقط للتحقق من أن بداية السطر لا تقع داخل تعليق.

## 47. خطر تعطيل بيئة Node الأصلية لـ SQLite عند تنفيذ `npm audit fix --force`
- **الخطأ (The Bug):** اقتراح أداة `npm audit` تشغيل `npm audit fix --force` الذي يُرقي حزمة `sqlite3` من `5.1.7` إلى `6.0.1` لكسر تبعية `@tootallnate/once`.
- **السبب الجذري (Root Cause):** ترقية `sqlite3` إلى `6.0.1` هي ترقية رئيسية (Breaking Change) تتطلب أدوات بناء C++ وتكسر توافق الـ ABI الخاص بـ Node.js داخل VS Code Extension Host (Electron).
- **الحل الفعلي (The Fix):** الامتناع التام عن تشغيل `npm audit fix --force` واستخدام ميزة `overrides` في `package.json` لتحديث الحزم الفرعية الآمنة مثل `braces` دون لمس `sqlite3`.

