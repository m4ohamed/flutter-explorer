import * as fs from 'fs';
import * as path from 'path';

export class ArbEditor {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  private findArbFiles(): string[] {
    const arbFiles: string[] = [];
    const libPath = path.join(this.projectRoot, 'lib');
    
    if (!fs.existsSync(libPath)) return [];
    
    const walkDir = (dir: string): void => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (file.endsWith('.arb')) {
          arbFiles.push(path.relative(this.projectRoot, fullPath));
        }
      }
    };
    
    walkDir(libPath);
    return arbFiles;
  }

  private readArb(filePath: string): any {
    const fullPath = path.join(this.projectRoot, filePath);
    if (!fs.existsSync(fullPath)) return {};
    const content = fs.readFileSync(fullPath, 'utf-8');
    try {
      return JSON.parse(content);
    } catch (e) {
      return {};
    }
  }

  private writeArb(filePath: string, data: any): void {
    const fullPath = path.join(this.projectRoot, filePath);
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  updateTranslation(key: string, arValue: string, enValue: string, description?: string): { success: boolean; message: string; updatedFiles: string[] } {
    const arbFiles = this.findArbFiles();
    const updatedFiles: string[] = [];
    
    if (arbFiles.length === 0) {
      return { success: false, message: 'No ARB files found in the project', updatedFiles: [] };
    }
    
    for (const arbFile of arbFiles) {
      const data = this.readArb(arbFile);
      
      let value = '';
      if (arbFile.toLowerCase().includes('_ar.arb') || arbFile.toLowerCase().includes('ar.arb')) {
        value = arValue;
      } else if (arbFile.toLowerCase().includes('_en.arb') || arbFile.toLowerCase().includes('en.arb')) {
        value = enValue;
      } else {
        // Fallback for other locales - assuming English as default
        value = enValue;
      }
      
      data[key] = value;
      if (description) {
        const metaKey = `@${key}`;
        if (!data[metaKey]) {
          data[metaKey] = {};
        }
        data[metaKey].description = description;
      }
      
      this.writeArb(arbFile, data);
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
      const data = this.readArb(arbFile);
      const keys = new Set<string>();
      
      for (const key of Object.keys(data)) {
        if (!key.startsWith('@')) {
          allKeys.add(key);
          keys.add(key);
        }
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
      const data = this.readArb(arbFile);
      let changed = false;
      
      if (data[key] !== undefined) {
        delete data[key];
        changed = true;
      }
      if (data[`@${key}`] !== undefined) {
        delete data[`@${key}`];
        changed = true;
      }
      
      if (changed) {
        this.writeArb(arbFile, data);
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

