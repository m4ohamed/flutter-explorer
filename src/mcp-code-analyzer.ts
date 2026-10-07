import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ImportResolver, CallResolver } from './indexer/importResolver';

export interface LogicStep {
  step: number;
  description: string;
  type: 'validation' | 'data_fetch' | 'conditional' | 'state_update' | 'notification' | 'api_call' | 'error_handling' | 'other';
  line?: number;
}

export interface CircularDependencyCycle {
  length: number;
  cycle: string[];
  formatted: string;
}

export interface LayerBoundaryRule {
  name: string;
  fromLayer: string; // pattern e.g. "domain" or "lib/domain/"
  forbiddenLayers: string[]; // patterns e.g. ["data", "presentation"]
  description: string;
}

export interface LayerViolation {
  fromFile: string;
  toFile: string;
  ruleName: string;
  description: string;
  line?: number;
}

export interface UnusedAsset {
  path: string;
  fileName: string;
  sizeBytes: number;
  extension: string;
}

export interface GitBlastRadiusResult {
  modifiedFiles: string[];
  totalAffectedFlows: number;
  affectedFlows: any[];
  summary: string;
}

export interface WidgetDepthViolation {
  file: string;
  rootWidget: string;
  maxDepth: number;
  deepestPath: string;
  deepestLine?: number;
  recommendation: string;
}

export interface WidgetDepthAnalysisResult {
  totalWidgetsAnalyzed: number;
  maxObservedDepth: number;
  violationsCount: number;
  violations: WidgetDepthViolation[];
}

export interface DuplicateWidgetCluster {
  nodeCount: number;
  structureSignature: string;
  occurrences: Array<{ file: string; rootWidget: string; line: number }>;
  suggestedName: string;
  proposal: string;
}

export interface DuplicateWidgetsResult {
  analyzedSubtreesCount: number;
  clustersCount: number;
  clusters: DuplicateWidgetCluster[];
}

export interface MemoryLeakWarning {
  file: string;
  className: string;
  field: string;
  fieldType: string;
  line?: number;
  hasDisposeMethod: boolean;
  message: string;
  fixSuggestion: string;
}

export interface MemoryLeakDetectionResult {
  analyzedClassesCount: number;
  warningsCount: number;
  warnings: MemoryLeakWarning[];
}

export interface ArchitecturalLayerInfo {
  layer: 'presentation' | 'domain' | 'data' | 'core' | 'other';
  file: string;
  classesCount: number;
  afferentCoupling: number;
  efferentCoupling: number;
  instability: number;
}

export interface LayerCouplingSummary {
  presentation: { filesCount: number; avgInstability: number };
  domain: { filesCount: number; avgInstability: number };
  data: { filesCount: number; avgInstability: number };
  core: { filesCount: number; avgInstability: number };
}

export interface ArchitecturalLayersResult {
  totalFiles: number;
  layerBreakdown: Record<string, number>;
  layerCouplingSummary: LayerCouplingSummary;
  files: ArchitecturalLayerInfo[];
  detectedCrossLayerViolations: Array<{ from: string; to: string; violation: string }>;
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

  private getProjectName(): string | null {
    try {
      const pubspecPath = path.join(this.projectRoot, 'pubspec.yaml');
      if (fs.existsSync(pubspecPath)) {
        const content = fs.readFileSync(pubspecPath, 'utf8');
        const match = /^name:\s*([a-zA-Z0-9_-]+)/m.exec(content);
        if (match) return match[1];
      }
      const pkgPath = path.join(this.projectRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (parsed.name) return parsed.name;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Build a reverse call graph: target -> Set of callers
   */
  private buildReverseCallGraph(index: any): Map<string, Set<string>> {
    const reverseGraph = new Map<string, Set<string>>();
    const combinedIndex = this.getCombinedIndex(index);
    const resolver = new ImportResolver(Object.keys(combinedIndex), this.getProjectName());
    const callResolver = new CallResolver(combinedIndex, resolver);

    for (const [filePath, info] of Object.entries(combinedIndex)) {
      const calls = info.functionCalls || [];
      for (const call of calls) {
        const callerQName = callResolver.callerQName(filePath, call);
        const targetNode = callResolver.resolve(filePath, call);
        
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

  // ─── Advanced Feature 11: Circular Dependency Cycle Detection ─────────────

  /**
   * Detects circular dependency cycles across project files
   */
  detectCircularDependencies(index: any): {
    totalFilesAnalyzed: number;
    cyclesCount: number;
    cycles: CircularDependencyCycle[];
  } {
    const combinedIndex = this.getCombinedIndex(index);
    const graph = new Map<string, string[]>();
    const resolver = new ImportResolver(Object.keys(combinedIndex), this.getProjectName());

    // Build directed import graph
    for (const [filePath, info] of Object.entries(combinedIndex)) {
      const neighbors: string[] = [];
      for (const imp of info.imports || []) {
        const impPath = typeof imp === 'string' ? imp : imp.path;
        if (!impPath) continue;
        const resolved = resolver.resolve(filePath, impPath);
        if (resolved && resolved !== filePath) {
          neighbors.push(resolved);
        }
      }
      graph.set(filePath, neighbors);
    }

    const cycles: CircularDependencyCycle[] = [];
    const seenCycleKeys = new Set<string>();

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const currentPath: string[] = [];

    const dfs = (node: string) => {
      visited.add(node);
      inStack.add(node);
      currentPath.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (inStack.has(neighbor)) {
          // Cycle found!
          const cycleStartIdx = currentPath.indexOf(neighbor);
          if (cycleStartIdx !== -1) {
            const cycleNodes = currentPath.slice(cycleStartIdx);
            // Canonical rotation to avoid duplicate permutations
            const minIndex = cycleNodes.indexOf([...cycleNodes].sort()[0]);
            const rotated = [...cycleNodes.slice(minIndex), ...cycleNodes.slice(0, minIndex)];
            const key = rotated.join('->');

            if (!seenCycleKeys.has(key)) {
              seenCycleKeys.add(key);
              cycles.push({
                length: cycleNodes.length,
                cycle: cycleNodes,
                formatted: [...cycleNodes, neighbor].join(' -> ')
              });
            }
          }
        }
      }

      currentPath.pop();
      inStack.delete(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    // Sort by cycle length
    cycles.sort((a, b) => a.length - b.length);

    return {
      totalFilesAnalyzed: graph.size,
      cyclesCount: cycles.length,
      cycles
    };
  }

  // ─── Advanced Feature 12: Architectural Layer Boundary Validation ──────────

  /**
   * Validates layer boundary rules (Clean Architecture / Feature-First)
   */
  validateLayerBoundaries(index: any, customRules?: LayerBoundaryRule[]): {
    totalViolations: number;
    violations: LayerViolation[];
    rulesApplied: number;
  } {
    const combinedIndex = this.getCombinedIndex(index);

    const defaultRules: LayerBoundaryRule[] = [
      {
        name: 'Domain Layer Isolation',
        fromLayer: 'domain',
        forbiddenLayers: ['data', 'presentation', 'ui'],
        description: 'Domain layer (entities/usecases) must be independent of Data and Presentation layers'
      },
      {
        name: 'Core Isolation',
        fromLayer: 'core',
        forbiddenLayers: ['features', 'modules', 'pages', 'screens'],
        description: 'Core infrastructure must not depend on higher-level Feature modules'
      },
      {
        name: 'Clean Presentation',
        fromLayer: 'presentation',
        forbiddenLayers: ['data/datasources', 'data/models'],
        description: 'Presentation/UI layer should interact with Domain repositories, not direct Data sources or models'
      }
    ];

    const rules = customRules && customRules.length > 0 ? customRules : defaultRules;
    const violations: LayerViolation[] = [];
    const resolver = new ImportResolver(Object.keys(combinedIndex), this.getProjectName());

    const matchesLayer = (filePath: string, layerPattern: string): boolean => {
      const norm = filePath.replace(/\\/g, '/').toLowerCase();
      const pattern = layerPattern.toLowerCase();
      return norm.includes(`/${pattern}/`) || norm.startsWith(`${pattern}/`) || norm.includes(pattern);
    };

    for (const [fromFile, info] of Object.entries(combinedIndex)) {
      for (const rule of rules) {
        if (matchesLayer(fromFile, rule.fromLayer)) {
          for (const imp of info.imports || []) {
            const impPath = typeof imp === 'string' ? imp : imp.path;
            if (!impPath) continue;

            const targetPath = resolver.resolve(fromFile, impPath) ?? impPath;

            for (const forbidden of rule.forbiddenLayers) {
              if (matchesLayer(targetPath, forbidden)) {
                violations.push({
                  fromFile,
                  toFile: impPath,
                  ruleName: rule.name,
                  description: rule.description,
                  line: typeof imp === 'object' ? imp.line : undefined
                });
              }
            }
          }
        }
      }
    }

    return {
      totalViolations: violations.length,
      violations,
      rulesApplied: rules.length
    };
  }

  // ─── Advanced Feature 13: Unused Assets Scanner ────────────────────────────

  /**
   * Scans pubspec.yaml assets and compares against references in code
   */
  detectUnusedAssets(): {
    totalAssetsFound: number;
    unusedCount: number;
    unusedAssets: UnusedAsset[];
    totalUnusedSizeBytes: number;
  } {
    const pubspecPath = path.join(this.projectRoot, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
      return { totalAssetsFound: 0, unusedCount: 0, unusedAssets: [], totalUnusedSizeBytes: 0 };
    }

    // 1. Parse assets from pubspec.yaml
    const pubspec = fs.readFileSync(pubspecPath, 'utf-8');
    const assetSectionMatch = pubspec.match(/assets:\s*([\s\S]*?)(?=\n\s*[a-zA-Z0-9_\-]+:|$)/);
    const declaredPaths: string[] = [];

    if (assetSectionMatch) {
      const lines = assetSectionMatch[1].split('\n');
      for (const l of lines) {
        const itemMatch = l.match(/^\s*-\s*([^\s#]+)/);
        if (itemMatch) {
          declaredPaths.push(itemMatch[1].trim());
        }
      }
    }

    // 2. Discover physical asset files on disk
    const physicalAssets: { fullPath: string; relPath: string; fileName: string; size: number }[] = [];
    const visitedFiles = new Set<string>();

    const checkAndAddFile = (fp: string) => {
      if (visitedFiles.has(fp)) return;
      visitedFiles.add(fp);
      try {
        const stat = fs.statSync(fp);
        if (stat.isFile()) {
          const rel = path.relative(this.projectRoot, fp).replace(/\\/g, '/');
          physicalAssets.push({
            fullPath: fp,
            relPath: rel,
            fileName: path.basename(fp),
            size: stat.size
          });
        }
      } catch {}
    };

    const scanAssetDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      try {
        const entries = fs.readdirSync(dir);
        for (const e of entries) {
          const full = path.join(dir, e);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            scanAssetDir(full);
          } else if (/\.(png|jpg|jpeg|svg|webp|gif|json|riv|ttf|otf|mp3|wav|flac)$/i.test(e)) {
            checkAndAddFile(full);
          }
        }
      } catch {}
    };

    for (const d of declaredPaths) {
      const target = path.join(this.projectRoot, d);
      if (fs.existsSync(target)) {
        const s = fs.statSync(target);
        if (s.isDirectory()) {
          scanAssetDir(target);
        } else {
          checkAndAddFile(target);
        }
      }
    }

    // Also scan common assets directory if declaredPaths was empty
    if (physicalAssets.length === 0) {
      scanAssetDir(path.join(this.projectRoot, 'assets'));
    }

    if (physicalAssets.length === 0) {
      return { totalAssetsFound: 0, unusedCount: 0, unusedAssets: [], totalUnusedSizeBytes: 0 };
    }

    // 3. Scan code files for asset references
    let mergedCode = '';
    const scanCode = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (item === '.git' || item === 'build' || item === '.dart_tool' || item === 'node_modules') continue;
          const full = path.join(dir, item);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            scanCode(full);
          } else if (/\.(dart|ts|tsx|js|jsx|kt|java)$/i.test(item)) {
            mergedCode += ' ' + fs.readFileSync(full, 'utf-8');
          }
        }
      } catch {}
    };

    scanCode(path.join(this.projectRoot, 'lib'));
    scanCode(path.join(this.projectRoot, 'src'));

    const unusedAssets: UnusedAsset[] = [];
    let totalUnusedSize = 0;

    for (const asset of physicalAssets) {
      // Check full relative path or filename or camelCase/PascalCase name
      const nameWithoutExt = path.parse(asset.fileName).name;
      const isReferenced =
        mergedCode.includes(asset.relPath) ||
        mergedCode.includes(asset.fileName) ||
        (nameWithoutExt.length > 4 && mergedCode.includes(nameWithoutExt));

      if (!isReferenced) {
        unusedAssets.push({
          path: asset.relPath,
          fileName: asset.fileName,
          sizeBytes: asset.size,
          extension: path.extname(asset.fileName).toLowerCase()
        });
        totalUnusedSize += asset.size;
      }
    }

    return {
      totalAssetsFound: physicalAssets.length,
      unusedCount: unusedAssets.length,
      unusedAssets,
      totalUnusedSizeBytes: totalUnusedSize
    };
  }

  // ─── Advanced Feature 14: Git Diff Blast Radius Analysis ───────────────────

  /**
   * Determines blast radius automatically from current uncommitted or staged Git changes
   */
  getGitDiffImpactAnalysis(index: any, maxDepth = 25): GitBlastRadiusResult {
    const modifiedFiles: string[] = [];

    try {
      // 1. Check staged and unstaged diffs
      const diffOutput = execSync('git diff --name-only HEAD', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      for (const line of diffOutput.split('\n')) {
        const f = line.trim().replace(/\\/g, '/');
        if (f) modifiedFiles.push(f);
      }
    } catch {
      // Fallback to git status --porcelain
      try {
        const statusOutput = execSync('git status --porcelain', {
          cwd: this.projectRoot,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore']
        });
        for (const line of statusOutput.split('\n')) {
          const match = line.match(/^..\s+(.*)$/);
          if (match) {
            const f = match[1].trim().replace(/\\/g, '/');
            if (f) modifiedFiles.push(f);
          }
        }
      } catch {
        // Git not available
      }
    }

    const uniqueModified = [...new Set(modifiedFiles)];
    const combinedIndex = this.getCombinedIndex(index);
    const affectedFlowsMap = new Map<string, any>();

    for (const file of uniqueModified) {
      if (combinedIndex[file]) {
        const flows = this.findImpactBackwards(index, file, maxDepth);
        for (const flow of flows) {
          const key = `${flow.entryFile}:${flow.entryPoint}:${flow.flowPath}`;
          if (!affectedFlowsMap.has(key)) {
            affectedFlowsMap.set(key, { ...flow, triggeredByModifiedFile: file });
          }
        }
      }
    }

    const affectedFlows = Array.from(affectedFlowsMap.values());
    const summary = `Analyzed ${uniqueModified.length} modified files from Git diff. Found ${affectedFlows.length} affected entry points and execution paths.`;

    return {
      modifiedFiles: uniqueModified,
      totalAffectedFlows: affectedFlows.length,
      affectedFlows,
      summary
    };
  }

  /**
   * Analyzes widget nesting depth across project files.
   * Flags deeply nested widget trees that should be refactored into modular sub-widgets.
   * Inspired by DCM widget-nesting-depth.
   */
  analyzeWidgetDepth(index: any, maxDepthThreshold = 5): WidgetDepthAnalysisResult {
    const combinedIndex = this.getCombinedIndex(index);
    const violations: WidgetDepthViolation[] = [];
    let totalWidgetsAnalyzed = 0;
    let maxObservedDepth = 0;

    const computeDepth = (widget: any, currentPath: string[]): { depth: number; path: string[]; deepestLine?: number } => {
      totalWidgetsAnalyzed++;
      const wName = widget.name || 'Widget';
      const newPath = [...currentPath, wName];
      if (!widget.children || widget.children.length === 0) {
        return { depth: newPath.length, path: newPath, deepestLine: widget.line };
      }
      let deepest: { depth: number; path: string[]; deepestLine?: number } = {
        depth: newPath.length,
        path: newPath,
        deepestLine: widget.line
      };
      for (const child of widget.children) {
        const res = computeDepth(child, newPath);
        if (res.depth > deepest.depth) {
          deepest = res;
        }
      }
      return deepest;
    };

    for (const [filePath, fileInfo] of Object.entries(combinedIndex)) {
      const widgets = (fileInfo as any).widgets || [];
      for (const rootWidget of widgets) {
        const res = computeDepth(rootWidget, []);
        if (res.depth > maxObservedDepth) {
          maxObservedDepth = res.depth;
        }
        if (res.depth > maxDepthThreshold) {
          const midIdx = Math.floor(res.path.length / 2);
          const midWidget = res.path[midIdx] || 'sub-tree';
          violations.push({
            file: filePath,
            rootWidget: rootWidget.name || 'Widget',
            maxDepth: res.depth,
            deepestPath: res.path.join(' -> '),
            deepestLine: res.deepestLine,
            recommendation: `Extract intermediate subtree '${midWidget}' around depth ${midIdx + 1} into a dedicated StatelessWidget or helper method to improve readability and prevent unnecessary rebuilds.`
          });
        }
      }
    }

    return {
      totalWidgetsAnalyzed,
      maxObservedDepth,
      violationsCount: violations.length,
      violations
    };
  }

  /**
   * Detects duplicate or near-identical widget subtrees across project files.
   * Inspired by DCM Duplicate Widget Analyzer.
   */
  detectDuplicateWidgets(index: any, minNodeCount = 3): DuplicateWidgetsResult {
    const combinedIndex = this.getCombinedIndex(index);
    const signatureMap = new Map<string, Array<{ file: string; rootWidget: string; line: number }>>();
    let analyzedSubtreesCount = 0;

    const getSignature = (w: any): { sig: string; count: number } => {
      analyzedSubtreesCount++;
      const name = w.name || 'Widget';
      if (!w.children || w.children.length === 0) {
        return { sig: name, count: 1 };
      }
      const childSigs = (w.children || []).map((c: any) => getSignature(c));
      const totalNodes = 1 + childSigs.reduce((sum: number, c: any) => sum + c.count, 0);
      const combinedChildren = childSigs.map((c: any) => c.sig).sort().join(',');
      return {
        sig: `${name}(${combinedChildren})`,
        count: totalNodes
      };
    };

    for (const [filePath, fileInfo] of Object.entries(combinedIndex)) {
      const widgets = (fileInfo as any).widgets || [];
      for (const w of widgets) {
        const { sig, count } = getSignature(w);
        if (count >= minNodeCount) {
          if (!signatureMap.has(sig)) {
            signatureMap.set(sig, []);
          }
          signatureMap.get(sig)!.push({
            file: filePath,
            rootWidget: w.name || 'Widget',
            line: w.line || 1
          });
        }
      }
    }

    const clusters: DuplicateWidgetCluster[] = [];
    for (const [sig, occurrences] of signatureMap.entries()) {
      if (occurrences.length >= 2) {
        const parenIdx = sig.indexOf('(');
        const rootName = parenIdx !== -1 ? sig.substring(0, parenIdx) : 'Custom';
        const suggestedName = `Custom${rootName}Widget`;
        clusters.push({
          nodeCount: sig.split(/[(),]/).filter(Boolean).length,
          structureSignature: sig,
          occurrences,
          suggestedName,
          proposal: `Found ${occurrences.length} duplicate occurrences of '${sig}'. Consider consolidating into a reusable widget named '${suggestedName}'.`
        });
      }
    }

    clusters.sort((a, b) => (b.nodeCount * b.occurrences.length) - (a.nodeCount * a.occurrences.length));

    return {
      analyzedSubtreesCount,
      clustersCount: clusters.length,
      clusters
    };
  }

  /**
   * Scans State and Controller classes for undisposed resources (TextEditingController, AnimationController, etc.)
   * Inspired by leak_tracker and saropa_lints.
   */
  detectMemoryLeaks(index: any): MemoryLeakDetectionResult {
    const combinedIndex = this.getCombinedIndex(index);
    const warnings: MemoryLeakWarning[] = [];
    let analyzedClassesCount = 0;

    const DISPOSABLE_PATTERN = /(?:TextEditingController|AnimationController|ScrollController|TabController|PageController|StreamSubscription|FocusNode|ChangeNotifier|Timer)/i;

    for (const [filePath, fileInfo] of Object.entries(combinedIndex)) {
      const classes = (fileInfo as any).classes || [];
      for (const cls of classes) {
        analyzedClassesCount++;
        const properties = cls.properties || [];
        const disposableFields: Array<{ name: string; type: string; line?: number }> = [];

        for (const prop of properties) {
          const typeMatch = prop.type && DISPOSABLE_PATTERN.test(prop.type);
          const nameMatch = DISPOSABLE_PATTERN.test(prop.name) || prop.name.toLowerCase().includes('controller') || prop.name.toLowerCase().includes('subscription');
          if (typeMatch || nameMatch) {
            disposableFields.push({
              name: prop.name,
              type: prop.type || 'Controller',
              line: prop.line
            });
          }
        }

        if (disposableFields.length === 0) continue;

        const methods = cls.methods || [];
        const disposeMethod = methods.find((m: any) => m.name === 'dispose' || m.name === 'close' || m.name === 'cancel');

        let fileContent = '';
        try {
          const abs = path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
          if (fs.existsSync(abs)) {
            fileContent = fs.readFileSync(abs, 'utf-8');
          }
        } catch {}

        for (const field of disposableFields) {
          if (!disposeMethod) {
            warnings.push({
              file: filePath,
              className: cls.name,
              field: field.name,
              fieldType: field.type,
              line: field.line,
              hasDisposeMethod: false,
              message: `Class '${cls.name}' defines disposable resource '${field.name}' (${field.type}) but has NO dispose() method! This causes permanent memory leaks.`,
              fixSuggestion: `@override\nvoid dispose() {\n  ${field.name}.dispose();\n  super.dispose();\n}`
            });
          } else if (fileContent) {
            const disposeCallsPattern = new RegExp(`\\b${field.name}\\s*\\.\\s*(?:dispose|cancel|close)\\s*\\(`);
            if (!disposeCallsPattern.test(fileContent)) {
              warnings.push({
                file: filePath,
                className: cls.name,
                field: field.name,
                fieldType: field.type,
                line: field.line,
                hasDisposeMethod: true,
                message: `Class '${cls.name}' defines disposable resource '${field.name}' (${field.type}), but '${field.name}.dispose()' is never called inside dispose().`,
                fixSuggestion: `Add '${field.name}.dispose();' before 'super.dispose();' in '${cls.name}.dispose()'.`
              });
            }
          }
        }
      }
    }

    return {
      analyzedClassesCount,
      warningsCount: warnings.length,
      warnings
    };
  }

  /**
   * Classifies project files into Clean Architecture layers and computes Lakos coupling metrics.
   * Inspired by Lakos Software Architecture Visualizer.
   */
  getArchitecturalLayers(index: any): ArchitecturalLayersResult {
    const combinedIndex = this.getCombinedIndex(index);
    const files: ArchitecturalLayerInfo[] = [];
    const layerBreakdown: Record<string, number> = {
      presentation: 0,
      domain: 0,
      data: 0,
      core: 0,
      other: 0
    };

    const determineLayer = (fp: string, info: any): 'presentation' | 'domain' | 'data' | 'core' | 'other' => {
      const lower = fp.toLowerCase().replace(/\\/g, '/');
      if (lower.includes('/presentation/') || lower.includes('/views/') || lower.includes('/pages/') || lower.includes('/screens/') || lower.includes('/ui/') || lower.includes('/widgets/')) {
        return 'presentation';
      }
      if (lower.includes('/domain/') || lower.includes('/usecases/') || lower.includes('/entities/') || lower.includes('/bloc/') || lower.includes('/cubit/')) {
        return 'domain';
      }
      if (lower.includes('/data/') || lower.includes('/models/') || lower.includes('/datasources/') || lower.includes('/network/') || lower.includes('/services/') || lower.includes('/repositories/')) {
        return 'data';
      }
      if (lower.includes('/core/') || lower.includes('/utils/') || lower.includes('/common/') || lower.includes('/constants/') || lower.includes('/theme/')) {
        return 'core';
      }
      if (info.widgets && info.widgets.length > 0) return 'presentation';
      return 'other';
    };

    const fileToLayer = new Map<string, 'presentation' | 'domain' | 'data' | 'core' | 'other'>();
    const fileImports = new Map<string, Set<string>>();
    const fileImportedBy = new Map<string, Set<string>>();

    for (const [fp, info] of Object.entries(combinedIndex)) {
      const layer = determineLayer(fp, info);
      fileToLayer.set(fp, layer);
      layerBreakdown[layer]++;
      fileImports.set(fp, new Set());
      if (!fileImportedBy.has(fp)) fileImportedBy.set(fp, new Set());
    }

    for (const [fp, info] of Object.entries(combinedIndex)) {
      const imps = (info as any).imports || [];
      for (const imp of imps) {
        if (imp.path) {
          for (const targetFp of fileToLayer.keys()) {
            if (targetFp !== fp && (targetFp.endsWith(imp.path) || imp.path.includes(path.basename(targetFp, path.extname(targetFp))))) {
              fileImports.get(fp)!.add(targetFp);
              fileImportedBy.get(targetFp)!.add(fp);
            }
          }
        }
      }
    }

    const detectedCrossLayerViolations: Array<{ from: string; to: string; violation: string }> = [];

    for (const [fp, info] of Object.entries(combinedIndex)) {
      const layer = fileToLayer.get(fp) || 'other';
      const ce = fileImports.get(fp)?.size ?? 0;
      const ca = fileImportedBy.get(fp)?.size ?? 0;
      const instability = (ce + ca) > 0 ? Number((ce / (ca + ce)).toFixed(3)) : 0;

      files.push({
        layer,
        file: fp,
        classesCount: ((info as any).classes || []).length,
        afferentCoupling: ca,
        efferentCoupling: ce,
        instability
      });

      for (const target of fileImports.get(fp) || []) {
        const targetLayer = fileToLayer.get(target);
        if (layer === 'domain' && (targetLayer === 'presentation' || targetLayer === 'data')) {
          detectedCrossLayerViolations.push({
            from: fp,
            to: target,
            violation: `Domain layer file '${fp}' directly imports '${targetLayer}' file '${target}'. Domain must remain decoupled.`
          });
        }
      }
    }

    const getLayerSummary = (lName: string) => {
      const lFiles = files.filter(f => f.layer === lName);
      const avgInstability = lFiles.length > 0
        ? Number((lFiles.reduce((s, f) => s + f.instability, 0) / lFiles.length).toFixed(3))
        : 0;
      return { filesCount: lFiles.length, avgInstability };
    };

    const layerCouplingSummary: LayerCouplingSummary = {
      presentation: getLayerSummary('presentation'),
      domain: getLayerSummary('domain'),
      data: getLayerSummary('data'),
      core: getLayerSummary('core')
    };

    return {
      totalFiles: files.length,
      layerBreakdown,
      layerCouplingSummary,
      files,
      detectedCrossLayerViolations
    };
  }
}
