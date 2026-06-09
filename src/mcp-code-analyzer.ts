import * as fs from 'fs';
import * as path from 'path';

export interface LogicStep {
  step: number;
  description: string;
  type: 'validation' | 'data_fetch' | 'conditional' | 'state_update' | 'notification' | 'api_call' | 'error_handling' | 'other';
  line?: number;
}

export class CodeAnalyzer {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Analyze a function's logic and return a summarized flow
   */
  analyzeLogicFlow(functionBody: string): LogicStep[] {
    const steps: LogicStep[] = [];
    const lines = functionBody.split('\n');
    let stepNumber = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and comments
      if (!line || line.startsWith('//') || line.startsWith('*')) continue;

      // Validation checks
      if (line.includes('if') && (line.includes('== null') || line.includes('=== null') || line.includes('isEmpty') || line.match(/!\w+/))) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'validation'),
          type: 'validation',
          line: i + 1
        });
      }
      // Data fetch (Hive, SharedPreferences, localStorage, etc.)
      else if (line.includes('Hive') || line.includes('box.get') || line.includes('box.values') || 
               line.includes('SharedPreferences') || line.includes('localStorage') || line.includes('sessionStorage') ||
               line.includes('getItem') || line.includes('getString')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'data_fetch'),
          type: 'data_fetch',
          line: i + 1
        });
      }
      // API calls (Firebase, fetch, http, Retrofit, axios)
      else if (line.includes('Firebase') || line.includes('http.') || line.includes('axios') || 
               (line.includes('await') && line.includes('fetch')) || line.includes('Retrofit') || line.includes('OkHttp')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'api_call'),
          type: 'api_call',
          line: i + 1
        });
      }
      // State updates (Flutter, Android, React/Vue)
      else if (line.includes('setState') || line.includes('ref.read') || line.includes('state =') || 
               line.includes('runOnUiThread') || line.includes('postValue') || line.includes('setValue') || 
               line.includes('useState') || line.includes('dispatch')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'state_update'),
          type: 'state_update',
          line: i + 1
        });
      }
      // Notifications / Logging
      else if (line.includes('showSnackBar') || line.includes('showDialog') || line.includes('ScaffoldMessenger') ||
               line.includes('Toast.makeText') || line.includes('Log.') || line.includes('console.') || line.includes('alert(')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'notification'),
          type: 'notification',
          line: i + 1
        });
      }
      // Error handling
      else if (line.includes('try') || line.includes('catch') || line.includes('throw')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'error_handling'),
          type: 'error_handling',
          line: i + 1
        });
      }
      // Conditionals
      else if (line.startsWith('if') || line.startsWith('else if') || line.startsWith('switch')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'conditional'),
          type: 'conditional',
          line: i + 1
        });
      }
    }

    return steps;
  }

  private extractDescription(line: string, type: string): string {
    const cleaned = line
      .replace(/\/\/.*$/, '') 
      .replace(/\/\*[\s\S]*?\*\//g, '') 
      .trim();

    switch (type) {
      case 'validation':
        if (cleaned.includes('== null') || cleaned.includes('=== null')) return 'Check if value is null';
        if (cleaned.includes('isEmpty')) return 'Check if collection is empty';
        if (cleaned.match(/!\w+/)) return 'Negation check';
        return 'Validation check';
      case 'data_fetch':
        if (cleaned.includes('Hive') || cleaned.includes('box.get')) return 'Fetch data from local storage (Hive)';
        if (cleaned.includes('SharedPreferences')) return 'Fetch data from SharedPreferences';
        if (cleaned.includes('localStorage') || cleaned.includes('sessionStorage')) return 'Fetch data from Web Storage';
        return 'Data retrieval';
      case 'api_call':
        if (cleaned.includes('Firebase')) return 'Call Firebase API';
        if (cleaned.includes('fetch') || cleaned.includes('axios') || cleaned.includes('http.')) return 'HTTP request';
        return 'Async network operation';
      case 'state_update':
        if (cleaned.includes('setState') || cleaned.includes('useState')) return 'Update component state';
        if (cleaned.includes('postValue') || cleaned.includes('setValue')) return 'Update observable state';
        if (cleaned.includes('ref.read')) return 'Read from provider/store';
        return 'State modification';
      case 'notification':
        if (cleaned.includes('Toast') || cleaned.includes('showSnackBar')) return 'Show temporary notification';
        if (cleaned.includes('Log.') || cleaned.includes('console.')) return 'Log information to console';
        if (cleaned.includes('alert(') || cleaned.includes('showDialog')) return 'Show dialog/alert';
        return 'User notification or logging';
      case 'error_handling':
        if (cleaned.includes('try')) return 'Start error handling block';
        if (cleaned.includes('catch')) return 'Catch error';
        if (cleaned.includes('throw')) return 'Throw exception';
        return 'Error handling';
      case 'conditional':
        return 'Conditional logic';
      default:
        return cleaned.substring(0, 50) + (cleaned.length > 50 ? '...' : '');
    }
  }

  /**
   * Extract constructor dependencies (repositories, services, etc.)
   */
  extractConstructorDependencies(classBody: string): string[] {
    const dependencies: string[] = [];
    const lines = classBody.split('\n');

    // 1. Gather all class fields and their types (Handles Dart and Java/TS properties)
    const fieldTypes = new Map<string, string>();
    const fieldPattern = /(?:private|public|protected|final|const|late)?\s*([a-zA-Z0-9_<>,?\s\[\]]+)\s+([a-zA-Z0-9_]+)\s*(?:;|=)/;

    const primitiveTypes = new Set([
      'string', 'int', 'double', 'bool', 'boolean', 'num', 'dynamic', 'void', 'any', 'number',
      'list', 'map', 'set', 'array', 'datetime', 'duration', 'widget', 'buildcontext',
      'key', 'function', 'future', 'promise', 'stream', 'observable', 'object', 'final', 'const', 'late',
      'var', 'override', 'get', 'set', 'return', 'this', 'super', 'private', 'public', 'protected'
    ]);

    const isClassType = (typeStr: string): boolean => {
      const cleaned = typeStr.trim().replace(/[?<>\[\]]/g, '');
      if (cleaned.length === 0) return false;
      const firstChar = cleaned[0];
      const isUpper = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
      return isUpper && !primitiveTypes.has(cleaned.toLowerCase());
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      const fieldMatch = trimmed.match(fieldPattern);
      if (fieldMatch) {
        const typePart = fieldMatch[1].trim();
        const namePart = fieldMatch[2].trim();
        if (isClassType(typePart)) {
          fieldTypes.set(namePart, typePart);
        }
      }
    }

    // 2. Identify constructor parameters and resolve their types
    let inConstructor = false;
    let constructorParamsText = '';
    let parenCount = 0;

    const processConstructorParams = (paramsText: string) => {
      const startIdx = paramsText.indexOf('(');
      const endIdx = paramsText.lastIndexOf(')');
      if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return;
      const inner = paramsText.substring(startIdx + 1, endIdx);

      const params: string[] = [];
      let current = '';
      let depth = 0;
      for (let i = 0; i < inner.length; i++) {
        const char = inner[i];
        if (char === '<' || char === '(' || char === '{') depth++;
        else if (char === '>' || char === ')' || char === '}') depth--;

        if (char === ',' && depth === 0) {
          params.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) params.push(current.trim());

      for (const param of params) {
        if (!param) continue;
        const cleanedParam = param.replace(/\b(?:required|final|const|private|public|protected|val|var)\b/g, '').trim();

        // Match Dart: this.fieldName
        const thisMatch = cleanedParam.match(/this\.([a-zA-Z0-9_]+)/);
        if (thisMatch) {
          const fieldName = thisMatch[1];
          const type = fieldTypes.get(fieldName);
          if (type) {
            dependencies.push(`${type} ${fieldName}`);
          }
          continue;
        } 

        // Match TS/Kotlin/Java explicit typing: name: Type OR Type name
        // TypeScript/Kotlin format: name: Type
        const colonMatch = cleanedParam.match(/^([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_<>?\[\]]+)/);
        if (colonMatch) {
          const fieldName = colonMatch[1];
          const type = colonMatch[2];
          if (isClassType(type)) {
            dependencies.push(`${type} ${fieldName}`);
          }
          continue;
        }

        // Dart/Java format: Type name
        const typedMatch = cleanedParam.match(/^([a-zA-Z0-9_<>?\[\]]+)\s+([a-zA-Z0-9_]+)/);
        if (typedMatch) {
          const type = typedMatch[1];
          const fieldName = typedMatch[2];
          if (isClassType(type)) {
            dependencies.push(`${type} ${fieldName}`);
          }
        }
      }
    };

    // Find class definition for Kotlin primary constructors
    let kotlinClassFound = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      if (!inConstructor) {
        // Kotlin primary constructor on class definition
        if (!kotlinClassFound && trimmed.startsWith('class ')) {
          const classCtorMatch = trimmed.match(/^class\s+[a-zA-Z0-9_]+\s*(?:<[^>]+>)?\s*\(/);
          if (classCtorMatch) {
            inConstructor = true;
            constructorParamsText = trimmed;
            parenCount = (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length;
            if (parenCount === 0) {
              inConstructor = false;
              processConstructorParams(constructorParamsText);
              kotlinClassFound = true;
            }
            continue;
          }
          kotlinClassFound = true;
        }

        // Standard constructor (Dart, Java, TS `constructor(...)`)
        const ctorMatch = trimmed.match(/^(?:public\s+|protected\s+|private\s+)?(?:constructor|[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)\s*\(/);
        // Ensure it looks like a constructor, not just a method. If it's `constructor(` or ClassName( it matches. 
        if (ctorMatch && (!trimmed.includes('function ') && !trimmed.includes('fun '))) {
          inConstructor = true;
          constructorParamsText = trimmed;
          parenCount = (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length;
          if (parenCount === 0) {
            inConstructor = false;
            processConstructorParams(constructorParamsText);
          }
        }
      } else {
        constructorParamsText += ' ' + trimmed;
        parenCount += (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length;
        if (parenCount <= 0) {
          inConstructor = false;
          processConstructorParams(constructorParamsText);
        }
      }
    }

    return dependencies;
  }

  /**
   * Helper to merge objects from index
   */
  private getCombinedIndex(index: any): Record<string, any> {
    const combined: Record<string, any> = {};
    if (!index) return combined;
    if (index.dart) Object.assign(combined, index.dart);
    if (index.android) Object.assign(combined, index.android);
    if (index.jsTs) Object.assign(combined, index.jsTs);
    return combined;
  }

  /**
   * Find application entry points (main and build methods, Android Activities, TS/React index)
   */
  findEntryPoints(index: any): any[] {
    const entryPoints: any[] = [];
    const combinedIndex = this.getCombinedIndex(index);

    for (const [path, info] of Object.entries(combinedIndex)) {
      // 1. Top-level main() or render()
      for (const func of info.functions || []) {
        if (func.name === 'main' || func.name === 'render') {
          entryPoints.push({ ...func, filePath: path, kind: 'Function', qname: this.getQName(path, null, func.name) });
        }
      }
      
      // 2. Class methods (build, onCreate, etc.)
      for (const cls of info.classes || []) {
        const extendsStr = cls.extendsClass || '';
        const implementsStr = cls.implementsClasses ? cls.implementsClasses.join(',') : '';
        const hierarchy = extendsStr + implementsStr;

        const isEntryPointClass = hierarchy.includes('Widget') || 
          hierarchy.includes('State') ||
          hierarchy.includes('Consumer') ||
          hierarchy.includes('Activity') ||
          hierarchy.includes('Fragment') ||
          hierarchy.includes('Application') ||
          hierarchy.includes('Service') ||
          hierarchy.includes('Component'); // React Component
        
        // Include entrypoints if it matches the above, or if file is intuitively an entry point like App.tsx
        const isEntryFile = path.endsWith('App.tsx') || path.endsWith('App.jsx') || path.endsWith('index.ts') || path.endsWith('index.js');

        if (isEntryPointClass || isEntryFile) {
          for (const method of cls.methods || []) {
            const entryPointMethods = [
              'build', 'initState', 'dispose', 
              'onCreate', 'onCreateView', 'onStartCommand', 'onReceive',
              'componentDidMount', 'render', 'ngOnInit'
            ];
            if (entryPointMethods.includes(method.name) || method.name.startsWith('on')) {
              entryPoints.push({ 
                ...method, 
                filePath: path, 
                kind: 'Method', 
                parentClass: cls.name, 
                qname: this.getQName(path, cls.name, method.name) 
              });
            }
          }
        }
      }

      // 3. JS/TS/React Functional Components & Entry Files fallback
      const isJsTsEntryFile = path.endsWith('App.tsx') || path.endsWith('App.jsx') || path.endsWith('index.tsx') || path.endsWith('index.jsx') || path.endsWith('index.ts') || path.endsWith('index.js') || path.endsWith('main.ts') || path.endsWith('main.js') || path.endsWith('main.tsx');
      if (isJsTsEntryFile) {
        for (const func of info.functions || []) {
          entryPoints.push({ ...func, filePath: path, kind: 'Function', qname: this.getQName(path, null, func.name) });
        }
        for (const widget of info.widgets || []) {
          entryPoints.push({ ...widget, filePath: path, kind: 'Widget', qname: this.getQName(path, null, widget.name) });
        }
      }
    }
    return entryPoints;
  }

  private getQName(filePath: string, className: string | null, entityName: string): string {
    return `${filePath}:${className ? className + '.' : ''}${entityName}`;
  }

  /**
   * Resolve a call to its target function or class
   */
  resolveCall(index: any, name: string, receiver?: string): any | null {
    const combinedIndex = this.getCombinedIndex(index);

    const dotIdx = name.indexOf('.');
    let searchClass = receiver;
    let searchMethod = name;

    if (dotIdx !== -1) {
      searchClass = name.substring(0, dotIdx);
      searchMethod = name.substring(dotIdx + 1);
    }

    for (const [path, info] of Object.entries(combinedIndex)) {
      if (!searchMethod || searchMethod === name) {
        for (const c of info.classes || []) {
          if (c.name === name) return { ...c, filePath: path, kind: 'Class', name: c.name, line: c.line, qname: this.getQName(path, null, c.name) };
        }
      }

      if (!searchClass) {
        for (const f of info.functions || []) {
          if (f.name === name) return { ...f, filePath: path, kind: 'Function', qname: this.getQName(path, null, f.name) };
        }
      }

      for (const c of info.classes || []) {
        if (searchClass && c.name !== searchClass) continue;
        for (const m of (c.methods || [])) {
          if (m.name === searchMethod) return { ...m, filePath: path, kind: 'Method', parentClass: c.name, qname: this.getQName(path, c.name, m.name) };
        }
      }
    }
    return null;
  }

  /**
   * Build a reverse call graph: target -> Set of callers
   */
  private buildReverseCallGraph(index: any): Map<string, Set<string>> {
    const reverseGraph = new Map<string, Set<string>>();
    const combinedIndex = this.getCombinedIndex(index);

    for (const [filePath, info] of Object.entries(combinedIndex)) {
      const calls = info.functionCalls || [];
      for (const call of calls) {
        const callerQName = this.getQName(filePath, call.callerClass, call.callerFunction);
        const targetNode = this.resolveCall(index, call.name, call.receiver);
        
        if (targetNode) {
          const targetQName = targetNode.qname;
          if (!reverseGraph.has(targetQName)) {
            reverseGraph.set(targetQName, new Set());
          }
          reverseGraph.get(targetQName)!.add(callerQName);
        }
      }
    }

    return reverseGraph;
  }

  /**
   * Find impact using a true backward BFS from target entities to entry points
   */
  findImpactBackwards(index: any, targetFilePath: string, maxDepth = 25): any[] {
    const combinedIndex = this.getCombinedIndex(index);
    const fileInfo = combinedIndex[targetFilePath];
    if (!fileInfo) return [];

    const targetEntities = new Set<string>();
    for (const cls of fileInfo.classes || []) targetEntities.add(this.getQName(targetFilePath, null, cls.name));
    for (const func of fileInfo.functions || []) targetEntities.add(this.getQName(targetFilePath, null, func.name));
    
    for (const cls of fileInfo.classes || []) {
      for (const m of cls.methods || []) {
        targetEntities.add(this.getQName(targetFilePath, cls.name, m.name));
      }
    }

    const reverseGraph = this.buildReverseCallGraph(index);
    const entryPoints = this.findEntryPoints(index);
    const entryPointQNames = new Set(entryPoints.map(ep => ep.qname));
    const entryPointMap = new Map(entryPoints.map(ep => [ep.qname, ep]));

    const affectedFlows: any[] = [];
    const queue: { qname: string; path: string[] }[] = [];
    const visited = new Map<string, number>();

    for (const target of targetEntities) {
      queue.push({ qname: target, path: [target] });
      visited.set(target, 0);
    }

    while (queue.length > 0) {
      const { qname, path: currentPath } = queue.shift()!;
      
      if (entryPointQNames.has(qname)) {
        const ep = entryPointMap.get(qname)!;
        affectedFlows.push({
          entryPoint: ep.name,
          entryFile: ep.filePath,
          kind: ep.kind,
          parentClass: ep.parentClass,
          flowPath: [...currentPath].reverse().join(" -> ")
        });
        if (affectedFlows.length >= 50) break;
      }

      if (currentPath.length >= maxDepth) continue;

      const callers = reverseGraph.get(qname);
      if (callers) {
        for (const caller of callers) {
          if (!visited.has(caller) || visited.get(caller)! > currentPath.length + 1) {
            visited.set(caller, currentPath.length + 1);
            queue.push({ qname: caller, path: [...currentPath, caller] });
          }
        }
      }
    }

    return affectedFlows;
  }
}
