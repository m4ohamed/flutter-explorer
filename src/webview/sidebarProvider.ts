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
import { ProjectDetector } from '../utils/projectDetector';
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
        private isDev: boolean = false,
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
                        vscode.commands.executeCommand('flutterExplorer.openFile', message.file, message.line);
                    }
                    break;
                }
                case 'getWidgetTree': {
                    const treeData = await this.widgetTreeProvider.getTreeDataForWebview();
                    this.postMessage({ command: 'widgetTree', data: treeData });
                    break;
                }
                case 'getDependencyGraph': {
                    const graphData = this.depGraphProvider.getGraphData();
                    this.postMessage({ command: 'dependencyGraph', data: graphData });
                    break;
                }
                case 'openGraph': {
                    vscode.commands.executeCommand('flutterExplorer.openGraph');
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
                case 'getPackages': {
                    const packages = this.indexManager.getAllPackages();
                    this.postMessage({ command: 'packagesData', data: packages });
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
        const mediaPath = this.isDev ? srcMediaPath : (fs.existsSync(outMediaPath) ? outMediaPath : srcMediaPath);
        try {
            cssContent = fs.readFileSync(path.join(mediaPath, 'sidebar.css'), 'utf-8');
        } catch { cssContent = ''; }
        try {
            jsContent = fs.readFileSync(path.join(mediaPath, 'sidebar.js'), 'utf-8');
        } catch { jsContent = ''; }
        const nonce = getNonce();

        const projectType = ProjectDetector.getProjectType(this.workspaceRoot);
        let tabTitle = '📦 Pubspec';
        let fileHeader = 'pubspec.yaml';
        if (projectType === 'ts') {
            tabTitle = '📦 Package';
            fileHeader = 'package.json';
        } else if (projectType === 'android') {
            tabTitle = '📦 Gradle';
            fileHeader = 'build.gradle';
        }

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
      <button class="tab" data-tab="pubspec" title="${fileHeader}">${tabTitle}</button>
      <button class="tab" data-tab="libraries" title="External Libraries">📚 Libraries</button>
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
          <button class="filter-btn" data-filter="extension">Extensions</button>
          <button class="filter-btn" data-filter="typedef">Typedefs</button>
          <button class="filter-btn" data-filter="variable">Variables</button>
          <button class="filter-btn" data-filter="constructor">Ctors</button>
        </div>
      </div>
      <div class="results-list" id="searchResults"></div>
    </div>
    <!-- Widget Tree Tab -->
    <div class="tab-content" id="tab-tree">
      <div class="tree-header">
        <span class="tree-file-name" id="treeFileName">No file open</span>
        <button class="icon-btn" id="refreshTree" title="Refresh">⟳</button>
      </div>
      <div class="tree-view" id="treeView"></div>
    </div>
    <!-- Dependency Graph Tab -->
    <div class="tab-content" id="tab-graph">
      <div class="graph-header">
        <span>Dependency Graph</span>
        <div style="display: flex; gap: 4px;">
          <button class="icon-btn" id="openInteractiveGraph" title="Open Interactive Graph">🌐</button>
          <button class="icon-btn" id="refreshGraph" title="Refresh">⟳</button>
        </div>
      </div>
      <div class="graph-stats" id="graphStats"></div>
      <div class="graph-container" id="graphContainer"></div>
    </div>
    <!-- Pubspec Tab -->
    <div class="tab-content" id="tab-pubspec">
      <div class="pubspec-header">
        <span>${fileHeader}</span>
        <button class="icon-btn" id="refreshPubspec" title="Refresh">⟳</button>
      </div>
      <div class="pubspec-content" id="pubspecContent"></div>
    </div>
    <!-- Analysis Tab -->
    <div class="tab-content" id="tab-analysis">
      <div class="pubspec-header">
        <span>Code Analysis</span>
        <button class="icon-btn" id="refreshAnalysis" title="Refresh">⟳</button>
      </div>
      <div class="analysis-filters">
        <select id="analysisTypeFilter" class="analysis-select" title="Filter by type">
          <option value="all">All Types</option>
          <option value="hardcoded_text">Text Only</option>
          <option value="hardcoded_color">Color Only</option>
          <option value="duplicated_logic">Duplicates Only</option>
        </select>
        <input type="text" id="analysisColorFilter" placeholder="Color/Text (e.g. 0xFFFFFF)" class="analysis-input" title="Filter by specific text or color value" />
        <input type="text" id="analysisFileFilter" placeholder="File name" class="analysis-input" title="Filter by specific file path" />
      </div>
      <div class="pubspec-content" id="analysisContent"></div>
    </div>
    <!-- Libraries Tab -->
    <div class="tab-content" id="tab-libraries">
      <div class="libraries-header">
        <span>External Libraries</span>
        <button class="icon-btn" id="refreshLibraries" title="Refresh">⟳</button>
      </div>
      <div class="libraries-content" id="librariesContent"></div>
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
function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}