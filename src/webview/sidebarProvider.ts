/**
 * Sidebar Webview Provider - Manages the sidebar panel UI
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IndexManager, SearchResult } from '../indexer/indexManager';
import { SearchProvider } from '../providers/searchProvider';
import { WidgetTreeProvider } from '../providers/widgetTreeProvider';
import { DependencyGraphProvider } from '../providers/dependencyGraphProvider';
import { PubspecProvider } from '../providers/pubspecProvider';
export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'flutterExplorer.sidebar';
    private view?: vscode.WebviewView;
    constructor(
        private extensionUri: vscode.Uri,
        private indexManager: IndexManager,
        private searchProvider: SearchProvider,
        private widgetTreeProvider: WidgetTreeProvider,
        private depGraphProvider: DependencyGraphProvider,
        private pubspecProvider: PubspecProvider,
        private workspaceRoot: string,
    ) { }
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'out', 'media'),
                vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'media'),
            ],
        };
        webviewView.webview.html = this.getHtmlContent(webviewView.webview);
        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            switch (message.command) {
                case 'search': {
                    const results = this.searchProvider.getSearchResultsForWebview(
                        message.query || '', message.filter
                    );
                    this.postMessage({ command: 'searchResults', data: results });
                    break;
                }
                case 'openFile': {
                    if (message.file && message.line !== undefined) {
                        const absPath = path.join(this.workspaceRoot, message.file);
                        const uri = vscode.Uri.file(absPath);
                        try {
                            const doc = await vscode.workspace.openTextDocument(uri);
                            const editor = await vscode.window.showTextDocument(doc);
                            const pos = new vscode.Position(Math.max(0, message.line - 1), 0);
                            editor.selection = new vscode.Selection(pos, pos);
                            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                        } catch {
                            vscode.window.showErrorMessage(`Could not open: ${message.file}`);
                        }
                    }
                    break;
                }
                case 'getWidgetTree': {
                    const treeData = this.widgetTreeProvider.getTreeDataForWebview();
                    this.postMessage({ command: 'widgetTree', data: treeData });
                    break;
                }
                case 'getDependencyGraph': {
                    const graphData = this.depGraphProvider.getGraphData();
                    this.postMessage({ command: 'dependencyGraph', data: graphData });
                    break;
                }
                case 'getPubspec': {
                    const pubspec = this.pubspecProvider.analyze();
                    this.postMessage({ command: 'pubspecData', data: pubspec });
                    break;
                }
                case 'getAnalysis': {
                    const missingTranslations = this.indexManager.analyzeTranslations();
                    const warnings = this.indexManager.getWarnings();
                    this.postMessage({ command: 'analysisData', data: { missingTranslations, warnings } });
                    break;
                }
                case 'getStats': {
                    const stats = this.indexManager.getStats();
                    this.postMessage({ command: 'stats', data: stats });
                    break;
                }
            }
        });
    }
    /** Send message to webview */
    postMessage(message: unknown): void {
        if (this.view) {
            this.view.webview.postMessage(message);
        }
    }
    /** Refresh the webview content */
    refresh(): void {
        if (this.view) {
            this.view.webview.html = this.getHtmlContent(this.view.webview);
        }
    }
    private getHtmlContent(webview: vscode.Webview): string {
        // Try to load from out/media first (production), then src/webview/media (dev)
        let cssContent = '';
        let jsContent = '';
        const outMediaPath = path.join(this.extensionUri.fsPath, 'out', 'media');
        const srcMediaPath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'media');
        const mediaPath = fs.existsSync(outMediaPath) ? outMediaPath : srcMediaPath;
        try {
            cssContent = fs.readFileSync(path.join(mediaPath, 'sidebar.css'), 'utf-8');
        } catch { cssContent = ''; }
        try {
            jsContent = fs.readFileSync(path.join(mediaPath, 'sidebar.js'), 'utf-8');
        } catch { jsContent = ''; }
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">${cssContent}</style>
</head>
<body>
  <div class="container">
    <!-- Tab Bar -->
    <div class="tab-bar">
      <button class="tab active" data-tab="search" title="Search">🔍 Search</button>
      <button class="tab" data-tab="tree" title="Widget Tree">🌳 Tree</button>
      <button class="tab" data-tab="graph" title="Dependencies">📊 Graph</button>
      <button class="tab" data-tab="pubspec" title="Pubspec">📦 Pubspec</button>
      <button class="tab" data-tab="analysis" title="Analysis">⚠️ Analysis</button>
    </div>
    <!-- Stats Bar -->
    <div class="stats-bar" id="statsBar">Loading index...</div>
    <!-- Search Tab -->
    <div class="tab-content active" id="tab-search">
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search classes, functions, widgets..." />
        <div class="filter-row">
          <button class="filter-btn active" data-filter="all">All</button>
          <button class="filter-btn" data-filter="class">Classes</button>
          <button class="filter-btn" data-filter="function">Functions</button>
          <button class="filter-btn" data-filter="widget">Widgets</button>
          <button class="filter-btn" data-filter="enum">Enums</button>
          <button class="filter-btn" data-filter="mixin">Mixins</button>
          <button class="filter-btn" data-filter="call">Calls</button>
          <button class="filter-btn" data-filter="translation">Translations</button>
        </div>
      </div>
      <div class="results-list" id="searchResults"></div>
    </div>
    <!-- Widget Tree Tab -->
    <div class="tab-content" id="tab-tree">
      <div class="tree-header">
        <span class="tree-file-name" id="treeFileName">No Dart file open</span>
        <button class="icon-btn" id="refreshTree" title="Refresh">⟳</button>
      </div>
      <div class="tree-view" id="treeView"></div>
    </div>
    <!-- Dependency Graph Tab -->
    <div class="tab-content" id="tab-graph">
      <div class="graph-header">
        <span>Dependency Graph</span>
        <button class="icon-btn" id="refreshGraph" title="Refresh">⟳</button>
      </div>
      <div class="graph-stats" id="graphStats"></div>
      <div class="graph-container" id="graphContainer"></div>
    </div>
    <!-- Pubspec Tab -->
    <div class="tab-content" id="tab-pubspec">
      <div class="pubspec-header">
        <span>pubspec.yaml</span>
        <button class="icon-btn" id="refreshPubspec" title="Refresh">⟳</button>
      </div>
      <div class="pubspec-content" id="pubspecContent"></div>
    </div>
    <!-- Analysis Tab -->
    <div class="tab-content" id="tab-analysis">
      <div class="tree-header">
        <span>Project Analysis</span>
        <button class="icon-btn" id="refreshAnalysis" title="Refresh">⟳</button>
      </div>
      <div class="pubspec-content" id="analysisContent"></div>
    </div>
  </div>
  <script nonce="${nonce}">${jsContent}</script>
</body>
</html>`;
    }
}
interface WebviewMessage {
    command: string;
    query?: string;
    filter?: string;
    file?: string;
    line?: number;
}
interface WebviewSearchResult {
    name: string;
    type: string;
    subType: string;
    file: string;
    line: number;
    relativePath: string;
    isPrivate: boolean;
    usageCount?: number;
}
function getSearchResultsForWebview(results: SearchResult[], rootPath: string): WebviewSearchResult[] {
    return results.map(r => ({
        ...r,
        relativePath: path.relative(rootPath, r.file),
        usageCount: r.usageCount
    }));
}
function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}