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
    onProgress?: (message: string, current?: number, total?: number) => void
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


        const toolsDir = path.dirname(toolsPath);
        return new Promise((resolve) => {
            const child = spawn('dart', ['run', `"${toolsPath}"`, `"${projectPath}"`], { 
                cwd: toolsDir,
                shell: true 
            });
            let stdoutData = '';
            let stderrData = '';

            // Guard against indefinite hanging: 180s initial timeout with activity keep-alive
            const timeoutMs = 180000;
            let timeoutTimer = setTimeout(() => {
                console.warn(`[dartAnalyzerWrapper] Dart analyzer timed out after ${timeoutMs}ms. Terminating process.`);
                try {
                    child.kill();
                } catch (_) {}
                resolve(null);
            }, timeoutMs);

            const resetTimeout = () => {
                clearTimeout(timeoutTimer);
                timeoutTimer = setTimeout(() => {
                    console.warn(`[dartAnalyzerWrapper] Dart analyzer timed out due to inactivity.`);
                    try {
                        child.kill();
                    } catch (_) {}
                    resolve(null);
                }, 60000);
            };

            const cleanup = () => clearTimeout(timeoutTimer);

            child.stdout.on('data', (data) => {
                stdoutData += data.toString();
            });

            let totalFiles: number | undefined = undefined;
            let currentFileCount = 0;
            child.stderr.on('data', (data) => {
                const message = data.toString();
                stderrData += message;

                const lines = message.split(/\r?\n/);
                for (const line of lines) {
                    if (!line.trim()) continue;

                    if (line.startsWith('START_ANALYSIS:')) {
                        if (onProgress) {
                            onProgress(line.substring('START_ANALYSIS:'.length));
                        }
                    } else if (line.startsWith('TOTAL:')) {
                        const totalMatch = line.match(/TOTAL:(\d+)/);
                        if (totalMatch) {
                            totalFiles = parseInt(totalMatch[1], 10);
                        }
                    } else if (line.startsWith('ANALYZING:')) {
                        resetTimeout();
                        const fileName = line.substring('ANALYZING:'.length).trim();
                        if (onProgress) {
                            const remaining = totalFiles !== undefined ? totalFiles - currentFileCount : '?';
                            const totalStr = totalFiles !== undefined ? totalFiles : '?';
                            onProgress(`Analyzing Dart SDK: [${fileName}] (${currentFileCount}/${totalStr} done, ${remaining} remaining)...`);
                        }
                    } else if (line.startsWith('PROGRESS:')) {
                        resetTimeout();
                        const progressMatch = line.match(/PROGRESS:(\d+)/);
                        if (progressMatch) {
                            currentFileCount = parseInt(progressMatch[1], 10);
                            if (onProgress) {
                                const remaining = totalFiles !== undefined ? totalFiles - currentFileCount : '?';
                                const totalStr = totalFiles !== undefined ? totalFiles : '?';
                                onProgress(`Completed Dart SDK analysis (${currentFileCount}/${totalStr} done, ${remaining} remaining)...`, currentFileCount, totalFiles);
                            }
                        }
                    }
                }
            });

            child.on('close', (code) => {
                cleanup();
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
                cleanup();
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
            if (!error) {
                resolve(true);
            } else {
                console.warn('[FlutterExplorer] Dart SDK not found or failed to run. Falling back to regex parser.');
                resolve(false);
            }
        });
    });
}