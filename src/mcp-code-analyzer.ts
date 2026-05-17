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
      if (line.includes('if') && (line.includes('== null') || line.includes('isEmpty') || line.includes('!'))) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'validation'),
          type: 'validation',
          line: i + 1
        });
      }
      // Data fetch from Hive
      else if (line.includes('Hive') || line.includes('box.get') || line.includes('box.values')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'data_fetch'),
          type: 'data_fetch',
          line: i + 1
        });
      }
      // API calls / Firebase
      else if (line.includes('Firebase') || line.includes('http.') || line.includes('await') && line.includes('fetch')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'api_call'),
          type: 'api_call',
          line: i + 1
        });
      }
      // State updates
      else if (line.includes('setState') || line.includes('ref.read') || line.includes('state =')) {
        steps.push({
          step: stepNumber++,
          description: this.extractDescription(line, 'state_update'),
          type: 'state_update',
          line: i + 1
        });
      }
      // Notifications
      else if (line.includes('showSnackBar') || line.includes('showDialog') || line.includes('ScaffoldMessenger')) {
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
    // Simple heuristic to extract meaningful description
    const cleaned = line
      .replace(/\/\/.*$/, '') // Remove comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .trim();

    switch (type) {
      case 'validation':
        if (cleaned.includes('== null')) return 'Check if value is null';
        if (cleaned.includes('isEmpty')) return 'Check if collection is empty';
        if (cleaned.includes('!')) return 'Negation check';
        return 'Validation check';
      case 'data_fetch':
        if (cleaned.includes('Hive')) return 'Fetch data from Hive storage';
        if (cleaned.includes('box.get')) return 'Get value from box';
        return 'Data retrieval';
      case 'api_call':
        if (cleaned.includes('Firebase')) return 'Call Firebase API';
        if (cleaned.includes('http.')) return 'HTTP request';
        return 'Async operation';
      case 'state_update':
        if (cleaned.includes('setState')) return 'Update widget state';
        if (cleaned.includes('ref.read')) return 'Read from Riverpod provider';
        return 'State modification';
      case 'notification':
        if (cleaned.includes('showSnackBar')) return 'Show snackbar notification';
        if (cleaned.includes('showDialog')) return 'Show dialog';
        return 'User notification';
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
    let inConstructor = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Find constructor
      if (trimmed.match(/^\w+\s*\(/)) {
        inConstructor = true;
      }

      if (inConstructor) {
        // Match constructor parameters that look like dependencies
        const paramMatch = trimmed.match(/(required\s+)?(?:final\s+)?(\w+)\s+(\w+)/);
        if (paramMatch) {
          const type = paramMatch[2];
          const name = paramMatch[3];
          
          // Common dependency patterns
          if (type.includes('Repository') || type.includes('Service') || type.includes('Provider') || type.includes('UseCase')) {
            dependencies.push(`${type} ${name}`);
          }
        }

        // End of constructor
        if (trimmed.includes('{') && inConstructor) {
          break;
        }
      }
    }

    return dependencies;
  }

  /**
   * Find application entry points (main and build methods)
   */
  findEntryPoints(index: any): any[] {
    const entryPoints: any[] = [];
    if (!index || !index.dart) return entryPoints;

    for (const [path, info] of Object.entries(index.dart as Record<string, any>)) {
      // 1. Top-level main()
      for (const func of info.functions || []) {
        if (func.name === 'main') {
          entryPoints.push({ ...func, filePath: path, kind: 'Function', qname: this.getQName(path, null, func.name) });
        }
      }
      // 2. Class methods (build, initState, etc. in Widgets/Controllers)
      for (const cls of info.classes || []) {
        const isEntryPointClass = cls.extendsClass && (
          cls.extendsClass.includes('Widget') || 
          cls.extendsClass.includes('State') ||
          cls.extendsClass.includes('Consumer') ||
          cls.extendsClass.includes('Hook') ||
          cls.extendsClass.includes('Controller') ||
          cls.extendsClass.includes('ViewModel') ||
          cls.extendsClass.includes('Bloc') ||
          cls.extendsClass.includes('Cubit') ||
          cls.extendsClass.includes('Notifier')
        );
        
        if (isEntryPointClass) {
          for (const method of cls.methods || []) {
            const entryPointMethods = [
              'build', 'initState', 'dispose', 'didUpdateWidget', 'didChangeDependencies',
              'onInit', 'onReady', 'onClose', 'mapEventToState', 'onEvent'
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
    if (!index || !index.dart) return null;

    // Fast lookup using pre-calculated entity map if possible
    // For now, we optimize the search by checking names directly

    // Handle Class.method or instance.method
    const dotIdx = name.indexOf('.');
    let searchClass = receiver;
    let searchMethod = name;

    if (dotIdx !== -1) {
      searchClass = name.substring(0, dotIdx);
      searchMethod = name.substring(dotIdx + 1);
    }

    for (const [path, info] of Object.entries(index.dart as Record<string, any>)) {
      // 1. Check classes if searching for a class (e.g. constructor call)
      if (!searchMethod || searchMethod === name) {
        for (const c of info.classes || []) {
          if (c.name === name) return { ...c, filePath: path, kind: 'Class', name: c.name, line: c.line, qname: this.getQName(path, null, c.name) };
        }
      }

      // 2. Check functions (top-level)
      if (!searchClass) {
        for (const f of info.functions || []) {
          if (f.name === name) return { ...f, filePath: path, kind: 'Function', qname: this.getQName(path, null, f.name) };
        }
      }

      // 3. Check methods in classes
      for (const c of info.classes || []) {
        // If we have a receiver, check if it matches the class name
        // This is a basic heuristic as receiver might be an instance variable
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

    if (!index || !index.dart) return reverseGraph;

    for (const [filePath, info] of Object.entries(index.dart as Record<string, any>)) {
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
    const fileInfo = index.dart?.[targetFilePath];
    if (!fileInfo) return [];

    const targetEntities = new Set<string>();
    for (const cls of fileInfo.classes || []) targetEntities.add(this.getQName(targetFilePath, null, cls.name));
    for (const func of fileInfo.functions || []) targetEntities.add(this.getQName(targetFilePath, null, func.name));
    // Also include methods
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
    const visited = new Map<string, number>(); // qname -> shortest distance

    for (const target of targetEntities) {
      queue.push({ qname: target, path: [target] });
      visited.set(target, 0);
    }

    while (queue.length > 0) {
      const { qname, path: currentPath } = queue.shift()!;
      
      // If this node is an entry point, we found a flow!
      if (entryPointQNames.has(qname)) {
        const ep = entryPointMap.get(qname)!;
        affectedFlows.push({
          entryPoint: ep.name,
          entryFile: ep.filePath,
          kind: ep.kind,
          parentClass: ep.parentClass,
          flowPath: [...currentPath].reverse().join(" -> ")
        });
        // Limit total flows to avoid overwhelming the output
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

