import * as fs from 'fs';
import * as path from 'path';

export interface ArbEntry {
  key: string;
  value: string;
  [key: string]: any;
}

export class ArbEditor {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  private findArbFiles(): string[] {
    const arbFiles: string[] = [];
    const libPath = path.join(this.projectRoot, 'lib');
    
    if (!fs.existsSync(libPath)) return [];
    
    const walkDir = (dir: string, baseDir: string = dir): void => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walkDir(fullPath, baseDir);
        } else if (file.endsWith('.arb')) {
          arbFiles.push(path.relative(this.projectRoot, fullPath));
        }
      }
    };
    
    walkDir(libPath);
    return arbFiles;
  }

  private readArb(filePath: string): Record<string, ArbEntry> {
    const fullPath = path.join(this.projectRoot, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(content);
    
    const entries: Record<string, ArbEntry> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('@')) {
        entries[key] = {
          key,
          value: value as string,
          ...this.getMetadata(data, key),
        };
      }
    }
    
    return entries;
  }

  private getMetadata(data: any, key: string): any {
    const metadata: any = {};
    const metaKeys = ['@description', '@context', '@source_text'];
    for (const metaKey of metaKeys) {
      const fullKey = `@${key}${metaKey.replace('@', '')}`;
      if (data[fullKey]) {
        metadata[metaKey] = data[fullKey];
      }
    }
    return metadata;
  }

  private writeArb(filePath: string, entries: Record<string, ArbEntry>): void {
    const fullPath = path.join(this.projectRoot, filePath);
    
    const data: any = {};
    const sortedKeys = Object.keys(entries).sort();
    
    for (const key of sortedKeys) {
      const entry = entries[key];
      data[key] = entry.value;
      
      for (const [metaKey, metaValue] of Object.entries(entry)) {
        if (metaKey !== 'key' && metaKey !== 'value') {
          // Metadata keys are already formatted as '@description' etc in ArbEntry
          // We need to write them as '@key_description' in the JSON
          const jsonMetaKey = `@${key}${metaKey.replace('@', '')}`;
          data[jsonMetaKey] = metaValue;
        }
      }
    }
    
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  updateTranslation(key: string, arValue: string, enValue: string, description?: string): { success: boolean; message: string; updatedFiles: string[] } {
    const arbFiles = this.findArbFiles();
    const updatedFiles: string[] = [];
    
    if (arbFiles.length === 0) {
      return { success: false, message: 'No ARB files found in the project', updatedFiles: [] };
    }
    
    for (const arbFile of arbFiles) {
      const entries = this.readArb(arbFile);
      
      let value = '';
      if (arbFile.toLowerCase().includes('_ar.arb') || arbFile.toLowerCase().includes('ar.arb')) {
        value = arValue;
      } else if (arbFile.toLowerCase().includes('_en.arb') || arbFile.toLowerCase().includes('en.arb')) {
        value = enValue;
      } else {
        // Default to English if indeterminate
        value = enValue;
      }
      
      entries[key] = {
        key,
        value,
        ...(description && { '@description': description }),
      };
      
      this.writeArb(arbFile, entries);
      updatedFiles.push(arbFile);
    }
    
    return {
      success: true,
      message: `Translation key "${key}" updated in ${updatedFiles.length} files`,
      updatedFiles,
    };
  }

  getAllTranslations(): { files: string[]; keys: string[]; missingKeys: { file: string; keys: string[] }[] } {
    const arbFiles = this.findArbFiles();
    const allKeys = new Set<string>();
    const fileKeys = new Map<string, Set<string>>();
    
    for (const arbFile of arbFiles) {
      const entries = this.readArb(arbFile);
      const keys = new Set<string>();
      
      for (const key of Object.keys(entries)) {
        allKeys.add(key);
        keys.add(key);
      }
      
      fileKeys.set(arbFile, keys);
    }
    
    const missingKeys: { file: string; keys: string[] }[] = [];
    for (const [file, keys] of fileKeys.entries()) {
      const missing = [];
      for (const key of allKeys) {
        if (!keys.has(key)) {
          missing.push(key);
        }
      }
      if (missing.length > 0) {
        missingKeys.push({ file, keys: missing });
      }
    }
    
    return {
      files: arbFiles,
      keys: Array.from(allKeys).sort(),
      missingKeys,
    };
  }

  deleteTranslation(key: string): { success: boolean; message: string; deletedFrom: string[] } {
    const arbFiles = this.findArbFiles();
    const deletedFrom: string[] = [];
    
    for (const arbFile of arbFiles) {
      const entries = this.readArb(arbFile);
      
      if (entries[key]) {
        delete entries[key];
        this.writeArb(arbFile, entries);
        deletedFrom.push(arbFile);
      }
    }
    
    if (deletedFrom.length === 0) {
      return { success: false, message: `Key "${key}" not found in any ARB file`, deletedFrom: [] };
    }
    
    return {
      success: true,
      message: `Key "${key}" deleted from ${deletedFrom.length} files`,
      deletedFrom,
    };
  }
}
