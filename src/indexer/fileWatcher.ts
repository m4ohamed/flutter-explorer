/**
 * File Watcher - Monitors lib/ and android/app/ for changes
 * with debouncing for incremental index updates.
 */
import * as vscode from 'vscode';
import { IndexManager } from './indexManager';
export class FileWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private debounceMs: number;
    private disposables: vscode.Disposable[] = [];
    constructor(
        private indexManager: IndexManager,
        debounceMs: number = 300,
    ) {
        this.debounceMs = debounceMs;
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
            // Watch ARB files
            const arbWatcher = vscode.workspace.createFileSystemWatcher('**/lib/**/*.arb');
            this.setupWatcher(arbWatcher);
            this.watchers.push(arbWatcher);
            // Watch pubspec.yaml
            const pubspecWatcher = vscode.workspace.createFileSystemWatcher('**/pubspec.yaml');
            pubspecWatcher.onDidChange(() => this.indexManager['onIndexChanged'].fire());
            pubspecWatcher.onDidCreate(() => this.indexManager['onIndexChanged'].fire());
            this.watchers.push(pubspecWatcher);
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
        return FileWatcher.EXCLUDED_DIRS.test(uri.fsPath);
    }
    private setupWatcher(watcher: vscode.FileSystemWatcher): void {
        this.disposables.push(
            watcher.onDidChange(uri => this.debouncedUpdate(uri)),
            watcher.onDidCreate(uri => this.debouncedUpdate(uri)),
            watcher.onDidDelete(uri => this.handleDelete(uri)),
        );
    }
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
    private handleDelete(uri: vscode.Uri): void {
        if (this.shouldExclude(uri)) return;
        const key = uri.fsPath;
        const existing = this.debounceTimers.get(key);
        if (existing) { clearTimeout(existing); }
        this.debounceTimers.delete(key);
        this.indexManager.removeFile(uri);
    }
    /** Update debounce delay */
    setDebounceMs(ms: number): void {
        this.debounceMs = ms;
    }
    dispose(): void {
        for (const timer of this.debounceTimers.values()) { clearTimeout(timer); }
        this.debounceTimers.clear();
        for (const w of this.watchers) { w.dispose(); }
        for (const d of this.disposables) { d.dispose(); }
    }
}