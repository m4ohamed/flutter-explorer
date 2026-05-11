import * as fs from 'fs';
import * as path from 'path';

export interface SearchResult {
  name: string;
  type: 'class_definition' | 'function_definition' | 'function_call' | 'enum_definition' | 'mixin_definition' | 'extension_definition' | 'typedef_definition' | 'variable_definition' | 'constructor_definition' | 'property_definition' | 'annotation_definition';
  file: string;
  line: number;
  context?: string;
  parent?: string | null;
  callerClass?: string | null;
  callerFunction?: string | null;
  _source?: string;
  subtype?: string;
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

      // Search for extension definitions
      if (!filter || filter === 'extension') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const extMatch = line.match(/^extension\s+(\w+)?\s+on\s+(\w+)/);
            if (extMatch) {
              const name = extMatch[1] || 'unnamed extension';
              if (name.toLowerCase().includes(q) || extMatch[2].toLowerCase().includes(q)) {
                results.push({
                  name,
                  type: 'extension_definition',
                  subtype: `on ${extMatch[2]}`,
                  file,
                  line: i + 1,
                });
              }
            }
          }
        }
      }

      // Search for typedef definitions
      if (!filter || filter === 'typedef') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const tdMatch = line.match(/^typedef\s+(\w+)\s*=/);
            if (tdMatch && tdMatch[1].toLowerCase().includes(q)) {
              results.push({
                name: tdMatch[1],
                type: 'typedef_definition',
                file,
                line: i + 1,
              });
            }
          }
        }
      }

      // Search for top-level variable definitions
      if (!filter || filter === 'variable') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const varMatch = line.match(/^(final|const|late)?\s*(final|const)?\s*([\w<>\[\]?,\s]+?)\s+(\w+)\s*(=\s*[^;]+)?;/);
            if (varMatch && varMatch[4].toLowerCase().includes(q)) {
              results.push({
                name: varMatch[4],
                type: 'variable_definition',
                subtype: varMatch[3],
                file,
                line: i + 1,
              });
            }
          }
        }
      }

      // Search for constructor definitions
      if (!filter || filter === 'constructor') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const ctorMatch = line.match(/^\s+(const\s+)?(factory\s+)?(\w+)\s*(\.\w+)?\s*\(/);
            if (ctorMatch) {
              const fullName = `${ctorMatch[3]}${ctorMatch[4] || ''}`;
              if (fullName.toLowerCase().includes(q)) {
                results.push({
                  name: fullName,
                  type: 'constructor_definition',
                  file,
                  line: i + 1,
                });
              }
            }
          }
        }
      }

      // Search for properties (Fields, Getters, Setters)
      if (!filter || filter === 'property') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const propMatch = line.match(/^\s+(static\s+)?(final|const|late)?\s*(final|const)?\s*([\w<>\[\]?,\s]+?)\s+(\w+)\s*(?:[;=]|\s+get\s+)/);
            if (propMatch && propMatch[5].toLowerCase().includes(q)) {
              results.push({
                name: propMatch[5],
                type: 'property_definition',
                subtype: propMatch[4],
                file,
                line: i + 1,
              });
            }
          }
        }
      }

      // Search for annotations
      if (!filter || filter === 'annotation') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const annMatch = line.match(/^@(\w+)/);
            if (annMatch && annMatch[1].toLowerCase().includes(q)) {
              results.push({
                name: `@${annMatch[1]}`,
                type: 'annotation_definition',
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

  /** Search for general text (strings, comments) in all Dart files */
  searchText(query: string, options: { isRegex?: boolean; caseInsensitive?: boolean; includeComments?: boolean; includeStrings?: boolean } = {}): TextSearchResult[] {
    const results: TextSearchResult[] = [];
    const { isRegex = false, caseInsensitive = true, includeComments = true, includeStrings = true } = options;
    const dartFiles = this.findDartFiles();

    let regex: RegExp;
    try {
      const flags = caseInsensitive ? 'gi' : 'g';
      regex = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e) {
      return [];
    }

    for (const file of dartFiles) {
      const fullPath = path.join(this.projectRoot, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;
        
        while ((match = regex.exec(line)) !== null) {
          const matchedText = match[0];
          const index = match.index;
          
          // Check if match is in a comment
          const lineBeforeMatch = line.substring(0, index);
          const isComment = lineBeforeMatch.includes('//') || line.trim().startsWith('///');
          
          // Check if match is in a string (rough check)
          const quotesCount = (lineBeforeMatch.match(/['"]/g) || []).length;
          const isString = quotesCount % 2 !== 0;

          if ((isComment && includeComments) || (isString && includeStrings) || (!isComment && !isString)) {
            const contextStart = Math.max(0, i - 1);
            const contextEnd = Math.min(lines.length - 1, i + 1);
            const context = lines.slice(contextStart, contextEnd + 1).join('\n').trim();

            results.push({
              text: matchedText,
              file,
              line: i + 1,
              context: context.substring(0, 200),
              isComment,
              isString
            });
          }
        }
      }
    }

    return results.slice(0, 100);
  }
}

export interface TextSearchResult {
  text: string;
  file: string;
  line: number;
  context: string;
  isComment: boolean;
  isString: boolean;
}
