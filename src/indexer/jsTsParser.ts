import { DartFileInfo, ClassInfo, FunctionInfo, FunctionCall, ImportInfo, EnumInfo, MixinInfo, WarningInfo } from './dartParser';

export class JsTsParser {
    /**
     * A simple regex-based parser for JavaScript and TypeScript files.
     * Maps TS/JS syntax to DartFileInfo structure.
     */
    parse(filePath: string, content: string): DartFileInfo {
        const lines = content.split('\n');
        const masked = this.preprocessSource(content);
        const maskedLines = masked.split('\n');

        const result: DartFileInfo = {
            filePath,
            classes: [],
            functions: [],
            functionCalls: [],
            imports: [],
            exports: [],
            widgets: [],
            enums: [],
            mixins: [],
            warnings: [],
            lastModified: Date.now(),
            classUsages: [],
            functionUsages: [],
            extensionUsages: [],
            typedefUsages: [],
            variableUsages: [],
            constructorUsages: [],
            propertyUsages: [],
            annotationUsages: [],
            enumUsages: [],
            mixinUsages: [],
            extensions: [],
            typedefs: [],
            variables: [],
            constructors: [],
            properties: [],
            annotations: [],
            extensionTypes: [],
        };

        // Regex patterns
        const P = {
            importes6: /import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]/,
            importCommonjs: /(?:const|let|var)\s+[\w*\s{},]+\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/,
            class_: /class\s+(\w+)(?:\s+extends\s+([\w.]+))?/,
            function_: /function\s+(\w+)\s*\(([^)]*)\)/,
            arrowFunction: /(?:const|let|var|export)\s+(\w+)\s*=\s*(?:\([^)]*\)|[\w]+)\s*=>/,
            enum_: /enum\s+(\w+)/,
            interface_: /interface\s+(\w+)/,
            type_: /type\s+(\w+)\s*=/,
            variable: /(?:const|let|var)\s+(\w+)\s*=/,
            hardText: /['"]([^'"]*?[a-zA-Z]{3,}[^'"]*?)['"]/, // strings with at least 3 letters
            hardColor: /#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})|rgba?\([^)]+\)/,
        };

        let braceDepth = 0;
        interface ScopeFrame {
            type: 'class' | 'function';
            name: string;
            braceDepth: number;
            ref: any;
        }
        const scopeStack: ScopeFrame[] = [];

        const currentClass = (): string | null => {
            for (let i = scopeStack.length - 1; i >= 0; i--) {
                if (scopeStack[i].type === 'class') return scopeStack[i].name;
            }
            return null;
        };

        const syncBraces = (lineIdx: number) => {
            const mLine = maskedLines[lineIdx];
            for (const ch of mLine) {
                if (ch === '{') {
                    braceDepth++;
                } else if (ch === '}') {
                    braceDepth--;
                    while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].braceDepth >= braceDepth) {
                        const popped = scopeStack.pop();
                        if (popped && popped.ref) {
                            popped.ref.lineEnd = lineIdx + 1;
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

            if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                continue;
            }

            // Sync braces
            syncBraces(i);

            // 1. Imports
            const impES6 = trimmed.match(P.importes6);
            if (impES6) {
                result.imports.push({
                    path: impES6[1],
                    alias: null,
                    showNames: [],
                    hideNames: [],
                    line: lineNum
                });
                continue;
            }
            const impCJS = trimmed.match(P.importCommonjs);
            if (impCJS) {
                result.imports.push({
                    path: impCJS[1],
                    alias: null,
                    showNames: [],
                    hideNames: [],
                    line: lineNum
                });
                continue;
            }

            // 2. Warnings (Hardcoded text & colors)
            const textMatch = line.match(P.hardText);
            if (textMatch) {
                const idx = textMatch.index ?? -1;
                // Only consider if not inside comments/strings in masked source
                if (idx !== -1 && maskedLine[idx] === ' ' && !trimmed.includes('import') && !trimmed.includes('require')) {
                    const matchedStr = textMatch[0];
                    if (!trimmed.includes('console.log') && !trimmed.includes('t(') && !trimmed.includes('i18n')) {
                        result.warnings.push({
                            type: 'hardcoded_text',
                            message: `Hardcoded text: ${matchedStr}`,
                            line: lineNum
                        });
                    }
                }
            }
            const colorMatch = maskedLine.match(P.hardColor);
            if (colorMatch && !filePath.toLowerCase().includes('theme') && !filePath.toLowerCase().includes('color')) {
                result.warnings.push({
                    type: 'hardcoded_color',
                    message: `Hardcoded color: ${colorMatch[0]}`,
                    line: lineNum
                });
            }

            // 3. Enums
            const enm = trimmed.match(P.enum_);
            if (enm) {
                result.enums.push({
                    name: enm[1],
                    values: [],
                    line: lineNum,
                    isPrivate: enm[1].startsWith('_')
                });
                continue;
            }

            // 4. Interfaces (mapped to mixins)
            const interf = trimmed.match(P.interface_);
            if (interf) {
                result.mixins.push({
                    name: interf[1],
                    on: null,
                    line: lineNum,
                    isPrivate: interf[1].startsWith('_')
                });
                continue;
            }

            // 5. Types (mapped to typedefs)
            const typ = trimmed.match(P.type_);
            if (typ) {
                result.typedefs.push({
                    name: typ[1],
                    signature: '',
                    line: lineNum,
                    isPrivate: typ[1].startsWith('_')
                });
                continue;
            }

            // 6. Classes
            const cls = trimmed.match(P.class_);
            if (cls) {
                const name = cls[1];
                const extendsClass = cls[2] || null;
                
                // Heuristic: If it extends React Component/PureComponent, treat as a Widget/Component
                let type: ClassInfo['type'] = 'plain';
                if (extendsClass && (extendsClass.includes('Component') || extendsClass.includes('PureComponent'))) {
                    type = 'StatelessWidget';
                }

                const newCls: ClassInfo = {
                    name,
                    type,
                    line: lineNum,
                    extendsClass,
                    mixins: [],
                    implements: [],
                    isAbstract: trimmed.includes('abstract'),
                    isPrivate: name.startsWith('_'),
                    methods: [],
                    properties: []
                };

                result.classes.push(newCls);
                scopeStack.push({ type: 'class', name, braceDepth: braceDepth - 1, ref: newCls });

                if (type !== 'plain') {
                    result.widgets.push({
                        name,
                        line: lineNum,
                        children: [],
                        properties: []
                    });
                }
                continue;
            }

            // 7. Class Members (Constructors, Methods)
            const cc = currentClass();
            if (cc) {
                if (trimmed.startsWith('constructor')) {
                    const paramsMatch = trimmed.match(/constructor\s*\(([^)]*)\)/);
                    result.constructors.push({
                        name: 'constructor',
                        className: cc,
                        isFactory: false,
                        isConst: false,
                        params: paramsMatch ? paramsMatch[1].trim() : '',
                        line: lineNum
                    });
                    continue;
                }

                const methodMatch = trimmed.match(/^async\s+(\w+)\s*\(([^)]*)\)/) || trimmed.match(/^(\w+)\s*\(([^)]*)\)/);
                if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
                    const isAsync = trimmed.startsWith('async');
                    const name = methodMatch[1];
                    const params = methodMatch[2];

                    const methodInfo: FunctionInfo = {
                        name,
                        returnType: 'any',
                        params,
                        line: lineNum,
                        isPrivate: name.startsWith('_') || name.startsWith('#'),
                        isAsync,
                        isStatic: trimmed.startsWith('static'),
                        parentClass: cc
                    };

                    const parentCls = result.classes.find(c => c.name === cc);
                    if (parentCls) parentCls.methods.push(methodInfo);
                    continue;
                }
            }

            // 8. Top-level Functions / Arrow Functions & Variables
            if (!cc) {
                const funcMatch = trimmed.match(P.function_);
                if (funcMatch) {
                    const name = funcMatch[1];
                    // PascalCase heuristic for React Functional Components
                    if (name[0] === name[0].toUpperCase() && name[0] !== '_') {
                        result.widgets.push({
                            name,
                            line: lineNum,
                            children: [],
                            properties: []
                        });
                    }

                    const newFunc: FunctionInfo = {
                        name,
                        returnType: 'any',
                        params: funcMatch[2],
                        line: lineNum,
                        isPrivate: name.startsWith('_'),
                        isAsync: trimmed.includes('async'),
                        isStatic: false,
                        parentClass: null
                    };
                    result.functions.push(newFunc);
                    scopeStack.push({ type: 'function', name, braceDepth: braceDepth - 1, ref: newFunc });
                    continue;
                }

                const arrowMatch = trimmed.match(P.arrowFunction);
                if (arrowMatch) {
                    const name = arrowMatch[1];
                    if (name[0] === name[0].toUpperCase() && name[0] !== '_') {
                        result.widgets.push({
                            name,
                            line: lineNum,
                            children: [],
                            properties: []
                        });
                    }

                    const newFunc: FunctionInfo = {
                        name,
                        returnType: 'any',
                        params: '',
                        line: lineNum,
                        isPrivate: name.startsWith('_'),
                        isAsync: trimmed.includes('async'),
                        isStatic: false,
                        parentClass: null
                    };
                    result.functions.push(newFunc);
                    scopeStack.push({ type: 'function', name, braceDepth: braceDepth - 1, ref: newFunc });
                    continue;
                }

                const varMatch = trimmed.match(P.variable);
                if (varMatch && !['const', 'let', 'var', 'export'].includes(varMatch[1])) {
                    const name = varMatch[1];
                    result.variables.push({
                        name,
                        type: 'any',
                        line: lineNum,
                        isConst: trimmed.startsWith('const'),
                        isFinal: false,
                        isPrivate: name.startsWith('_'),
                        isTopLevel: true
                    });
                }
            }
        }

        // 9. Function Calls extraction
        this.extractFunctionCalls(maskedLines, result, lines);

        return result;
    }

    private preprocessSource(content: string): string {
        return content
            // Strings (single, double, template literal backticks)
            .replace(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g, m => ' '.repeat(m.length))
            // Inline comments //
            .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
            // Block comments /* */
            .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    }

    private extractFunctionCalls(maskedLines: string[], result: DartFileInfo, originalLines: string[]) {
        const callPat = /(?:([a-zA-Z_]\w*)\.)?([a-zA-Z_]\w*)\s*\(/g;
        for (let i = 0; i < maskedLines.length; i++) {
            const mLine = maskedLines[i];
            const lineNum = i + 1;
            let match;
            while ((match = callPat.exec(mLine)) !== null) {
                const receiver = match[1] || undefined;
                const name = match[2];
                if (['if', 'for', 'while', 'switch', 'catch', 'require'].includes(name)) continue;

                result.functionCalls.push({
                    name,
                    line: lineNum,
                    callerClass: null,
                    callerFunction: null,
                    context: originalLines[i].trim().substring(0, 80),
                    isStatic: !!receiver,
                    isChained: false,
                    receiver
                });
            }
        }
    }
}
