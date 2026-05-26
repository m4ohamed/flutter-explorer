import * as path from 'path';
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

export class AndroidParser {
  /**
   * A regex-based parser for Android files (.kt, .java, .xml, .gradle).
   * Maps syntax to DartFileInfo structure.
   */
  parse(filePath: string, content: string): DartFileInfo {
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.kt' || ext === '.java') {
        return this.parseKotlinJava(filePath, content, ext);
      } else if (ext === '.xml') {
        return this.parseXml(filePath, content);
      } else if (ext === '.gradle' || filePath.endsWith('.gradle.kts')) {
        return this.parseGradle(filePath, content);
      } else {
        // Fallback for unexpected extensions
        return this.createEmptyFileInfo(filePath);
      }
    } catch (err) {
      console.error(`[AndroidParser] Failed to parse ${filePath}:`, err);
      return this.createEmptyFileInfo(filePath);
    }
  }

  private createEmptyFileInfo(filePath: string): DartFileInfo {
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

  /**
   * Preprocess source to mask comments and string literals
   */
  private preprocessKotlinJava(content: string): string {
    return content
      // Multi-line comments
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      // Single-line comments
      .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
      // Triple quoted strings (Kotlin raw strings)
      .replace(/"""[\s\S]*?"""/g, m => m.replace(/[^\n]/g, ' '))
      // Single/double quoted strings
      .replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g, m => m.replace(/[^\n]/g, ' '));
  }

  /**
   * Parse Kotlin (.kt) or Java (.java) source files
   */
  private parseKotlinJava(filePath: string, content: string, ext: string): DartFileInfo {
    const lines = content.split('\n');
    const masked = this.preprocessKotlinJava(content);
    const maskedLines = masked.split('\n');

    const result = this.createEmptyFileInfo(filePath);

    // Regex patterns
    const P = {
      import: /import\s+([\w.*]+)(?:\s+as\s+(\w+))?/,
      hardText: /"([^"\\]*?[a-zA-Z]{3,}[^"\\]*?)"/,
      hardColor: /#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8}|[A-Fa-f0-9]{3})\b|rgba?\([^)]+\)/,
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
      const impMatch = trimmed.match(P.import);
      if (impMatch) {
        result.imports.push({
          path: impMatch[1],
          alias: impMatch[2] || null,
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
        if (idx !== -1 && maskedLine[idx] === ' ' && !trimmed.includes('import') && !trimmed.startsWith('package')) {
          const matchedStr = textMatch[0];
          // Skip logging and annotations
          if (!trimmed.includes('Log.') && !trimmed.includes('println') && !trimmed.includes('System.out') && !trimmed.startsWith('@')) {
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

      // 2.5. Annotations
      const annotationMatch = trimmed.match(/^@(\w+)/);
      if (annotationMatch) {
        const nextLines = maskedLines.slice(i + 1, i + 5).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*'));
        const nextMasked = nextLines[0] || '';
        let target = 'unknown';
        let targetName = '';
        if (nextMasked.match(/^(?:class|interface|object|enum)\s+(\w+)/)) {
          target = 'class';
          targetName = nextMasked.match(/^(?:class|interface|object|enum)\s+(\w+)/)?.[1] || '';
        } else if (nextMasked.match(/^(?:fun|public|private|protected|static|void|[\w<>]+)\s+(\w+)\s*\(/)) {
          target = 'function';
          targetName = nextMasked.match(/^(?:fun|public|private|protected|static|void|[\w<>]+)\s+(\w+)\s*\(/)?.[1] || '';
        }
        result.annotations.push({ name: annotationMatch[1], target, targetName, line: lineNum });
      }

      // 3. Enums
      const enm = ext === '.kt'
        ? trimmed.match(/^(?:(?:public|private|internal|protected)\s+)?enum\s+class\s+(\w+)/)
        : trimmed.match(/^(?:(?:public|private|protected|static)\s+)?enum\s+(\w+)/);
      if (enm) {
        result.enums.push({
          name: enm[1],
          values: this.extractEnumValues(lines, i, maskedLines),
          line: lineNum,
          isPrivate: enm[1].startsWith('_')
        });
        continue;
      }

      // 4. Interfaces (Mapped to mixins for uniform search representation)
      const interf = trimmed.match(/^(?:(?:public|private|protected|internal|abstract)\s+)*(?:interface)\s+(\w+)/);
      if (interf) {
        result.mixins.push({
          name: interf[1],
          on: null,
          line: lineNum,
          isPrivate: interf[1].startsWith('_')
        });
        continue;
      }

      // 5. Classes
      const lookahead = maskedLines.slice(i, i + 5).join('\n');
      const cls = ext === '.kt'
        ? lookahead.match(/^\s*(?:(?:public|private|internal|protected|abstract|sealed|open|data)\s+)*class\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w.<>(),\s]+))?/)
        : lookahead.match(/^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+([\w.,\s]+))?/);

      if (cls) {
        const name = cls[1];
        let extendsClass: string | null = null;
        const mixins: string[] = [];
        const implementsList: string[] = [];

        if (ext === '.kt' && cls[2]) {
          // Kotlin syntax: `:` is used for both extends and implements
          const parts = cls[2].split(',').map(p => p.trim());
          for (let pIdx = 0; pIdx < parts.length; pIdx++) {
            const p = parts[pIdx];
            if (p.includes('(') || p.match(/^[A-Z]\w*Activity/) || p.endsWith('Service') || p.endsWith('Receiver') || p.endsWith('Fragment')) {
              // Looks like class inheritance (usually has constructor call `()` or standard Android base components)
              extendsClass = p.replace(/\(.*\)/, '').trim();
            } else {
              implementsList.push(p);
            }
          }
        } else if (ext === '.java') {
          extendsClass = cls[2] || null;
          if (cls[3]) {
            cls[3].split(',').map(p => implementsList.push(p.trim()));
          }
        }

        const newCls: ClassInfo = {
          name,
          type: 'plain',
          line: lineNum,
          extendsClass,
          mixins,
          implements: implementsList,
          isAbstract: lookahead.includes('abstract'),
          isPrivate: lookahead.includes('private') || name.startsWith('_'),
          methods: [],
          properties: []
        };

        result.classes.push(newCls);
        scopeStack.push({ type: 'class', name, braceDepth: braceDepth - 1, ref: newCls });

        const headerLines = cls[0].split('\n').length;
        syncBraces(i, headerLines);
        i += headerLines - 1;
        continue;
      }

      // 6. Class Members (Constructors, Methods, Properties)
      const cc = currentClass();
      const inFunction = scopeStack.some(frame => frame.type === 'function');
      if (cc && !inFunction) {
        // Constructor
        const isConstructor = ext === '.kt'
          ? (trimmed.startsWith('constructor') || trimmed.match(/^\s*(?:constructor|init\b)/))
          : (trimmed.match(new RegExp(`^\\s*(?:public|private|protected)?\\s*${cc}\\s*\\(`)));

        if (isConstructor) {
          result.constructors.push({
            name: 'constructor',
            className: cc,
            isFactory: false,
            isConst: false,
            params: '',
            line: lineNum
          });
          syncBraces(i);
          continue;
        }

        // Methods / Member Functions
        const mLookahead = maskedLines.slice(i, i + 5).join('\n');
        const methodMatch = ext === '.kt'
          ? mLookahead.match(/^\s*(?:(?:public|private|internal|protected|open|abstract|override|actual|expect|suspend|inline)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([\w.<>?]+))?\s*([;{=])/)
          : mLookahead.match(/^\s*(?:(?:public|private|protected|static|final|synchronized|abstract)\s+)*(?:<[^>]*>\s*)?([\w.<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*([;{=])/);

        if (methodMatch) {
          const name = ext === '.kt' ? methodMatch[1] : methodMatch[2];
          const returnType = ext === '.kt' ? (methodMatch[3] ? methodMatch[3].trim() : 'Unit') : methodMatch[1].trim();
          const params = ext === '.kt' ? methodMatch[2].trim() : methodMatch[3].trim();
          const bodySymbol = ext === '.kt' ? methodMatch[4] : methodMatch[4];

          if (!['if', 'for', 'while', 'switch', 'catch', 'when'].includes(name)) {
            const methodInfo: FunctionInfo = {
              name,
              returnType,
              params,
              line: lineNum,
              isPrivate: trimmed.includes('private') || name.startsWith('_'),
              isAsync: trimmed.includes('suspend') || trimmed.includes('async'),
              isStatic: trimmed.includes('static') || trimmed.includes('companion'),
              parentClass: cc
            };

            const parentCls = result.classes.find(c => c.name === cc);
            if (parentCls) parentCls.methods.push(methodInfo);

            const hLines = methodMatch[0].split('\n').length;
            if (hLines > 1) syncBraces(i + 1, hLines - 1);

            if (bodySymbol === '{') {
              scopeStack.push({ type: 'function', name, braceDepth: braceDepth - 1, ref: methodInfo });
            } else {
              methodInfo.lineEnd = lineNum + hLines - 1;
            }

            i += hLines - 1;
            continue;
          }
        }

        // Fields (Properties)
        const fieldMatch = ext === '.kt'
          ? trimmed.match(/^\s*(?:(?:public|private|internal|protected|const|lateinit|var|val)\s+)*(var|val)\s+(\w+)\s*(?::\s*([^=;{()]+))?\s*(?:=\s*([^;]+))?/)
          : trimmed.match(/^\s*(?:(?:public|private|protected|static|final|transient|volatile)\s+)+([\w.<>\[\]]+)\s+(\w+)\s*(?:=\s*([^;]+))?;/);

        if (fieldMatch) {
          const propName = ext === '.kt' ? fieldMatch[2] : fieldMatch[2];
          const propType = ext === '.kt' ? (fieldMatch[3] ? fieldMatch[3].trim() : 'Any') : fieldMatch[1].trim();
          const isFinal = ext === '.kt' ? fieldMatch[1] === 'val' : trimmed.includes('final');

          if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'import', 'package'].includes(propName)) {
            const prop: PropertyInfo = {
              name: propName,
              type: propType,
              className: cc,
              isFinal,
              isConst: trimmed.includes('const'),
              isStatic: trimmed.includes('static') || trimmed.includes('companion'),
              isPrivate: trimmed.includes('private') || propName.startsWith('_'),
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
      }

      // 7. Top-level Functions & Variables (Kotlin only)
      if (!cc && ext === '.kt') {
        const lookahead = maskedLines.slice(i, i + 5).join('\n');
        const funcMatch = lookahead.match(/^\s*(?:(?:public|private|internal|protected|suspend|inline)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([\w.<>?]+))?\s*([;{=])/);
        if (funcMatch) {
          const name = funcMatch[1];
          if (!['if', 'for', 'while', 'switch', 'catch', 'when'].includes(name)) {
            const newFunc: FunctionInfo = {
              name,
              returnType: funcMatch[3] ? funcMatch[3].trim() : 'Unit',
              params: funcMatch[2].trim(),
              line: lineNum,
              isPrivate: trimmed.includes('private') || name.startsWith('_'),
              isAsync: trimmed.includes('suspend'),
              isStatic: false,
              parentClass: null
            };
            result.functions.push(newFunc);

            const hLines = funcMatch[0].split('\n').length;
            if (hLines > 1) syncBraces(i + 1, hLines - 1);

            if (funcMatch[4] === '{') {
              scopeStack.push({ type: 'function', name, braceDepth: braceDepth - 1, ref: newFunc });
            } else {
              newFunc.lineEnd = lineNum + hLines - 1;
            }

            i += hLines - 1;
            continue;
          }
        }

        const varMatch = trimmed.match(/^\s*(?:(?:public|private|internal|protected|const)\s+)*(var|val)\s+(\w+)\s*(?::\s*([^=;{()]+))?\s*(?:=\s*([^;]+))?/);
        if (varMatch) {
          const name = varMatch[2];
          if (!['val', 'var', 'fun', 'class', 'interface', 'import', 'package'].includes(name)) {
            result.variables.push({
              name,
              type: varMatch[3] ? varMatch[3].trim() : 'Any',
              line: lineNum,
              isConst: trimmed.includes('const'),
              isFinal: varMatch[1] === 'val',
              isPrivate: trimmed.includes('private') || name.startsWith('_'),
              isTopLevel: true
            });
            syncBraces(i);
            continue;
          }
        }
      }
    }

    this.analyzeUsages(maskedLines, result);
    this.extractFunctionCalls(maskedLines, result, lines);

    return result;
  }

  private extractEnumValues(lines: string[], startIndex: number, maskedLines: string[]): string[] {
    const values: string[] = [];
    let depth = 0;
    let started = false;
    for (let i = startIndex; i < maskedLines.length; i++) {
      for (const ch of maskedLines[i]) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; if (started && depth === 0) { return values; } }
      }
      if (started && depth === 1) {
        const t = lines[i].trim();
        if (t && !t.startsWith('{') && !t.startsWith('//') && !t.startsWith('/*')) {
          const v = t.match(/^([A-Za-z0-9_]+)/);
          if (v && !['class', 'interface', 'enum', 'fun', 'val', 'var'].includes(v[1])) {
            values.push(v[1]);
          }
        }
      }
    }
    return values;
  }

  private extractFunctionCalls(maskedLines: string[], result: DartFileInfo, originalLines: string[]): void {
    const classNameSet = new Set(result.classes.map(c => c.name));
    const RESERVED_CALLS = new Set([
      'print', 'println', 'printf', 'log', 'd', 'e', 'w', 'i', 'v', 'wtf',
      'require', 'check', 'assert', 'synchronized', 'let', 'also', 'apply', 'run', 'with',
      'if', 'for', 'while', 'switch', 'catch', 'throw', 'return', 'await',
      'try', 'finally', 'break', 'continue', 'super', 'this', 'new', 'when'
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
      if (trimmed.match(/^(class|import|package)\s/)) continue;

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
      const funcM = trimmed.match(/fun\s+(\w+)\s*\(/) || trimmed.match(/^[a-zA-Z_]\w*\s*\([^)]*\)\s*\{/);
      if (funcM && !RESERVED_CALLS.has(funcM[1])) { callCurrentFunction = funcM[1]; callFuncBrace = callBraceDepth - 1; }

      callPatLocal.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = callPatLocal.exec(mLine)) !== null) {
        const receiver = match[1];
        const funcName = match[2];
        if (RESERVED_CALLS.has(funcName)) continue;
        if (funcName === callCurrentFunction) continue;

        const contextStart = Math.max(0, i - 1);
        const contextEnd = Math.min(originalLines.length - 1, i + 1);
        const context = originalLines.slice(contextStart, contextEnd + 1).join('\n').trim();

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
    type SymbolKind = 'class' | 'function' | 'variable' | 'enum' | 'mixin';
    interface SymbolEntry {
      kind: SymbolKind;
      name: string;
      pattern: RegExp;
    }

    const symbols: SymbolEntry[] = [];
    const addSymbol = (kind: SymbolKind, name: string) =>
      symbols.push({ kind, name, pattern: new RegExp(`\\b${name}\\b`) });

    for (const c of result.classes) addSymbol('class', c.name);
    for (const f of result.functions) addSymbol('function', f.name);
    for (const v of result.variables) addSymbol('variable', v.name);
    for (const e of result.enums) addSymbol('enum', e.name);
    for (const m of result.mixins) addSymbol('mixin', m.name);

    const classUsageMap = new Map(result.classes.map(c => [c.name, { className: c.name, usedInFiles: [result.filePath], usedByClasses: [] as string[], usedByFunctions: [] as string[], confidence: 'medium' as const }]));
    const funcUsageMap = new Map(result.functions.map(f => [f.name, { functionName: f.name, parentClass: f.parentClass, calledByFunctions: [] as string[], calledInFiles: [result.filePath], confidence: 'medium' as const }]));
    const varUsageMap = new Map(result.variables.map(v => [v.name, { variableName: v.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const enumUsageMap = new Map(result.enums.map(e => [e.name, { enumName: e.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const mixinUsageMap = new Map(result.mixins.map(m => [m.name, { mixinName: m.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));

    let curCls: string | null = null;
    let curFunc: string | null = null;
    let bDepth = 0;
    let clsBrace = 0;
    let funcBrace = 0;

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

      const cMatch = trimmed.match(/class\s+(\w+)/);
      if (cMatch) { curCls = cMatch[1]; clsBrace = bDepth - 1; }
      const fMatch = trimmed.match(/fun\s+(\w+)\s*\(/);
      if (fMatch) { curFunc = fMatch[1]; funcBrace = bDepth - 1; }

      for (const sym of symbols) {
        if (sym.pattern.test(mLine)) {
          // Skip if this line is the definition itself
          const isDef = trimmed.includes(`class ${sym.name}`) || trimmed.includes(`fun ${sym.name}`) || trimmed.includes(`enum class ${sym.name}`) || trimmed.includes(`interface ${sym.name}`);
          if (isDef) continue;

          if (sym.kind === 'class') {
            const usage = classUsageMap.get(sym.name);
            if (usage) {
              if (curCls && !usage.usedByClasses.includes(curCls)) usage.usedByClasses.push(curCls);
              if (curFunc && !usage.usedByFunctions.includes(curFunc)) usage.usedByFunctions.push(curFunc);
            }
          } else if (sym.kind === 'function') {
            const usage = funcUsageMap.get(sym.name);
            if (usage && curFunc && !usage.calledByFunctions.includes(curFunc)) {
              usage.calledByFunctions.push(curFunc);
            }
          } else if (sym.kind === 'variable') {
            const usage = varUsageMap.get(sym.name);
            if (usage && !usage.usedInFiles.includes(result.filePath)) usage.usedInFiles.push(result.filePath);
          } else if (sym.kind === 'enum') {
            const usage = enumUsageMap.get(sym.name);
            if (usage && !usage.usedInFiles.includes(result.filePath)) usage.usedInFiles.push(result.filePath);
          } else if (sym.kind === 'mixin') {
            const usage = mixinUsageMap.get(sym.name);
            if (usage && !usage.usedInFiles.includes(result.filePath)) usage.usedInFiles.push(result.filePath);
          }
        }
      }
    }

    result.classUsages = Array.from(classUsageMap.values());
    result.functionUsages = Array.from(funcUsageMap.values());
    result.variableUsages = Array.from(varUsageMap.values());
    result.enumUsages = Array.from(enumUsageMap.values());
    result.mixinUsages = Array.from(mixinUsageMap.values());
  }

  /**
   * Preprocess source to mask XML comments
   */
  private preprocessXml(content: string): string {
    return content.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  }

  /**
   * Parse XML (.xml) files (Layouts, AndroidManifest, Resources)
   */
  private parseXml(filePath: string, content: string): DartFileInfo {
    const result = this.createEmptyFileInfo(filePath);
    const lines = content.split('\n');
    const masked = this.preprocessXml(content);
    const maskedLines = masked.split('\n');

    // 1. Check if it's a layout file
    const isLayoutFile = filePath.toLowerCase().includes('layout/') || content.trim().startsWith('<layout') || content.trim().startsWith('<RelativeLayout') || content.trim().startsWith('<LinearLayout') || content.trim().startsWith('<ConstraintLayout') || content.trim().startsWith('<FrameLayout') || content.trim().startsWith('<androidx.');

    if (isLayoutFile) {
      // Build WidgetTree from XML tags
      result.widgets = this.parseXmlLayoutToWidgetTree(content, lines);

      // Extract layout warnings
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Hardcoded text warning (e.g. android:text="Hello" instead of "@string/hello")
        const textAttrMatch = line.match(/\bandroid:text\s*=\s*"([^"]+)"/);
        if (textAttrMatch) {
          const value = textAttrMatch[1];
          if (!value.startsWith('@string/') && !value.startsWith('?') && value.length > 0) {
            result.warnings.push({
              type: 'hardcoded_text',
              message: `Hardcoded text in XML layout: ${value}`,
              line: lineNum
            });
          }
        }

        // Hardcoded color warning (e.g. android:background="#FFFFFF" instead of "@color/white")
        const colorAttrMatch = line.match(/\b(?:android:background|android:textColor|android:tint|app:backgroundTint)\s*=\s*"([^"]+)"/);
        if (colorAttrMatch) {
          const value = colorAttrMatch[1];
          if (value.startsWith('#')) {
            result.warnings.push({
              type: 'hardcoded_color',
              message: `Hardcoded color in XML layout: ${value}`,
              line: lineNum
            });
          }
        }
      }
    }

    // 2. Check if it's a resources file (e.g. strings.xml or colors.xml)
    const isResourcesFile = filePath.endsWith('strings.xml') || filePath.endsWith('colors.xml') || filePath.endsWith('dimens.xml') || content.includes('<resources>');
    if (isResourcesFile) {
      const resourceRegex = /<(\w+)\s+name="([^"]+)">([^<]+)<\/\1>/g;
      let match: RegExpExecArray | null;
      while ((match = resourceRegex.exec(content)) !== null) {
        const type = match[1];
        const name = match[2];
        const value = match[3].trim();
        const lineNum = content.substring(0, match.index).split('\n').length;

        result.variables.push({
          name,
          type,
          value,
          line: lineNum,
          isConst: true,
          isFinal: true,
          isPrivate: false,
          isTopLevel: true
        });
      }
    }

    // 3. Check if AndroidManifest.xml
    if (filePath.endsWith('AndroidManifest.xml')) {
      // Extract package name
      const packageMatch = content.match(/package\s*=\s*"([^"]+)"/);
      const packageName = packageMatch ? packageMatch[1] : '';

      // Extract permissions as imports
      const permissionRegex = /<uses-permission\s+android:name="([^"]+)"\s*\/>/g;
      let permMatch: RegExpExecArray | null;
      while ((permMatch = permissionRegex.exec(content)) !== null) {
        const lineNum = content.substring(0, permMatch.index).split('\n').length;
        result.imports.push({
          path: permMatch[1],
          alias: null,
          showNames: [],
          hideNames: [],
          line: lineNum
        });
      }

      // Extract components (Activities, Services, Receivers) as classes
      const componentRegex = /<(activity|service|receiver)\s+[^>]*android:name="([^"]+)"[^>]*>/g;
      let compMatch: RegExpExecArray | null;
      while ((compMatch = componentRegex.exec(content)) !== null) {
        const compType = compMatch[1];
        let name = compMatch[2];
        if (name.startsWith('.')) {
          name = packageName ? packageName + name : name.substring(1);
        }
        const lineNum = content.substring(0, compMatch.index).split('\n').length;

        result.classes.push({
          name,
          type: 'plain',
          line: lineNum,
          extendsClass: compType === 'activity' ? 'Activity' : (compType === 'service' ? 'Service' : 'BroadcastReceiver'),
          mixins: [],
          implements: [],
          isAbstract: false,
          isPrivate: false,
          methods: [],
          properties: []
        });
      }
    }

    return result;
  }

  private parseXmlLayoutToWidgetTree(content: string, lines: string[]): WidgetInfo[] {
    const rootWidgets: WidgetInfo[] = [];
    const stack: { widget: WidgetInfo; depth: number }[] = [];

    // Simple XML tag parser regex that finds start tags, attributes, self-closing tags, and end tags.
    // E.g., <LinearLayout android:id="..." > or <Button android:id="..." /> or </LinearLayout>
    const tagRegex = /<(\/?)([\w.:]+)(\s+[\s\S]*?)?(\/?)>/g;

    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(content)) !== null) {
      const isEnd = !!match[1];
      const tagName = match[2];
      const attrString = match[3] || '';
      const isSelfClosing = !!match[4];

      // Skip XML declarations/comments/namespaces
      if (tagName.startsWith('?') || tagName.startsWith('!')) continue;

      const lineNum = content.substring(0, match.index).split('\n').length;

      if (!isEnd) {
        // Parse attributes
        const properties: { name: string; value: string }[] = [];
        const attrRegex = /([\w.:]+)\s*=\s*"([^"]*)"/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(attrString)) !== null) {
          const attrName = attrMatch[1].replace(/^android:|^app:|^tools:/, '');
          properties.push({
            name: attrName,
            value: attrMatch[2]
          });
        }

        const widget: WidgetInfo = {
          name: tagName,
          line: lineNum,
          properties,
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
        // End tag: pop from stack if name matches
        if (stack.length > 0 && stack[stack.length - 1].widget.name === tagName) {
          stack.pop();
        }
      }
    }

    return rootWidgets;
  }

  /**
   * Parse Gradle (.gradle / .gradle.kts) build files
   */
  private parseGradle(filePath: string, content: string): DartFileInfo {
    const result = this.createEmptyFileInfo(filePath);
    const lines = content.split('\n');

    // 1. Extract Dependencies as imports
    const depRegex = /(?:implementation|api|kapt|annotationProcessor|testImplementation|androidTestImplementation)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g;
    let depMatch: RegExpExecArray | null;
    while ((depMatch = depRegex.exec(content)) !== null) {
      const depName = depMatch[1];
      const lineNum = content.substring(0, depMatch.index).split('\n').length;

      result.imports.push({
        path: depName,
        alias: null,
        showNames: [],
        hideNames: [],
        line: lineNum
      });
    }

    // Direct libs.xxx style implementation in Gradle Catalog (Kotlin DSL / Groovy)
    const catalogDepRegex = /(?:implementation|api|kapt|testImplementation)\s*\(?\s*libs\.([\w.]+)\s*\)?/g;
    while ((depMatch = catalogDepRegex.exec(content)) !== null) {
      const depName = `libs.${depMatch[1]}`;
      const lineNum = content.substring(0, depMatch.index).split('\n').length;

      result.imports.push({
        path: depName,
        alias: null,
        showNames: [],
        hideNames: [],
        line: lineNum
      });
    }

    // 2. Extract build configurations as top-level variables
    const configKeys = [
      'compileSdk', 'minSdk', 'targetSdk', 'compileSdkVersion', 'minSdkVersion', 'targetSdkVersion',
      'versionCode', 'versionName', 'applicationId', 'namespace'
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      for (const key of configKeys) {
        const valRegex = new RegExp(`\\b${key}\\b\\s*(?:=|\\s)\\s*['"]?([^'"\n]+)['"]?`);
        const match = line.match(valRegex);
        if (match) {
          result.variables.push({
            name: key,
            type: isNaN(Number(match[1])) ? 'String' : 'int',
            value: match[1].trim(),
            line: lineNum,
            isConst: true,
            isFinal: true,
            isPrivate: false,
            isTopLevel: true
          });
          break;
        }
      }
    }

    return result;
  }

  /**
   * Extract code block for specific elements (identical behavior to DartParser & JsTsParser)
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
      case 'function': {
        const fn = parsed.functions.find(f => f.name === name && !f.parentClass);
        if (fn) { startLine = fn.line; endLine = fn.lineEnd ?? -1; }
        break;
      }
      case 'method': {
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

    if (endLine === -1) {
      const ext = path.extname(parsed.filePath).toLowerCase();
      const masked = ext === '.xml' ? this.preprocessXml(content) : this.preprocessKotlinJava(content);
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
          if (ch === '{' || (ext === '.xml' && ch === '<' && !mLine.includes('</') && !mLine.includes('/>'))) {
            depth++;
            started = true;
          } else if (ch === '}' || (ext === '.xml' && ch === '>')) {
            if (started) {
              depth--;
              if (depth === 0) { endLine = i + 1; break; }
            }
          }
        }
        if (endLine !== -1) break;
        if (i > startLine + 500) break;
      }
    }

    if (endLine === -1) return null;

    const comments: string[] = [];
    for (let i = startLine - 2; i >= 0; i--) {
      const t = lines[i].trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) {
        comments.unshift(t);
      } else {
        break;
      }
    }

    return {
      body: lines.slice(startLine - 1, endLine).join('\n'),
      startLine,
      endLine,
      comments
    };
  }
}
