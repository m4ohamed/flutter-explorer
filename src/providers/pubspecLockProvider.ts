import * as fs from 'fs';
import * as path from 'path';

export interface PackageInfo {
    name: string;
    version: string;
    source: 'hosted' | 'git' | 'path' | 'unknown';
    dependencyType: 'direct' | 'dev' | 'transitive';
    description?: any;
}

export class PubspecLockProvider {
    static getPackages(projectPath: string): PackageInfo[] {
        const lockPath = path.join(projectPath, 'pubspec.lock');
        if (!fs.existsSync(lockPath)) {
            return [];
        }

        const content = fs.readFileSync(lockPath, 'utf8');
        const packages: PackageInfo[] = [];
        
        // Simple regex-based parsing for pubspec.lock
        // This is faster and avoids heavy YAML dependencies
        const packageBlocks = content.split('\n  ').slice(1);
        
        for (const block of packageBlocks) {
            const lines = block.split('\n');
            const name = lines[0].replace(':', '').trim();
            if (!name || name === 'packages') continue;

            let version = '';
            let source: PackageInfo['source'] = 'unknown';
            let depType: PackageInfo['dependencyType'] = 'transitive';
            let description: any = {};

            let inDescription = false;
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('version:')) {
                    version = trimmed.replace('version: "', '').replace('"', '').trim();
                } else if (trimmed.startsWith('source:')) {
                    const s = trimmed.replace('source:', '').trim();
                    if (s === 'hosted') source = 'hosted';
                    else if (s === 'git') source = 'git';
                    else if (s === 'path') source = 'path';
                } else if (trimmed.startsWith('dependency:')) {
                    const d = trimmed.replace('dependency: "', '').replace('"', '').trim();
                    if (d.includes('direct main')) depType = 'direct';
                    else if (d.includes('direct dev')) depType = 'dev';
                    else depType = 'transitive';
                } else if (trimmed.startsWith('description:')) {
                    inDescription = true;
                } else if (inDescription && line.startsWith('      ')) {
                    const parts = trimmed.split(':');
                    if (parts.length >= 2) {
                        const key = parts[0].trim();
                        const val = parts.slice(1).join(':').trim().replace(/^"|"$/g, '');
                        description[key] = val;
                    }
                } else if (inDescription && trimmed === '') {
                    inDescription = false;
                }
            }

            if (name && version) {
                packages.push({ 
                    name, 
                    version, 
                    source, 
                    dependencyType: depType,
                    description: Object.keys(description).length > 0 ? description : undefined
                });
            }
        }

        return packages;
    }
}
