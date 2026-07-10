/**
 * File Watcher - Monitors lib/ and android/app/ for changes
 * with debouncing for incremental index updates.
 *
 * ARB files trigger both index update AND automatic l10n code generation
 * (replicating Flutter Intl IDE plugin behavior).
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { IndexManager } from './indexManager';
import { IntlGenerator } from './intlGenerator';

export class FileWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private debounceMs: number;
    private disposables: vscode.Disposable[] = [];

    // ── Intl Generation ────────────────────────────────────────────────────
    private intlGenerator: IntlGenerator;
    private arbGenerateTimer: NodeJS.Timeout | null = null;
    private isGenerating = false;
    private pendingGenerate = false;
    private static readonly ARB_GENERATE_DEBOUNCE_MS = 1500;

    constructor(
        private indexManager: IndexManager,
        private workspaceRoot: string,
        debounceMs: number = 300,
    ) {
        this.debounceMs = debounceMs;
        this.intlGenerator = new IntlGenerator(workspaceRoot);
    }

    /** Start watching for file changes */
    start(): void {
        const mode = this.indexManager.getProjectMode();
        if (mode === 'flutter') {
            // Watch Dart files in lib/
            const dartWatcher = vscode.workspace.createFileSystemWatcher('**/lib/**/*.dart');
            this.setupWatcher(dartWatcher);
            this.watchers.push(dartWatcher);
            // Watch android/app/ files
            const config = vscode.workspace.getConfiguration('flutterExplorer');
            if (config.get<boolean>('watchAndroidApp', true)) {
                const androidWatcher = vscode.workspace.createFileSystemWatcher('**/android/app/**/*.{dart,kt,java,xml,gradle}');
                this.setupWatcher(androidWatcher);
                this.watchers.push(androidWatcher);
            }
            // Watch ARB files — index + auto-generate
            const arbWatcher = vscode.workspace.createFileSystemWatcher('**/lib/**/*.arb');
            this.setupArbWatcher(arbWatcher);
            this.watchers.push(arbWatcher);
            // Watch pubspec.yaml
            const pubspecWatcher = vscode.workspace.createFileSystemWatcher('**/pubspec.yaml');
            pubspecWatcher.onDidChange(() => this.indexManager['onIndexChanged'].fire());
            pubspecWatcher.onDidCreate(() => this.indexManager['onIndexChanged'].fire());
            pubspecWatcher.onDidDelete(() => this.indexManager['onIndexChanged'].fire());
            this.watchers.push(pubspecWatcher);
            // Watch analysis_options.yaml
            const handleAnalysisOptionsChange = async () => {
                this.indexManager.loadAnalysisOptionsExcludes();
                // Remove files that are now excluded
                for (const fileInfo of this.indexManager.getAllFiles()) {
                    const fullPath = path.join(this.workspaceRoot, fileInfo.filePath);
                    if (this.indexManager.isFileExcluded(fullPath)) {
                        await this.indexManager.removeFile(vscode.Uri.file(fullPath));
                    }
                }
                this.indexManager['onIndexChanged'].fire();
            };
            const analysisOptionsWatcher = vscode.workspace.createFileSystemWatcher('**/analysis_options.yaml');
            analysisOptionsWatcher.onDidChange(handleAnalysisOptionsChange);
            analysisOptionsWatcher.onDidCreate(handleAnalysisOptionsChange);
            analysisOptionsWatcher.onDidDelete(handleAnalysisOptionsChange);
            this.watchers.push(analysisOptionsWatcher);
            // Watch MCP Trigger file
            const triggerWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/.flutter-explorer-trigger');
            triggerWatcher.onDidChange(() => vscode.commands.executeCommand('flutterExplorer.reindex'));
            triggerWatcher.onDidCreate(() => vscode.commands.executeCommand('flutterExplorer.reindex'));
            this.watchers.push(triggerWatcher);
        } else {
            // Watch TS/JS files
            const jsTsWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx}');
            this.setupWatcher(jsTsWatcher);
            this.watchers.push(jsTsWatcher);
            // Watch package.json
            const packageJsonWatcher = vscode.workspace.createFileSystemWatcher('**/package.json');
            packageJsonWatcher.onDidChange(() => this.indexManager['onIndexChanged'].fire());
            packageJsonWatcher.onDidCreate(() => this.indexManager['onIndexChanged'].fire());
            this.watchers.push(packageJsonWatcher);
        }
    }

    private static readonly EXCLUDED_DIRS = /[\/\\](node_modules|out|dist|build|\.git|\.next)[\/\\]/;
    private shouldExclude(uri: vscode.Uri): boolean {
        return FileWatcher.EXCLUDED_DIRS.test(uri.fsPath) || this.indexManager.isFileExcluded(uri.fsPath);
    }

    private setupWatcher(watcher: vscode.FileSystemWatcher): void {
        this.disposables.push(
            watcher.onDidChange(uri => this.debouncedUpdate(uri)),
            watcher.onDidCreate(uri => this.debouncedUpdate(uri)),
            watcher.onDidDelete(uri => this.handleDelete(uri)),
        );
    }

    /**
     * ARB-specific watcher: triggers both index update AND intl code generation.
     * Uses a separate, longer debounce for generation to avoid running it
     * multiple times during rapid edits.
     */
    private setupArbWatcher(watcher: vscode.FileSystemWatcher): void {
        const handleArbChange = (uri: vscode.Uri) => {
            // 1. Normal index update (fast debounce)
            this.debouncedUpdate(uri);
            // 2. Trigger intl generation (slow debounce)
            this.debouncedGenerate();
        };

        this.disposables.push(
            watcher.onDidChange(handleArbChange),
            watcher.onDidCreate(handleArbChange),
            watcher.onDidDelete(uri => {
                this.handleDelete(uri);
                this.debouncedGenerate();
            }),
        );
    }

    // ── Intl Generation Logic ──────────────────────────────────────────────

    /**
     * Debounced trigger for intl code generation.
     * Waits 1500ms after the last ARB change before running.
     */
    private debouncedGenerate(): void {
        // Check if auto-generate is enabled in settings
        const config = vscode.workspace.getConfiguration('flutterExplorer');
        if (!config.get<boolean>('autoGenerateIntl', true)) return;

        // Check if flutter_intl is enabled in pubspec.yaml
        if (!this.intlGenerator.isEnabled()) return;

        // Clear existing timer
        if (this.arbGenerateTimer) {
            clearTimeout(this.arbGenerateTimer);
        }

        this.arbGenerateTimer = setTimeout(() => {
            this.arbGenerateTimer = null;
            this.runGenerate();
        }, FileWatcher.ARB_GENERATE_DEBOUNCE_MS);
    }

    /**
     * Execute intl code generation with process guard.
     * If generation is already running, queues one more run after completion.
     */
    private async runGenerate(): Promise<void> {
        if (this.isGenerating) {
            this.pendingGenerate = true;
            return;
        }

        this.isGenerating = true;

        try {
            const generated = this.intlGenerator.generate();

            if (generated.length > 0) {
                console.log(`[FlutterExplorer] Intl generated ${generated.length} files: ${generated.join(', ')}`);
                vscode.window.setStatusBarMessage('$(check) Localization files generated ✓', 3000);
            }
        } catch (err: any) {
            console.error('[FlutterExplorer] Intl generation failed:', err);
            vscode.window.showErrorMessage(`Flutter Explorer: Localization generation failed — ${err.message || err}`);
        } finally {
            this.isGenerating = false;

            // If there was a pending request during generation, run again
            if (this.pendingGenerate) {
                this.pendingGenerate = false;
                this.runGenerate();
            }
        }
    }

    // ── Standard File Handlers ─────────────────────────────────────────────

    private debouncedUpdate(uri: vscode.Uri): void {
        if (this.shouldExclude(uri)) return;
        const key = uri.fsPath;
        const existing = this.debounceTimers.get(key);
        if (existing) { clearTimeout(existing); }
        const timer = setTimeout(async () => {
            this.debounceTimers.delete(key);
            await this.indexManager.updateFile(uri);
        }, this.debounceMs);
        this.debounceTimers.set(key, timer);
    }

    private async handleDelete(uri: vscode.Uri): Promise<void> {
        if (this.shouldExclude(uri)) return;
        const key = uri.fsPath;
        const existing = this.debounceTimers.get(key);
        if (existing) { clearTimeout(existing); }
        this.debounceTimers.delete(key);
        await this.indexManager.removeFile(uri);
    }

    /** Update debounce delay */
    setDebounceMs(ms: number): void {
        this.debounceMs = ms;
    }

    dispose(): void {
        if (this.arbGenerateTimer) {
            clearTimeout(this.arbGenerateTimer);
            this.arbGenerateTimer = null;
        }
        for (const timer of this.debounceTimers.values()) { clearTimeout(timer); }
        this.debounceTimers.clear();
        for (const w of this.watchers) { w.dispose(); }
        this.watchers = [];
        for (const d of this.disposables) { d.dispose(); }
        this.disposables = [];
    }
}