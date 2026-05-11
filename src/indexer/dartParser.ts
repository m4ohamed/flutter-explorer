/**
 * Dart File Parser - Regex-based extraction of classes, functions, widgets,
 * imports, exports, enums, and mixins from Dart source files.
 */
export interface ClassInfo {
    name: string;
    type: 'StatelessWidget' | 'StatefulWidget' | 'State' | 'ChangeNotifier' | 'plain';
    line: number;
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
    isPrivate: boolean;
    isAsync: boolean;
    isStatic: boolean;
    parentClass: string | null;
}
export interface WidgetInfo {
    name: string;
    line: number;
    children: WidgetInfo[];
    properties: string[];
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
}

export interface ExtensionInfo {
    name: string;
    onType: string;
    methods: FunctionInfo[];
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
    // New elements
    extensions: ExtensionInfo[];
    typedefs: TypedefInfo[];
    variables: VariableInfo[];
    constructors: ConstructorInfo[];
    properties: PropertyInfo[];
    annotations: AnnotationInfo[];
}
const WIDGET_BASE_CLASSES = new Set([
    'StatelessWidget', 'StatefulWidget', 'HookWidget',
    'HookConsumerWidget', 'ConsumerWidget', 'ConsumerStatefulWidget',
]);
const STATE_BASE_PATTERN = /^State<\w+>$/;
const NOTIFIER_CLASSES = new Set([
    'ChangeNotifier', 'ValueNotifier', 'StateNotifier', 'Notifier', 'AsyncNotifier',
]);
const SKIP_METHODS = new Set([
    'build', 'createState', 'initState', 'dispose', 'didChangeDependencies',
    'didUpdateWidget', 'deactivate',
]);
const RESERVED = new Set([
    'class', 'enum', 'mixin', 'if', 'for', 'while', 'switch', 'catch', 'try', 'return',
]);
export class DartParser {
    parse(filePath: string, content: string): DartFileInfo {
        const lines = content.split('\n');
        const result: DartFileInfo = {
            filePath, classes: [], functions: [], functionCalls: [],
            imports: [], exports: [], widgets: [], enums: [], mixins: [], warnings: [], lastModified: Date.now(),
            classUsages: [], functionUsages: [],
            extensions: [], typedefs: [], variables: [], constructors: [], properties: [], annotations: [],
        };
        let currentClass: string | null = null;
        let currentFunction: string | null = null;
        let braceDepth = 0;
        let classBraceStart = 0;
        let functionBraceStart = 0;
        let inBuildMethod = false;
        let buildBraceStart = 0;
        let buildLines: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const lineNum = i + 1;
            if (trimmed === '' || trimmed.startsWith('//')) { continue; }
            // Imports
            const imp = trimmed.match(/^import\s+['"]([^'"]+)['"]\s*(?:as\s+(\w+))?\s*(?:show\s+([\w,\s]+))?\s*(?:hide\s+([\w,\s]+))?\s*;/);
            if (imp) {
                result.imports.push({
                    path: imp[1], alias: imp[2] || null,
                    showNames: imp[3] ? imp[3].split(',').map(s => s.trim()) : [],
                    hideNames: imp[4] ? imp[4].split(',').map(s => s.trim()) : [],
                    line: lineNum,
                });
                continue;
            }
            // Exports
            const exp = trimmed.match(/^export\s+['"]([^'"]+)['"]\s*;/);
            if (exp) { result.exports.push(exp[1]); continue; }

            if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
                continue;
            }
            // Hardcoded Text Detection
            const textMatch = line.match(/Text\s*\(\s*(['"])(.*?)\1/);
            if (textMatch && !line.includes('.tr') && !line.includes('S.of') && !line.includes('Intl.message')) {
                result.warnings.push({
                    type: 'hardcoded_text',
                    message: `Hardcoded text: ${textMatch[0]}`,
                    line: lineNum,
                });
            }
            // Hardcoded Color Detection
            const colorMatch = line.match(/Color\s*\(\s*0x[A-Fa-f0-9]{8}\s*\)/) || line.match(/Colors\.[a-zA-Z0-9_]+/);
            if (colorMatch && !filePath.toLowerCase().includes('theme') && !filePath.toLowerCase().includes('color')) {
                result.warnings.push({
                    type: 'hardcoded_color',
                    message: `Hardcoded color: ${colorMatch[0]}`,
                    line: lineNum,
                });
            }
            // Enums
            const enm = trimmed.match(/^enum\s+(\w+)\s*\{/);
            if (enm) {
                result.enums.push({
                    name: enm[1], values: this.extractEnumValues(lines, i),
                    line: lineNum, isPrivate: enm[1].startsWith('_'),
                });
                continue;
            }
            // Mixins
            const mix = trimmed.match(/^mixin\s+(\w+)(?:\s+on\s+(\w+))?\s*\{/);
            if (mix) {
                result.mixins.push({ name: mix[1], on: mix[2] || null, line: lineNum, isPrivate: mix[1].startsWith('_') });
                continue;
            }
            // Extensions
            const extMatch = trimmed.match(/^extension\s+(\w+)?\s+on\s+([\w<>\[\]?,\s]+?)\s*\{/);
            if (extMatch) {
                const name = extMatch[1] || 'UnnamedExtension';
                result.extensions.push({
                    name,
                    onType: extMatch[2].trim(),
                    methods: [], // Methods will be added in currentClass logic if we treat extension as a class-like scope
                    line: lineNum,
                    isPrivate: name.startsWith('_'),
                });
                currentClass = name; // Treat extension as a class to capture methods/properties inside
                classBraceStart = braceDepth;
                continue;
            }
            // Typedefs
            const typedefMatch = trimmed.match(/^typedef\s+(\w+)\s*=\s*([^;]+);/);
            if (typedefMatch) {
                result.typedefs.push({
                    name: typedefMatch[1],
                    signature: typedefMatch[2].trim(),
                    line: lineNum,
                    isPrivate: typedefMatch[1].startsWith('_'),
                });
                continue;
            }
            // Annotations
            const annotationMatch = trimmed.match(/^@(\w+)/);
            if (annotationMatch) {
                const nextLine = lines[i + 1] || '';
                const nextLineTrimmed = nextLine.trim();

                let target = 'unknown';
                let targetName = '';

                if (nextLineTrimmed.match(/^(class|enum|mixin)\s+(\w+)/)) {
                    target = 'class';
                    targetName = nextLineTrimmed.match(/^(class|enum|mixin)\s+(\w+)/)?.[2] || '';
                } else if (nextLineTrimmed.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+(\w+)\s*\(/)) {
                    target = 'function';
                    targetName = nextLineTrimmed.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+(\w+)\s*\(/)?.[2] || '';
                } else if (nextLineTrimmed.match(/^\s+(final|const|late)?\s*(final|const)?\s*[\w<>\[\]?,\s]+\s+(\w+)\s*=/)) {
                    target = 'field';
                    targetName = nextLineTrimmed.match(/^\s+(final|const|late)?\s*(final|const)?\s*[\w<>\[\]?,\s]+\s+(\w+)\s*=/)?.[3] || '';
                }

                result.annotations.push({
                    name: annotationMatch[1],
                    target,
                    targetName,
                    line: lineNum,
                });
            }

            // Classes
            const cls = trimmed.match(/^(abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w<>,\s]+?))?(?:\s+with\s+([\w<>,\s]+?))?(?:\s+implements\s+([\w<>,\s]+?))?\s*\{/);
            if (cls) {
                const name = cls[2];
                const ext = cls[3]?.trim() || null;
                let type: ClassInfo['type'] = 'plain';
                if (ext) {
                    if (WIDGET_BASE_CLASSES.has(ext)) { type = ext as ClassInfo['type']; }
                    else if (STATE_BASE_PATTERN.test(ext)) { type = 'State'; }
                    else if (NOTIFIER_CLASSES.has(ext)) { type = 'ChangeNotifier'; }
                }
                result.classes.push({
                    name, type, line: lineNum, extendsClass: ext,
                    mixins: cls[4] ? cls[4].split(',').map(s => s.trim()) : [],
                    implements: cls[5] ? cls[5].split(',').map(s => s.trim()) : [],
                    isAbstract: !!cls[1], isPrivate: name.startsWith('_'),
                    methods: [], properties: []
                });
                currentClass = name;
                classBraceStart = braceDepth;
                
                // Extract constructors
                for (let j = i + 1; j < lines.length; j++) {
                    const classLine = lines[j];
                    const ctorMatch = classLine.match(/^\s+(const\s+)?(factory\s+)?(\w+)\s*(\.\w+)?\s*\(([^)]*)\)\s*(:\s*[^{]+)?\{/);
                    if (ctorMatch && ctorMatch[3] === name) {
                        result.constructors.push({
                            name: ctorMatch[4] ? ctorMatch[4].substring(1) : name,
                            className: name,
                            isFactory: !!ctorMatch[2],
                            isConst: !!ctorMatch[1],
                            params: ctorMatch[5].trim(),
                            line: j + 1,
                        });
                    }
                }
                continue;
            }
            // Track braces
            for (const ch of line) {
                if (ch === '{') { braceDepth++; }
                else if (ch === '}') {
                    braceDepth--;
                    if (currentClass && braceDepth <= classBraceStart) { currentClass = null; }
                    if (currentFunction && braceDepth <= functionBraceStart) { currentFunction = null; }
                    if (inBuildMethod && braceDepth <= buildBraceStart) {
                        inBuildMethod = false;
                        const wt = this.parseWidgetTree(buildLines.join('\n'));
                        if (wt.length > 0) { result.widgets.push(...wt); }
                        buildLines = [];
                    }
                }
            }
            // Build method
            if (currentClass && /Widget\s+build\s*\(\s*BuildContext\s+\w+\s*\)/.test(trimmed)) {
                inBuildMethod = true;
                buildBraceStart = braceDepth - 1;
                buildLines = [];
                continue;
            }
            if (inBuildMethod) { buildLines.push(line); continue; }
            // Methods and Properties
            if (currentClass) {
                const methodMatch = line.match(/^\s+(static\s+)?([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(async\s*)?\{/);
                if (methodMatch && !SKIP_METHODS.has(methodMatch[3])) {
                    const methodInfo: FunctionInfo = {
                        name: methodMatch[3], returnType: methodMatch[2].trim(), params: methodMatch[4].trim(),
                        line: lineNum, isPrivate: methodMatch[3].startsWith('_'),
                        isAsync: !!methodMatch[5], isStatic: !!methodMatch[1], parentClass: currentClass,
                    };
                    const cls = result.classes.find(c => c.name === currentClass);
                    if (cls) cls.methods.push(methodInfo);
                    currentFunction = methodMatch[3];
                    functionBraceStart = braceDepth - 1;
                }

                const getterMatch = line.match(/^\s+(\w+)\s+get\s+(\w+)\s*(=>|{)/);
                if (getterMatch) {
                    result.properties.push({
                        name: getterMatch[2], type: getterMatch[1].trim(), className: currentClass,
                        isFinal: false, isConst: false, isStatic: false, isPrivate: getterMatch[2].startsWith('_'),
                        isGetter: true, isSetter: false, line: lineNum,
                    });
                }

                const setterMatch = line.match(/^\s+(\w+)\s+set\s+(\w+)\s*\(([^)]*)\)/);
                if (setterMatch) {
                    result.properties.push({
                        name: setterMatch[2], type: setterMatch[3].trim(), className: currentClass,
                        isFinal: false, isConst: false, isStatic: false, isPrivate: setterMatch[2].startsWith('_'),
                        isGetter: false, isSetter: true, line: lineNum,
                    });
                }

                const fieldMatch = line.match(/^\s+(final|const|late)?\s*(final|const)?\s*(static\s+)?([\w<>\[\]?,\s]+?)\s+(\w+)\s*(=\s*[^;]+)?;/);
                if (fieldMatch && !fieldMatch[5].includes('(')) {
                    result.properties.push({
                        name: fieldMatch[5], type: fieldMatch[4].trim(), className: currentClass,
                        isFinal: fieldMatch[1] === 'final' || fieldMatch[2] === 'final',
                        isConst: fieldMatch[1] === 'const' || fieldMatch[2] === 'const',
                        isStatic: !!fieldMatch[3], isPrivate: fieldMatch[5].startsWith('_'),
                        isGetter: false, isSetter: false, line: lineNum,
                    });
                }
            }
            // Top-level variables
            if (!currentClass) {
                const varMatch = trimmed.match(/^(final|const|late)?\s*(final|const)?\s*([\w<>\[\]?,\s]+?)\s+(\w+)\s*(=\s*[^;]+)?;/);
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
            // Top-level functions
            if (!currentClass) {
                const f = trimmed.match(/^([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(async\s*)?\{/);
                if (f && !RESERVED.has(f[2])) {
                    result.functions.push({
                        name: f[2], returnType: f[1].trim(), params: f[3].trim(),
                        line: lineNum, isPrivate: f[2].startsWith('_'),
                        isAsync: !!f[4], isStatic: false, parentClass: null,
                    });
                    currentFunction = f[2];
                    functionBraceStart = braceDepth - 1;
                }
            }
        }
        // Analyze usages before returning
        this.analyzeUsages(content, result);
        this.extractFunctionCalls(lines, result, currentClass, currentFunction);
        return result;
    }
    private extractEnumValues(lines: string[], startIndex: number): string[] {
        const values: string[] = [];
        let depth = 0; let started = false;
        for (let i = startIndex; i < lines.length; i++) {
            for (const ch of lines[i]) {
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
    parseWidgetTree(buildBody: string): WidgetInfo[] {
        const widgets: WidgetInfo[] = [];
        const lines = buildBody.split('\n');
        const stack: { widget: WidgetInfo; depth: number }[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) { continue; }
            const wm = trimmed.match(/^(?:return\s+)?([A-Z]\w+)(?:\.\w+)?\s*\(/);
            if (wm) {
                const indent = line.length - line.trimStart().length;
                const widget: WidgetInfo = { name: wm[1], line: i + 1, children: [], properties: [] };
                while (stack.length > 0 && stack[stack.length - 1].depth >= indent) { stack.pop(); }
                if (stack.length > 0) { stack[stack.length - 1].widget.children.push(widget); }
                else { widgets.push(widget); }
                stack.push({ widget, depth: indent });
            }
        }
        return widgets;
    }
    private analyzeUsages(content: string, result: DartFileInfo): void {
        const lines = content.split('\n');
        // Analyze class usages
        for (const cls of result.classes) {
            const usage: ClassUsage = {
                className: cls.name,
                usedInFiles: [result.filePath],
                usedByClasses: [],
                usedByFunctions: [],
                confidence: 'medium'
            };
            // Search for class name usage in the same file
            const pattern = new RegExp(`\\b${cls.name}\\b`, 'g');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (pattern.test(line)) {
                    // Exclude the definition itself
                    if (!line.includes(`class ${cls.name}`) && !line.includes(`extends ${cls.name}`)) {
                        const context = this.getUsageContext(lines, i);
                        if (context.type === 'class' && context.name !== cls.name) {
                            if (!usage.usedByClasses.includes(context.name)) {
                                usage.usedByClasses.push(context.name);
                            }
                        } else if (context.type === 'function') {
                            if (!usage.usedByFunctions.includes(context.name)) {
                                usage.usedByFunctions.push(context.name);
                            }
                        }
                    }
                }
            }
            result.classUsages.push(usage);
        }
        // Analyze function usages
        for (const func of result.functions) {
            const usage: FunctionUsage = {
                functionName: func.name,
                parentClass: func.parentClass,
                calledByFunctions: [],
                calledInFiles: [result.filePath],
                confidence: 'medium'
            };
            const pattern = new RegExp(`\\b${func.name}\\s*\\(`, 'g');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (pattern.test(line)) {
                    // Exclude definition
                    if (!line.includes(`${func.name}(`) || line.trim().startsWith('return')) {
                        const context = this.getUsageContext(lines, i);
                        if (context.type === 'function' && context.name !== func.name) {
                            if (!usage.calledByFunctions.includes(context.name)) {
                                usage.calledByFunctions.push(context.name);
                            }
                        }
                    }
                }
            }
            result.functionUsages.push(usage);
        }
    }
    private getUsageContext(lines: string[], lineIndex: number): { type: 'class' | 'function' | 'none', name: string } {
        // Search backwards for class or function definition
        for (let i = lineIndex; i >= 0; i--) {
            const line = lines[i].trim();
            const clsMatch = line.match(/class\s+(\w+)/);
            if (clsMatch) {
                return { type: 'class', name: clsMatch[1] };
            }
            const funcMatch = line.match(/([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(/);
            if (funcMatch && !RESERVED.has(funcMatch[2])) {
                return { type: 'function', name: funcMatch[2] };
            }
        }
        return { type: 'none', name: '' };
    }

    private extractFunctionCalls(lines: string[], result: DartFileInfo, currentClass: string | null, currentFunction: string | null): void {
        const classNameSet = new Set(result.classes.map(c => c.name));
        const RESERVED_CALLS = new Set([
            'print', 'setState', 'Navigator', 'Scaffold', 'Container', 'Text',
            'Column', 'Row', 'Stack', 'Padding', 'SizedBox', 'Expanded', 'Flexible',
            'if', 'for', 'while', 'switch', 'return', 'await', 'async', 'try', 'catch',
            'throw', 'finally', 'break', 'continue', 'import', 'export', 'library',
            'part', 'of', 'part of', 'show', 'hide', 'as', 'is', 'assert', 'rethrow',
        ]);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const lineNum = i + 1;
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'))
                continue;
            if (trimmed.match(/^(class|enum|mixin|import|export)\s/))
                continue;
            if (trimmed.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+\w+\s*\([^)]*\)\s*(async\s*)?\{/))
                continue;
            const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
            let match;
            while ((match = callPattern.exec(line)) !== null) {
                const funcName = match[1];
                if (RESERVED_CALLS.has(funcName))
                    continue;
                if (funcName === currentFunction)
                    continue;
                if (classNameSet.has(funcName) && line.includes(`new ${funcName}`))
                    continue;
                const contextStart = Math.max(0, i - 1);
                const contextEnd = Math.min(lines.length - 1, i + 1);
                const context = lines.slice(contextStart, contextEnd + 1).join('\n').trim();
                const isStatic = line.includes(`${funcName}(`) && !line.includes(`.${funcName}(`);
                const isChained = line.includes(`.${funcName}(`);
                result.functionCalls.push({
                    name: funcName,
                    line: lineNum,
                    callerClass: currentClass,
                    callerFunction: currentFunction,
                    isStatic,
                    isChained,
                    context: context.substring(0, 200),
                });
            }
        }
    }
}
