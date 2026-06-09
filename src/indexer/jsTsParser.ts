import {
  DartFileInfo,
  ClassInfo,
  FunctionInfo,
  FunctionCall,
  ImportInfo,
  EnumInfo,
  MixinInfo,
  WarningInfo,
  ExtensionInfo,
  TypedefInfo,
  VariableInfo,
  ConstructorInfo,
  PropertyInfo,
  AnnotationInfo,
  ExtensionTypeInfo,
  WidgetInfo,
  ClassUsage,
  FunctionUsage,
  ExtensionUsage,
  TypedefUsage,
  VariableUsage,
  ConstructorUsage,
  PropertyUsage,
  AnnotationUsage,
  EnumUsage,
  MixinUsage
} from './dartParser';

import { BaseParser } from './baseParser.js';

export class JsTsParser extends BaseParser<DartFileInfo> {
  /**
   * A simple regex-based parser for JavaScript and TypeScript files.
   * Maps TS/JS syntax to DartFileInfo structure.
   */
  parse(filePath: string, content: string): DartFileInfo {
    try {
      return this._parseInternal(filePath, content);
    } catch (err) {
      console.error(`[JsTsParser] Failed to parse ${filePath}:`, err);
      return {
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
    }
  }

  private _parseInternal(filePath: string, content: string): DartFileInfo {
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
              if (popped && popped.ref) {
                popped.ref.lineEnd = idx + 1;
              }
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

      // 1.5. Exports / Re-exports
      const expMatch = trimmed.match(/^export\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/);
      if (expMatch) {
        result.exports.push(expMatch[1]);
        continue;
      }

      // 2. Warnings (Hardcoded text & colors)
      // For JSX we use a regex to find text between tags: />([\w\s.,!?]{3,})</
      const textMatch = line.match(/>\s*([a-zA-Z0-9\s.,!?]{3,})\s*</);
      if (textMatch) {
        const matchedStr = textMatch[1].trim();
        // Exclude common programming keywords or single letters
        if (matchedStr.length > 2 && !['import', 'require', 'const', 'let', 'var', 'return'].includes(matchedStr) && !trimmed.includes('console.log') && !trimmed.includes('t(') && !trimmed.includes('i18n')) {
          result.warnings.push({
            type: 'hardcoded_text',
            message: `Hardcoded text: ${matchedStr}`,
            line: lineNum
          });
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

      // 2.5. Decorators → Annotations
      const annotationMatch = trimmed.match(/^@(\w+)/);
      if (annotationMatch) {
        const nextLines = maskedLines.slice(i + 1, i + 5).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'));
        const nextMasked = nextLines[0] || '';
        let target = 'unknown';
        let targetName = '';
        if (nextMasked.match(/^(class|enum)\s+(\w+)/)) {
          target = 'class';
          targetName = nextMasked.match(/^(class|enum)\s+(\w+)/)?.[2] || '';
        } else if (nextMasked.match(/^(?:async\s+)?(\w+)\s*\(/)) {
          target = 'function';
          targetName = nextMasked.match(/^(?:async\s+)?(\w+)\s*\(/)?.[1] || '';
        } else if (nextMasked.match(/^(\w+)\s*(?::|=)/)) {
          target = 'field';
          targetName = nextMasked.match(/^(\w+)\s*(?::|=)/)?.[1] || '';
        }
        result.annotations.push({ name: annotationMatch[1], target, targetName, line: lineNum });
      }

      // 3. Enums
      const enm = trimmed.match(/^(?:export\s+)?enum\s+(\w+)/);
      if (enm) {
        result.enums.push({
          name: enm[1],
          values: this.extractEnumValues(lines, i, maskedLines),
          line: lineNum,
          isPrivate: enm[1].startsWith('_')
        });
        continue;
      }

      // 4. Interfaces (mapped to mixins)
      const interf = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
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
      const typ = trimmed.match(/^(?:export\s+)?type\s+(\w+)\s*=/);
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
      const lookahead = maskedLines.slice(i, i + 5).join('\n');
      const cls = lookahead.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w.]+)(?:<[^>]*>)?)?/);
      if (cls && !cls[0].includes('(') && !cls[0].includes(')')) {
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
          isAbstract: lookahead.includes('abstract'),
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

        const headerLines = cls[0].split('\n').length;
        syncBraces(i, headerLines);
        i += headerLines - 1;
        continue;
      }

      // 7. Class Members (Constructors, Methods, Properties)
      const cc = currentClass();
      if (cc) {
        // Constructor
        if (trimmed.startsWith('constructor') || trimmed.match(/^\s*(?:public|private|protected)?\s*constructor\s*\(/)) {
          const paramsMatch = trimmed.match(/constructor\s*\(([^)]*)\)/);
          const params = paramsMatch ? paramsMatch[1].trim() : '';

          result.constructors.push({
            name: 'constructor',
            className: cc,
            isFactory: false,
            isConst: false,
            params,
            line: lineNum
          });

          // Check for TypeScript constructor shorthand properties
          if (params) {
            const paramList = params.split(',');
            for (const param of paramList) {
              const shorthandMatch = param.trim().match(/^\s*(public|private|protected|readonly)\s+(?:readonly\s+)?(\w+)\s*(?:\?|!)?\s*(?::\s*([^=]+))?/);
              if (shorthandMatch) {
                const modifier = shorthandMatch[1];
                const propName = shorthandMatch[2];
                const propType = shorthandMatch[3] ? shorthandMatch[3].trim() : 'any';

                const prop: PropertyInfo = {
                  name: propName,
                  type: propType,
                  className: cc,
                  isFinal: modifier === 'readonly',
                  isConst: false,
                  isStatic: false,
                  isPrivate: modifier === 'private' || propName.startsWith('_'),
                  isGetter: false,
                  isSetter: false,
                  line: lineNum
                };
                result.properties.push(prop);

                const parentCls = result.classes.find(c => c.name === cc);
                if (parentCls) parentCls.properties.push(prop);
              }
            }
          }
          syncBraces(i);
          continue;
        }

        // Getters
        const getterMatch = trimmed.match(/^\s*(?:public|private|protected|static)?\s*get\s+(\w+)\s*\(\)\s*(?::\s*([^;{]+))?\s*(?:=>|\{)/);
        if (getterMatch) {
          const propName = getterMatch[1];
          const propType = getterMatch[2] ? getterMatch[2].trim() : 'any';
          const prop: PropertyInfo = {
            name: propName,
            type: propType,
            className: cc,
            isFinal: true,
            isConst: false,
            isStatic: trimmed.includes('static'),
            isPrivate: propName.startsWith('_') || propName.startsWith('#'),
            isGetter: true,
            isSetter: false,
            line: lineNum
          };
          result.properties.push(prop);
          const parentCls = result.classes.find(c => c.name === cc);
          if (parentCls) parentCls.properties.push(prop);
          syncBraces(i);
          continue;
        }

        // Setters
        const setterMatch = trimmed.match(/^\s*(?:public|private|protected|static)?\s*set\s+(\w+)\s*\(([^)]*)\)\s*(?:=>|\{)/);
        if (setterMatch) {
          const propName = setterMatch[1];
          const param = setterMatch[2].trim();
          const propType = param.includes(':') ? param.split(':')[1].trim() : 'any';
          const prop: PropertyInfo = {
            name: propName,
            type: propType,
            className: cc,
            isFinal: false,
            isConst: false,
            isStatic: trimmed.includes('static'),
            isPrivate: propName.startsWith('_') || propName.startsWith('#'),
            isGetter: false,
            isSetter: true,
            line: lineNum
          };
          result.properties.push(prop);
          const parentCls = result.classes.find(c => c.name === cc);
          if (parentCls) parentCls.properties.push(prop);
          syncBraces(i);
          continue;
        }

        // Methods (including abstract/interface and override methods)
        const mLookahead = maskedLines.slice(i, i + 5).join('\n');
        const methodMatch = mLookahead.match(/^\s*(?:(public|private|protected|static|abstract|override|async)\s+)*(getter|setter|get|set\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^;{]+))?\s*([;{])/);
        if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[3])) {
          const modifiers = methodMatch[1] || '';
          const isAsync = modifiers.includes('async');
          const isStatic = modifiers.includes('static');
          const name = methodMatch[3];
          const params = methodMatch[4].trim().replace(/\n/g, ' ');
          const returnType = methodMatch[5] ? methodMatch[5].trim() : 'any';
          const bodyType = methodMatch[6];

          const methodInfo: FunctionInfo = {
            name,
            returnType,
            params,
            line: lineNum,
            isPrivate: name.startsWith('_') || name.startsWith('#'),
            isAsync,
            isStatic,
            parentClass: cc
          };

          const parentCls = result.classes.find(c => c.name === cc);
          if (parentCls) parentCls.methods.push(methodInfo);

          if (modifiers.includes('override')) {
            result.annotations.push({ name: 'override', target: 'function', targetName: name, line: lineNum });
          }

          const hLines = methodMatch[0].split('\n').length;
          if (hLines > 1) syncBraces(i + 1, hLines - 1);

          if (bodyType === '{') {
            scopeStack.push({ type: 'function', name, braceDepth: braceDepth - 1, ref: methodInfo });
          } else {
            methodInfo.lineEnd = lineNum + hLines - 1;
          }

          i += hLines - 1;
          continue;
        }

        // Fields (Properties)
        const fieldMatch = trimmed.match(/^\s*(?:(public|private|protected|static|readonly)\s+)*(?:(readonly|static)\s+)*(\w+)\s*(?:\?|!)?\s*(?::\s*([^=;{()]+))?\s*(?:=\s*([^;]+))?;/);
        if (fieldMatch && !['if', 'for', 'while', 'switch', 'catch', 'return', 'import', 'export'].includes(fieldMatch[3])) {
          const modifiers = (fieldMatch[1] || '') + ' ' + (fieldMatch[2] || '');
          const propName = fieldMatch[3];
          const propType = fieldMatch[4] ? fieldMatch[4].trim() : 'any';
          const isStatic = modifiers.includes('static');
          const isPrivate = modifiers.includes('private') || propName.startsWith('_') || propName.startsWith('#');

          const prop: PropertyInfo = {
            name: propName,
            type: propType,
            className: cc,
            isFinal: modifiers.includes('readonly'),
            isConst: false,
            isStatic,
            isPrivate,
            isGetter: false,
            isSetter: false,
            line: lineNum
          };
          result.properties.push(prop);
          const parentCls = result.classes.find(c => c.name === cc);
          if (parentCls) parentCls.properties.push(prop);
          syncBraces(i);
          continue;
        }
      }

      // 8. Top-level Functions / Arrow Functions & Variables
      if (!cc) {
        const lookahead = maskedLines.slice(i, i + 5).join('\n');

        // Match function name() { ... }
        const funcMatch = lookahead.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)/);
        if (funcMatch) {
          const name = funcMatch[1];
          let isReactComponent = false;
          if (name !== name.toUpperCase() && /^[A-Z][a-zA-Z0-9]*$/.test(name)) {
            isReactComponent = true;
          }

          if (isReactComponent) {
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
            isAsync: lookahead.includes('async'),
            isStatic: false,
            parentClass: null
          };
          result.functions.push(newFunc);

          const hLines = funcMatch[0].split('\n').length;
          if (hLines > 1) syncBraces(i + 1, hLines - 1);

          scopeStack.push({ type: 'function', name, braceDepth: braceDepth - 1, ref: newFunc });
          i += hLines - 1;
          continue;
        }

        // Match const/let/var name = (...) => { ... } or memo(...) etc.
        const arrowMatch = lookahead.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:<[^>]*>)?\s*(?:\([^)]*\)|[\w]+)\s*=>/);
        if (arrowMatch) {
          const name = arrowMatch[1];
          let isReactComponent = false;
          if (name !== name.toUpperCase() && /^[A-Z][a-zA-Z0-9]*$/.test(name)) {
            isReactComponent = true;
          } else if (lookahead.includes('memo(') || lookahead.includes('forwardRef(') || lookahead.includes('styled.')) {
            isReactComponent = true;
          }

          if (isReactComponent) {
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
            isAsync: lookahead.includes('async'),
            isStatic: false,
            parentClass: null
          };
          result.functions.push(newFunc);

          const hLines = arrowMatch[0].split('\n').length;
          if (hLines > 1) syncBraces(i + 1, hLines - 1);

          scopeStack.push({ type: 'function', name, braceDepth: braceDepth - 1, ref: newFunc });
          i += hLines - 1;
          continue;
        }

        // Match Top-level variables
        const varMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/);
        if (varMatch && !['const', 'let', 'var', 'export', 'function', 'class', 'enum', 'interface'].includes(varMatch[1])) {
          const name = varMatch[1];
          result.variables.push({
            name,
            type: 'any',
            line: lineNum,
            isConst: trimmed.includes('const'),
            isFinal: false,
            isPrivate: name.startsWith('_'),
            isTopLevel: true
          });
          syncBraces(i);
          continue;
        }
      }
    }

    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
      result.widgets = this.parseJsxToWidgetTree(maskedLines.join('\n'));
    }

    this.analyzeUsages(maskedLines, result);
    this.extractFunctionCalls(maskedLines, result, lines);

    return result;
  }

  private parseJsxToWidgetTree(maskedContent: string): import('./dartParser').WidgetInfo[] {
    const rootWidgets: import('./dartParser').WidgetInfo[] = [];
    const stack: { widget: import('./dartParser').WidgetInfo; depth: number }[] = [];

    // Simple JSX tag parser that finds start tags, self-closing tags, and end tags.
    const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9_.]*)([^>]*?)?(\/?)>/g;

    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(maskedContent)) !== null) {
      const isEnd = !!match[1];
      const tagName = match[2];
      const isSelfClosing = !!match[4];

      let lineNum = 1;
      for (let i = 0; i < match.index; i++) {
        if (maskedContent[i] === '\n') lineNum++;
      }

      if (!isEnd) {
        const widget: import('./dartParser').WidgetInfo = {
          name: tagName,
          line: lineNum,
          properties: [],
          children: []
        };

        if (stack.length === 0) {
          rootWidgets.push(widget);
        } else {
          stack[stack.length - 1].widget.children.push(widget);
        }

        if (!isSelfClosing) {
          stack.push({ widget, depth: stack.length });
        }
      } else {
        if (stack.length > 0 && stack[stack.length - 1].widget.name === tagName) {
          stack.pop();
        }
      }
    }
    return rootWidgets;
  }

  public preprocessSource(content: string): string {
    let resultStr = content;

    // 1. Template Literals backticks (replace contents with spaces while preserving ${expressions})
    resultStr = resultStr.replace(/`([\s\S]*?)`/g, (match, body) => {
      let newBody = '';
      let i = 0;
      while (i < body.length) {
        if (body[i] === '$' && body[i + 1] === '{') {
          newBody += '${';
          i += 2;
          let depth = 1;
          while (i < body.length && depth > 0) {
            const ch = body[i];
            newBody += ch;
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            i++;
          }
        } else {
          newBody += body[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
      return '`' + newBody + '`';
    });

    return resultStr
      // Single/double quoted strings
      .replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g, m => m.replace(/[^\n]/g, ' '))
      // JSX/TSX tags (non-greedy)
      .replace(/<\/?[A-Za-z][A-Za-z0-9]*[^>]*?>/g, m => m.replace(/[^\n]/g, ' '))
      // Regex literals
      .replace(/([^/])\/([^/*\n][^/\n]*)\/([gimyuy]*)\b/g, (match, prefix, pattern, flags) => {
        return prefix + '/' + ' '.repeat(pattern.length) + '/' + ' '.repeat(flags.length);
      })
      // Inline comments //
      .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
      // Block comments /* */
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  }

  private extractEnumValues(lines: string[], startIndex: number, maskedLines?: string[]): string[] {
    const values: string[] = [];
    const safeLines = maskedLines ?? lines;
    let depth = 0;
    let started = false;
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

  private extractFunctionCalls(maskedLines: string[], result: DartFileInfo, originalLines?: string[]): void {
    const lines = originalLines ?? maskedLines;

    const classNameSet = new Set(result.classes.map(c => c.name));
    const RESERVED_CALLS = new Set([
      'print', 'console', 'log', 'error', 'warn', 'info', 'require',
      'import', 'export', 'default', 'setState', 'useState', 'useEffect',
      'useContext', 'useReducer', 'useCallback', 'useMemo', 'useRef',
      'useImperativeHandle', 'useLayoutEffect', 'useDebugValue',
      'if', 'for', 'while', 'switch', 'catch', 'throw', 'return', 'await',
      'async', 'try', 'finally', 'break', 'continue', 'typeof', 'instanceof',
      'super', 'this', 'new', 'delete', 'void', 'in', 'of'
    ]);

    let callCurrentClass: string | null = null;
    let callCurrentFunction: string | null = null;
    let callBraceDepth = 0;
    let callClassBrace = 0;
    let callFuncBrace = 0;
    const callPatLocal = /(?:([a-zA-Z_]\w*)\.)?([a-zA-Z_]\w*)\s*\(/g;

    for (let i = 0; i < maskedLines.length; i++) {
      const mLine = maskedLines[i];
      const trimmed = mLine.trim();
      const lineNum = i + 1;

      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      if (trimmed.match(/^(class|import|export)\s/)) continue;

      for (const ch of mLine) {
        if (ch === '{') callBraceDepth++;
        else if (ch === '}') {
          callBraceDepth--;
          if (callCurrentClass && callBraceDepth <= callClassBrace) callCurrentClass = null;
          if (callCurrentFunction && callBraceDepth <= callFuncBrace) callCurrentFunction = null;
        }
      }

      const classM = trimmed.match(/class\s+(\w+)/);
      if (classM) { callCurrentClass = classM[1]; callClassBrace = callBraceDepth - 1; continue; }
      const funcM = trimmed.match(/(?:function|const|let|var)\s+(\w+)\s*\(/) || trimmed.match(/^(\w+)\s*\([^)]*\)\s*\{/);
      if (funcM && !RESERVED_CALLS.has(funcM[1])) { callCurrentFunction = funcM[1]; callFuncBrace = callBraceDepth - 1; }

      if (trimmed.match(/^\s*(?:static\s+)?(?:async\s+)?\w+\s*\([^)]*\)\s*\{/)) continue;

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

  private analyzeUsages(maskedLines: string[], result: DartFileInfo): void {
    type SymbolKind =
      | 'class' | 'function' | 'typedef'
      | 'variable' | 'enum' | 'mixin';

    interface SymbolEntry {
      kind: SymbolKind;
      name: string;
      pattern: RegExp;
      defSnippets: string[];
    }

    const symbols: SymbolEntry[] = [];
    const addSymbol = (kind: SymbolKind, name: string, defSnippets: string[]) =>
      symbols.push({ kind, name, pattern: new RegExp(`\\b${name}\\b`), defSnippets });

    for (const c of result.classes) addSymbol('class', c.name, [`class ${c.name}`, `extends ${c.name}`]);
    for (const f of result.functions) addSymbol('function', f.name, [`function ${f.name}`, `${f.name}(`]);
    for (const t of result.typedefs) addSymbol('typedef', t.name, [`type ${t.name}`]);
    for (const v of result.variables) addSymbol('variable', v.name, [`${v.name} =`, `${v.name}=`]);
    for (const e of result.enums) addSymbol('enum', e.name, [`enum ${e.name}`]);
    for (const m of result.mixins) addSymbol('mixin', m.name, [`interface ${m.name}`]);

    const classUsageMap = new Map(result.classes.map(c => [c.name, { className: c.name, usedInFiles: [result.filePath], usedByClasses: [] as string[], usedByFunctions: [] as string[], confidence: 'medium' as const }]));
    const funcUsageMap = new Map(result.functions.map(f => [f.name, { functionName: f.name, parentClass: f.parentClass, calledByFunctions: [] as string[], calledInFiles: [result.filePath], confidence: 'medium' as const }]));
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

    let curCls: string | null = null;
    let curFunc: string | null = null;
    let bDepth = 0;
    let clsBrace = 0;
    let funcBrace = 0;

    const RESERVED_WORDS = new Set(['class', 'enum', 'interface', 'type', 'const', 'let', 'var', 'function', 'return', 'import', 'export', 'default']);

    for (let i = 0; i < maskedLines.length; i++) {
      const mLine = maskedLines[i];
      const trimmed = mLine.trim();

      for (const ch of mLine) {
        if (ch === '{') bDepth++;
        else if (ch === '}') {
          bDepth--;
          if (curCls && bDepth <= clsBrace) curCls = null;
          if (curFunc && bDepth <= funcBrace) curFunc = null;
        }
      }

      const cMatch = trimmed.match(/^(class|interface|enum)\s+(\w+)/);
      if (cMatch) { curCls = cMatch[2]; clsBrace = bDepth - 1; }
      const fMatch = trimmed.match(/(?:function|const|let|var)\s+(\w+)\s*\(/) || trimmed.match(/^(\w+)\s*\([^)]*\)\s*\{/);
      if (fMatch && !RESERVED_WORDS.has(fMatch[1])) { curFunc = fMatch[1]; funcBrace = bDepth - 1; }

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

    result.classUsages = [...classUsageMap.values()];
    result.functionUsages = [...funcUsageMap.values()];
    result.typedefUsages = [...typedefUsageMap.values()];
    result.variableUsages = [...varUsageMap.values()];
    result.enumUsages = [...enumUsageMap.values()];
    result.mixinUsages = [...mixinUsageMap.values()];

    for (const a of result.annotations) {
      if (!result.annotationUsages.find(au => au.annotationName === a.name))
        result.annotationUsages.push({ annotationName: a.name, usedInFiles: [result.filePath], confidence: 'medium' });
    }

    for (const c of result.constructors) {
      const pattern = new RegExp(`\\bnew\\s+${c.className}\\b|\\b${c.className}\\b`);
      const usage = { constructorName: c.name, className: c.className, usedInFiles: [] as string[], confidence: 'medium' as const };
      for (const ml of maskedLines) {
        if (pattern.test(ml) && !ml.includes(`class ${c.className}`) && !usage.usedInFiles.includes(result.filePath))
          usage.usedInFiles.push(result.filePath);
      }
      result.constructorUsages.push(usage);
    }

    for (const p of result.properties) {
      const pattern = new RegExp(`\\b${p.name}\\b`);
      const usage = { propertyName: p.name, className: p.className, usedInFiles: [] as string[], confidence: 'medium' as const };
      for (const ml of maskedLines) {
        if (pattern.test(ml) && !ml.includes(`${p.name}:`) && !ml.includes(`get ${p.name}`) && !ml.includes(`set ${p.name}`) && !usage.usedInFiles.includes(result.filePath))
          usage.usedInFiles.push(result.filePath);
      }
      result.propertyUsages.push(usage);
    }
  }


}
