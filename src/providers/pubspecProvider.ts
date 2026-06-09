/**
 * Pubspec Provider - Parses and analyzes pubspec.yaml
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
export interface PubspecData {
    name: string;
    version: string;
    description: string;
    sdkConstraint: string;
    dependencies: PubspecDep[];
    devDependencies: PubspecDep[];
    flutterAssets: string[];
    flutterFonts: string[];
    warnings: string[];
}
export interface PubspecDep {
    name: string;
    version: string;
    isPath: boolean;
    isGit: boolean;
}
export class PubspecProvider {
    private workspaceRoot: string;
    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }
    /** Parse pubspec.yaml, package.json, or build.gradle and return structured data */
    analyze(): PubspecData | null {
        const pubspecPath = path.join(this.workspaceRoot, 'pubspec.yaml');
        if (fs.existsSync(pubspecPath)) {
            try {
                const content = fs.readFileSync(pubspecPath, 'utf-8');
                return this.parsePubspec(content);
            } catch {
                return null;
            }
        }

        const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const content = fs.readFileSync(packageJsonPath, 'utf-8');
                return this.parsePackageJson(content);
            } catch {
                return null;
            }
        }

        // Try Android gradle files
        for (const file of ['build.gradle', 'app/build.gradle', 'build.gradle.kts', 'app/build.gradle.kts']) {
            const gradlePath = path.join(this.workspaceRoot, file);
            if (fs.existsSync(gradlePath)) {
                try {
                    const content = fs.readFileSync(gradlePath, 'utf-8');
                    return this.parseGradle(content);
                } catch {
                    // try next
                }
            }
        }

        return null;
    }

    private parseGradle(content: string): PubspecData {
        const lines = content.split('\n');
        const dependencies: PubspecDep[] = [];
        const devDependencies: PubspecDep[] = [];
        const warnings: string[] = [];
        let sdkConstraint = 'any';
        let version = '1.0.0';

        const depRegex = /^\s*(implementation|api|kapt|annotationProcessor|compileOnly)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/;
        const devDepRegex = /^\s*(testImplementation|androidTestImplementation|testCompileOnly)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/;
        const sdkRegex = /^\s*(compileSdk|targetSdk)\s*=?\s*(\d+)/;
        const versionRegex = /^\s*versionName\s*=?\s*['"]([^'"]+)['"]/;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

            const sdkMatch = trimmed.match(sdkRegex);
            if (sdkMatch) {
                sdkConstraint = `${sdkMatch[1]}: ${sdkMatch[2]}`;
                continue;
            }

            const verMatch = trimmed.match(versionRegex);
            if (verMatch) {
                version = verMatch[1];
                continue;
            }

            const depMatch = trimmed.match(depRegex);
            if (depMatch) {
                const parts = depMatch[2].split(':');
                dependencies.push({
                    name: parts[0] + (parts[1] ? ':' + parts[1] : ''),
                    version: parts[2] || 'any',
                    isPath: false,
                    isGit: false
                });
                continue;
            }

            const devMatch = trimmed.match(devDepRegex);
            if (devMatch) {
                const parts = devMatch[2].split(':');
                devDependencies.push({
                    name: parts[0] + (parts[1] ? ':' + parts[1] : ''),
                    version: parts[2] || 'any',
                    isPath: false,
                    isGit: false
                });
                continue;
            }
        }

        return {
            name: path.basename(this.workspaceRoot),
            version,
            description: 'Android Gradle Project',
            sdkConstraint,
            dependencies,
            devDependencies,
            flutterAssets: [],
            flutterFonts: [],
            warnings
        };
    }

    private parsePackageJson(content: string): PubspecData {
        try {
            const pkg = JSON.parse(content);
            const dependencies = Object.entries(pkg.dependencies || {}).map(([name, ver]) => ({
                name,
                version: String(ver),
                isPath: String(ver).startsWith('file:'),
                isGit: String(ver).startsWith('git') || String(ver).includes('/')
            }));
            const devDependencies = Object.entries(pkg.devDependencies || {}).map(([name, ver]) => ({
                name,
                version: String(ver),
                isPath: String(ver).startsWith('file:'),
                isGit: String(ver).startsWith('git') || String(ver).includes('/')
            }));

            const warnings: string[] = [];
            if (!pkg.description) warnings.push('⚠️ Missing "description" field in package.json');
            if (!pkg.version) warnings.push('⚠️ Missing "version" field in package.json');

            return {
                name: pkg.name || 'unnamed',
                version: pkg.version || '0.0.0',
                description: pkg.description || '',
                sdkConstraint: pkg.engines?.node ? `node: ${pkg.engines.node}` : 'any',
                dependencies,
                devDependencies,
                flutterAssets: [],
                flutterFonts: [],
                warnings
            };
        } catch {
            return {
                name: 'unnamed',
                version: '0.0.0',
                description: '',
                sdkConstraint: 'any',
                dependencies: [],
                devDependencies: [],
                flutterAssets: [],
                flutterFonts: [],
                warnings: ['⚠️ Failed to parse package.json']
            };
        }
    }
    private parsePubspec(content: string): PubspecData {
        const lines = content.split('\n');
        const data: PubspecData = {
            name: '', version: '', description: '', sdkConstraint: '',
            dependencies: [], devDependencies: [], flutterAssets: [],
            flutterFonts: [], warnings: [],
        };
        let section: 'none' | 'environment' | 'dependencies' | 'dev_dependencies' | 'flutter' | 'assets' | 'fonts' = 'none';
        let indentLevel = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) { continue; }
            const indent = line.length - line.trimStart().length;
            // Top-level keys
            if (indent === 0) {
                const nameMatch = trimmed.match(/^name:\s*(.+)/);
                if (nameMatch) { data.name = nameMatch[1].trim(); continue; }
                const versionMatch = trimmed.match(/^version:\s*(.+)/);
                if (versionMatch) { data.version = versionMatch[1].trim(); continue; }
                const descMatch = trimmed.match(/^description:\s*(.+)/);
                if (descMatch) { data.description = descMatch[1].trim(); continue; }
                if (trimmed === 'environment:') { section = 'environment'; indentLevel = indent; continue; }
                if (trimmed === 'dependencies:') { section = 'dependencies'; indentLevel = indent; continue; }
                if (trimmed === 'dev_dependencies:') { section = 'dev_dependencies'; indentLevel = indent; continue; }
                if (trimmed === 'flutter:') { section = 'flutter'; indentLevel = indent; continue; }
                // Reset section for other top-level keys
                if (!trimmed.startsWith(' ') && trimmed.endsWith(':')) { section = 'none'; }
            }
            // Environment/SDK constraint
            if (section === 'environment' && trimmed.startsWith('sdk:') && indent > indentLevel) {
                const sdkMatch = trimmed.match(/^sdk:\s*['"]?(.+?)['"]?\s*$/);
                if (sdkMatch) { data.sdkConstraint = sdkMatch[1]; }
                continue;
            }
            // Dependencies
            if ((section === 'dependencies' || section === 'dev_dependencies') && indent > indentLevel) {
                if (indent === indentLevel + 2) {
                    const depMatch = trimmed.match(/^(\w[\w_]*)\s*:\s*(.+)?/);
                    if (depMatch) {
                        const dep: PubspecDep = {
                            name: depMatch[1],
                            version: depMatch[2]?.trim() || 'any',
                            isPath: false,
                            isGit: false,
                        };
                        if (dep.version === 'any' || dep.version === '') {
                            data.warnings.push(`⚠️ "${dep.name}" uses 'any' version — consider pinning a version`);
                        }
                        if (section === 'dependencies') { data.dependencies.push(dep); }
                        else { data.devDependencies.push(dep); }
                    }
                }
                // Path dependency
                if (trimmed.startsWith('path:')) {
                    const lastDeps = section === 'dependencies' ? data.dependencies : data.devDependencies;
                    if (lastDeps.length > 0) {
                        lastDeps[lastDeps.length - 1].isPath = true;
                        lastDeps[lastDeps.length - 1].version = trimmed.replace('path:', '').trim();
                    }
                }
                // Git dependency
                if (trimmed.startsWith('git:') || trimmed.startsWith('url:')) {
                    const lastDeps = section === 'dependencies' ? data.dependencies : data.devDependencies;
                    if (lastDeps.length > 0) { lastDeps[lastDeps.length - 1].isGit = true; }
                }
                continue;
            }
            // Flutter section
            if (section === 'flutter' && indent > indentLevel) {
                if (trimmed === 'assets:') { section = 'assets'; continue; }
                if (trimmed === 'fonts:') { section = 'fonts'; continue; }
            }
            // Assets
            if (section === 'assets' && trimmed.startsWith('- ')) {
                data.flutterAssets.push(trimmed.substring(2).trim());
                continue;
            }
            // Fonts
            if (section === 'fonts' && trimmed.startsWith('- family:')) {
                data.flutterFonts.push(trimmed.replace('- family:', '').trim());
                continue;
            }
        }
        // Validation warnings
        if (!data.description) {
            data.warnings.push('⚠️ Missing "description" field in pubspec.yaml');
        }
        if (!data.sdkConstraint) {
            data.warnings.push('⚠️ Missing SDK constraint in environment section');
        }
        return data;
    }
}
