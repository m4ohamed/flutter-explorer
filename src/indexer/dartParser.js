"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DartParser = void 0;
const crypto = __importStar(require("crypto"));
const baseParser_js_1 = require("./baseParser.js");
const WIDGET_BASE_CLASSES = new Set([
    'StatelessWidget', 'StatefulWidget', 'HookWidget',
    'HookConsumerWidget', 'ConsumerWidget', 'ConsumerStatefulWidget', 'ConsumerState',
]);
const STATE_BASE_PATTERN = /^(Consumer|Hook|)?State(?:ful)?(?:Widget)?(?:\s*<.*>)?$/;
const NOTIFIER_CLASSES = new Set([
    'ChangeNotifier', 'ValueNotifier', 'StateNotifier', 'Notifier', 'AsyncNotifier',
]);
const SKIP_METHODS = new Set();
const RESERVED = new Set([
    'class', 'enum', 'mixin', 'if', 'for', 'while', 'switch', 'catch', 'try', 'return',
    'import', 'export', 'typedef', 'library', 'part', 'var', 'final', 'const', 'late',
    'get', 'set', 'void', 'dynamic', 'break', 'continue', 'throw', 'rethrow', 'else',
    'case', 'default', 'in', 'is', 'as', 'assert', 'true', 'false', 'null', 'this', 'super',
]);
const NON_DEF_KEYWORDS = new Set([
    'return', 'await', 'throw', 'yield', 'new', 'else', 'case',
    'in', 'is', 'as', 'if', 'for', 'while', 'switch', 'catch', 'assert', 'final', 'var', 'const',
]);
class DartParser extends baseParser_js_1.BaseParser {
    preprocessSource(content) {
        return content
            .replace(/\br'''[\s\S]*?'''|\br"""[\s\S]*?"""/g, m => m.replace(/[^\n]/g, ' '))
            .replace(/\br'[^']*'|\br"[^"]*"/g, m => m.replace(/[^\n]/g, ' '))
            .replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, m => m.replace(/[^\n]/g, ' '))
            .replace(/(["'])((?:\\.|(?!\1)[^\r\n\\])*)\1/g, m => m.replace(/[^\n]/g, ' '))
            .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
            .replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, m => m.replace(/[^\n]/g, ' '));
    }
    findContainer(result, name) {
        return result.classes.find(c => c.name === name)
            ?? result.extensions.find(e => e.name === name)
            ?? result.extensionTypes.find(et => et.name === name);
    }
    attachMethod(result, containerName, method) {
        this.findContainer(result, containerName)?.methods.push(method);
    }
    attachProperty(result, containerName, prop) {
        this.findContainer(result, containerName)?.properties.push(prop);
    }
    parse(filePath, content) {
        try {
            return this._parseInternal(filePath, content);
        }
        catch (err) {
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
    _parseInternal(filePath, content) {
        const lines = content.split('\n');
        const masked = this.preprocessSource(content);
        const maskedLines = masked.split('\n');
        const result = {
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
        const scopeStack = [];
        const currentClass = () => {
            for (let i = scopeStack.length - 1; i >= 0; i--)
                if (scopeStack[i].type === 'class' || scopeStack[i].type === 'extensionType')
                    return scopeStack[i].name;
            return null;
        };
        const currentFunction = () => {
            for (let i = scopeStack.length - 1; i >= 0; i--)
                if (scopeStack[i].type === 'function')
                    return scopeStack[i].name;
            return null;
        };
        let braceDepth = 0;
        let inBuildMethod = false;
        let buildBraceStart = 0;
        let buildLines = [];
        const P = DartParser.P;
        const syncBraces = (lineIdx, count = 1) => {
            for (let k = 0; k < count; k++) {
                const idx = lineIdx + k;
                if (idx >= maskedLines.length)
                    break;
                const mLine = maskedLines[idx];
                for (const ch of mLine) {
                    if (ch === '{') {
                        braceDepth++;
                    }
                    else if (ch === '}') {
                        braceDepth--;
                        while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].braceDepth >= braceDepth) {
                            const popped = scopeStack.pop();
                            if (popped) {
                                const lineNum_ = idx + 1;
                                let actualRef = popped.ref;
                                if (!actualRef) {
                                    if (popped.type === 'class') {
                                        actualRef = result.classes.find(c => c.name === popped.name && c.lineEnd === undefined);
                                    }
                                    else if (popped.type === 'extensionType') {
                                        actualRef = result.extensionTypes.find(e => e.name === popped.name && e.lineEnd === undefined);
                                    }
                                    else if (popped.type === 'function') {
                                        actualRef = result.functions.find(f => f.name === popped.name && f.lineEnd === undefined);
                                        if (!actualRef) {
                                            for (const cls of result.classes) {
                                                actualRef = cls.methods.find(f => f.name === popped.name && f.lineEnd === undefined);
                                                if (actualRef)
                                                    break;
                                            }
                                            if (!actualRef) {
                                                for (const ext of result.extensions) {
                                                    actualRef = ext.methods.find(f => f.name === popped.name && f.lineEnd === undefined);
                                                    if (actualRef)
                                                        break;
                                                }
                                            }
                                            if (!actualRef) {
                                                for (const et of result.extensionTypes) {
                                                    actualRef = et.methods.find(f => f.name === popped.name && f.lineEnd === undefined);
                                                    if (actualRef)
                                                        break;
                                                }
                                            }
                                        }
                                    }
                                }
                                if (actualRef) {
                                    actualRef.lineEnd = lineNum_;
                                    const startLine = actualRef.line - 1;
                                    const endLine = lineNum_ - 1;
                                    if (startLine >= 0 && endLine < maskedLines.length && startLine <= endLine) {
                                        const bodyLines = maskedLines.slice(startLine, endLine + 1);
                                        const rawBody = bodyLines.join(' ');
                                        const normalizedBody = rawBody.replace(new RegExp(`\\b${popped.name}\\b`, 'g'), '').replace(/\s+/g, '');
                                        actualRef.bodyLength = normalizedBody.length;
                                        actualRef.bodyHash = crypto.createHash('md5').update(normalizedBody).digest('hex');
                                    }
                                }
                            }
                        }
                        if (inBuildMethod && braceDepth <= buildBraceStart) {
                            inBuildMethod = false;
                            const wt = this.parseWidgetTree(buildLines.join('\n'), true);
                            if (wt.length > 0)
                                result.widgets.push(...wt);
                            buildLines = [];
                        }
                    }
                }
            }
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const maskedLine = maskedLines[i];
            const trimmed = maskedLine.trim();
            const lineNum = i + 1;
            if (trimmed === '')
                continue;
            if (/^\s*$/.test(trimmed))
                continue;
            const imp = trimmed.match(P.import_);
            if (imp) {
                result.imports.push({
                    path: imp[1], alias: imp[2] || null,
                    showNames: imp[3] ? imp[3].split(',').map(s => s.trim()) : [],
                    hideNames: imp[4] ? imp[4].split(',').map(s => s.trim()) : [],
                    line: lineNum,
                });
                syncBraces(i);
                continue;
            }
            const exp = trimmed.match(P.export_);
            if (exp) {
                result.exports.push(exp[1]);
                syncBraces(i);
                continue;
            }
            if (trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.startsWith('show ') || trimmed.startsWith('hide ')) {
                syncBraces(i);
                continue;
            }
            const textMatch = line.match(P.hardText);
            if (textMatch) {
                const idx = textMatch.index ?? -1;
                if (idx !== -1 && maskedLine[idx] === 'T') {
                    const matchedStr = textMatch[0];
                    const afterMatch = line.substring(idx + matchedStr.length, idx + matchedStr.length + 40);
                    const fullContext = matchedStr + afterMatch;
                    if (!fullContext.includes('.tr') && !fullContext.includes('S.of') && !fullContext.includes('Intl.message')) {
                        result.warnings.push({ type: 'hardcoded_text', message: `Hardcoded text: ${matchedStr}`, line: lineNum });
                    }
                }
            }
            const colorMatch = maskedLine.match(P.hardColor);
            if (colorMatch && !filePath.toLowerCase().includes('theme') && !filePath.toLowerCase().includes('color')) {
                result.warnings.push({ type: 'hardcoded_color', message: `Hardcoded color: ${colorMatch[0]}`, line: lineNum });
            }
            const enm = trimmed.match(P.enum_);
            if (enm) {
                result.enums.push({ name: enm[1], values: this.extractEnumValues(lines, i, maskedLines), line: lineNum, isPrivate: enm[1].startsWith('_') });
                syncBraces(i);
                continue;
            }
            const mix = trimmed.match(P.mixin_);
            if (mix) {
                result.mixins.push({ name: mix[1], on: mix[2] || null, line: lineNum, isPrivate: mix[1].startsWith('_') });
                syncBraces(i);
                continue;
            }
            const extMatch = trimmed.match(P.extension_);
            if (extMatch) {
                const name = extMatch[1] || `UnnamedExtension_${lineNum}`;
                const newExt = { name, onType: extMatch[2].trim(), methods: [], properties: [], line: lineNum, isPrivate: name.startsWith('_') };
                result.extensions.push(newExt);
                scopeStack.push({ type: 'class', name, braceDepth, ref: newExt });
                syncBraces(i);
                continue;
            }
            if (!currentClass()) {
                const td = trimmed.match(P.typedef_);
                if (td) {
                    result.typedefs.push({
                        name: td[1], signature: td[2].trim(),
                        line: lineNum, isPrivate: td[1].startsWith('_'),
                    });
                    syncBraces(i);
                    continue;
                }
                const tdOld = trimmed.match(P.typedefOld_);
                if (tdOld) {
                    result.typedefs.push({
                        name: tdOld[2], signature: `${tdOld[1].trim()} Function(${tdOld[3].trim()})`,
                        line: lineNum, isPrivate: tdOld[2].startsWith('_'),
                    });
                    syncBraces(i);
                    continue;
                }
            }
            const annotationMatch = trimmed.match(P.annotation);
            if (annotationMatch) {
                const nextMasked = maskedLines[i + 1]?.trim() || '';
                let target = 'unknown';
                let targetName = '';
                if (nextMasked.match(/^(class|enum|mixin)\s+(\w+)/)) {
                    target = 'class';
                    targetName = nextMasked.match(/^(class|enum|mixin)\s+(\w+)/)?.[2] || '';
                }
                else if (nextMasked.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+(\w+)\s*\(/)) {
                    target = 'function';
                    targetName = nextMasked.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+(\w+)\s*\(/)?.[2] || '';
                }
                else if (nextMasked.match(/^\s+(final|const|late)?\s*(final|const)?\s*[\w<>\[\]?,\s]+\s+(\w+)\s*=/)) {
                    target = 'field';
                    targetName = nextMasked.match(/^\s+(final|const|late)?\s*(final|const)?\s*[\w<>\[\]?,\s]+\s+(\w+)\s*=/)?.[3] || '';
                }
                result.annotations.push({ name: annotationMatch[1], target, targetName, line: lineNum });
            }
            if (!currentClass()) {
                const extType = trimmed.match(P.extensionType_);
                if (extType) {
                    const name = extType[2];
                    const newExtType = {
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
            const lookahead = maskedLines.slice(i, i + 5).join('\n');
            const cls = lookahead.match(P.class_);
            if (cls && !cls[0].includes('(') && !cls[0].includes(')')) {
                const name = cls[3];
                const ext = cls[4]?.trim() || null;
                let type = 'plain';
                if (ext) {
                    if (WIDGET_BASE_CLASSES.has(ext))
                        type = ext;
                    else if (STATE_BASE_PATTERN.test(ext))
                        type = 'State';
                    else if (NOTIFIER_CLASSES.has(ext))
                        type = 'ChangeNotifier';
                }
                const newCls = {
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
            const ccName = currentClass();
            if (ccName) {
                const currentCls = result.classes.find(c => c.name === ccName && c.type === 'plain');
                if (currentCls) {
                    const extMatch = trimmed.match(/extends\s+([\w<>,\s]+)/);
                    if (extMatch) {
                        const ext = extMatch[1].trim();
                        if (WIDGET_BASE_CLASSES.has(ext))
                            currentCls.type = ext;
                        else if (STATE_BASE_PATTERN.test(ext))
                            currentCls.type = 'State';
                    }
                }
            }
            syncBraces(i);
            if (currentClass() && P.buildMethod.test(trimmed)) {
                const buildMatch = trimmed.match(P.buildMethod);
                const cc = currentClass();
                if (buildMatch && cc) {
                    const methodName = buildMatch[1];
                    const methodInfo = {
                        name: methodName, returnType: trimmed.split(/\s+/)[0] || 'Widget', params: buildMatch[2].trim().replace(/\n/g, ' '),
                        line: lineNum, isPrivate: methodName.startsWith('_'),
                        isAsync: false, isStatic: false, parentClass: cc,
                    };
                    this.attachMethod(result, cc, methodInfo);
                    const hLines = buildMatch[0].split('\n').length;
                    syncBraces(i, hLines);
                    scopeStack.push({ type: 'function', name: methodName, braceDepth: braceDepth - 1, ref: methodInfo });
                    inBuildMethod = true;
                    buildBraceStart = braceDepth - 1;
                    buildLines = [];
                    const braceIdx = line.indexOf('{');
                    if (braceIdx !== -1 && braceIdx < line.length - 1) {
                        buildLines.push(maskedLine.substring(braceIdx + 1));
                    }
                    i += hLines - 1;
                    continue;
                }
            }
            if (inBuildMethod) {
                buildLines.push(maskedLine);
                continue;
            }
            const cc = currentClass();
            if (cc) {
                const mLookahead = maskedLines.slice(i, i + 30).join('\n');
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
                    syncBraces(i, hLines);
                    i += hLines - 1;
                    continue;
                }
                const methodMatch = mLookahead.match(P.method);
                if (methodMatch && !SKIP_METHODS.has(methodMatch[3]) && !RESERVED.has(methodMatch[3]) && methodMatch[3] !== cc) {
                    const methodInfo = {
                        name: methodMatch[3], returnType: methodMatch[2].trim(), params: methodMatch[4].trim().replace(/\n/g, ' '),
                        line: lineNum, isPrivate: methodMatch[3].startsWith('_'),
                        isAsync: !!methodMatch[5], isStatic: !!methodMatch[1], parentClass: cc,
                    };
                    this.attachMethod(result, cc, methodInfo);
                    const hLines = methodMatch[0].split('\n').length;
                    syncBraces(i, hLines);
                    scopeStack.push({ type: 'function', name: methodMatch[3], braceDepth: braceDepth - 1, ref: methodInfo });
                    i += hLines - 1;
                    continue;
                }
                const getterMatch = maskedLine.match(P.getter);
                if (getterMatch) {
                    const prop = {
                        name: getterMatch[3], type: getterMatch[2] ? getterMatch[2].trim() : 'dynamic', className: cc,
                        isFinal: false, isConst: false, isStatic: !!getterMatch[1], isPrivate: getterMatch[3].startsWith('_'),
                        isGetter: true, isSetter: false, line: lineNum,
                    };
                    result.properties.push(prop);
                    this.attachProperty(result, cc, prop);
                }
                else {
                    const setterMatch = maskedLine.match(P.setter);
                    if (setterMatch) {
                        const prop = {
                            name: setterMatch[3], type: setterMatch[4] ? setterMatch[4].trim() : 'dynamic', className: cc,
                            isFinal: false, isConst: false, isStatic: !!setterMatch[1], isPrivate: setterMatch[3].startsWith('_'),
                            isGetter: false, isSetter: true, line: lineNum,
                        };
                        result.properties.push(prop);
                        this.attachProperty(result, cc, prop);
                    }
                    else {
                        const fieldMatch = maskedLine.match(P.field);
                        if (fieldMatch && !fieldMatch[5].includes('(') && !SKIP_METHODS.has(fieldMatch[5]) && !fieldMatch[0].includes('=>') && !RESERVED.has(fieldMatch[5])) {
                            const prop = {
                                name: fieldMatch[5], type: fieldMatch[4] ? fieldMatch[4].trim() : 'dynamic', className: cc,
                                isFinal: fieldMatch[2] === 'final' || fieldMatch[3] === 'final',
                                isConst: fieldMatch[2] === 'const' || fieldMatch[3] === 'const',
                                isStatic: !!fieldMatch[1], isPrivate: fieldMatch[5].startsWith('_'),
                                isGetter: false, isSetter: false, line: lineNum,
                            };
                            result.properties.push(prop);
                            this.attachProperty(result, cc, prop);
                        }
                    }
                }
            }
            if (!currentClass() && braceDepth === 0) {
                const fLookahead = maskedLines.slice(i, i + 30).join('\n');
                const f = fLookahead.match(P.topFunc);
                if (f && !RESERVED.has(f[2])) {
                    const newFunc = {
                        name: f[2], returnType: f[1].trim(), params: f[3].trim().replace(/\n/g, ' '),
                        line: lineNum, isPrivate: f[2].startsWith('_'),
                        isAsync: !!f[4], isStatic: false, parentClass: null,
                    };
                    result.functions.push(newFunc);
                    const hLines = f[0].split('\n').length;
                    syncBraces(i, hLines);
                    scopeStack.push({ type: 'function', name: f[2], braceDepth: braceDepth - 1, ref: newFunc });
                    i += hLines - 1;
                }
                else {
                    const varMatch = trimmed.match(P.topVar);
                    if (varMatch && !RESERVED.has(varMatch[4])) {
                        result.variables.push({
                            name: varMatch[4], type: varMatch[3] ? varMatch[3].trim() : 'dynamic',
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
        this.detectDuplicatedLogic(result);
        return result;
    }
    extractEnumValues(lines, startIndex, maskedLines) {
        const safeLines = maskedLines ?? lines;
        let depth = 0;
        let started = false;
        let raw = '';
        outer: for (let i = startIndex; i < safeLines.length; i++) {
            const line = safeLines[i];
            for (const ch of line) {
                if (ch === '{') {
                    depth++;
                    if (depth === 1) {
                        started = true;
                        continue;
                    }
                }
                else if (ch === '}') {
                    depth--;
                    if (started && depth === 0)
                        break outer;
                }
                else if (ch === ';' && depth === 1) {
                    break outer;
                }
                if (started && depth >= 1)
                    raw += ch;
            }
            if (started)
                raw += '\n';
        }
        const values = [];
        let level = 0;
        let current = '';
        const flush = () => {
            const cleaned = current.replace(/@\w+(\([^)]*\))?/g, '').trim();
            const m = cleaned.match(/^(\w+)/);
            if (m && !RESERVED.has(m[1]))
                values.push(m[1]);
            current = '';
        };
        for (const ch of raw) {
            if (ch === '(' || ch === '<' || ch === '[')
                level++;
            else if (ch === ')' || ch === '>' || ch === ']')
                level--;
            if (ch === ',' && level === 0)
                flush();
            else
                current += ch;
        }
        if (current.trim())
            flush();
        return values;
    }
    detectDuplicatedLogic(result) {
        const MIN_BODY_LENGTH = 80;
        const byHash = new Map();
        const collect = (fns, scope) => {
            for (const f of fns) {
                if (!f.bodyHash || (f.bodyLength ?? 0) < MIN_BODY_LENGTH)
                    continue;
                const label = scope ? `${scope}.${f.name}` : f.name;
                const arr = byHash.get(f.bodyHash) ?? [];
                arr.push({ name: label, line: f.line });
                byHash.set(f.bodyHash, arr);
            }
        };
        collect(result.functions, null);
        for (const c of result.classes)
            collect(c.methods, c.name);
        for (const e of result.extensions)
            collect(e.methods, e.name);
        for (const et of result.extensionTypes)
            collect(et.methods, et.name);
        for (const entries of byHash.values()) {
            if (entries.length < 2)
                continue;
            for (const entry of entries) {
                const others = entries
                    .filter(o => o !== entry)
                    .map(o => `'${o.name}' (line ${o.line})`)
                    .join(', ');
                result.warnings.push({
                    type: 'duplicated_logic',
                    message: `Duplicated logic: '${entry.name}' has the same body as ${others}`,
                    line: entry.line,
                });
            }
        }
    }
    parseWidgetTree(content, isMasked = false) {
        const widgets = [];
        const masked = isMasked ? content : this.preprocessSource(content);
        const lines = content.split('\n');
        const maskedLines = masked.split('\n');
        const stack = [];
        for (let i = 0; i < maskedLines.length; i++) {
            const mLine = maskedLines[i];
            const trimmedMasked = mLine.trim();
            if (!trimmedMasked || trimmedMasked.startsWith('//') || trimmedMasked.startsWith('*'))
                continue;
            const matches = trimmedMasked.matchAll(/(?:\b|return\s+|=>\s+)(_?[A-Z]\w+)(?:<[\w$,\s<>?\[\]]*>)?(?:\.\w+)?\s*\(/g);
            for (const wm of matches) {
                const indent = mLine.length - mLine.trimStart().length;
                const name = wm[1];
                if (RESERVED.has(name.toLowerCase()) || ['String', 'int', 'double', 'bool', 'List', 'Map', 'Set', 'Future', 'Stream', 'Duration', 'DateTime', 'TextEditingController', 'GlobalKey', 'AnimationController', 'ScrollController'].includes(name))
                    continue;
                const originalTrimmed = lines[i].trim();
                const lineRemaining = originalTrimmed.substring(wm.index + wm[0].length);
                if (/^\s*\)\s*=>/.test(lineRemaining))
                    continue;
                let detail = '';
                const detailMatch = lineRemaining.match(/^(['"])(.*?)\1/);
                if (detailMatch)
                    detail = detailMatch[2];
                else {
                    const iconMatch = lineRemaining.match(/^(Icons\.\w+)/);
                    if (iconMatch)
                        detail = iconMatch[1];
                }
                const widget = {
                    name,
                    line: i + 1,
                    children: [],
                    properties: detail ? [{ name: 'detail', value: detail }] : []
                };
                while (stack.length > 0 && stack[stack.length - 1].depth >= indent) {
                    stack.pop();
                }
                if (stack.length > 0) {
                    stack[stack.length - 1].widget.children.push(widget);
                }
                else {
                    widgets.push(widget);
                }
                stack.push({ widget, depth: indent });
            }
        }
        return widgets;
    }
    analyzeUsages(maskedLines, result) {
        const symbols = [];
        const addSymbol = (kind, name, defSnippets) => symbols.push({ kind, name, pattern: new RegExp(`\\b${name}\\b`), defSnippets });
        for (const c of result.classes)
            addSymbol('class', c.name, [`class ${c.name}`, `extends ${c.name}`]);
        for (const f of result.functions)
            addSymbol('function', f.name, [`${f.name}(`]);
        for (const e of result.extensions)
            addSymbol('extension', e.name, [`extension ${e.name}`]);
        for (const t of result.typedefs)
            addSymbol('typedef', t.name, [`typedef ${t.name}`]);
        for (const v of result.variables)
            addSymbol('variable', v.name, [`${v.name} =`, `${v.name}=`]);
        for (const e of result.enums)
            addSymbol('enum', e.name, [`enum ${e.name}`]);
        for (const m of result.mixins)
            addSymbol('mixin', m.name, [`mixin ${m.name}`]);
        for (const et of result.extensionTypes)
            addSymbol('class', et.name, [`extension type ${et.name}`]);
        const classUsageMap = new Map(result.classes.map(c => [c.name, { className: c.name, usedInFiles: [result.filePath], usedByClasses: [], usedByFunctions: [], confidence: 'medium' }]));
        const funcUsageMap = new Map(result.functions.map(f => [f.name, { functionName: f.name, parentClass: f.parentClass, calledByFunctions: [], calledInFiles: [result.filePath], confidence: 'medium' }]));
        const extUsageMap = new Map(result.extensions.map(e => [e.name, { extensionName: e.name, usedInFiles: [], confidence: 'medium' }]));
        const typedefUsageMap = new Map(result.typedefs.map(t => [t.name, { typedefName: t.name, usedInFiles: [], confidence: 'medium' }]));
        const varUsageMap = new Map(result.variables.map(v => [v.name, { variableName: v.name, usedInFiles: [], confidence: 'medium' }]));
        const enumUsageMap = new Map(result.enums.map(e => [e.name, { enumName: e.name, usedInFiles: [], confidence: 'medium' }]));
        const mixinUsageMap = new Map(result.mixins.map(m => [m.name, { mixinName: m.name, usedInFiles: [], confidence: 'medium' }]));
        const symbolMap = new Map();
        for (const sym of symbols) {
            let arr = symbolMap.get(sym.name);
            if (!arr) {
                arr = [];
                symbolMap.set(sym.name, arr);
            }
            arr.push(sym);
        }
        let curCls = null;
        let curFunc = null;
        let bDepth = 0;
        let clsBrace = 0;
        let funcBrace = 0;
        for (let i = 0; i < maskedLines.length; i++) {
            const mLine = maskedLines[i];
            const trimmed = mLine.trim();
            for (const ch of mLine) {
                if (ch === '{')
                    bDepth++;
                else if (ch === '}') {
                    bDepth--;
                    if (curCls && bDepth <= clsBrace)
                        curCls = null;
                    if (curFunc && bDepth <= funcBrace)
                        curFunc = null;
                }
            }
            const cMatch = trimmed.match(/^(class|mixin|extension\s+type|extension|enum)\s+(?:const\s+)?(\w+)/);
            if (cMatch) {
                curCls = cMatch[2];
                clsBrace = bDepth - 1;
            }
            const fMatch = trimmed.match(DartParser.P.funcDef);
            if (fMatch && !RESERVED.has(fMatch[2])) {
                const firstWord = fMatch[1].trim().split(/\s+/)[0];
                if (!NON_DEF_KEYWORDS.has(firstWord)) {
                    curFunc = fMatch[2];
                    funcBrace = bDepth - 1;
                }
            }
            const ctx = {
                type: curFunc ? 'function' : (curCls ? 'class' : 'none'),
                name: curFunc || curCls || ''
            };
            const words = mLine.match(/\b[A-Za-z_]\w*\b/g);
            if (!words)
                continue;
            const uniqueWords = new Set(words);
            for (const word of uniqueWords) {
                const syms = symbolMap.get(word);
                if (!syms)
                    continue;
                for (const sym of syms) {
                    if (sym.defSnippets.some(s => mLine.includes(s)))
                        continue;
                    switch (sym.kind) {
                        case 'class': {
                            const u = classUsageMap.get(sym.name);
                            if (ctx.type === 'class' && ctx.name !== sym.name && !u.usedByClasses.includes(ctx.name))
                                u.usedByClasses.push(ctx.name);
                            if (ctx.type === 'function' && !u.usedByFunctions.includes(ctx.name))
                                u.usedByFunctions.push(ctx.name);
                            break;
                        }
                        case 'function': {
                            const u = funcUsageMap.get(sym.name);
                            if (ctx.type === 'function' && ctx.name !== sym.name && !u.calledByFunctions.includes(ctx.name))
                                u.calledByFunctions.push(ctx.name);
                            break;
                        }
                        case 'extension': {
                            const u = extUsageMap.get(sym.name);
                            if (!u.usedInFiles.includes(result.filePath))
                                u.usedInFiles.push(result.filePath);
                            break;
                        }
                        case 'typedef': {
                            const u = typedefUsageMap.get(sym.name);
                            if (!u.usedInFiles.includes(result.filePath))
                                u.usedInFiles.push(result.filePath);
                            break;
                        }
                        case 'variable': {
                            const u = varUsageMap.get(sym.name);
                            if (!u.usedInFiles.includes(result.filePath))
                                u.usedInFiles.push(result.filePath);
                            break;
                        }
                        case 'enum': {
                            const u = enumUsageMap.get(sym.name);
                            if (!u.usedInFiles.includes(result.filePath))
                                u.usedInFiles.push(result.filePath);
                            break;
                        }
                        case 'mixin': {
                            const u = mixinUsageMap.get(sym.name);
                            if (!u.usedInFiles.includes(result.filePath))
                                u.usedInFiles.push(result.filePath);
                            break;
                        }
                    }
                }
            }
        }
        result.classUsages = [...classUsageMap.values()];
        result.functionUsages = [...funcUsageMap.values()];
        result.extensionUsages = [...extUsageMap.values()];
        result.typedefUsages = [...typedefUsageMap.values()];
        result.variableUsages = [...varUsageMap.values()];
        result.enumUsages = [...enumUsageMap.values()];
        result.mixinUsages = [...mixinUsageMap.values()];
        for (const a of result.annotations) {
            if (!result.annotationUsages.find(au => au.annotationName === a.name))
                result.annotationUsages.push({ annotationName: a.name, usedInFiles: [result.filePath], confidence: 'medium' });
        }
        const ctorEntries = result.constructors.map(c => {
            const fullName = c.name === c.className ? c.className : `${c.className}.${c.name}`;
            return {
                fullName,
                pattern: new RegExp(`\\b${fullName.replace('.', '\\.')}\\b`),
                usage: { constructorName: c.name, className: c.className, usedInFiles: [], confidence: 'medium' },
            };
        });
        const propEntries = result.properties.map(p => ({
            name: p.name,
            pattern: new RegExp(`\\b${p.name}\\b`),
            usage: { propertyName: p.name, className: p.className, usedInFiles: [], confidence: 'medium' },
        }));
        let pendingCtors = ctorEntries.length;
        let pendingProps = propEntries.length;
        for (const ml of maskedLines) {
            if (pendingCtors === 0 && pendingProps === 0)
                break;
            if (pendingCtors > 0) {
                for (const e of ctorEntries) {
                    if (e.usage.usedInFiles.length > 0)
                        continue;
                    if (e.pattern.test(ml) && !ml.includes(`${e.fullName}(`)) {
                        e.usage.usedInFiles.push(result.filePath);
                        pendingCtors--;
                    }
                }
            }
            if (pendingProps > 0) {
                for (const e of propEntries) {
                    if (e.usage.usedInFiles.length > 0)
                        continue;
                    if (e.pattern.test(ml) && !ml.includes(`${e.name};`) && !ml.includes(`get ${e.name}`)) {
                        e.usage.usedInFiles.push(result.filePath);
                        pendingProps--;
                    }
                }
            }
        }
        result.constructorUsages.push(...ctorEntries.map(e => e.usage));
        result.propertyUsages.push(...propEntries.map(e => e.usage));
    }
    extractFunctionCalls(maskedLines, result, originalLines) {
        const lines = originalLines ?? maskedLines;
        const classNameSet = new Set(result.classes.map(c => c.name));
        const RESERVED_CALLS = new Set([
            'print', 'setState', 'Navigator', 'Scaffold', 'Container', 'Text',
            'Column', 'Row', 'Stack', 'Padding', 'SizedBox', 'Expanded', 'Flexible',
            'if', 'for', 'while', 'switch', 'return', 'await', 'async', 'try', 'catch',
            'throw', 'finally', 'break', 'continue', 'import', 'export', 'library',
            'part', 'of', 'show', 'hide', 'as', 'is', 'assert', 'rethrow',
        ]);
        let callCurrentClass = null;
        let callCurrentFunction = null;
        let callBraceDepth = 0;
        let callClassBrace = 0;
        let callFuncBrace = 0;
        const callPatLocal = new RegExp(DartParser.P.callPat.source, 'g');
        for (let i = 0; i < maskedLines.length; i++) {
            const mLine = maskedLines[i];
            const trimmed = mLine.trim();
            const lineNum = i + 1;
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'))
                continue;
            if (trimmed.match(/^(class|enum|mixin|import|export)\s/))
                continue;
            for (const ch of mLine) {
                if (ch === '{')
                    callBraceDepth++;
                else if (ch === '}') {
                    callBraceDepth--;
                    if (callCurrentClass && callBraceDepth <= callClassBrace)
                        callCurrentClass = null;
                    if (callCurrentFunction && callBraceDepth <= callFuncBrace)
                        callCurrentFunction = null;
                }
            }
            const classM = trimmed.match(DartParser.P.class_);
            if (classM) {
                callCurrentClass = classM[3];
                callClassBrace = callBraceDepth - 1;
                continue;
            }
            const funcM = trimmed.match(DartParser.P.method);
            if (funcM) {
                callCurrentFunction = funcM[3];
                callFuncBrace = callBraceDepth - 1;
            }
            if (trimmed.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+\w+\s*\([^)]*\)\s*(async\s*)?\{/))
                continue;
            callPatLocal.lastIndex = 0;
            let match;
            while ((match = callPatLocal.exec(mLine)) !== null) {
                const receiver = match[1];
                const funcName = match[2];
                if (RESERVED_CALLS.has(funcName))
                    continue;
                if (funcName === callCurrentFunction)
                    continue;
                if (classNameSet.has(funcName) && mLine.includes(`new ${funcName}`))
                    continue;
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
}
exports.DartParser = DartParser;
DartParser.P = {
    import_: /^import\s+['"]([^'"]+)['"]\s*(?:as\s+([\w$]+))?\s*(?:show\s+([\w$,\s]+))?\s*(?:hide\s+([\w$,\s]+))?\s*;/,
    export_: /^export\s+['"]([^'"]+)['"]\s*;/,
    hardText: /Text\s*\(\s*(['"])(.*?)\1/,
    hardColor: /Color\s*\(\s*0x[A-Fa-f0-9]{8}\s*\)|Colors\.[a-zA-Z0-9_$]+/,
    enum_: /^enum\s+([\w$]+)\s*\{/,
    mixin_: /^mixin\s+(?!class\b)([\w$]+)(?:\s+on\s+([\w$]+))?\s*\{/,
    extension_: /^extension\s+([\w$]+)?\s+on\s+([\w$<>\[\]?,\s]+?)\s*\{/,
    extensionType_: /^extension\s+type\s+(const\s+)?([\w$]+)(?:\.([\w$]+))?\s*\(([\w$<>\[\]?,\s]+)\)(?:\s+implements\s+([\w$<>,\s]+))?\s*\{/,
    typedef_: /^typedef\s+([\w$]+)\s*=\s*([^;]+);/,
    typedefOld_: /^typedef\s+([\w$<>\[\]?,\s]+?)\s+([\w$]+)\s*\(([^)]*)\);/,
    annotation: /^@([\w$]+)/,
    class_: /^((?:abstract\s+|sealed\s+|base\s+|interface\s+|final\s+)*)(mixin\s+)?class\s+([\w$]+)(?:\s+extends\s+((?:(?!with\b|implements\b)[\w$<>,\s\[\]])+))?(?:\s*with\s+((?:(?!implements\b)[\w$<>,\s\[\]])+))?(?:\s*implements\s+([\w$<>,\s\[\]]+))?/,
    ctor: /^\s*(const\s+)?(factory\s+)?([\w$]+)(?:\.([\w$]+))?\s*\(([^)(]*(?:\([^)(]*\)[^)(]*)*)\)\s*(?::[^{;]*)?([\{;])/,
    buildMethod: /(?:Widget|Route|PreferredSizeWidget|StatelessWidget|StatefulWidget)\s+([\w$]+)\s*\(([^)]*)\)/,
    method: /^\s*(static\s+)?([\w$][\w$<>\[\]?,\s]*?)\s+([\w$]+)(?:<[\w$,\s<>]*>)?\s*\(([^)(]*(?:\([^)(]*\)[^)(]*)*)\)\s*(async\*?|sync\*?)?\s*[\{=>;]/,
    getter: /^\s*(static\s+)?(?:([\w$<>\[\]?,\s]+?)\s+)?get\s+([\w$]+)\s*(=>|\{)/,
    setter: /^\s*(static\s+)?(?:([\w$]+)\s+)?set\s+([\w$]+)\s*\(([^)]*)\)/,
    field: /^(?:(static)\s+)?(?:(final|const|late|var)\s+)?(?:(final|const|late|var)\s+)?(?:([\w$<>\[\]?,\s]+?)\s+)?([\w$]+)\s*(?:(=\s*[^;]+|;).*)/,
    topVar: /^(?:(final|const|late|var)\s+)?(?:(final|const|late|var)\s+)?(?:([\w$<>\[\]?,\s]+?)\s+)?([\w$]+)\s*(?:(=\s*[^;]+|;).*)/,
    topFunc: /^([\w$][\w$<>\[\]?,\s]*?)\s+([\w$]+)(?:<[\w$,\s<>]*>)?\s*\(([^)(]*(?:\([^)(]*\)[^)(]*)*)\)\s*(async\*?|sync\*?)?\s*[\{=>]/,
    callPat: /(?:([a-zA-Z_]\w*)\.)?([a-zA-Z_]\w*)\s*\(/g,
    classDef: /class\s+([\w$]+)/,
    funcDef: /([\w$<>\[\]?,\s]+?)\s+([\w$]+)\s*\(/,
};
