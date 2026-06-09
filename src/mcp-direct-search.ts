import * as fs from 'fs';
import * as path from 'path';

export interface SearchResult {
  name: string;
  type: 'class_definition' | 'function_definition' | 'function_call' | 'enum_definition' | 'mixin_definition' | 'extension_definition' | 'typedef_definition' | 'variable_definition' | 'constructor_definition' | 'property_definition' | 'annotation_definition' | 'interface_definition';
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

  /** Find all source files in the project across supported languages */
  private findSourceFiles(): string[] {
    const sourceFiles: string[] = [];
    const searchDirs = [
      path.join(this.projectRoot, 'lib'),
      path.join(this.projectRoot, 'android', 'app', 'src', 'main'),
      path.join(this.projectRoot, 'src'),
      path.join(this.projectRoot, 'app')
    ];
      
    const walkDir = (dir: string, baseDir: string = dir): void => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walkDir(fullPath, baseDir);
          } else if (/\.(dart|kt|java|ts|tsx|js|jsx)$/.test(file)) {
            sourceFiles.push(path.relative(this.projectRoot, fullPath).replace(/\\/g, '/'));
          }
        } catch (e) {
          // Ignore files that can't be stat'd
        }
      }
    };
      
    for (const dir of searchDirs) {
      walkDir(dir);
    }
    
    // Also include top level JS/TS if present (e.g. App.tsx, index.js)
    if (fs.existsSync(this.projectRoot)) {
      try {
        const files = fs.readdirSync(this.projectRoot);
        for (const file of files) {
          if (/^(App|index|main)\.(ts|tsx|js|jsx)$/.test(file)) {
            try {
              const stat = fs.statSync(path.join(this.projectRoot, file));
              if (!stat.isDirectory()) {
                sourceFiles.push(file);
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    return [...new Set(sourceFiles)];
  }

  /** Search for a term in all source files */
  search(query: string, filter?: string, searchMode: string = 'both'): SearchResult[] {
    const results: SearchResult[] = [];
    const q = query.toLowerCase();
    const sourceFiles = this.findSourceFiles();

    for (const file of sourceFiles) {
      const fullPath = path.join(this.projectRoot, file);
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch (e) {
        continue;
      }
      const lines = content.split('\n');

      // Search for class definitions (Dart/Java/Kotlin/TS)
      if (!filter || filter === 'class' || filter === 'widget') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const clsMatch = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+|public\s+|private\s+|internal\s+)?class\s+(\w+)/);
            if (clsMatch && clsMatch[1].toLowerCase().includes(q)) {
              results.push({
                name: clsMatch[1],
                type: 'class_definition',
                file,
                line: i + 1,
              });
            }
          }
        }
      }

      // Search for interface definitions (Java/Kotlin/TS)
      if (!filter || filter === 'interface') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const ifaceMatch = line.match(/^(?:export\s+)?(?:public\s+|internal\s+)?interface\s+(\w+)/);
            if (ifaceMatch && ifaceMatch[1].toLowerCase().includes(q)) {
              results.push({
                name: ifaceMatch[1],
                type: 'interface_definition',
                file,
                line: i + 1,
              });
            }
          }
        }
      }

      // Search for function definitions (Dart/Java/Kotlin/JS/TS)
      if (!filter || filter === 'function') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Dart/Java/TS: returnType name(
            // Kotlin: fun name(
            // JS/TS: function name(
            const funcMatch = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:static\s+|public\s+|private\s+)?(?:fun\s+|function\s+|[\w<>\[\]?,\s]+\s+)(\w+)\s*\(/);
            if (funcMatch && funcMatch[1].toLowerCase().includes(q) && !['if', 'else', 'for', 'while', 'switch', 'catch'].includes(funcMatch[1])) {
              results.push({
                name: funcMatch[1],
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
              if (match[1].toLowerCase().includes(q) && !['if', 'else', 'for', 'while', 'switch', 'catch', 'function', 'fun'].includes(match[1])) {
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

      // Search for enum definitions (All)
      if (!filter || filter === 'enum') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const enumMatch = line.match(/^(?:export\s+)?(?:public\s+)?enum\s+(\w+)/);
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

      // Search for mixin definitions (Dart)
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

      // Search for extension definitions (Dart/Kotlin extension functions loosely matched)
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

      // Search for typedef definitions (Dart/TS)
      if (!filter || filter === 'typedef') {
        if (searchMode === 'definitions' || searchMode === 'both') {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const tdMatch = line.match(/^(?:export\s+)?(?:typedef|type)\s+(\w+)\s*=/);
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
            // Note: This regex is broad and acts as a fallback. It might match some generic assignments.
            const varMatch = line.match(/^(?:export\s+)?(?:final|const|let|var|late)?\s*(?:final|const)?\s*(?:[\w<>\[\]?,\s]+)?\s+(\w+)\s*(?:=\s*[^;]+)?;/);
            if (varMatch && varMatch[1].toLowerCase().includes(q)) {
              results.push({
                name: varMatch[1],
                type: 'variable_definition',
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
            const ctorMatch = line.match(/^\s+(?:public\s+|protected\s+|private\s+)?(?:const\s+)?(?:factory\s+)?(?:constructor|(\w+))\s*(\.\w+)?\s*\(/);
            if (ctorMatch && !line.includes('function ') && !line.includes('fun ')) {
              const fullName = ctorMatch[1] ? `${ctorMatch[1]}${ctorMatch[2] || ''}` : 'constructor';
              if (fullName.toLowerCase().includes(q) && !['if','switch','while','for','catch'].includes(fullName)) {
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
    }

    return results.slice(0, 50);
  }

  /** Search for general text (strings, comments) in all source files */
  searchText(query: string, options: { isRegex?: boolean; caseInsensitive?: boolean; includeComments?: boolean; includeStrings?: boolean } = {}): TextSearchResult[] {
    const results: TextSearchResult[] = [];
    const { isRegex = false, caseInsensitive = true, includeComments = true, includeStrings = true } = options;
    const sourceFiles = this.findSourceFiles();

    let regex: RegExp;
    try {
      const flags = caseInsensitive ? 'gi' : 'g';
      regex = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e) {
      return [];
    }

    for (const file of sourceFiles) {
      const fullPath = path.join(this.projectRoot, file);
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch (e) {
        continue;
      }
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;
        
        while ((match = regex.exec(line)) !== null) {
          const matchedText = match[0];
          const index = match.index;
          
          // Check if match is in a comment
          const lineBeforeMatch = line.substring(0, index);
          const isComment = lineBeforeMatch.includes('//') || line.trim().startsWith('///') || line.trim().startsWith('*');
          
          // Check if match is in a string (rough check)
          const quotesCount = (lineBeforeMatch.match(/['"`]/g) || []).length;
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
