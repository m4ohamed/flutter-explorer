import * as fs from 'fs';
import * as path from 'path';

export interface PackageInfo {
    name: string;
    version: string;
    source: 'hosted' | 'git' | 'path' | 'sdk' | 'unknown';
    dependencyType: 'direct' | 'dev' | 'transitive';
    description?: any;
}

export class PubspecLockProvider {
    static getPackages(projectPath: string): PackageInfo[] {
        // 1. Try Flutter pubspec.lock
        const lockPath = path.join(projectPath, 'pubspec.lock');
        if (fs.existsSync(lockPath)) {
            return this.parsePubspecLock(lockPath);
        }

        // 2. Try Node/Web package-lock.json
        const packageLockPath = path.join(projectPath, 'package-lock.json');
        if (fs.existsSync(packageLockPath)) {
            const pkgs = this.parsePackageLock(packageLockPath);
            if (pkgs.length > 0) return pkgs;
        }

        // 3. Try Node/Web package.json (fallback if no package-lock.json)
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const pkgs = this.parsePackageJson(packageJsonPath);
            if (pkgs.length > 0) return pkgs;
        }

        // 4. Try Android Gradle build files
        const gradlePkgs = this.parseGradleDependencies(projectPath);
        if (gradlePkgs.length > 0) {
            return gradlePkgs;
        }

        return [];
    }

    private static parsePubspecLock(lockPath: string): PackageInfo[] {
        try {
            const content = fs.readFileSync(lockPath, 'utf8');
            const packages: PackageInfo[] = [];
            const lines = content.split('\n');

            let currentPackage: Partial<PackageInfo> | null = null;
            let inDescription = false;
            let currentSection: 'none' | 'packages' | 'sdks' | 'other' = 'none';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                if (trimmed === '') continue;

                // Detect top-level sections (no leading spaces/tabs and ends with :)
                if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.endsWith(':')) {
                    const secName = trimmed.substring(0, trimmed.length - 1);
                    if (secName === 'packages') currentSection = 'packages';
                    else if (secName === 'sdks') currentSection = 'sdks';
                    else currentSection = 'other';
                    currentPackage = null;
                    continue;
                }

                if (currentSection !== 'packages') continue;

                // Detect package name (starts with exactly 2 spaces or 1 tab)
                const isPackageHeader = (line.startsWith('  ') && !line.startsWith('    ') && trimmed.endsWith(':')) ||
                                        (line.startsWith('\t') && !line.startsWith('\t\t') && trimmed.endsWith(':'));
                if (isPackageHeader) {
                    // Save previous package if valid
                    if (currentPackage && currentPackage.name && currentPackage.version) {
                        packages.push(currentPackage as PackageInfo);
                    }

                    const name = trimmed.substring(0, trimmed.length - 1);
                    currentPackage = {
                        name,
                        version: '',
                        source: 'unknown',
                        dependencyType: 'transitive',
                        description: {}
                    };
                    inDescription = false;
                    continue;
                }

                if (!currentPackage) continue;

                // Detect properties (starts with 4 or more spaces or 2 or more tabs)
                if (trimmed.startsWith('version:')) {
                    currentPackage.version = trimmed.replace('version:', '').replace(/"/g, '').trim();
                } else if (trimmed.startsWith('source:')) {
                    const s = trimmed.replace('source:', '').trim();
                    if (s === 'hosted') currentPackage.source = 'hosted';
                    else if (s === 'git') currentPackage.source = 'git';
                    else if (s === 'path') currentPackage.source = 'path';
                    else if (s === 'sdk') currentPackage.source = 'sdk';
                    else currentPackage.source = 'unknown';
                } else if (trimmed.startsWith('dependency:')) {
                    const d = trimmed.replace('dependency:', '').replace(/"/g, '').trim();
                    if (d.includes('direct main')) currentPackage.dependencyType = 'direct';
                    else if (d.includes('direct dev')) currentPackage.dependencyType = 'dev';
                    else currentPackage.dependencyType = 'transitive';
                } else if (trimmed.startsWith('description:')) {
                    const descVal = trimmed.replace('description:', '').trim();
                    if (descVal.length > 0) {
                        currentPackage.description = { name: descVal.replace(/^"|"$/g, '') };
                        inDescription = false;
                    } else {
                        inDescription = true;
                    }
                } else if (inDescription && (line.startsWith('      ') || line.startsWith('\t\t\t'))) {
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
        } catch (error) {
            console.error('Error parsing pubspec.lock:', error);
            return [];
        }
    }

    private static parsePackageLock(lockPath: string): PackageInfo[] {
        try {
            const content = fs.readFileSync(lockPath, 'utf8');
            const lock = JSON.parse(content);
            const packages: PackageInfo[] = [];

            if (lock.packages) {
                for (const [pkgPath, pkgInfo] of Object.entries(lock.packages)) {
                    if (pkgPath === '' || !pkgPath.startsWith('node_modules/')) continue;
                    const name = pkgPath.substring('node_modules/'.length);
                    if (name.includes('node_modules/')) continue;

                    const version = (pkgInfo as any).version || '';
                    const dev = !!(pkgInfo as any).dev;

                    packages.push({
                        name,
                        version,
                        source: (pkgInfo as any).resolved ? 'hosted' : 'unknown',
                        dependencyType: dev ? 'dev' : 'direct',
                        description: {}
                    });
                }
            } else if (lock.dependencies) {
                for (const [name, pkgInfo] of Object.entries(lock.dependencies)) {
                    const version = (pkgInfo as any).version || '';
                    const dev = !!(pkgInfo as any).dev;
                    packages.push({
                        name,
                        version,
                        source: (pkgInfo as any).resolved ? 'hosted' : 'unknown',
                        dependencyType: dev ? 'dev' : 'direct',
                        description: {}
                    });
                }
            }
            return packages;
        } catch (error) {
            console.error('Error parsing package-lock.json:', error);
            return [];
        }
    }

    private static parsePackageJson(packageJsonPath: string): PackageInfo[] {
        try {
            const content = fs.readFileSync(packageJsonPath, 'utf8');
            const pkgJson = JSON.parse(content);
            const packages: PackageInfo[] = [];

            if (pkgJson.dependencies) {
                for (const [name, version] of Object.entries(pkgJson.dependencies)) {
                    packages.push({
                        name,
                        version: String(version).replace(/^[\^~]/, ''),
                        source: 'hosted',
                        dependencyType: 'direct',
                        description: {}
                    });
                }
            }
            if (pkgJson.devDependencies) {
                for (const [name, version] of Object.entries(pkgJson.devDependencies)) {
                    packages.push({
                        name,
                        version: String(version).replace(/^[\^~]/, ''),
                        source: 'hosted',
                        dependencyType: 'dev',
                        description: {}
                    });
                }
            }
            return packages;
        } catch (error) {
            console.error('Error parsing package.json:', error);
            return [];
        }
    }

    private static parseGradleDependencies(projectPath: string): PackageInfo[] {
        const candidates = [
            path.join(projectPath, 'build.gradle'),
            path.join(projectPath, 'build.gradle.kts'),
            path.join(projectPath, 'app', 'build.gradle'),
            path.join(projectPath, 'app', 'build.gradle.kts'),
            path.join(projectPath, 'android', 'app', 'build.gradle'),
            path.join(projectPath, 'android', 'app', 'build.gradle.kts'),
        ];

        const packages: PackageInfo[] = [];
        const seenNames = new Set<string>();

        for (const candidate of candidates) {
            if (!fs.existsSync(candidate)) continue;
            try {
                const content = fs.readFileSync(candidate, 'utf8');
                // Matches implementation 'group:artifact:version' or implementation("group:artifact:version")
                const regex = /(implementation|api|kapt|ksp|testImplementation|androidTestImplementation)\s*(?:\(?\s*['"])([^'"]+)(?:['"]\s*\)?)/g;
                let match: RegExpExecArray | null;

                while ((match = regex.exec(content)) !== null) {
                    const depTypeStr = match[1];
                    const coordinate = match[2].trim();
                    if (!coordinate || coordinate.startsWith('project(') || coordinate.startsWith(':')) continue;

                    const parts = coordinate.split(':');
                    let name = coordinate;
                    let version = 'unknown';

                    if (parts.length >= 3) {
                        name = `${parts[0]}:${parts[1]}`;
                        version = parts[2];
                    } else if (parts.length === 2) {
                        name = parts[0];
                        version = parts[1];
                    }

                    if (seenNames.has(name)) continue;
                    seenNames.add(name);

                    const isDev = depTypeStr.toLowerCase().includes('test');
                    packages.push({
                        name,
                        version,
                        source: 'hosted',
                        dependencyType: isDev ? 'dev' : 'direct',
                        description: { configuration: depTypeStr }
                    });
                }
            } catch (err) {
                console.error(`Error reading gradle file ${candidate}:`, err);
            }
        }

        return packages;
    }
}

