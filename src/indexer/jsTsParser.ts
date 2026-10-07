import * as ts from 'typescript';
import * as crypto from 'crypto';
import type {
  DartFileInfo,
  ClassInfo,
  FunctionInfo,
  FunctionCall,
  ImportInfo,
  PropertyInfo,
  WidgetInfo,
  WarningInfo,
} from './dartParser';
import { BaseParser } from './baseParser';
import { MockupAnalyzer } from './mockupAnalyzer';

/**
 * JavaScript / TypeScript parser that maps the syntax tree to the DartFileInfo structure.
 *
 * The previous implementation was a line-by-line regex scanner that ran on text in which every
 * quoted string (and every JSX tag) had been blanked out. Consequences that are fixed here:
 *   - `import x from 'y'` was never recognised (the module path had been blanked), so every file
 *     had zero imports and cycle detection / impact analysis / the dependency graph were empty;
 *   - methods whose parameter list contained parentheses (`start = process.cwd()`) were dropped
 *     and their body leaked into the class as bogus "properties";
 *   - methods starting with `get`/`set` lost that prefix (`getDataDir` -> `DataDir`);
 *   - JSX tags were blanked, so the widget tree of every .tsx/.jsx file was empty;
 *   - hard coded text/colour warnings fired on every string of every backend file.
 */

const RESERVED_CALLS = new Set([
  'print', 'require', 'import', 'setState', 'useState', 'useEffect',
  'useContext', 'useReducer', 'useCallback', 'useMemo', 'useRef',
  'useImperativeHandle', 'useLayoutEffect', 'useDebugValue', 'super',
]);

const TEXT_ATTRIBUTES = new Set([
  'placeholder', 'title', 'alt', 'label', 'aria-label', 'aria-placeholder', 'helperText', 'description', 'tooltip',
]);

const COLOR_LITERAL = /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|rgba|hsl|hsla)\([^)]*\))$/;
const COMPONENT_WRAPPERS = /^(?:React\.)?(?:memo|forwardRef|observer)$/;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function modifiersOf(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiersOf(node).some(m => m.kind === kind);
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
        ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current) ||
        ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function withEnd<T extends object>(obj: T, lineEnd: number): T {
  return Object.assign(obj, { lineEnd });
}

type FunctionLikeNode = ts.ArrowFunction | ts.FunctionExpression;

export class JsTsParser extends BaseParser<DartFileInfo> {
  parse(filePath: string, content: string): DartFileInfo {
    try {
      return this.parseInternal(filePath, content);
    } catch (err) {
      console.error(`[JsTsParser] Failed to parse ${filePath}:`, err);
      return this.emptyInfo(filePath);
    }
  }

  private emptyInfo(filePath: string): DartFileInfo {
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

  private parseInternal(filePath: string, content: string): DartFileInfo {
    const lower = filePath.toLowerCase();
    const result = this.emptyInfo(filePath);
    const masked = this.preprocessSource(content);

    if (lower.endsWith('.md')) {
      this.outlineMarkdown(content, result);
    } else if (/\.(css|scss|less)$/.test(lower)) {
      this.outlineCss(content, result);
    } else if (lower.endsWith('.json')) {
      this.outlineJson(content, result);
    } else {
      this.parseScript(filePath, content, result);
    }

    for (const mw of MockupAnalyzer.analyze(filePath, content, masked)) {
      result.warnings.push({
        type: mw.type,
        message: mw.message,
        line: mw.line,
        codeSnippet: mw.codeSnippet,
        suggestion: mw.suggestion,
        category: mw.category,
        severity: mw.severity,
      });
    }
    return result;
  }

  // ─── Outlines for non-code files ────────────────────────────────────────────

  private pushOutline(result: DartFileInfo, name: string, type: string, line: number): void {
    result.classes.push({
      name,
      type,
      extendsClass: null,
      implements: [],
      mixins: [],
      isAbstract: false,
      isPrivate: false,
      methods: [],
      properties: [],
      line,
      lineEnd: line,
    });
  }

  private outlineMarkdown(content: string, result: DartFileInfo): void {
    let inFence = false;
    content.split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '');
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) { return; }
      const m = line.match(/^(#{1,6})\s+(.*)/);
      if (m) { this.pushOutline(result, m[2].trim(), `H${m[1].length}`, i + 1); }
    });
  }

  private outlineCss(content: string, result: DartFileInfo): void {
    content.split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '');
      const m = line.match(/^([.#][a-zA-Z0-9_-]+)(?:\s*\{|[^a-zA-Z0-9_-])/);
      if (m && !line.includes(':')) {
        this.pushOutline(result, m[1], m[1].startsWith('.') ? 'class' : 'id', i + 1);
      }
    });
  }

  private outlineJson(content: string, result: DartFileInfo): void {
    let depth = 0;
    content.split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '');
      const key = line.match(/^\s*"([^"\\]+)"\s*:/);
      if (key && depth <= 1) { this.pushOutline(result, key[1], 'key', i + 1); }
      let inString = false;
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (inString) {
          if (ch === '\\') { k++; } else if (ch === '"') { inString = false; }
        } else if (ch === '"') { inString = true; }
        else if (ch === '{' || ch === '[') { depth++; }
        else if (ch === '}' || ch === ']') { depth = Math.max(0, depth - 1); }
      }
    });
  }

  // ─── Scripts ────────────────────────────────────────────────────────────────

  private scriptKindFor(lowerPath: string): ts.ScriptKind {
    if (lowerPath.endsWith('.tsx')) { return ts.ScriptKind.TSX; }
    if (lowerPath.endsWith('.jsx')) { return ts.ScriptKind.JSX; }
    if (/\.(js|mjs|cjs)$/.test(lowerPath)) { return ts.ScriptKind.JS; }
    return ts.ScriptKind.TS;
  }

  private parseScript(filePath: string, content: string, result: DartFileInfo): void {
    const lower = filePath.toLowerCase();
    const kind = this.scriptKindFor(lower);
    const isJsxFile = kind === ts.ScriptKind.TSX || kind === ts.ScriptKind.JSX;
    const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
    const sourceLines = content.split('\n');

    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const startLine = (n: ts.Node): number => lineOf(n.getStart(sf));
    const endLine = (n: ts.Node): number => lineOf(n.getEnd());
    const textOf = (n: ts.Node): string => n.getText(sf);

    const nameOf = (name: ts.Node | undefined): string => {
      if (!name) { return ''; }
      if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) { return name.text; }
      if (ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) { return name.text; }
      if (ts.isComputedPropertyName(name)) { return `[${collapse(textOf(name.expression))}]`; }
      return collapse(textOf(name));
    };

    const paramsText = (fn: ts.SignatureDeclarationBase): string =>
      collapse(fn.parameters.map(p => textOf(p)).join(', '));

    const typeText = (type: ts.TypeNode | undefined, fallback = 'any'): string =>
      type ? collapse(textOf(type)) : fallback;

    const fingerprint = (node: ts.Node, name: string): { bodyHash: string; bodyLength: number } | undefined => {
      const text = textOf(node);
      if (text.length > 400_000) { return undefined; }
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        isJsxFile ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
        text,
      );
      let out = '';
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        const tokenText = scanner.getTokenText();
        if (tokenText !== name) { out += tokenText; }
      }
      return { bodyLength: out.length, bodyHash: crypto.createHash('md5').update(out).digest('hex') };
    };

    // ── imports ──
    const importKeys = new Set<string>();
    const addImport = (info: ImportInfo, typeOnly = false): void => {
      const key = `${info.path}\u0000${info.line}`;
      if (importKeys.has(key)) { return; }
      importKeys.add(key);
      result.imports.push(typeOnly ? Object.assign(info, { isTypeOnly: true }) : info);
    };

    // ── decorators → annotations ──
    const addDecorators = (node: ts.Node, target: string, targetName: string): void => {
      for (const decorator of decoratorsOf(node)) {
        const expr = decorator.expression;
        const callee = ts.isCallExpression(expr) ? expr.expression : expr;
        const full = textOf(callee);
        const name = full.includes('.') ? full.slice(full.lastIndexOf('.') + 1) : full;
        result.annotations.push({ name, target, targetName, line: startLine(decorator) });
      }
    };

    const isFunctionLike = (expr: ts.Expression | undefined): FunctionLikeNode | null => {
      if (!expr) { return null; }
      const inner = unwrap(expr);
      if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) { return inner; }
      if (ts.isCallExpression(inner) && COMPONENT_WRAPPERS.test(textOf(inner.expression)) && inner.arguments.length > 0) {
        const first = unwrap(inner.arguments[0]);
        if (ts.isArrowFunction(first) || ts.isFunctionExpression(first)) { return first; }
      }
      return null;
    };

    const isRequireCall = (expr: ts.Expression | undefined): boolean => {
      if (!expr) { return false; }
      const inner = unwrap(expr);
      return ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === 'require' &&
        inner.arguments.length > 0 && ts.isStringLiteralLike(inner.arguments[0]);
    };

    const isReactComponentName = (name: string): boolean =>
      name !== name.toUpperCase() && /^[A-Z][a-zA-Z0-9]*$/.test(name);

    const classNames = new Set<string>();
    const declaredClassForName = new Map<string, ClassInfo>();

    // ── classes ──
    const handleClass = (node: ts.ClassDeclaration): void => {
      const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
      const name = node.name?.text ?? (isDefault ? 'default' : '<anonymous>');
      let extendsClass: string | null = null;
      const impls: string[] = [];
      for (const clause of node.heritageClauses ?? []) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types[0]) {
          extendsClass = textOf(clause.types[0].expression);
        } else {
          for (const t of clause.types) { impls.push(textOf(t.expression)); }
        }
      }
      const isComponent = !!extendsClass && (extendsClass.includes('Component') || extendsClass.includes('PureComponent'));

      const cls: ClassInfo = {
        name,
        type: isComponent ? 'StatelessWidget' : 'plain',
        line: startLine(node),
        lineEnd: endLine(node),
        extendsClass,
        mixins: [],
        implements: impls,
        isAbstract: hasModifier(node, ts.SyntaxKind.AbstractKeyword),
        isPrivate: name.startsWith('_'),
        methods: [],
        properties: [],
        ...fingerprint(node, name),
      };
      result.classes.push(cls);
      classNames.add(name);
      declaredClassForName.set(name, cls);
      addDecorators(node, 'class', name);

      if (isComponent && !isJsxFile) {
        result.widgets.push({ name, line: cls.line, children: [], properties: [] });
      }

      const implementedMethodNames = new Set<string>();
      for (const m of node.members) {
        if (ts.isMethodDeclaration(m) && m.body) { implementedMethodNames.add(nameOf(m.name)); }
      }

      const addProperty = (prop: PropertyInfo): void => {
        result.properties.push(prop);
        cls.properties.push(prop);
      };

      for (const member of node.members) {
        if (ts.isConstructorDeclaration(member)) {
          result.constructors.push({
            name: 'constructor',
            className: name,
            isFactory: false,
            isConst: false,
            params: paramsText(member),
            line: startLine(member),
          });
          for (const p of member.parameters) {
            const isShorthand = modifiersOf(p).some(m =>
              m.kind === ts.SyntaxKind.PublicKeyword || m.kind === ts.SyntaxKind.PrivateKeyword ||
              m.kind === ts.SyntaxKind.ProtectedKeyword || m.kind === ts.SyntaxKind.ReadonlyKeyword);
            if (!isShorthand || !ts.isIdentifier(p.name)) { continue; }
            addProperty({
              name: p.name.text,
              type: typeText(p.type),
              className: name,
              isFinal: hasModifier(p, ts.SyntaxKind.ReadonlyKeyword),
              isConst: false,
              isStatic: false,
              isPrivate: hasModifier(p, ts.SyntaxKind.PrivateKeyword) || p.name.text.startsWith('_'),
              isGetter: false,
              isSetter: false,
              line: startLine(p),
            });
          }
          continue;
        }

        if (ts.isMethodDeclaration(member)) {
          const methodName = nameOf(member.name);
          if (!member.body && implementedMethodNames.has(methodName)) { continue; } // overload signature
          const fn: FunctionInfo = {
            name: methodName,
            returnType: typeText(member.type),
            params: paramsText(member),
            line: startLine(member),
            lineEnd: endLine(member),
            isPrivate: methodName.startsWith('_') || methodName.startsWith('#') || hasModifier(member, ts.SyntaxKind.PrivateKeyword),
            isAsync: hasModifier(member, ts.SyntaxKind.AsyncKeyword),
            isStatic: hasModifier(member, ts.SyntaxKind.StaticKeyword),
            parentClass: name,
            ...(member.body ? fingerprint(member, methodName) : undefined),
          };
          cls.methods.push(fn);
          addDecorators(member, 'function', methodName);
          if (hasModifier(member, ts.SyntaxKind.OverrideKeyword)) {
            result.annotations.push({ name: 'override', target: 'function', targetName: methodName, line: fn.line });
          }
          continue;
        }

        if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
          const propName = nameOf(member.name);
          const isGetter = ts.isGetAccessorDeclaration(member);
          const setterType = !isGetter && member.parameters[0] ? typeText(member.parameters[0].type) : 'any';
          addProperty({
            name: propName,
            type: isGetter ? typeText(member.type) : setterType,
            className: name,
            isFinal: isGetter,
            isConst: false,
            isStatic: hasModifier(member, ts.SyntaxKind.StaticKeyword),
            isPrivate: propName.startsWith('_') || propName.startsWith('#') || hasModifier(member, ts.SyntaxKind.PrivateKeyword),
            isGetter,
            isSetter: !isGetter,
            line: startLine(member),
          });
          addDecorators(member, 'function', propName);
          continue;
        }

        if (ts.isPropertyDeclaration(member)) {
          const propName = nameOf(member.name);
          const arrow = isFunctionLike(member.initializer);
          if (arrow) {
            // `handle = () => { ... }` is a method for every practical purpose (React handlers etc.)
            cls.methods.push({
              name: propName,
              returnType: typeText(arrow.type),
              params: paramsText(arrow),
              line: startLine(member),
              lineEnd: endLine(member),
              isPrivate: propName.startsWith('_') || propName.startsWith('#') || hasModifier(member, ts.SyntaxKind.PrivateKeyword),
              isAsync: hasModifier(arrow, ts.SyntaxKind.AsyncKeyword),
              isStatic: hasModifier(member, ts.SyntaxKind.StaticKeyword),
              parentClass: name,
              ...fingerprint(arrow, propName),
            });
            addDecorators(member, 'function', propName);
            continue;
          }
          addProperty({
            name: propName,
            type: typeText(member.type),
            className: name,
            isFinal: hasModifier(member, ts.SyntaxKind.ReadonlyKeyword),
            isConst: false,
            isStatic: hasModifier(member, ts.SyntaxKind.StaticKeyword),
            isPrivate: hasModifier(member, ts.SyntaxKind.PrivateKeyword) || propName.startsWith('_') || propName.startsWith('#'),
            isGetter: false,
            isSetter: false,
            line: startLine(member),
          });
          addDecorators(member, 'field', propName);
        }
      }
    };

    // ── functions & variables ──
    const addTopLevelFunction = (
      name: string,
      lineNode: ts.Node,
      signature: ts.SignatureDeclarationBase,
      bodyNode: ts.Node,
      forceComponent: boolean,
    ): void => {
      const fn: FunctionInfo = {
        name,
        returnType: typeText(signature.type),
        params: paramsText(signature),
        line: startLine(lineNode),
        lineEnd: endLine(lineNode),
        isPrivate: name.startsWith('_'),
        isAsync: hasModifier(signature, ts.SyntaxKind.AsyncKeyword),
        isStatic: false,
        parentClass: null,
        ...fingerprint(bodyNode, name),
      };
      result.functions.push(fn);
      if (!isJsxFile && (forceComponent || isReactComponentName(name))) {
        result.widgets.push({ name, line: fn.line, children: [], properties: [] });
      }
      addDecorators(lineNode, 'function', name);
    };

    const visitStatements = (statements: readonly ts.Statement[]): void => {
      const functionsWithBody = new Set<string>();
      for (const s of statements) {
        if (ts.isFunctionDeclaration(s) && s.body && s.name) { functionsWithBody.add(s.name.text); }
      }

      for (const stmt of statements) {
        if (ts.isImportDeclaration(stmt)) {
          if (!ts.isStringLiteral(stmt.moduleSpecifier)) { continue; }
          const clause = stmt.importClause;
          let alias: string | null = clause?.name?.text ?? null;
          const show: string[] = [];
          const bindings = clause?.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings)) {
            alias = bindings.name.text;
          } else if (bindings && ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) { show.push((el.propertyName ?? el.name).text); }
          }
          addImport(
            { path: stmt.moduleSpecifier.text, alias, showNames: show, hideNames: [], line: startLine(stmt) },
            !!clause?.isTypeOnly,
          );
        } else if (ts.isImportEqualsDeclaration(stmt)) {
          if (ts.isExternalModuleReference(stmt.moduleReference) && ts.isStringLiteral(stmt.moduleReference.expression)) {
            addImport({
              path: stmt.moduleReference.expression.text,
              alias: stmt.name.text,
              showNames: [],
              hideNames: [],
              line: startLine(stmt),
            });
          }
        } else if (ts.isExportDeclaration(stmt)) {
          if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
            result.exports.push(stmt.moduleSpecifier.text);
          }
        } else if (ts.isClassDeclaration(stmt)) {
          handleClass(stmt);
        } else if (ts.isFunctionDeclaration(stmt)) {
          const name = stmt.name?.text ?? (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword) ? 'default' : '');
          if (!name) { continue; }
          if (!stmt.body && functionsWithBody.has(name)) { continue; } // overload signature
          addTopLevelFunction(name, stmt, stmt, stmt, false);
        } else if (ts.isVariableStatement(stmt)) {
          const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
          for (const decl of stmt.declarationList.declarations) {
            if (isRequireCall(decl.initializer)) { continue; }
            if (ts.isIdentifier(decl.name)) {
              const name = decl.name.text;
              const fnNode = isFunctionLike(decl.initializer);
              if (fnNode) {
                const wrapped = decl.initializer ? unwrap(decl.initializer) : undefined;
                const viaWrapper = !!wrapped && ts.isCallExpression(wrapped);
                addTopLevelFunction(name, stmt, fnNode, fnNode, viaWrapper);
              } else {
                result.variables.push({
                  name,
                  type: typeText(decl.type),
                  line: startLine(decl),
                  isConst,
                  isFinal: false,
                  isPrivate: name.startsWith('_'),
                  isTopLevel: true,
                });
              }
            } else {
              // const { a, b } = ...   /   const [x, y] = ...
              const collect = (binding: ts.BindingName): void => {
                if (ts.isIdentifier(binding)) {
                  result.variables.push({
                    name: binding.text,
                    type: 'any',
                    line: startLine(binding),
                    isConst,
                    isFinal: false,
                    isPrivate: binding.text.startsWith('_'),
                    isTopLevel: true,
                  });
                } else {
                  for (const el of binding.elements) {
                    if (ts.isBindingElement(el)) { collect(el.name); }
                  }
                }
              };
              collect(decl.name);
            }
          }
        } else if (ts.isEnumDeclaration(stmt)) {
          result.enums.push(withEnd({
            name: stmt.name.text,
            values: stmt.members.map(m => nameOf(m.name)),
            line: startLine(stmt),
            isPrivate: stmt.name.text.startsWith('_'),
          }, endLine(stmt)));
        } else if (ts.isInterfaceDeclaration(stmt)) {
          const parent = stmt.heritageClauses?.[0]?.types[0];
          result.mixins.push(withEnd({
            name: stmt.name.text,
            on: parent ? textOf(parent.expression) : null,
            line: startLine(stmt),
            isPrivate: stmt.name.text.startsWith('_'),
          }, endLine(stmt)));
        } else if (ts.isTypeAliasDeclaration(stmt)) {
          result.typedefs.push({
            name: stmt.name.text,
            signature: collapse(textOf(stmt.type)).slice(0, 200),
            line: startLine(stmt),
            isPrivate: stmt.name.text.startsWith('_'),
          });
        } else if (ts.isModuleDeclaration(stmt) && stmt.body && ts.isModuleBlock(stmt.body)) {
          visitStatements(stmt.body.statements);
        }
      }
    };

    visitStatements(sf.statements);

    // ── references, calls, usages, requires, JSX ─────────────────────────────
    interface Symbols {
      classes: Set<string>;
      functions: Set<string>;
      typedefs: Set<string>;
      variables: Set<string>;
      enums: Set<string>;
      mixins: Set<string>;
    }
    const symbols: Symbols = {
      classes: new Set(result.classes.map(c => c.name)),
      functions: new Set(result.functions.map(f => f.name)),
      typedefs: new Set(result.typedefs.map(t => t.name)),
      variables: new Set(result.variables.map(v => v.name)),
      enums: new Set(result.enums.map(e => e.name)),
      mixins: new Set(result.mixins.map(m => m.name)),
    };

    const classUsage = new Map(result.classes.map(c => [c.name, {
      className: c.name, usedInFiles: [filePath], usedByClasses: [] as string[], usedByFunctions: [] as string[], confidence: 'medium' as const,
    }]));
    const funcUsage = new Map(result.functions.map(f => [f.name, {
      functionName: f.name, parentClass: f.parentClass, calledByFunctions: [] as string[], calledInFiles: [filePath], confidence: 'medium' as const,
    }]));
    const typedefUsage = new Map(result.typedefs.map(t => [t.name, { typedefName: t.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const variableUsage = new Map(result.variables.map(v => [v.name, { variableName: v.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const enumUsage = new Map(result.enums.map(e => [e.name, { enumName: e.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));
    const mixinUsage = new Map(result.mixins.map(m => [m.name, { mixinName: m.name, usedInFiles: [] as string[], confidence: 'medium' as const }]));

    const referenced = new Set<string>();
    const propertyAccessNames = new Set<string>();
    const instantiated = new Set<string>();

    const addUnique = (list: string[], value: string): void => { if (!list.includes(value)) { list.push(value); } };

    const isDeclarationName = (node: ts.Identifier): boolean => {
      const parent = node.parent;
      if (!parent) { return false; }
      if ((ts.isClassDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent) ||
        ts.isEnumDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
        ts.isParameter(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) ||
        ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent) || ts.isBindingElement(parent) ||
        ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) ||
        ts.isPropertyAssignment(parent) || ts.isTypeParameterDeclaration(parent) || ts.isLabeledStatement(parent) ||
        ts.isClassExpression(parent) || ts.isFunctionExpression(parent)) && (parent as { name?: ts.Node }).name === node) {
        return true;
      }
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) { return true; }
      if (ts.isQualifiedName(parent) && parent.right === node) { return true; }
      if (ts.isJsxAttribute(parent) && parent.name === node) { return true; }
      return false;
    };

    const handleIdentifier = (node: ts.Identifier, cls: string | null, fn: string | null): void => {
      const parent = node.parent;
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) {
        propertyAccessNames.add(node.text);
        return;
      }
      if (isDeclarationName(node)) { return; }
      const text = node.text;

      if (symbols.classes.has(text)) {
        referenced.add(text);
        const usage = classUsage.get(text)!;
        if (fn) { addUnique(usage.usedByFunctions, fn); }
        else if (cls && cls !== text) { addUnique(usage.usedByClasses, cls); }
      }
      if (symbols.functions.has(text)) {
        referenced.add(text);
        if (fn && fn !== text) { addUnique(funcUsage.get(text)!.calledByFunctions, fn); }
      }
      if (symbols.typedefs.has(text)) { addUnique(typedefUsage.get(text)!.usedInFiles, filePath); }
      if (symbols.variables.has(text)) { addUnique(variableUsage.get(text)!.usedInFiles, filePath); }
      if (symbols.enums.has(text)) { addUnique(enumUsage.get(text)!.usedInFiles, filePath); }
      if (symbols.mixins.has(text)) { addUnique(mixinUsage.get(text)!.usedInFiles, filePath); }
    };

    const contextAround = (line: number): string => {
      const from = Math.max(0, line - 2);
      const to = Math.min(sourceLines.length - 1, line);
      return sourceLines.slice(from, to + 1).join('\n').trim().substring(0, 200);
    };

    const receiverOf = (expr: ts.Expression): string | undefined => {
      const inner = unwrap(expr);
      if (ts.isIdentifier(inner)) { return inner.text; }
      if (inner.kind === ts.SyntaxKind.ThisKeyword) { return 'this'; }
      if (inner.kind === ts.SyntaxKind.SuperKeyword) { return 'super'; }
      if (ts.isPropertyAccessExpression(inner)) { return inner.name.text; }
      return undefined;
    };

    const pushCall = (name: string, node: ts.Node, receiver: string | undefined, cls: string | null, fn: string | null): void => {
      const line = startLine(node);
      const call: FunctionCall = {
        name,
        line,
        callerClass: cls,
        callerFunction: fn,
        context: contextAround(line),
        isStatic: !receiver || classNames.has(receiver),
        isChained: !!receiver,
        receiver,
      };
      result.functionCalls.push(call);
    };

    const handleCall = (node: ts.CallExpression, cls: string | null, fn: string | null): void => {
      const callee = node.expression;
      const first = node.arguments[0];

      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        if (first && ts.isStringLiteralLike(first)) {
          addImport({ path: first.text, alias: null, showNames: [], hideNames: [], line: startLine(node) });
        }
        return;
      }
      if (ts.isIdentifier(callee) && callee.text === 'require') {
        if (first && ts.isStringLiteralLike(first)) {
          addImport({ path: first.text, alias: null, showNames: [], hideNames: [], line: startLine(node) });
        }
        return;
      }

      let name: string | undefined;
      let receiver: string | undefined;
      if (ts.isIdentifier(callee)) {
        name = callee.text;
      } else if (ts.isPropertyAccessExpression(callee)) {
        name = callee.name.text;
        receiver = receiverOf(callee.expression);
      }
      if (!name || RESERVED_CALLS.has(name) || receiver === 'console') { return; }
      // direct recursion adds nothing to the graph
      if (name === fn && (!receiver || receiver === 'this')) { return; }
      pushCall(name, node, receiver, cls, fn);
    };

    const handleNew = (node: ts.NewExpression, cls: string | null, fn: string | null): void => {
      const callee = node.expression;
      let name: string | undefined;
      let receiver: string | undefined;
      if (ts.isIdentifier(callee)) {
        name = callee.text;
      } else if (ts.isPropertyAccessExpression(callee)) {
        name = callee.name.text;
        receiver = receiverOf(callee.expression);
      }
      if (!name) { return; }
      instantiated.add(name);
      pushCall(name, node, receiver, cls, fn);
    };

    const walk = (node: ts.Node, cls: string | null, fn: string | null): void => {
      let nextCls = cls;
      let nextFn = fn;

      if (ts.isClassDeclaration(node)) {
        nextCls = node.name?.text ?? (hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? 'default' : cls);
        nextFn = null;
      } else if (ts.isFunctionDeclaration(node)) {
        nextFn = node.name?.text ?? (hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? 'default' : fn);
      } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        nextFn = nameOf(node.name) || fn;
      } else if (ts.isConstructorDeclaration(node)) {
        nextFn = 'constructor';
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunctionLike(node.initializer)) {
        nextFn = node.name.text;
      } else if (ts.isPropertyDeclaration(node) && isFunctionLike(node.initializer)) {
        nextFn = nameOf(node.name) || fn;
      }

      if (ts.isCallExpression(node)) { handleCall(node, nextCls, nextFn); }
      else if (ts.isNewExpression(node)) { handleNew(node, nextCls, nextFn); }
      else if (ts.isIdentifier(node)) { handleIdentifier(node, nextCls, nextFn); }

      ts.forEachChild(node, child => walk(child, nextCls, nextFn));
    };

    walk(sf, null, null);

    // ── JSX tree + UI warnings (only for .tsx / .jsx) ─────────────────────────
    if (isJsxFile) {
      const roots: WidgetInfo[] = [];
      const attach = (widget: WidgetInfo, parent: WidgetInfo | null): void => {
        if (parent) { parent.children.push(widget); } else { roots.push(widget); }
      };
      const visitJsx = (node: ts.Node, parent: WidgetInfo | null): void => {
        if (ts.isJsxElement(node)) {
          const widget: WidgetInfo = { name: textOf(node.openingElement.tagName), line: startLine(node), children: [], properties: [] };
          attach(widget, parent);
          ts.forEachChild(node, c => visitJsx(c, widget));
          return;
        }
        if (ts.isJsxSelfClosingElement(node)) {
          const widget: WidgetInfo = { name: textOf(node.tagName), line: startLine(node), children: [], properties: [] };
          attach(widget, parent);
          ts.forEachChild(node, c => visitJsx(c, widget));
          return;
        }
        ts.forEachChild(node, c => visitJsx(c, parent));
      };
      visitJsx(sf, null);
      result.widgets = roots;

      const lowerPath = filePath.toLowerCase();
      const skipColors = lowerPath.includes('theme') || lowerPath.includes('color');
      const visitWarnings = (node: ts.Node): void => {
        if (ts.isJsxText(node)) {
          const raw = node.text;
          const trimmed = raw.trim();
          if (trimmed.length > 1 && /[A-Za-z\u0600-\u06FF]{2,}/.test(trimmed)) {
            const offset = raw.length - raw.trimStart().length;
            result.warnings.push({ type: 'hardcoded_text', message: `Hardcoded text: ${trimmed}`, line: lineOf(node.getStart(sf) + offset) } as WarningInfo);
          }
        } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) &&
          TEXT_ATTRIBUTES.has(nameOf(node.name)) && /[A-Za-z\u0600-\u06FF]{2,}/.test(node.initializer.text)) {
          result.warnings.push({ type: 'hardcoded_text', message: `Hardcoded text: ${node.initializer.text}`, line: startLine(node) } as WarningInfo);
        } else if (!skipColors && ts.isStringLiteral(node) && COLOR_LITERAL.test(node.text.trim())) {
          result.warnings.push({ type: 'hardcoded_color', message: `Hardcoded color: ${node.text.trim()}`, line: startLine(node) } as WarningInfo);
        }
        ts.forEachChild(node, visitWarnings);
      };
      visitWarnings(sf);
    }

    // ── usage tables ──
    result.classUsages = [...classUsage.values()];
    result.functionUsages = [...funcUsage.values()];
    result.typedefUsages = [...typedefUsage.values()];
    result.variableUsages = [...variableUsage.values()];
    result.enumUsages = [...enumUsage.values()];
    result.mixinUsages = [...mixinUsage.values()];

    for (const a of result.annotations) {
      if (!result.annotationUsages.find(au => au.annotationName === a.name)) {
        result.annotationUsages.push({ annotationName: a.name, usedInFiles: [filePath], confidence: 'medium' });
      }
    }
    for (const c of result.constructors) {
      result.constructorUsages.push({
        constructorName: c.name,
        className: c.className,
        usedInFiles: instantiated.has(c.className) || referenced.has(c.className) ? [filePath] : [],
        confidence: 'medium',
      });
    }
    for (const p of result.properties) {
      result.propertyUsages.push({
        propertyName: p.name,
        className: p.className,
        usedInFiles: propertyAccessNames.has(p.name) ? [filePath] : [],
        confidence: 'medium',
      });
    }
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
}
