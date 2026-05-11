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
        const lines = content.split('\n');
        
        let currentPackage: Partial<PackageInfo> | null = null;
        let inDescription = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Detect package name (starts with exactly 2 spaces)
            if (line.startsWith('  ') && !line.startsWith('    ') && trimmed.endsWith(':')) {
                // Save previous package if valid
                if (currentPackage && currentPackage.name && currentPackage.version) {
                    packages.push(currentPackage as PackageInfo);
                }
                
                const name = trimmed.substring(0, trimmed.length - 1);
                if (name === 'packages' || name === 'sdks') {
                    currentPackage = null;
                } else {
                    currentPackage = {
                        name,
                        version: '',
                        source: 'unknown',
                        dependencyType: 'transitive',
                        description: {}
                    };
                }
                inDescription = false;
                continue;
            }

            if (!currentPackage) continue;

            // Detect properties (starts with 4 or more spaces)
            if (trimmed.startsWith('version:')) {
                currentPackage.version = trimmed.replace('version:', '').replace(/"/g, '').trim();
            } else if (trimmed.startsWith('source:')) {
                const s = trimmed.replace('source:', '').trim();
                if (s === 'hosted') currentPackage.source = 'hosted';
                else if (s === 'git') currentPackage.source = 'git';
                else if (s === 'path') currentPackage.source = 'path';
            } else if (trimmed.startsWith('dependency:')) {
                const d = trimmed.replace('dependency:', '').replace(/"/g, '').trim();
                if (d.includes('direct main')) currentPackage.dependencyType = 'direct';
                else if (d.includes('direct dev')) currentPackage.dependencyType = 'dev';
                else currentPackage.dependencyType = 'transitive';
            } else if (trimmed.startsWith('description:')) {
                inDescription = true;
            } else if (inDescription && line.startsWith('      ')) {
                const parts = trimmed.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim();
                    const val = parts.slice(1).join(':').trim().replace(/^"|"$/g, '');
                    if (currentPackage.description) {
                        currentPackage.description[key] = val;
                    }
                }
            }
        }

        // Add last package
        if (currentPackage && currentPackage.name && currentPackage.version) {
            packages.push(currentPackage as PackageInfo);
        }

        return packages;
    }
}
