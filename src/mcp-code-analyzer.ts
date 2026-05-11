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
}
