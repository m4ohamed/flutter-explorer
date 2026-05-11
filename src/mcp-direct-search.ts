import * as fs from 'fs';
import * as path from 'path';

export interface SearchResult {
  name: string;
  type: 'class_definition' | 'function_definition' | 'function_call' | 'enum_definition' | 'mixin_definition';
  file: string;
  line: number;
  context?: string;
  parent?: string | null;
  callerClass?: string | null;
  callerFunction?: string | null;
  _source?: string;
}

export class DirectSearch {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /** Find all Dart files in the project */
  private findDartFiles(): string[] {
    const dartFiles: string[] = [];
    const libPath = path.join(this.projectRoot, 'lib');
      
    if (!fs.existsSync(libPath)) return [];
      
    const walkDir = (dir: string, baseDir: string = dir): void => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walkDir(fullPath, baseDir);
        } else if (file.endsWith('.dart')) {
          dartFiles.push(path.relative(this.projectRoot, fullPath));
        }
      }
    };
      
    walkDir(libPath);
    return dartFiles;
  }

  /** Search for a term in all Dart files */
  search(query: string, filter?: string, searchMode: string = 'both'): SearchResult[] {
    const results: SearchResult[] = [];
    const q = query.toLowerCase();
    const dartFiles = this.findDartFiles();

    for (const file of dartFiles) {
      const fullPath = path.join(this.projectRoot, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      // Search for class definitions  
      if (!filter || filter === 'class' || filter === 'widget') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const clsMatch = line.match(/^(abstract\s+)?class\s+(\w+)/);
            if (clsMatch && clsMatch[2].toLowerCase().includes(q)) {
              results.push({
                name: clsMatch[2],
                type: 'class_definition',
                file,
                line: i + 1,
              });
            }
          }
        }
      }

      // Search for function definitions  
      if (!filter || filter === 'function') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const funcMatch = line.match(/^\s*(static\s+)?[\w<>\[\]?,\s]+\s+(\w+)\s*\(/);
            if (funcMatch && funcMatch[2].toLowerCase().includes(q)) {
              results.push({
                name: funcMatch[2],
                type: 'function_definition',
                file,
                line: i + 1,
              });
            }
          }
        }

        // Search for function calls  
        if (searchMode === 'calls' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
            let match;
            while ((match = callPattern.exec(line)) !== null) {
              if (match[1].toLowerCase().includes(q)) {
                const contextStart = Math.max(0, i - 1);
                const contextEnd = Math.min(lines.length - 1, i + 1);
                const context = lines.slice(contextStart, contextEnd + 1).join('\n').trim();
                  
                results.push({
                  name: match[1],
                  type: 'function_call',
                  file,
                  line: i + 1,
                  context: context.substring(0, 200),
                });
              }
            }
          }
        }
      }

      // Search for enum definitions
      if (!filter || filter === 'enum') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const enumMatch = line.match(/^enum\s+(\w+)/);
            if (enumMatch && enumMatch[1].toLowerCase().includes(q)) {
              results.push({
                name: enumMatch[1],
                type: 'enum_definition',
                file,
                line: i + 1,
              });
            }
          }
        }
      }

      // Search for mixin definitions
      if (!filter || filter === 'mixin') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const mixinMatch = line.match(/^mixin\s+(\w+)/);
            if (mixinMatch && mixinMatch[1].toLowerCase().includes(q)) {
              results.push({
                name: mixinMatch[1],
                type: 'mixin_definition',
                file,
                line: i + 1,
              });
            }
          }
        }
      }
    }

    return results.slice(0, 50);
  }
}
