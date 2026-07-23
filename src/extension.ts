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

// ─── Centralized Constants ─────────────────────────────────
const COMMANDS = {
    REINDEX: 'flutterExplorer.reindex',
    REFRESH: 'flutterExplorer.refresh',
    OPEN_FILE: 'flutterExplorer.openFile',
    SETUP_MCP: 'flutterExplorer.setupMcp',
    OPEN_GRAPH: 'flutterExplorer.openGraph',
    COMPARE_PARSERS: 'flutterExplorer.compareParsers',
    INTL_INIT: 'flutterExplorer.intlInitialize',
    INTL_ADD_LOCALE: 'flutterExplorer.intlAddLocale',
    INTL_REMOVE_LOCALE: 'flutterExplorer.intlRemoveLocale',
    OPEN_SETTINGS: 'flutterExplorer.openSettings',
    COPY_TO_CLIPBOARD: 'flutterExplorer.copyToClipboard',
} as const;

const MESSAGES = {
    NO_WORKSPACE: 'Flutter Explorer: No workspace folder found.',
    READY: 'Flutter Explorer is ready! 🚀',
    REBUILDING_INDEX: 'Flutter Explorer: Rebuilding index...',
    INITIAL_INDEX: 'Flutter Explorer: Building initial index...',
    INDEX_REBUILT: 'Flutter Explorer: Index rebuilt successfully!',
    COMPARING_PARSERS: 'Comparing Regex & SDK Parsers...',
    INTL_NOT_INITIALIZED: 'Flutter Intl is not initialized. Run "Flutter Intl: Initialize" first.',
} as const;

const MONITORED_PATH_PREFIXES = ['lib/', 'test/', 'android/', 'src/', 'app/'];

let statusBarItem: vscode.StatusBarItem;

// ─── Helper Functions to Eliminate Duplication ────────────
/** Runs index build with progress notification and updates status bar & sidebar */
async function runIndexProgressBuild(
    title: string,
    indexManager: IndexManager,
    sidebarProvider?: SidebarProvider,
    onSuccessMsg?: string
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: false,
        },
        async (progress) => {
            await indexManager.buildFullIndex(progress);
            updateStatusBar(indexManager);
            if (sidebarProvider) {
                sidebarProvider.postMessage({ command: 'stats', data: indexManager.getStats() });
            }
            if (onSuccessMsg) {
                vscode.window.showInformationMessage(onSuccessMsg);
            }
        },
    );
}

/** Wrapper for Intl Generator commands to eliminate duplicated instantiation and error handling */
async function runIntlCommand(
    workspaceRoot: string,
    requireInit: boolean,
    action: (generator: IntlGenerator) => Promise<void>
): Promise<void> {
    try {
        const generator = new IntlGenerator(workspaceRoot);
        if (requireInit && !generator.isEnabled()) {
            vscode.window.showErrorMessage(MESSAGES.INTL_NOT_INITIALIZED);
            return;
        }
        await action(generator);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Intl Error: ${err.message}`);
    }
}

/** Updates real-time widget tree in webview */
async function sendWidgetTreeUpdate(sidebarProvider: SidebarProvider, widgetTreeProvider: WidgetTreeProvider): Promise<void> {
    sidebarProvider.postMessage({
        command: 'widgetTree',
        data: await widgetTreeProvider.getTreeDataForWebview(),
    });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Set default auto-select family attempt timeout to 1000ms
    if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
        net.setDefaultAutoSelectFamilyAttemptTimeout(1000);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage(MESSAGES.NO_WORKSPACE);
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
    statusBarItem.command = COMMANDS.REINDEX;
    statusBarItem.tooltip = 'Flutter Explorer — Click to rebuild index';
    context.subscriptions.push(statusBarItem);
    updateStatusBar(indexManager);

    // ─── Commands Registration ──────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.REINDEX, async () => {
            await runIndexProgressBuild(MESSAGES.REBUILDING_INDEX, indexManager, sidebarProvider, MESSAGES.INDEX_REBUILT);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.REFRESH, () => {
            sidebarProvider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.OPEN_FILE, async (file: string, line: number) => {
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
        vscode.commands.registerCommand(COMMANDS.COPY_TO_CLIPBOARD, async (text: string) => {
            if (text) {
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage(`Copied: "${text.length > 30 ? text.substring(0, 30) + '...' : text}"`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SETUP_MCP, async () => {
            await setupMcpConfig(context.extensionPath, workspaceRoot);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.OPEN_GRAPH, () => {
            const { GraphWebviewPanel } = require('./views/graphWebview');
            GraphWebviewPanel.createOrShow(context.extensionUri, indexManager);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.COMPARE_PARSERS, async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: MESSAGES.COMPARING_PARSERS,
                    cancellable: false,
                },
                async (progress) => {
                    await indexManager.compareParsersAndWriteReport(progress);
                }
            );
        }),
    );

    // ─── Intl Generator Commands ───────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.INTL_INIT, async () => {
            await runIntlCommand(workspaceRoot, false, async (generator) => {
                const locale = await vscode.window.showInputBox({
                    prompt: 'Enter main locale (e.g. en, ar)',
                    value: 'en'
                });
                if (!locale) return;
                const generated = generator.initialize(locale);
                vscode.window.showInformationMessage(`Flutter Intl initialized. Created: ${generated.join(', ')}`);
            });
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.INTL_ADD_LOCALE, async () => {
            await runIntlCommand(workspaceRoot, true, async (generator) => {
                const locale = await vscode.window.showInputBox({
                    prompt: 'Enter new locale to add (e.g. ar, de_DE)'
                });
                if (!locale) return;
                const generated = generator.addLocale(locale);
                vscode.window.showInformationMessage(`Locale ${locale} added. Created: ${generated.join(', ')}`);
            });
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.INTL_REMOVE_LOCALE, async () => {
            await runIntlCommand(workspaceRoot, true, async (generator) => {
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
            });
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.OPEN_SETTINGS, () => {
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:flutter-explorer.flutter-explorer');
        })
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

    // ─── Real-time Widget Tree Updates ─────────────────────
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async () => {
            await sendWidgetTreeUpdate(sidebarProvider, widgetTreeProvider);
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (e) => {
            if (e.document === vscode.window.activeTextEditor?.document &&
                (e.document.fileName.match(/\.(dart|ts|tsx|js|jsx|kt|java|xml|gradle|kts)$/))) {
                await sendWidgetTreeUpdate(sidebarProvider, widgetTreeProvider);
            }
        }),
    );

    // ─── Diagnostics Listener ──────────────────────────────
    const updateDiagnostics = () => {
        const diagnostics: DiagnosticInfo[] = [];
        const allDiagnostics = vscode.languages.getDiagnostics();

        for (const [uri, diags] of allDiagnostics) {
            const relPath = indexManager.relativePath(uri.fsPath).replace(/\\/g, '/');
            if (!MONITORED_PATH_PREFIXES.some(prefix => relPath.startsWith(prefix))) continue;

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

        indexManager.buildReverseDependencies().catch(err => {
            console.error('Error building reverse dependencies:', err);
        });
    } else {
        context.subscriptions.push(fileWatcher);
        runIndexProgressBuild(MESSAGES.INITIAL_INDEX, indexManager).then(() => {
            fileWatcher.start();
        });
    }
    vscode.window.showInformationMessage(MESSAGES.READY);

    // ─── Auto MCP Setup ───────────────────────────────────
    setupMcpConfig(context.extensionPath, workspaceRoot).catch(err => {
        console.error('[FlutterExplorer] MCP setup failed:', err);
    });

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
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}