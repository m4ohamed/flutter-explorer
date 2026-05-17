/**
 * Dart File Parser - Regex-based extraction of classes, functions, widgets,
 * imports, exports, enums, and mixins from Dart source files.
 */
export interface ClassInfo {
  name: string;
  type: 'StatelessWidget' | 'StatefulWidget' | 'State' | 'ChangeNotifier' | 'plain';
  line: number;
  lineEnd?: number;
  extendsClass: string | null;
  mixins: string[];
  implements: string[];
  isAbstract: boolean;
  isPrivate: boolean;
  methods: FunctionInfo[];
  properties: PropertyInfo[];
}
export interface FunctionInfo {
  name: string;
  returnType: string;
  params: string;
  line: number;
  lineEnd?: number;
  isPrivate: boolean;
  isAsync: boolean;
  isStatic: boolean;
  parentClass: string | null;
}
export interface WidgetInfo {
  name: string;
  line: number;
  children: WidgetInfo[];
  properties: { name: string; value: string }[];
}
export interface ImportInfo {
  path: string;
  alias: string | null;
  showNames: string[];
  hideNames: string[];
  line: number;
}
export interface EnumInfo {
  name: string;
  values: string[];
  line: number;
  isPrivate: boolean;
}
export interface MixinInfo {
  name: string;
  on: string | null;
  line: number;
  isPrivate: boolean;
}
export interface WarningInfo {
  type: 'hardcoded_text' | 'hardcoded_color';
  message: string;
  line: number;
}
export interface FunctionCall {
  name: string;
  line: number;
  callerClass: string | null;
  callerFunction: string | null;
  context: string;
  isStatic: boolean;
  isChained: boolean;
  receiver?: string;
}

export interface ExtensionTypeInfo {
  name: string;
  representationType: string;
  implements: string[];
  isConst: boolean;
  isPrivate: boolean;
  line: number;
  lineEnd?: number;
  methods: FunctionInfo[];
  properties: PropertyInfo[];
}

export interface ExtensionInfo {
  name: string;
  onType: string;
  methods: FunctionInfo[];
  properties: PropertyInfo[];
  line: number;
  isPrivate: boolean;
}

export interface TypedefInfo {
  name: string;
  signature: string;
  line: number;
  isPrivate: boolean;
}

export interface VariableInfo {
  name: string;
  type: string;
  value?: string;
  line: number;
  isConst: boolean;
  isFinal: boolean;
  isPrivate: boolean;
  isTopLevel: boolean;
}

export interface ConstructorInfo {
  name: string;
  className: string;
  isFactory: boolean;
  isConst: boolean;
  params: string;
  line: number;
}

export interface PropertyInfo {
  name: string;
  type: string;
  className: string | null;
  isFinal: boolean;
  isConst: boolean;
  isStatic: boolean;
  isPrivate: boolean;
  isGetter: boolean;
  isSetter: boolean;
  line: number;
}

export interface AnnotationInfo {
  name: string;
  target: string;
  targetName: string;
  line: number;
}
export interface ClassUsage {
  className: string;
  usedInFiles: string[]; // Files that use this class
  usedByClasses: string[]; // Classes that use this class
  usedByFunctions: string[]; // Functions that use this class
  confidence: 'high' | 'medium' | 'low'; // Confidence level
}
export interface FunctionUsage {
  functionName: string;
  parentClass: string | null;
  calledByFunctions: string[]; // Functions that call this function
  calledInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface ExtensionUsage {
  extensionName: string;
  usedInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface TypedefUsage {
  typedefName: string;
  usedInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface VariableUsage {
  variableName: string;
  usedInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface ConstructorUsage {
  constructorName: string;
  className: string;
  usedInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface PropertyUsage {
  propertyName: string;
  className: string | null;
  usedInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface AnnotationUsage {
  annotationName: string;
  usedInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface EnumUsage {
  enumName: string;
  usedInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface MixinUsage {
  mixinName: string;
  usedInFiles: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface DartFileInfo {
  filePath: string;
  classes: ClassInfo[];
  functions: FunctionInfo[];
  functionCalls: FunctionCall[];
  imports: ImportInfo[];
  exports: string[];
  widgets: WidgetInfo[];
  enums: EnumInfo[];
  mixins: MixinInfo[];
  warnings: WarningInfo[];
  lastModified: number;
  contentHash?: string;
  classUsages: ClassUsage[];
  functionUsages: FunctionUsage[];
  extensionUsages: ExtensionUsage[];
  typedefUsages: TypedefUsage[];
  variableUsages: VariableUsage[];
  constructorUsages: ConstructorUsage[];
  propertyUsages: PropertyUsage[];
  annotationUsages: AnnotationUsage[];
  enumUsages: EnumUsage[];
  mixinUsages: MixinUsage[];
  // New elements
  extensions: ExtensionInfo[];
  typedefs: TypedefInfo[];
  variables: VariableInfo[];
  constructors: ConstructorInfo[];
  properties: PropertyInfo[];
  annotations: AnnotationInfo[];
  extensionTypes: ExtensionTypeInfo[];
}
const WIDGET_BASE_CLASSES = new Set([
  'StatelessWidget', 'StatefulWidget', 'HookWidget',
  'HookConsumerWidget', 'ConsumerWidget', 'ConsumerStatefulWidget', 'ConsumerState',
]);
const STATE_BASE_PATTERN = /^(Consumer|Hook|)?State(?:ful)?(?:Widget)?(?:\s*<.*>)?$/;
const NOTIFIER_CLASSES = new Set([
  'ChangeNotifier', 'ValueNotifier', 'StateNotifier', 'Notifier', 'AsyncNotifier',
]);
const SKIP_METHODS = new Set([
  'createState', 'dispose', 'didChangeDependencies',
  'didUpdateWidget', 'deactivate',
]);
const RESERVED = new Set([
  'class', 'enum', 'mixin', 'if', 'for', 'while', 'switch', 'catch', 'try', 'return',
]);
export class DartParser {
  // All RegExps created once and reused — never inside loops
  private static readonly P = {
    import_: /^import\s+['"]([^'"]+)['"]\s*(?:as\s+(\w+))?\s*(?:show\s+([\w,\s]+))?\s*(?:hide\s+([\w,\s]+))?\s*;/,
    export_: /^export\s+['"]([^'"]+)['"]\s*;/,
    hardText: /Text\s*\(\s*(['"])(.*?)\1/,
    hardColor: /Color\s*\(\s*0x[A-Fa-f0-9]{8}\s*\)|Colors\.[a-zA-Z0-9_]+/,
    enum_: /^enum\s+(\w+)\s*\{/,
    mixin_: /^mixin\s+(?!class\b)(\w+)(?:\s+on\s+(\w+))?\s*\{/,
    extension_: /^extension\s+(\w+)?\s+on\s+([\w<>\[\]?,\s]+?)\s*\{/,
    extensionType_: /^extension\s+type\s+(const\s+)?(\w+)(?:\.(\w+))?\s*\(([\w<>\[\]?,\s]+)\)(?:\s+implements\s+([\w<>,\s]+))?\s*\{/,
    typedef_: /^typedef\s+(\w+)\s*=\s*([^;]+);/,
    typedefOld_: /^typedef\s+([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(([^)]*)\);/,
    annotation: /^@(\w+)/,
    class_: /^((?:abstract\s+|sealed\s+|base\s+|interface\s+|final\s+)*)(mixin\s+)?class\s+(\w+)(?:\s+extends\s+([\w<>,\s\[\]]+))?(?:\s+with\s+([\w<>,\s\[\]]+))?(?:\s+implements\s+([\w<>,\s\[\]]+))?/,
    ctor: /^\s*(const\s+)?(factory\s+)?(\w+)(?:\.(\w+))?\s*\(((?:[^)(]+|\([^)(]*\))*)\)\s*(?::[^{;]*)?([\{;])/,
    buildMethod: /(?:Widget|Route|PreferredSizeWidget|StatelessWidget|StatefulWidget)\s+(\w+)\s*\(([^)]*)\)/,
    method: /^\s*(static\s+)?([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(((?:[^)(]+|\([^)(]*\))*)\)\s*(async\*?|sync\*?)?\s*[\{=>]/,
    getter: /^\s+(\w+)\s+get\s+(\w+)\s*(=>|\{)/,
    setter: /^\s+(\w+)\s+set\s+(\w+)\s*\(([^)]*)\)/,
    field: /^\s+(final|const|late)?\s*(final|const)?\s*(static\s+)?([\w<>\[\]?,\s]+?)\s+(\w+)\s*(=\s*[^;]+)?;/,
    topVar: /^(final|const|late)?\s*(final|const)?\s*([\w<>\[\]?,\s]+?)\s+(\w+)\s*(=\s*[^;]+)?;/,
    topFunc: /^([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(((?:[^)(]+|\([^)(]*\))*)\)\s*(async\*?|sync\*?)?\s*[\{=>]/,
    callPat: /(?:([a-zA-Z_]\w*)\.)?([a-zA-Z_]\w*)\s*\(/g,
    classDef: /class\s+(\w+)/,
    funcDef: /([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(/,
  } as const;

  /**
   * Mask string literals and comments with spaces so regex passes never
   * produce false positives from content inside strings or comments.
   * The masked source has identical line/column positions to the original.
   *
   * Fixes: false positives in usages, function calls, and warnings
   * (e.g.  print("class User");  or  // fetchData()  )
   */
  private preprocessSource(content: string): string {
    return content
      // Raw strings أولاً (r'...' و r"..." و r'''...''' و r"""...""")
      .replace(/r'''[\s\S]*?'''|r"""[\s\S]*?"""/g,
        m => m.replace(/[^\n]/g, ' '))
      .replace(/r'[^']*'|r"[^"]*"/g,
        m => m.replace(/[^\n]/g, ' '))
      // Triple-quoted strings
      .replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g,
        m => m.replace(/[^\n]/g, ' '))
      // Single/double quoted strings
      .replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g,
        m => m.replace(/[^\n]/g, ' '))
      // Line comments
      .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
      // Nested block comments (Dart يدعمها)
      .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g,
        m => m.replace(/[^\n]/g, ' '));
  }

  parse(filePath: string, content: string): DartFileInfo {
    try {
      return this._parseInternal(filePath, content);
    } catch (err) {
      console.error(`[DartParser] Failed to parse ${filePath}:`, err);
      return {
        filePath, classes: [], functions: [], functionCalls: [],
        imports: [], exports: [], widgets: [], enums: [], mixins: [], warnings: [],
        lastModified: Date.now(),
        classUsages: [], functionUsages: [], extensionUsages: [], typedefUsages: [],
        variableUsages: [], constructorUsages: [], propertyUsages: [],
        annotationUsages: [], enumUsages: [], mixinUsages: [],
        extensions: [], typedefs: [], variables: [], constructors: [],
        properties: [], annotations: [], extensionTypes: [],
      };
    }
  }

  private _parseInternal(filePath: string, content: string): DartFileInfo {
    const lines = content.split('\n');

    // FIX (preprocessing): use masked source for all regex work
    // so strings and comments never produce false positives
    const masked = this.preprocessSource(content);
    const maskedLines = masked.split('\n');

    const result: DartFileInfo = {
      filePath, classes: [], functions: [], functionCalls: [],
      imports: [], exports: [], widgets: [], enums: [], mixins: [], warnings: [],
      lastModified: Date.now(),
      classUsages: [], functionUsages: [],
      extensionUsages: [], typedefUsages: [], variableUsages: [],
      constructorUsages: [], propertyUsages: [], annotationUsages: [],
      enumUsages: [], mixinUsages: [],
      extensions: [], typedefs: [], variables: [], constructors: [], properties: [],
      annotations: [],
      extensionTypes: [],
    };

    // FIX (scope stack): replaces fragile currentClass / currentFunction booleans.
    // Correctly handles nested closures, anonymous functions, and inline callbacks.
    interface ScopeFrame {
      type: 'class' | 'function' | 'closure' | 'extensionType';
      name: string;
      braceDepth: number; // braceDepth at which this scope OPENED
      ref?: ClassInfo | FunctionInfo | ExtensionTypeInfo | ExtensionInfo;
    }
    const scopeStack: ScopeFrame[] = [];

    const currentClass = (): string | null => {
      for (let i = scopeStack.length - 1; i >= 0; i--)
        if (scopeStack[i].type === 'class' || scopeStack[i].type === 'extensionType') return scopeStack[i].name;
      return null;
    };
    const currentFunction = (): string | null => {
      for (let i = scopeStack.length - 1; i >= 0; i--)
        if (scopeStack[i].type === 'function') return scopeStack[i].name;
      return null;
    };

    let braceDepth = 0;
    let inBuildMethod = false;
    let buildBraceStart = 0;
    let buildLines: string[] = [];

    const P = DartParser.P; // shorthand
    
    // Helper to sync braces and pop scopes — handles current line or multiple lines
    const syncBraces = (lineIdx: number, count: number = 1) => {
      for (let k = 0; k < count; k++) {
        const idx = lineIdx + k;
        if (idx >= maskedLines.length) break;
        const mLine = maskedLines[idx];
        for (const ch of mLine) {
          if (ch === '{') {
            braceDepth++;
          } else if (ch === '}') {
            braceDepth--;
            while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].braceDepth >= braceDepth) {
              const popped = scopeStack.pop();
              if (popped) {
                const lineNum_ = idx + 1;
                if (popped.ref) {
                  (popped.ref as any).lineEnd = lineNum_;
                } else {
                  if (popped.type === 'class') {
                    const cls = result.classes.find(c => c.name === popped.name && c.lineEnd === undefined);
                    if (cls) cls.lineEnd = lineNum_;
                  } else if (popped.type === 'extensionType') {
                    const et = result.extensionTypes.find(e => e.name === popped.name && e.lineEnd === undefined);
                    if (et) et.lineEnd = lineNum_;
                  } else if (popped.type === 'function') {
                    const func = result.functions.find(f => f.name === popped.name && f.lineEnd === undefined);
                    if (func) { func.lineEnd = lineNum_; }
                    else {
                      for (const cls of result.classes) {
                        const m = cls.methods.find(f => f.name === popped.name && f.lineEnd === undefined);
                        if (m) { m.lineEnd = lineNum_; break; }
                      }
                      for (const ext of result.extensions) {
                        const m = ext.methods.find(f => f.name === popped.name && f.lineEnd === undefined);
                        if (m) { m.lineEnd = lineNum_; break; }
                      }
                      for (const et of result.extensionTypes) {
                        const m = et.methods.find(f => f.name === popped.name && f.lineEnd === undefined);
                        if (m) { m.lineEnd = lineNum_; break; }
                      }
                    }
                  }
                }
              }
            }
            if (inBuildMethod && braceDepth <= buildBraceStart) {
              inBuildMethod = false;
              const wt = this.parseWidgetTree(buildLines.join('\n'), true);
              if (wt.length > 0) result.widgets.push(...wt);
              buildLines = [];
            }
          }
        }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];        // original (for display / warnings)
      const maskedLine = maskedLines[i];  // masked (for all regex matching)
      const trimmed = maskedLine.trim();
      const lineNum = i + 1;

      if (trimmed === '') continue;
      // skip lines that are entirely masked comments (all spaces after trim)
      if (/^\s*$/.test(trimmed)) continue;

      // Imports — use masked line
      const imp = trimmed.match(P.import_);
      if (imp) {
        result.imports.push({
          path: imp[1], alias: imp[2] || null,
          showNames: imp[3] ? imp[3].split(',').map(s => s.trim()) : [],
          hideNames: imp[4] ? imp[4].split(',').map(s => s.trim()) : [],
          line: lineNum,
        });
        syncBraces(i); continue;
      }

      const exp = trimmed.match(P.export_);
      if (exp) { result.exports.push(exp[1]); syncBraces(i); continue; }

      if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) { syncBraces(i); continue; }

      // Hardcoded text/color — use ORIGINAL line (we want real content for message)
      // but only if it isn't inside a string/comment (maskedLine won't match)
      const textMatch = maskedLine.match(P.hardText);
      if (textMatch && !maskedLine.includes('.tr') && !maskedLine.includes('S.of') && !maskedLine.includes('Intl.message')) {
        result.warnings.push({ type: 'hardcoded_text', message: `Hardcoded text: ${line.match(P.hardText)?.[0] ?? textMatch[0]}`, line: lineNum });
      }
      const colorMatch = maskedLine.match(P.hardColor);
      if (colorMatch && !filePath.toLowerCase().includes('theme') && !filePath.toLowerCase().includes('color')) {
        result.warnings.push({ type: 'hardcoded_color', message: `Hardcoded color: ${colorMatch[0]}`, line: lineNum });
      }

      // Enums
      const enm = trimmed.match(P.enum_);
      if (enm) {
        result.enums.push({ name: enm[1], values: this.extractEnumValues(lines, i, maskedLines), line: lineNum, isPrivate: enm[1].startsWith('_') });
        syncBraces(i); continue;
      }

      // Mixins
      const mix = trimmed.match(P.mixin_);
      if (mix) {
        result.mixins.push({ name: mix[1], on: mix[2] || null, line: lineNum, isPrivate: mix[1].startsWith('_') });
        syncBraces(i); continue;
      }

      // Extensions
      const extMatch = trimmed.match(P.extension_);
      if (extMatch) {
        const name = extMatch[1] || `UnnamedExtension_${lineNum}`;
        const newExt: ExtensionInfo = { name, onType: extMatch[2].trim(), methods: [], properties: [], line: lineNum, isPrivate: name.startsWith('_') };
        result.extensions.push(newExt);
        scopeStack.push({ type: 'class', name, braceDepth, ref: newExt });
        syncBraces(i); continue;
      }

      // Typedefs (new and old)
      if (!currentClass()) {
        const td = trimmed.match(P.typedef_);
        if (td) {
          result.typedefs.push({
            name: td[1], signature: td[2].trim(),
            line: lineNum, isPrivate: td[1].startsWith('_'),
          });
          syncBraces(i); continue;
        }
        const tdOld = trimmed.match(P.typedefOld_);
        if (tdOld) {
          result.typedefs.push({
            name: tdOld[2], signature: `${tdOld[1].trim()} Function(${tdOld[3].trim()})`,
            line: lineNum, isPrivate: tdOld[2].startsWith('_'),
          });
          syncBraces(i); continue;
        }
      }

      // Annotations
      const annotationMatch = trimmed.match(P.annotation);
      if (annotationMatch) {
        const nextMasked = maskedLines[i + 1]?.trim() || '';
        let target = 'unknown'; let targetName = '';
        if (nextMasked.match(/^(class|enum|mixin)\s+(\w+)/)) {
          target = 'class'; targetName = nextMasked.match(/^(class|enum|mixin)\s+(\w+)/)?.[2] || '';
        } else if (nextMasked.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+(\w+)\s*\(/)) {
          target = 'function'; targetName = nextMasked.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+(\w+)\s*\(/)?.[2] || '';
        } else if (nextMasked.match(/^\s+(final|const|late)?\s*(final|const)?\s*[\w<>\[\]?,\s]+\s+(\w+)\s*=/)) {
          target = 'field'; targetName = nextMasked.match(/^\s+(final|const|late)?\s*(final|const)?\s*[\w<>\[\]?,\s]+\s+(\w+)\s*=/)?.[3] || '';
        }
        result.annotations.push({ name: annotationMatch[1], target, targetName, line: lineNum });
      }

      // Extension types (Dart 3.3+)
      if (!currentClass()) {
        const extType = trimmed.match(P.extensionType_);
        if (extType) {
          const name = extType[2];
          const newExtType: ExtensionTypeInfo = {
            name, representationType: extType[4].trim(),
            implements: extType[5] ? extType[5].split(',').map(s => s.trim()) : [],
            isConst: !!extType[1], isPrivate: name.startsWith('_'),
            line: lineNum, methods: [], properties: [],
          };
          result.extensionTypes.push(newExtType);
          scopeStack.push({ type: 'extensionType', name, braceDepth, ref: newExtType });
          const hLines = extType[0].split('\n').length;
          syncBraces(i, hLines);
          i += hLines - 1;
          continue;
        }
      }

      // Classes - use lookahead for multi-line support
      const lookahead = maskedLines.slice(i, i + 5).join('\n');
      const cls = lookahead.match(P.class_);
      if (cls && !cls[0].includes('(') && !cls[0].includes(')')) {
        const name = cls[3]; // with mixin class support, name is index 3
        const ext = cls[4]?.trim() || null;
        let type: ClassInfo['type'] = 'plain';
        if (ext) {
          if (WIDGET_BASE_CLASSES.has(ext)) type = ext as ClassInfo['type'];
          else if (STATE_BASE_PATTERN.test(ext)) type = 'State';
          else if (NOTIFIER_CLASSES.has(ext)) type = 'ChangeNotifier';
        }

        const newCls: ClassInfo = {
          name, type, line: lineNum, extendsClass: ext,
          mixins: cls[5] ? cls[5].split(',').map(s => s.trim()) : [],
          implements: cls[6] ? cls[6].split(',').map(s => s.trim()) : [],
          isAbstract: !!cls[1], isPrivate: name.startsWith('_'),
          methods: [], properties: [],
        };
        result.classes.push(newCls);
        scopeStack.push({ type: 'class', name, braceDepth, ref: newCls });

        const headerLines = cls[0].split('\n').length;
        syncBraces(i, headerLines);
        i += headerLines - 1;
        continue;
      }

      // If we are inside a class but its type is still 'plain', 
      // check if this line contains 'extends' or 'with' that identifies it as a Widget/State
      const ccName = currentClass();
      if (ccName) {
        const currentCls = result.classes.find(c => c.name === ccName && c.type === 'plain');
        if (currentCls) {
          const extMatch = trimmed.match(/extends\s+([\w<>,\s]+)/);
          if (extMatch) {
            const ext = extMatch[1].trim();
            if (WIDGET_BASE_CLASSES.has(ext)) currentCls.type = ext as any;
            else if (STATE_BASE_PATTERN.test(ext)) currentCls.type = 'State';
          }
        }
      }

      // Track braces — syncBraces handles current line AND scope popping
      syncBraces(i);

      // Widget-returning method detection
      if (currentClass() && P.buildMethod.test(trimmed)) {
        inBuildMethod = true;
        buildBraceStart = braceDepth - 1;
        buildLines = [];
        const braceIdx = line.indexOf('{');
        if (braceIdx !== -1 && braceIdx < line.length - 1) {
          buildLines.push(maskedLine.substring(braceIdx + 1));
        }
        continue;
      }
      if (inBuildMethod) { buildLines.push(maskedLine); continue; }

      // Methods and Properties inside a class/extension
      const cc = currentClass();
      if (cc) {
        const mLookahead = maskedLines.slice(i, i + 8).join('\n');
        const ctorMatch = mLookahead.match(P.ctor);
        if (ctorMatch && ctorMatch[3] === cc) {
          result.constructors.push({
            name: ctorMatch[4] || cc,
            className: cc,
            isFactory: !!ctorMatch[2],
            isConst: !!ctorMatch[1],
            params: ctorMatch[5] ? ctorMatch[5].replace(/\n/g, ' ').trim() : '',
            line: lineNum,
          });
          const hLines = ctorMatch[0].split('\n').length;
          if (hLines > 1) syncBraces(i + 1, hLines - 1);
          i += hLines - 1;
          continue;
        }

        const methodMatch = mLookahead.match(P.method);
        if (methodMatch && !SKIP_METHODS.has(methodMatch[3])) {
          const methodInfo: FunctionInfo = {
            name: methodMatch[3], returnType: methodMatch[2].trim(), params: methodMatch[4].trim().replace(/\n/g, ' '),
            line: lineNum, isPrivate: methodMatch[3].startsWith('_'),
            isAsync: !!methodMatch[5], isStatic: !!methodMatch[1], parentClass: cc,
          };
          const parentCls = result.classes.find(c => c.name === cc);
          if (parentCls) parentCls.methods.push(methodInfo);
          else {
            const e = result.extensions.find(ex => ex.name === cc);
            if (e) e.methods.push(methodInfo);
            else {
              const et = result.extensionTypes.find(ext => ext.name === cc);
              if (et) et.methods.push(methodInfo);
            }
          }

          const hLines = methodMatch[0].split('\n').length;
          if (hLines > 1) syncBraces(i + 1, hLines - 1);
          
          scopeStack.push({ type: 'function', name: methodMatch[3], braceDepth: braceDepth - 1, ref: methodInfo });
          i += hLines - 1;
          continue;
        }

        const getterMatch = maskedLine.match(P.getter);
        if (getterMatch) {
          const prop: PropertyInfo = {
            name: getterMatch[2], type: getterMatch[1].trim(), className: cc,
            isFinal: false, isConst: false, isStatic: false, isPrivate: getterMatch[2].startsWith('_'),
            isGetter: true, isSetter: false, line: lineNum,
          };
          result.properties.push(prop);
          const parentCls = result.classes.find(c => c.name === cc);
          if (parentCls) parentCls.properties.push(prop);
          else {
            const e = result.extensions.find(ex => ex.name === cc);
            if (e) e.properties.push(prop);
            else {
              const et = result.extensionTypes.find(ext => ext.name === cc);
              if (et) et.properties.push(prop);
            }
          }
        }

        const setterMatch = maskedLine.match(P.setter);
        if (setterMatch) {
          const prop: PropertyInfo = {
            name: setterMatch[2], type: setterMatch[3].trim(), className: cc,
            isFinal: false, isConst: false, isStatic: false, isPrivate: setterMatch[2].startsWith('_'),
            isGetter: false, isSetter: true, line: lineNum,
          };
          result.properties.push(prop);
          const parentCls = result.classes.find(c => c.name === cc);
          if (parentCls) parentCls.properties.push(prop);
          else {
            const e = result.extensions.find(ex => ex.name === cc);
            if (e) e.properties.push(prop);
            else {
              const et = result.extensionTypes.find(ext => ext.name === cc);
              if (et) et.properties.push(prop);
            }
          }
        }

        const fieldMatch = maskedLine.match(P.field);
        if (fieldMatch && !fieldMatch[5].includes('(') && !SKIP_METHODS.has(fieldMatch[5]) && !fieldMatch[0].includes('=>')) {
          const prop: PropertyInfo = {
            name: fieldMatch[5], type: fieldMatch[4].trim(), className: cc,
            isFinal: fieldMatch[1] === 'final' || fieldMatch[2] === 'final',
            isConst: fieldMatch[1] === 'const' || fieldMatch[2] === 'const',
            isStatic: !!fieldMatch[3], isPrivate: fieldMatch[5].startsWith('_'),
            isGetter: false, isSetter: false, line: lineNum,
          };
          result.properties.push(prop);
          const parentCls = result.classes.find(c => c.name === cc);
          if (parentCls) parentCls.properties.push(prop);
          else {
            const e = result.extensions.find(ex => ex.name === cc);
            if (e) e.properties.push(prop);
            else {
              const et = result.extensionTypes.find(ext => ext.name === cc);
              if (et) et.properties.push(prop);
            }
          }
        }
      }

      // Top-level functions and variables - ORDER MATTERS: check functions first
      if (!currentClass()) {
        const fLookahead = maskedLines.slice(i, i + 8).join('\n');
        const f = fLookahead.match(P.topFunc);
        if (f && !RESERVED.has(f[2])) {
          const newFunc: FunctionInfo = {
            name: f[2], returnType: f[1].trim(), params: f[3].trim().replace(/\n/g, ' '),
            line: lineNum, isPrivate: f[2].startsWith('_'),
            isAsync: !!f[4], isStatic: false, parentClass: null,
          };
          result.functions.push(newFunc);

          const hLines = f[0].split('\n').length;
          if (hLines > 1) syncBraces(i + 1, hLines - 1);
          
          scopeStack.push({ type: 'function', name: f[2], braceDepth: braceDepth - 1, ref: newFunc });
          i += hLines - 1;
        } else {
          const varMatch = trimmed.match(P.topVar);
          if (varMatch && !RESERVED.has(varMatch[4])) {
            result.variables.push({
              name: varMatch[4], type: varMatch[3].trim(),
              value: varMatch[5] ? varMatch[5].replace('=', '').trim() : undefined,
              line: lineNum, isConst: varMatch[1] === 'const' || varMatch[2] === 'const',
              isFinal: varMatch[1] === 'final' || varMatch[2] === 'final',
              isPrivate: varMatch[4].startsWith('_'), isTopLevel: true,
            });
          }
        }
      }
    }
    this.analyzeUsages(maskedLines, result);
    this.extractFunctionCalls(maskedLines, result, lines);
    return result;
  }
  private extractEnumValues(lines: string[], startIndex: number, maskedLines?: string[]): string[] {
    const values: string[] = [];
    const safeLines = maskedLines ?? lines;
    let depth = 0; let started = false;
    for (let i = startIndex; i < safeLines.length; i++) {
      for (const ch of safeLines[i]) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; if (started && depth === 0) { return values; } }
      }
      if (started && depth === 1) {
        const t = lines[i].trim();
        if (t && !t.startsWith('{') && !t.startsWith('//')) {
          const v = t.match(/^(\w+)/);
          if (v) { values.push(v[1]); }
        }
      }
    }
    return values;
  }
  parseWidgetTree(content: string, isMasked: boolean = false): WidgetInfo[] {
    const widgets: WidgetInfo[] = [];
    const masked = isMasked ? content : this.preprocessSource(content);
    const lines = content.split('\n'); // for original display
    const maskedLines = masked.split('\n'); // for name detection
    const stack: { widget: WidgetInfo; depth: number }[] = [];

    for (let i = 0; i < maskedLines.length; i++) {
      const mLine = maskedLines[i];
      const trimmedMasked = mLine.trim();
      if (!trimmedMasked || trimmedMasked.startsWith('//') || trimmedMasked.startsWith('*')) continue;

      const matches = trimmedMasked.matchAll(/(?:\b|return\s+|=>\s+)([A-Z]\w+)(?:\.\w+)?\s*\(/g);

      for (const wm of matches) {
        const indent = mLine.length - mLine.trimStart().length;
        const name = wm[1];
        if (RESERVED.has(name.toLowerCase())) continue;

        // Extract detail from ORIGINAL content to keep the text values
        let detail = '';
        const originalTrimmed = lines[i].trim();
        const lineRemaining = originalTrimmed.substring(wm.index! + wm[0].length);
        const detailMatch = lineRemaining.match(/^(['"])(.*?)\1/);
        if (detailMatch) detail = detailMatch[2];
        else {
          const iconMatch = lineRemaining.match(/^(Icons\.\w+)/);
          if (iconMatch) detail = iconMatch[1];
        }

        const widget: WidgetInfo = {
          name,
          line: i + 1,
          children: [],
          properties: detail ? [{ name: 'detail', value: detail }] : []
        };

        // Pop stack based on indentation or logical nesting
        while (stack.length > 0 && stack[stack.length - 1].depth >= indent) {
          stack.pop();
        }

        if (stack.length > 0) {
          stack[stack.length - 1].widget.children.push(widget);
        } else {
          widgets.push(widget);
        }

        stack.push({ widget, depth: indent });
      }
    }
    return widgets;
  }
  private analyzeUsages(maskedLines: string[], result: DartFileInfo): void {
    // ── Build one pattern per named symbol ───────────────────────────────────
    type SymbolKind =
      | 'class' | 'function' | 'extension' | 'typedef'
      | 'variable' | 'enum' | 'mixin' | 'extensionType';

    interface SymbolEntry {
      kind: SymbolKind;
      name: string;
      pattern: RegExp;          // \bNAME\b
      defSnippets: string[];    // substrings that mark the definition line → skip
    }

    const symbols: SymbolEntry[] = [];
    const addSymbol = (kind: SymbolKind, name: string, defSnippets: string[]) =>
      symbols.push({ kind, name, pattern: new RegExp(`\\b${name}\\b`), defSnippets });

    for (const c of result.classes) addSymbol('class', c.name, [`class ${c.name}`, `extends ${c.name}`]);
    for (const f of result.functions) addSymbol('function', f.name, [`${f.name}(`]);
    for (const e of result.extensions) addSymbol('extension', e.name, [`extension ${e.name}`]);
    for (const t of result.typedefs) addSymbol('typedef', t.name, [`typedef ${t.name}`]);
    for (const v of result.variables) addSymbol('variable', v.name, [`${v.name} =`, `${v.name}=`]);
    for (const e of result.enums) addSymbol('enum', e.name, [`enum ${e.name}`]);
    for (const m of result.mixins) addSymbol('mixin', m.name, [`mixin ${m.name}`]);
    for (const et of result.extensionTypes) addSymbol('class', et.name, [`extension type ${et.name}`]);

    // Pre-build usage containers
    const classUsageMap = new Map(result.classes.map(c => [c.name, { className: c.name, usedInFiles: [result.filePath], usedByClasses: [] as string[], usedByFunctions: [] as string[], confidence: 'medium' as const }]));
    const funcUsageMap = new Map(result.functions.map(f => [f.name, { functionName: f.name, parentClass: f.parentClass, calledByFunctions: [] as string[], calledInFiles: [result.filePath], confidence: 'medium' as const }]));
    const extUsageMap = new Map(result.extensions.map(e => [e.name, { extensionName: e.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const typedefUsageMap = new Map(result.typedefs.map(t => [t.name, { typedefName: t.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const varUsageMap = new Map(result.variables.map(v => [v.name, { variableName: v.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const enumUsageMap = new Map(result.enums.map(e => [e.name, { enumName: e.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const mixinUsageMap = new Map(result.mixins.map(m => [m.name, { mixinName: m.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));

    const symbolMap = new Map<string, SymbolEntry[]>();
    for (const sym of symbols) {
      let arr = symbolMap.get(sym.name);
      if (!arr) { arr = []; symbolMap.set(sym.name, arr); }
      arr.push(sym);
    }

    // ── Single pass over all lines with inline context awareness (O(n)) ───────
    let curCls: string | null = null;
    let curFunc: string | null = null;
    let bDepth = 0;
    let clsBrace = 0;
    let funcBrace = 0;

    for (let i = 0; i < maskedLines.length; i++) {
      const mLine = maskedLines[i];
      const trimmed = mLine.trim();

      // Track scope for context
      for (const ch of mLine) {
        if (ch === '{') bDepth++;
        else if (ch === '}') {
          bDepth--;
          if (curCls && bDepth <= clsBrace) curCls = null;
          if (curFunc && bDepth <= funcBrace) curFunc = null;
        }
      }

      // Detect scope entry (using simple patterns for faster O(n) context tracking)
      const cMatch = trimmed.match(/^(class|mixin|extension\s+type|extension|enum)\s+(?:const\s+)?(\w+)/);
      if (cMatch) { curCls = cMatch[2]; clsBrace = bDepth - 1; }
      const fMatch = trimmed.match(DartParser.P.funcDef);
      if (fMatch && !RESERVED.has(fMatch[2])) { curFunc = fMatch[2]; funcBrace = bDepth - 1; }

      const ctx = {
        type: curFunc ? 'function' : (curCls ? 'class' : 'none') as any,
        name: curFunc || curCls || ''
      };

      const words = mLine.match(/\b[A-Za-z_]\w*\b/g);
      if (!words) continue;
      const uniqueWords = new Set(words);

      for (const word of uniqueWords) {
        const syms = symbolMap.get(word);
        if (!syms) continue;

        for (const sym of syms) {
          if (sym.defSnippets.some(s => mLine.includes(s))) continue;

          switch (sym.kind) {
            case 'class': {
              const u = classUsageMap.get(sym.name)!;
              if (ctx.type === 'class' && ctx.name !== sym.name && !u.usedByClasses.includes(ctx.name)) u.usedByClasses.push(ctx.name);
              if (ctx.type === 'function' && !u.usedByFunctions.includes(ctx.name)) u.usedByFunctions.push(ctx.name);
              break;
            }
            case 'function': {
              const u = funcUsageMap.get(sym.name)!;
              if (ctx.type === 'function' && ctx.name !== sym.name && !u.calledByFunctions.includes(ctx.name)) u.calledByFunctions.push(ctx.name);
              break;
            }
            case 'extension': {
              const u = extUsageMap.get(sym.name)!;
              if (!u.usedInFiles.includes(result.filePath)) u.usedInFiles.push(result.filePath);
              break;
            }
            case 'typedef': {
              const u = typedefUsageMap.get(sym.name)!;
              if (!u.usedInFiles.includes(result.filePath)) u.usedInFiles.push(result.filePath);
              break;
            }
            case 'variable': {
              const u = varUsageMap.get(sym.name)!;
              if (!u.usedInFiles.includes(result.filePath)) u.usedInFiles.push(result.filePath);
              break;
            }
            case 'enum': {
              const u = enumUsageMap.get(sym.name)!;
              if (!u.usedInFiles.includes(result.filePath)) u.usedInFiles.push(result.filePath);
              break;
            }
            case 'mixin': {
              const u = mixinUsageMap.get(sym.name)!;
              if (!u.usedInFiles.includes(result.filePath)) u.usedInFiles.push(result.filePath);
              break;
            }
          }
        }
      }
    }

    // ── Flush to result ───────────────────────────────────────────────────────
    result.classUsages = [...classUsageMap.values()];
    result.functionUsages = [...funcUsageMap.values()];
    result.extensionUsages = [...extUsageMap.values()];
    result.typedefUsages = [...typedefUsageMap.values()];
    result.variableUsages = [...varUsageMap.values()];
    result.enumUsages = [...enumUsageMap.values()];
    result.mixinUsages = [...mixinUsageMap.values()];

    // Annotations are binary (present = used)
    for (const a of result.annotations) {
      if (!result.annotationUsages.find(au => au.annotationName === a.name))
        result.annotationUsages.push({ annotationName: a.name, usedInFiles: [result.filePath], confidence: 'medium' });
    }

    // Constructors & properties — unchanged logic, still fast (small sets)
    for (const c of result.constructors) {
      const fullName = c.name === c.className ? c.className : `${c.className}.${c.name}`;
      const pattern = new RegExp(`\\b${fullName.replace('.', '\\.')}\\b`);
      const usage: ConstructorUsage = { constructorName: c.name, className: c.className, usedInFiles: [], confidence: 'medium' };
      for (const ml of maskedLines) {
        if (pattern.test(ml) && !ml.includes(`${fullName}(`) && !usage.usedInFiles.includes(result.filePath))
          usage.usedInFiles.push(result.filePath);
      }
      result.constructorUsages.push(usage);
    }

    for (const p of result.properties) {
      const pattern = new RegExp(`\\b${p.name}\\b`);
      const usage: PropertyUsage = { propertyName: p.name, className: p.className, usedInFiles: [], confidence: 'medium' };
      for (const ml of maskedLines) {
        if (pattern.test(ml) && !ml.includes(`${p.name};`) && !ml.includes(`get ${p.name}`) && !usage.usedInFiles.includes(result.filePath))
          usage.usedInFiles.push(result.filePath);
      }
      result.propertyUsages.push(usage);
    }
  }

  private extractFunctionCalls(maskedLines: string[], result: DartFileInfo, originalLines?: string[]): void {
    const lines = originalLines ?? maskedLines;

    const classNameSet = new Set(result.classes.map(c => c.name));
    const RESERVED_CALLS = new Set([
      'print', 'setState', 'Navigator', 'Scaffold', 'Container', 'Text',
      'Column', 'Row', 'Stack', 'Padding', 'SizedBox', 'Expanded', 'Flexible',
      'if', 'for', 'while', 'switch', 'return', 'await', 'async', 'try', 'catch',
      'throw', 'finally', 'break', 'continue', 'import', 'export', 'library',
      'part', 'of', 'show', 'hide', 'as', 'is', 'assert', 'rethrow',
    ]);

    // Rebuild a minimal scope tracker just for call context
    let callCurrentClass: string | null = null;
    let callCurrentFunction: string | null = null;
    let callBraceDepth = 0;
    let callClassBrace = 0;
    let callFuncBrace = 0;
    const callPatLocal = new RegExp(DartParser.P.callPat.source, 'g');

    for (let i = 0; i < maskedLines.length; i++) {
      const mLine = maskedLines[i];
      const trimmed = mLine.trim();
      const lineNum = i + 1;

      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      if (trimmed.match(/^(class|enum|mixin|import|export)\s/)) continue;

      // Track scope for context
      for (const ch of mLine) {
        if (ch === '{') callBraceDepth++;
        else if (ch === '}') {
          callBraceDepth--;
          if (callCurrentClass && callBraceDepth <= callClassBrace) callCurrentClass = null;
          if (callCurrentFunction && callBraceDepth <= callFuncBrace) callCurrentFunction = null;
        }
      }
      const classM = trimmed.match(DartParser.P.class_);
      if (classM) { callCurrentClass = classM[3]; callClassBrace = callBraceDepth - 1; continue; }
      const funcM = trimmed.match(DartParser.P.method);
      if (funcM) { callCurrentFunction = funcM[3]; callFuncBrace = callBraceDepth - 1; }

      if (trimmed.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+\w+\s*\([^)]*\)\s*(async\s*)?\{/)) continue;

      callPatLocal.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = callPatLocal.exec(mLine)) !== null) {
        const receiver = match[1];
        const funcName = match[2];
        if (RESERVED_CALLS.has(funcName)) continue;
        if (funcName === callCurrentFunction) continue;
        if (classNameSet.has(funcName) && mLine.includes(`new ${funcName}`)) continue;

        const contextStart = Math.max(0, i - 1);
        const contextEnd = Math.min(lines.length - 1, i + 1);
        const context = lines.slice(contextStart, contextEnd + 1).join('\n').trim();

        result.functionCalls.push({
          name: funcName,
          line: lineNum,
          callerClass: callCurrentClass,
          callerFunction: callCurrentFunction,
          isStatic: !receiver || classNameSet.has(receiver),
          isChained: !!receiver,
          receiver: receiver || undefined,
          context: context.substring(0, 200),
        });
      }
    }
  }

  /**
   * Extract the full body of a class, function, or method from the source code
   */
  extractCodeBlock(
    content: string,
    elementType: 'class' | 'function' | 'method' | 'enum' | 'mixin' | 'extension',
    name: string,
    parentClass?: string,
    parsedInfo?: DartFileInfo
  ): { body: string; startLine: number; endLine: number; comments: string[] } | null {

    const parsed = parsedInfo ?? this.parse('__extract__', content);
    const lines = content.split('\n');

    let startLine = -1;
    let endLine = -1;

    switch (elementType) {
      case 'class': {
        const cls = parsed.classes.find(c => c.name === name);
        if (cls) { startLine = cls.line; endLine = cls.lineEnd ?? -1; }
        if (endLine === -1) {
          const ext = parsed.extensions.find(e => e.name === name);
          if (ext) { startLine = ext.line; endLine = -1; }
          const et = parsed.extensionTypes.find(e => e.name === name);
          if (et) { startLine = et.line; endLine = et.lineEnd ?? -1; }
        }
        break;
      }
      case 'enum': {
        const enm = parsed.enums.find(e => e.name === name);
        if (enm) { startLine = enm.line; endLine = -1; }
        break;
      }
      case 'mixin': {
        const mix = parsed.mixins.find(m => m.name === name);
        if (mix) { startLine = mix.line; endLine = -1; }
        break;
      }
      case 'extension': {
        const ext = parsed.extensions.find(e =>
          name === 'unnamed extension' ? !e.name.startsWith('Unnamed') === false : e.name === name
        );
        if (ext) { startLine = ext.line; endLine = -1; }
        break;
      }
      case 'function': {
        const fn = parsed.functions.find(f => f.name === name && !f.parentClass);
        if (fn) { startLine = fn.line; endLine = fn.lineEnd ?? -1; }
        break;
      }
      case 'method': {
        // ابحث في classes + extensions + extensionTypes
        let fn = parsed.functions.find(f => f.name === name && f.parentClass === parentClass);
        if (!fn) {
          for (const cls of parsed.classes) {
            const m = cls.methods.find(m => m.name === name);
            if (m && (!parentClass || cls.name === parentClass)) { fn = m; break; }
          }
        }
        if (fn) { startLine = fn.line; endLine = fn.lineEnd ?? -1; }
        break;
      }
    }

    if (startLine === -1) return null;

    // لو lineEnd مش موجود في الـ parse (enum/mixin/extension)، احسبه بـ brace tracking بسيط
    if (endLine === -1) {
      const masked = this.preprocessSource(content);
      const maskedLines = masked.split('\n');
      let depth = 0;
      let started = false;
      for (let i = startLine - 1; i < maskedLines.length; i++) {
        const mLine = maskedLines[i];

        if (!started && mLine.trim().endsWith(';')) {
          endLine = i + 1;
          break;
        }

        for (const ch of mLine) {
          if (ch === '{') { depth++; started = true; }
          else if (ch === '}') {
            depth--;
            if (started && depth === 0) { endLine = i + 1; break; }
          }
        }
        if (endLine !== -1) break;

        if (i > startLine + 500) break;
      }
    }

    if (endLine === -1) return null;

    // استخرج الـ comments اللي قبل السطر
    const comments: string[] = [];
    for (let i = startLine - 2; i >= 0; i--) {
      const t = lines[i].trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
        comments.unshift(t);
      } else {
        break;
      }
    }

    const body = lines.slice(startLine - 1, endLine).join('\n');
    return { body, startLine, endLine, comments };
  }

  private _countNetBraces(line: string): number {
    let net = 0;
    for (const ch of line) {
      if (ch === '{') net++;
      else if (ch === '}') net--;
    }
    return net;
  }

}

