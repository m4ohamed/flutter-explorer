import { exec, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { DartFileInfo } from './dartParser';

/**
 * Wrapper for the Dart-based analyzer tool.
 * Uses package:analyzer for high-accuracy indexing.
 */
export async function analyzeWithDart(
    projectPath: string, 
    extensionPath?: string,
    onProgress?: (current: number) => void
): Promise<DartFileInfo[] | null> {
    try {
        const hasDart = await checkDartSdk();
        if (!hasDart) {
            console.log('Dart SDK not found, falling back to regex parser');
            return null;
        }

        // Adjust path based on where the extension is running (src vs out vs simulation)
        const searchPaths = [
            path.join(projectPath, 'tools', 'dart_analyzer.dart'), // Project local tools
            ...(extensionPath ? [path.join(extensionPath, 'tools', 'dart_analyzer.dart')] : []), // Extension tools
            path.join(__dirname, '..', '..', 'tools', 'dart_analyzer.dart'),
            path.join(__dirname, '..', '..', '..', 'tools', 'dart_analyzer.dart'),
            path.join(process.cwd(), 'tools', 'dart_analyzer.dart'),
            path.join(process.cwd(), '..', 'tools', 'dart_analyzer.dart'),
        ];



        let toolsPath = '';
        for (const p of searchPaths) {
            if (fs.existsSync(p)) {
                toolsPath = p;
                break;
            }
        }
        
        if (!toolsPath) {
            console.error(`Dart analyzer script not found. Searched in: ${searchPaths.join(', ')}`);
            return null;
        }


        return new Promise((resolve) => {
            const child = spawn('dart', [toolsPath, projectPath]);
            let stdoutData = '';
            let stderrData = '';

            child.stdout.on('data', (data) => {
                stdoutData += data.toString();
            });

            child.stderr.on('data', (data) => {
                const message = data.toString();
                stderrData += message;

                // Check for progress messages
                const progressMatch = message.match(/PROGRESS:(\d+)/);
                if (progressMatch && onProgress) {
                    onProgress(parseInt(progressMatch[1], 10));
                }
            });

            child.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Dart analyzer process exited with code ${code}`);
                    console.error(`Stderr: ${stderrData}`);
                    return resolve(null);
                }

                try {
                    const results = JSON.parse(stdoutData);
                    // Map results to ensure they match DartFileInfo (some fields might be missing)
                    const mappedResults = (results as any[]).map(file => ({
                        ...file,
                        functionCalls: file.functionCalls || [],
                        imports: file.imports || [],
                        exports: file.exports || [],
                        widgets: file.widgets || [],
                        warnings: file.warnings || [],
                        lastModified: Date.now(),
                        classUsages: [],
                        functionUsages: [],
                        extensionUsages: [],
                        typedefUsages: [],
                        variableUsages: [],
                        constructorUsages: [],
                        propertyUsages: [],
                        annotationUsages: [],
                        enumUsages: [],
                        mixinUsages: [],
                        annotations: file.annotations || [],
                        constructors: file.constructors || [],
                    }));
                    resolve(mappedResults as DartFileInfo[]);
                } catch (e) {
                    console.error('Failed to parse Dart analyzer output:', e);
                    resolve(null);
                }
            });

            child.on('error', (err) => {
                console.error('Failed to start Dart analyzer:', err);
                resolve(null);
            });
        });
    } catch (e) {
        console.error('analyzeWithDart failed:', e);
        return null;
    }
}

async function checkDartSdk(): Promise<boolean> {
    return new Promise((resolve) => {
        exec('dart --version', (error) => {
            resolve(!error);
        });
    });
}
