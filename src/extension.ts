/**
 * Flutter Explorer - VS Code Extension Entry Point
 *
 * Provides Code Search, Widget Tree, Dependency Graph, and pubspec.yaml
 * analysis for Flutter/Dart projects.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as net from 'net';
import { IndexManager, DiagnosticInfo } from './indexer/indexManager';
import { FileWatcher } from './indexer/fileWatcher';
import { SearchProvider } from './providers/searchProvider';
import { WidgetTreeProvider } from './providers/widgetTreeProvider';
import { DependencyGraphProvider } from './providers/dependencyGraphProvider';
import { PubspecProvider } from './providers/pubspecProvider';
import { SidebarProvider } from './webview/sidebarProvider';
import { setupMcpConfig } from './utils/mcpSetup';
import { IntlGenerator } from './indexer/intlGenerator';

let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Set default auto-select family attempt timeout to 1000ms
    if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
        net.setDefaultAutoSelectFamilyAttemptTimeout(1000);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('Flutter Explorer: No workspace folder found.');
        return;
    }
    const workspaceRoot = workspaceFolder.uri.fsPath;

    // ─── Initialize Components ─────────────────────────────
    const indexManager = new IndexManager(workspaceRoot, context.extensionPath);

    // ✅ طريقة واحدة فقط للـ dispose — VS Code بيتكفل بها تلقائياً عند deactivate
    context.subscriptions.push({
        dispose: () => indexManager.dispose()
    });

    const config = vscode.workspace.getConfiguration('flutterExplorer');
    const debounceMs = config.get<number>('debounceMs', 300);
    const fileWatcher = new FileWatcher(indexManager, workspaceRoot, debounceMs);
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
        context.extensionMode === vscode.ExtensionMode.Development,
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
            try {
                const absPath = path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
                const uri = vscode.Uri.file(absPath);
                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(Math.max(0, line - 1), 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            } catch (err) {
                vscode.window.showErrorMessage(`Could not open: ${file}`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flutterExplorer.setupMcp', async () => {
            await setupMcpConfig(context.extensionPath, workspaceRoot);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flutterExplorer.openGraph', () => {
            const { GraphWebviewPanel } = require('./views/graphWebview');
            GraphWebviewPanel.createOrShow(context.extensionUri, indexManager);
        }),
    );

    // ─── Intl Generator Commands ───────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('flutterExplorer.intlInitialize', async () => {
            try {
                const generator = new IntlGenerator(workspaceRoot);
                const locale = await vscode.window.showInputBox({
                    prompt: 'Enter main locale (e.g. en, ar)',
                    value: 'en'
                });
                if (!locale) return;
                
                const generated = generator.initialize(locale);
                vscode.window.showInformationMessage(`Flutter Intl initialized. Created: ${generated.join(', ')}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Intl Error: ${err.message}`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flutterExplorer.intlAddLocale', async () => {
            try {
                const generator = new IntlGenerator(workspaceRoot);
                if (!generator.isEnabled()) {
                    vscode.window.showErrorMessage('Flutter Intl is not initialized. Run "Flutter Intl: Initialize" first.');
                    return;
                }
                const locale = await vscode.window.showInputBox({
                    prompt: 'Enter new locale to add (e.g. ar, de_DE)'
                });
                if (!locale) return;
                
                const generated = generator.addLocale(locale);
                vscode.window.showInformationMessage(`Locale ${locale} added. Created: ${generated.join(', ')}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Intl Error: ${err.message}`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flutterExplorer.intlRemoveLocale', async () => {
            try {
                const generator = new IntlGenerator(workspaceRoot);
                if (!generator.isEnabled()) {
                    vscode.window.showErrorMessage('Flutter Intl is not initialized.');
                    return;
                }
                const locales = generator.getLocales();
                if (locales.length === 0) {
                    vscode.window.showErrorMessage('No locales found.');
                    return;
                }
                const locale = await vscode.window.showQuickPick(locales, {
                    placeHolder: 'Select locale to remove'
                });
                if (!locale) return;
                
                const generated = generator.removeLocale(locale);
                vscode.window.showInformationMessage(`Locale ${locale} removed. Updated ${generated.length} files.`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Intl Error: ${err.message}`);
            }
        }),
    );

    // ─── Index Changed Listener ────────────────────────────
    indexManager.onDidChangeIndex(() => {
        updateStatusBar(indexManager);
        sidebarProvider.postMessage({ command: 'stats', data: indexManager.getStats() });
        sidebarProvider.postMessage({
            command: 'analysisData',
            data: {
                missingTranslations: indexManager.analyzeTranslations(),
                warnings: indexManager.getWarnings()
            }
        });
    });

    // ─── Active Editor Change → Update Widget Tree ─────────
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async () => {
            sidebarProvider.postMessage({
                command: 'widgetTree',
                data: await widgetTreeProvider.getTreeDataForWebview(),
            });
        }),
    );

    // Listen for text changes to update widget tree in real time
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (e) => {
            if (e.document === vscode.window.activeTextEditor?.document &&
                (e.document.fileName.match(/\.(dart|ts|tsx|js|jsx|kt|java|xml|gradle)$/))) {
                sidebarProvider.postMessage({
                    command: 'widgetTree',
                    data: await widgetTreeProvider.getTreeDataForWebview(),
                });
            }
        }),
    );

    // ─── Diagnostics Listener ──────────────────────────────
    const updateDiagnostics = () => {
        const diagnostics: DiagnosticInfo[] = [];
        const allDiagnostics = vscode.languages.getDiagnostics();

        for (const [uri, diags] of allDiagnostics) {
            // Care about Dart (lib/, test/), Android (android/), and JS/TS (src/, app/)
            const relPath = indexManager.relativePath(uri.fsPath).replace(/\\/g, '/');
            if (!relPath.startsWith('lib/') && !relPath.startsWith('test/') && !relPath.startsWith('android/') && !relPath.startsWith('src/') && !relPath.startsWith('app/')) continue;

            for (const d of diags) {
                diagnostics.push({
                    filePath: relPath,
                    line: d.range.start.line + 1,
                    column: d.range.start.character + 1,
                    message: d.message,
                    severity: d.severity === 0 ? 'error' : d.severity === 1 ? 'warning' : d.severity === 2 ? 'info' : 'hint',
                    source: d.source || 'dart'
                });
            }
        }
        indexManager.updateDiagnostics(diagnostics);
    };

    context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(updateDiagnostics));

    // Initial diagnostics collection
    updateDiagnostics();

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
    const cacheLoaded = await indexManager.loadCache();
    if (cacheLoaded) {
        updateStatusBar(indexManager);
        fileWatcher.start();
        context.subscriptions.push(fileWatcher);

        // Build reverse dependencies in background
        indexManager.buildReverseDependencies().catch(err => {
            console.error('Error building reverse dependencies:', err);
        });
    } else {
        // Build index without blocking on reverse dependencies
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

        fileWatcher.start();
        context.subscriptions.push(fileWatcher);
    }
    vscode.window.showInformationMessage('Flutter Explorer is ready! 🚀');

    // ─── Auto MCP Setup ───────────────────────────────────
    setupMcpConfig(context.extensionPath, workspaceRoot);

    // ─── Show Welcome README ──────────────────────────────
    const extensionVersion = context.extension.packageJSON.version;
    const lastVersionOpened = context.globalState.get<string>('lastVersionOpened');
    if (lastVersionOpened !== extensionVersion) {
        context.globalState.update('lastVersionOpened', extensionVersion);
        const readmePath = path.join(context.extensionPath, 'README-FlutterExplorer.md');
        const readmeUri = vscode.Uri.file(readmePath);
        
        setTimeout(() => {
            vscode.commands.executeCommand('markdown.showPreview', readmeUri).then(
                undefined,
                () => {
                    // Fallback to opening as text document if markdown preview command fails
                    vscode.workspace.openTextDocument(readmeUri).then((doc) => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            );
        }, 1500);
    }
}

function updateStatusBar(indexManager: IndexManager): void {
    const stats = indexManager.getStats();
    statusBarItem.text = `$(symbol-class) ${stats.classes} classes · $(symbol-method) ${stats.functions} fns · $(extensions) ${stats.widgets} widgets · $(globe) ${stats.translations || 0} loc`;
    statusBarItem.show();
}

export function deactivate(): void {
    // ✅ statusBar فقط هنا — الـ indexManager.dispose() بيتنادى تلقائياً
    // من context.subscriptions اللي VS Code بيعمل dispose عليها
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}