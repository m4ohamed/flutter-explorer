# flutter-explorer-mcp

*Description: استخدم الـ MCP tools الخاصة بـ Flutter Explorer للتحليل العميق لمشاريع Flutter/Dart. يجب استخدام هذه السكيل في أي وقت يطلب فيه المستخدم: تحليل الكود، البحث عن كلاس أو دالة، معرفة مَن يستخدم مكوناً معيناً، فهم بنية المشروع، البحث عن translations، إصلاح أخطاء، مراجعة التبعيات، تتبع التأثير (blast radius)، تشغيل analyze أو build_runner، أو أي مهمة تتطلب قراءة أو فهم كود Flutter. الأدوات متاحة كـ deferred tools تحت flutter-explorer-mcp:flutter_* — استخدمها مباشرة ولا تكتب الكود يدوياً. تشمل: البحث، قراءة الكود، تحليل المنطق، الـ graph، الترجمات، الـ diagnostics، وأكثر.*

# Flutter Explorer MCP — دليل الاستخدام

## نظرة عامة

هذه السكيل تمنحك وصولاً كاملاً لـ 30 أداة MCP مدمجة تُحلّل مشروع Flutter/Dart مباشرةً.
الأدوات تعمل على SQLite index تبنيه امتداد VS Code، مع JSON fallback إذا كان SQLite غير متاح.

**قبل أي شيء**: استخدم `tool_search` بـ `"flutter"` لتحميل الأدوات.

---

## الخطوات الأساسية

```
1. tool_search(query="flutter") → يحمّل كل أدوات flutter-explorer-mcp
2. اختر الأداة المناسبة من الجدول أدناه
3. نفّذها مباشرة — لا تكتب كوداً بديلاً
```

---

## دليل الأدوات السريع

### 🔍 البحث والاستكشاف

| الأداة | الاستخدام | متى تستخدمها |
|--------|-----------|--------------|
| `flutter_search` | البحث عن كلاس/دالة/widget/enum | أول خطوة عند البحث عن أي عنصر |
| `flutter_search_text` | بحث نصي/regex في كل الملفات | البحث عن string literal أو comment |
| `flutter_get_project_structure` | عرض شجرة المشروع | فهم البنية، إيجاد الملفات |
| `flutter_get_stats` | إحصائيات المشروع | نظرة سريعة على حجم المشروع |
| `flutter_get_file_info` | تفاصيل ملف dart | قراءة كل عناصر ملف معين |

### 📖 قراءة الكود

| الأداة | الاستخدام | متى تستخدمها |
|--------|-----------|--------------|
| `flutter_get_code_block` | قراءة body كاملة لكلاس/دالة/method | بعد flutter_search، لقراءة الكود الكامل |
| `flutter_read_fragment` | قراءة بـ اسم العنصر + سياق اختياري | بديل أسرع لـ get_code_block |
| `flutter_analyze_logic_flow` | تحليل منطق دالة بـ steps | فهم ماذا تفعل دالة معقدة |
| `flutter_get_pubspec` | قراءة pubspec.yaml | فهم dependencies والإعدادات |
| `flutter_get_index_status` | حالة الـ index | تشخيص مشاكل الـ index |

### 🔗 التحليل والعلاقات

| الأداة | الاستخدام | متى تستخدمها |
|--------|-----------|--------------|
| `flutter_find_references` | كل مكان يُستخدم فيه عنصر | refactoring، تتبع الاستخدام |
| `flutter_get_reverse_deps` | مَن يعتمد على هذا العنصر | قبل تعديل كلاس أو دالة |
| `flutter_get_impact_analysis` | blast radius لملف | قبل تعديل ملف حيوي |
| `flutter_get_dependencies` | dependencies الـ constructor | فهم DI لكلاس معين |
| `flutter_get_detailed_graph` | رسم بياني للعلاقات | فهم معمارية جزء من المشروع |
| `flutter_get_node_at_cursor` | العنصر في سطر معين | التنقل في كود محدد |

### ⚠️ التحقق والتشخيص

| الأداة | الاستخدام | متى تستخدمها |
|--------|-----------|--------------|
| `flutter_get_diagnostics` | أخطاء VS Code كلها | أول خطوة عند تشخيص مشكلة |
| `flutter_get_code_warnings` | تحذيرات hardcoded text/color | تحسين جودة الكود |
| `flutter_run_analyze` | تشغيل flutter analyze | التحقق من errors قبل deploy |
| `flutter_get_hints` | اقتراحات بناءً على آخر tool | الخطوة التالية المنطقية |

### 🌍 الترجمات (ARB)

| الأداة | الاستخدام | متى تستخدمها |
|--------|-----------|--------------|
| `flutter_list_translations` | كل translation keys | استعراض الترجمات |
| `flutter_get_missing_translations` | مفاتيح مفقودة | قبل release |
| `flutter_update_translation` | إضافة/تعديل ترجمة (AR + EN) | إضافة string جديد |
| `flutter_delete_translation` | حذف مفتاح ترجمة | تنظيف مفاتيح قديمة |
| `flutter_run_intl_generate` | توليد ملفات l10n | بعد تعديل ARB files |

### ⚙️ الإعدادات والبناء

| الأداة | الاستخدام | متى تستخدمها |
|--------|-----------|--------------|
| `flutter_get_project_path` | المسار الحالي للمشروع | التحقق من المشروع النشط |
| `flutter_set_project_path` | تغيير المشروع | التبديل بين مشاريع |
| `flutter_list_packages` | packages من pubspec.lock | فهم الإصدارات المثبتة |
| `flutter_run_build_runner` | توليد كود Freezed/Riverpod | بعد تعديل models |
| `flutter_rebuild_index` | إعادة بناء الـ index | إذا كان الـ index قديم |

---

## سير العمل الشائع

### 📌 "أريد أن أفهم كلاس معين"
```
1. flutter_search(query="ClassName", filter="class")
2. flutter_get_code_block(className="ClassName", elementType="class")
3. flutter_get_dependencies(className="ClassName")  ← مَن يحتاجه في constructor
4. flutter_get_reverse_deps(name="ClassName", type="class")  ← مَن يستخدمه
```

### 📌 "ما الذي سيتأثر إذا عدّلت هذا الملف؟"
```
1. flutter_get_impact_analysis(relativePath="lib/path/to/file.dart")
2. flutter_get_reverse_deps(name="ClassName", type="class")
```

### 📌 "أريد إضافة ترجمة جديدة"
```
1. flutter_list_translations()  ← تحقق أن المفتاح غير موجود
2. flutter_update_translation(key="myKey", arValue="النص", enValue="Text")
3. flutter_run_intl_generate()  ← لتوليد ملفات Dart
```

### 📌 "هناك أخطاء في المشروع"
```
1. flutter_get_diagnostics()  ← أخطاء VS Code
2. flutter_run_analyze()  ← تشغيل flutter analyze
3. flutter_get_code_warnings()  ← تحذيرات إضافية
```

### 📌 "ابحث عن كل أماكن استخدام دالة"
```
1. flutter_find_references(name="functionName", type="function")
```

---

## نصائح للاستخدام الفعال

**ابدأ بـ flutter_search دائماً** — يعطيك الـ `file` و `line` اللي تحتاجهم للأدوات الأخرى.

**استخدم filter في flutter_search** لنتائج أدق:
```
filter: "class" | "function" | "widget" | "enum" | "mixin" | 
        "extension" | "typedef" | "variable" | "translation" | "file"
```

**إذا كان الـ index غير متاح** (Index not found):
- نفّذ `flutter_rebuild_index()` أولاً
- أو تحقق بـ `flutter_get_index_status()`
- الـ `flutter_search` يستخدم direct search تلقائياً كـ fallback

**للأدوات التي تحتاج `parentClass`** (مثل get_code_block للـ methods):
```
flutter_search(query="methodName") → يعطيك parent class من حقل "parent"
```

**تسلسل منطقي**: استخدم `flutter_get_hints()` بعد أي tool لتقترح الخطوة التالية.

---

## معالجة الأخطاء الشائعة

| الخطأ | السبب | الحل |
|-------|-------|------|
| "Index not found" | SQLite غير جاهز | `flutter_rebuild_index()` أو `flutter_get_index_status()` |
| "File not found in index" | مسار خاطئ | استخدم `flutter_search(filter="file")` للمسار الصحيح |
| "Function not found" | اسم خاطئ أو تغيّر | `flutter_search(query="partialName")` |
| "No Flutter project found" | مسار خاطئ | `flutter_set_project_path(projectPath="...")` |

---

للتفاصيل المتقدمة عن كل tool والـ parameters الكاملة:
→ اقرأ `references/tool-reference.md`

# Flutter Explorer MCP — Tool Reference المرجع الكامل

## flutter_search

**البحث في الـ index عن أي عنصر Dart**

```typescript
flutter_search({
  query: string,              // اسم العنصر أو جزء منه
  filter?: string,            // "class"|"function"|"widget"|"enum"|"mixin"|"extension"
                              // "typedef"|"variable"|"constructor"|"property"
                              // "annotation"|"file"|"call"|"translation"
  searchMode?: string,        // "definitions"|"calls"|"both" (default: "both")
  useDirectSearch?: boolean   // true = تجاهل الـ index، ابحث مباشرة في الملفات
})
```

**نموذج النتيجة:**
```json
{
  "results": [
    {
      "name": "AuthService",
      "type": "class_definition",
      "subtype": "plain",
      "file": "lib/services/auth_service.dart",
      "line": 12,
      "lineEnd": 89
    }
  ],
  "source": "index"
}
```

---

## flutter_get_code_block

**قراءة body كاملة لكلاس أو دالة**

```typescript
flutter_get_code_block({
  className?: string,    // اسم الكلاس (لو elementType="class" أو "method")
  functionName?: string, // اسم الدالة أو الـ method
  elementType?: string,  // "class"|"function"|"method" (auto-detected إذا لم يُذكر)
  filePath?: string,     // مسار نسبي (اختياري، يبحث تلقائياً)
})
```

---

## flutter_read_fragment

**قراءة كود بالاسم مع سياق اختياري**

```typescript
flutter_read_fragment({
  name: string,              // اسم العنصر
  elementType?: string,      // "class"|"function"|"method"
  filePath?: string,         // مسار نسبي (اختياري)
  parentClass?: string,      // للـ methods
  includeContext?: boolean,  // إضافة سطور قبل وبعد (default: false)
  contextLines?: number,     // عدد السطور الإضافية (default: 3)
})
```

---

## flutter_analyze_logic_flow

**تحليل منطق دالة وتقسيمه لـ steps**

```typescript
flutter_analyze_logic_flow({
  functionName: string,  // اسم الدالة
  parentClass?: string,  // الكلاس المحتوي (للـ methods)
  filePath?: string,     // مسار نسبي (اختياري)
})
```

**نموذج النتيجة:**
```json
{
  "functionName": "exportVideo",
  "logicSteps": [
    { "type": "validation", "description": "Check outputPath not null" },
    { "type": "async_call", "description": "Call VideoEngine.process()" }
  ]
}
```

---

## flutter_find_references

**إيجاد كل أماكن استخدام عنصر معين**

```typescript
flutter_find_references({
  name: string,  // اسم العنصر
  type: string   // "class"|"function"|"variable"|"enum"|"mixin"|"extension"|"typedef"
})
```

**نموذج النتيجة:**
```json
{
  "references": [
    {
      "file": "lib/screens/home_screen.dart",
      "line": 45,
      "context": "final auth = AuthService();",
      "kind": "instantiation_or_access"
    }
  ],
  "referencesCount": 7
}
```

---

## flutter_get_impact_analysis

**تحليل blast radius لملف — مَن يصل إليه من entry points**

```typescript
flutter_get_impact_analysis({
  relativePath: string,  // مثال: "lib/core/utils.dart"
  maxDepth?: number,     // عمق البحث (default: 25)
})
```

**نموذج النتيجة:**
```json
{
  "targetFile": "lib/core/utils.dart",
  "affectedFlows": [
    {
      "entryPoint": "HomeScreen.build",
      "path": ["HomeScreen", "HomeController", "AuthService", "utils"]
    }
  ],
  "summary": "Found 3 execution flows from entry points reaching this file."
}
```

---

## flutter_get_reverse_deps

**مَن يعتمد على عنصر معين**

```typescript
flutter_get_reverse_deps({
  name: string,          // اسم العنصر
  type: string,          // "class"|"function"|"extension"|"typedef"|"variable"
                         // "constructor"|"property"|"annotation"|"enum"|"mixin"
  parentClass?: string,  // مطلوب للـ properties و functions داخل كلاس
})
```

---

## flutter_get_dependencies

**dependencies الـ constructor لكلاس معين**

```typescript
flutter_get_dependencies({
  className: string,   // اسم الكلاس
  filePath?: string,   // مسار نسبي (اختياري)
})
```

---

## flutter_get_detailed_graph

**رسم بياني للعلاقات (inheritance, calls, imports)**

```typescript
flutter_get_detailed_graph({
  focusFile?: string,  // ملف محوري (اختياري)
  depth?: number,      // عمق الـ graph (default: 1)
})
```

---

## flutter_get_node_at_cursor

**العنصر الموجود في سطر معين**

```typescript
flutter_get_node_at_cursor({
  relativePath: string,  // مسار الملف
  line: number,          // رقم السطر (1-indexed)
})
```

---

## flutter_get_project_structure

**شجرة مجلدات المشروع**

```typescript
flutter_get_project_structure({
  targetPath?: string  // مجلد فرعي (default: "lib")
})
```

---

## flutter_get_file_info

**كل عناصر ملف dart**

```typescript
flutter_get_file_info({
  relativePath: string  // مثال: "lib/main.dart"
})
```

---

## flutter_get_stats

**إحصائيات المشروع الكاملة**
```typescript
flutter_get_stats({})
// → "Files: 142, Classes: 89, Functions: 234, Widgets: 45, ..."
```

---

## flutter_get_pubspec

**محتوى pubspec.yaml كاملاً**
```typescript
flutter_get_pubspec({})
```

---

## flutter_list_packages

**packages من pubspec.lock بإصداراتها**
```typescript
flutter_list_packages({})
```

---

## flutter_get_code_warnings

**تحذيرات الكود (hardcoded text/color/logic)**

```typescript
flutter_get_code_warnings({
  typeFilter?: string,   // "all"|"text"|"color"|"duplicated_logic"
  searchQuery?: string,  // بحث داخل نص التحذير
  fileQuery?: string,    // بحث داخل مسار الملف
})
```

---

## flutter_get_diagnostics

**أخطاء VS Code المحفوظة في الـ index**
```typescript
flutter_get_diagnostics({})
```

---

## flutter_run_analyze

**تشغيل flutter analyze / tsc / gradle lint**
```typescript
flutter_run_analyze({})
// مهلة: 5 دقائق — لا تنتظر أكثر
```

---

## flutter_get_index_status

**حالة الـ index: SQLite vs JSON fallback**
```typescript
flutter_get_index_status({})
```

---

## flutter_get_hints

**اقتراح الأداة التالية بناءً على آخر استخدام**

```typescript
flutter_get_hints({
  lastTool: string  // اسم آخر أداة استخدمتها
})
```

---

## flutter_search_text

**بحث نصي/regex عبر كل الملفات**

```typescript
flutter_search_text({
  query: string,
  isRegex?: boolean,           // (default: false)
  caseInsensitive?: boolean,   // (default: true)
  includeComments?: boolean,   // (default: true)
  includeStrings?: boolean,    // (default: true)
})
```

---

## flutter_update_translation

**إضافة أو تعديل مفتاح ترجمة**

```typescript
flutter_update_translation({
  key: string,           // مثال: "loginButton"
  arValue: string,       // النص بالعربية
  enValue: string,       // النص بالإنجليزية
  description?: string,  // وصف اختياري
})
```

---

## flutter_delete_translation

**حذف مفتاح ترجمة من كل ARB files**
```typescript
flutter_delete_translation({ key: string })
```

---

## flutter_list_translations

**قائمة كل مفاتيح الترجمة**
```typescript
flutter_list_translations({})
```

---

## flutter_get_missing_translations

**مفاتيح موجودة في ملف وغير موجودة في ملفات أخرى**
```typescript
flutter_get_missing_translations({})
```

---

## flutter_run_intl_generate

**توليد ملفات l10n.dart و messages_*.dart**
```typescript
flutter_run_intl_generate({})
```

---

## flutter_run_build_runner

**تشغيل dart run build_runner build**
```typescript
flutter_run_build_runner({})
// مهلة: 3 دقائق
```

---

## flutter_rebuild_index

**إعادة بناء الـ index من VS Code extension**
```typescript
flutter_rebuild_index({})
```

---

## flutter_set_project_path

**تعيين مسار المشروع**

```typescript
flutter_set_project_path({
  projectPath: string  // مسار مطلق يحتوي على pubspec.yaml أو .git
})
```

---

## flutter_get_project_path

**المسار الحالي النشط**
```typescript
flutter_get_project_path({})
```
