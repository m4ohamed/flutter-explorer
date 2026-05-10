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
export interface DartFileInfo {
    filePath: string;
    classes: ClassInfo[];
    functions: FunctionInfo[];
    imports: ImportInfo[];
    exports: string[];
    widgets: WidgetInfo[];
    enums: EnumInfo[];
    mixins: MixinInfo[];
    warnings: WarningInfo[];
    lastModified: number;
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
            filePath, classes: [], functions: [], imports: [], exports: [],
            widgets: [], enums: [], mixins: [], warnings: [], lastModified: Date.now(),
        };
        let currentClass: string | null = null;
        let braceDepth = 0;
        let classBraceStart = 0;
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
                });
                currentClass = name;
                classBraceStart = braceDepth;
                continue;
            }
            // Track braces
            for (const ch of line) {
                if (ch === '{') { braceDepth++; }
                else if (ch === '}') {
                    braceDepth--;
                    if (currentClass && braceDepth <= classBraceStart) { currentClass = null; }
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
            // Methods
            if (currentClass) {
                const m = line.match(/^\s+(static\s+)?([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(async\s*)?\{/);
                if (m && !SKIP_METHODS.has(m[3]) && m[3] !== currentClass) {
                    result.functions.push({
                        name: m[3], returnType: m[2].trim(), params: m[4].trim(),
                        line: lineNum, isPrivate: m[3].startsWith('_'),
                        isAsync: !!m[5], isStatic: !!m[1], parentClass: currentClass,
                    });
                }
                continue;
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
                }
            }
        }
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
}
