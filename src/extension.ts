/**
 * Flutter Explorer - VS Code Extension Entry Point
 *
 * Provides Code Search, Widget Tree, Dependency Graph, and pubspec.yaml
 * analysis for Flutter/Dart projects.
 */
import * as vscode from 'vscode';
import { IndexManager } from './indexer/indexManager';
import { FileWatcher } from './indexer/fileWatcher';
import { SearchProvider } from './providers/searchProvider';
import { WidgetTreeProvider } from './providers/widgetTreeProvider';
import { DependencyGraphProvider } from './providers/dependencyGraphProvider';
import { PubspecProvider } from './providers/pubspecProvider';
import { SidebarProvider } from './webview/sidebarProvider';
let statusBarItem: vscode.StatusBarItem;
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('Flutter Explorer: No workspace folder found.');
        return;
    }
    const workspaceRoot = workspaceFolder.uri.fsPath;
    // ─── Initialize Components ─────────────────────────────
    const indexManager = new IndexManager(workspaceRoot);
    const config = vscode.workspace.getConfiguration('flutterExplorer');
    const debounceMs = config.get<number>('debounceMs', 300);
    const fileWatcher = new FileWatcher(indexManager, debounceMs);
    const searchProvider = new SearchProvider(indexManager, workspaceRoot);
    const widgetTreeProvider = new WidgetTreeProvider(indexManager);
    const depGraphProvider = new DependencyGraphProvider(indexManager);
    const pubspecProvider = new PubspecProvider(workspaceRoot);
    // ─── Sidebar Provider ─────────────────────────────────
    const sidebarProvider = new SidebarProvider(
        context.extensionUri,
        indexManager,
        searchProvider,
        widgetTreeProvider,
        depGraphProvider,
        pubspecProvider,
        workspaceRoot,
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SidebarProvider.viewType,
            sidebarProvider,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );
    // ─── Status Bar ────────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusBarItem.command = 'flutterExplorer.reindex';
    statusBarItem.tooltip = 'Flutter Explorer — Click to rebuild index';
    context.subscriptions.push(statusBarItem);
    updateStatusBar(indexManager);
    // ─── Commands ──────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('flutterExplorer.reindex', async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Flutter Explorer: Rebuilding index...',
                    cancellable: false,
                },
                async (progress) => {
                    await indexManager.buildFullIndex(progress);
                    updateStatusBar(indexManager);
                    sidebarProvider.postMessage({ command: 'stats', data: indexManager.getStats() });
                    vscode.window.showInformationMessage('Flutter Explorer: Index rebuilt successfully!');
                },
            );
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('flutterExplorer.refresh', () => {
            sidebarProvider.refresh();
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('flutterExplorer.openFile', async (file: string, line: number) => {
            const uri = vscode.Uri.file(file);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            const position = new vscode.Position(Math.max(0, line - 1), 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }),
    );
    // ─── Index Changed Listener ────────────────────────────
    indexManager.onDidChangeIndex(() => {
        updateStatusBar(indexManager);
        sidebarProvider.postMessage({ command: 'stats', data: indexManager.getStats() });
    });
    // ─── Active Editor Change → Update Widget Tree ─────────
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            sidebarProvider.postMessage({
                command: 'widgetTree',
                data: widgetTreeProvider.getTreeDataForWebview(),
            });
        }),
    );
    // Listen for text changes to update widget tree in real time
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document === vscode.window.activeTextEditor?.document &&
                e.document.fileName.endsWith('.dart')) {
                sidebarProvider.postMessage({
                    command: 'widgetTree',
                    data: widgetTreeProvider.getTreeDataForWebview(),
                });
            }
        }),
    );
    // ─── Configuration Change Listener ─────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('flutterExplorer.debounceMs')) {
                const newDebounce = vscode.workspace.getConfiguration('flutterExplorer').get<number>('debounceMs', 300);
                fileWatcher.setDebounceMs(newDebounce);
            }
        }),
    );
    // ─── Startup: Load Cache or Build Full Index ───────────
    const cacheLoaded = indexManager.loadCache();
    if (cacheLoaded) {
        updateStatusBar(indexManager);
        // Start file watcher for incremental updates
        fileWatcher.start();
        context.subscriptions.push(fileWatcher);
    } else {
        // No cache → build full index with progress in the background
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Flutter Explorer: Building initial index...',
                cancellable: false,
            },
            async (progress) => {
                await indexManager.buildFullIndex(progress);
                updateStatusBar(indexManager);
            },
        );
        // Start file watcher after initial build
        fileWatcher.start();
        context.subscriptions.push(fileWatcher);
    }
    vscode.window.showInformationMessage('Flutter Explorer is ready! 🚀');
}
function updateStatusBar(indexManager: IndexManager): void {
    const stats = indexManager.getStats();
    statusBarItem.text = `$(symbol-class) ${stats.classes} classes · $(symbol-method) ${stats.functions} fns · $(extensions) ${stats.widgets} widgets · $(globe) ${stats.translations || 0} loc`;
    statusBarItem.show();
}
export function deactivate(): void {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}