import * as vscode from "vscode";
import * as path from "path";
import { IndexManager } from "../indexer/indexManager";

export class GraphWebviewPanel {
  private static currentPanel: GraphWebviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri,
    private indexManager: IndexManager
  ) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.html = this.getHtmlContent(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "ready":
            this.sendGraphData();
            break;
          case "nodeClicked":
            this.openFile(message.filePath, message.line);
            break;
        }
      },
      null,
      this.disposables
    );

    this.indexManager.onDidChangeIndex(() => {
      this.sendGraphData();
    }, null, this.disposables);
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    indexManager: IndexManager
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GraphWebviewPanel.currentPanel) {
      GraphWebviewPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "flutterExplorer.graph",
      "Flutter Dependency Graph",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "out"),
          vscode.Uri.joinPath(extensionUri, "src", "webview"),
        ],
      }
    );

    GraphWebviewPanel.currentPanel = new GraphWebviewPanel(
      panel,
      extensionUri,
      indexManager
    );
  }

  private dispose(): void {
    GraphWebviewPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private sendGraphData(): void {
    const detailed = this.indexManager.getDetailedGraph();
    const nodes = detailed.nodes.map(n => ({
      id: n.id,
      name: n.name,
      kind: n.type.charAt(0).toUpperCase() + n.type.slice(1),
      filePath: n.file,
      line: n.line || 1
    }));
    
    const edges = detailed.edges.map(e => ({
      source: e.source,
      target: e.target,
      kind: e.type.toUpperCase()
    }));

    this.panel.webview.postMessage({
      command: "setData",
      nodes,
      edges,
    });
  }

  private async openFile(filePath: string, line: number): Promise<void> {
    // Reuse the central command for robustness
    vscode.commands.executeCommand('flutterExplorer.openFile', filePath, line);
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview-graph.js")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flutter Dependency Graph</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --panel-bg: rgba(30, 30, 34, 0.75);
      --border-color: rgba(255, 255, 255, 0.08);
      --text-color: var(--vscode-editor-foreground, #cccccc);
      --font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    
    body.vscode-light {
      --panel-bg: rgba(243, 243, 245, 0.85);
      --border-color: rgba(0, 0, 0, 0.08);
      --text-color: var(--vscode-editor-foreground, #333333);
    }

    body {
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--font-family);
      overflow: hidden;
      user-select: none;
    }

    #graph-area {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
      z-index: 1;
    }

    /* Floating Panel */
    .floating-panel {
      position: absolute;
      top: 20px;
      left: 20px;
      z-index: 10;
      width: 300px;
      background: var(--panel-bg);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      box-shadow: 0 10px 40px 0 rgba(0, 0, 0, 0.25);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 10px;
    }

    .panel-title {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: var(--vscode-editor-foreground);
    }

    .panel-subtitle {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
    }

    /* Search Box */
    .search-box-wrapper {
      position: relative;
    }

    .search-box {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--vscode-input-border, var(--border-color));
      background: var(--vscode-input-background, rgba(0,0,0,0.15));
      color: var(--vscode-input-foreground, var(--text-color));
      font-family: var(--font-family);
      font-size: 12px;
      outline: none;
      transition: all 0.2s ease;
    }

    .search-box:focus {
      border-color: var(--vscode-focusBorder, #007acc);
      background: var(--vscode-input-background, rgba(0,0,0,0.25));
    }

    /* Filter Groups */
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .filter-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--vscode-descriptionForeground, #999);
    }

    .filter-items {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 12px;
    }

    .filter-item {
      display: flex;
      align-items: center;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      color: var(--text-color);
    }

    .filter-item input {
      margin-right: 6px;
      cursor: pointer;
    }

    .color-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }

    /* Zoom Controls */
    .zoom-controls {
      display: flex;
      gap: 8px;
    }

    .btn {
      flex: 1;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #ffffff);
      font-family: var(--font-family);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      transition: all 0.2s ease;
      outline: none;
    }

    .btn:hover {
      background: var(--vscode-button-hoverBackground, #0062a3);
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-color);
      border: 1px solid var(--border-color);
    }
    
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    /* Inspector Card */
    .inspector-card {
      position: absolute;
      bottom: 20px;
      right: 20px;
      z-index: 10;
      width: 320px;
      max-height: 400px;
      background: var(--panel-bg);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      box-shadow: 0 10px 40px 0 rgba(0, 0, 0, 0.25);
      padding: 16px;
      box-sizing: border-box;
      display: none; 
      flex-direction: column;
      gap: 12px;
      animation: slideIn 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    }

    @keyframes slideIn {
      from { transform: translateY(15px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .inspector-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }

    .inspector-name {
      font-size: 15px;
      font-weight: 600;
      word-break: break-all;
    }

    .inspector-type {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      letter-spacing: 0.5px;
      color: #fff;
    }

    .inspector-path {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      word-break: break-all;
      background: rgba(0, 0, 0, 0.1);
      padding: 6px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
    }

    .inspector-section {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .inspector-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #999);
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 2px;
      margin-bottom: 4px;
    }

    .inspector-links-list {
      max-height: 100px;
      overflow-y: auto;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .inspector-link-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid transparent;
    }

    .inspector-link-item:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: var(--border-color);
    }

    .link-rel-type {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      opacity: 0.7;
    }

    /* Scrollbars */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(120, 120, 120, 0.2);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(120, 120, 120, 0.4);
    }
  </style>
</head>
<body>
  <div id="graph-area"></div>

  <!-- Floating Control Panel -->
  <div class="floating-panel">
    <div class="panel-header">
      <span class="panel-title">Graph Explorer</span>
      <span class="panel-subtitle" id="graph-stats">Loading...</span>
    </div>

    <!-- Search box -->
    <div class="search-box-wrapper">
      <input type="text" id="node-search" class="search-box" placeholder="🔍 Search nodes by name..." />
    </div>

    <!-- Node Type Filters -->
    <div class="filter-group">
      <span class="filter-label">Element Types</span>
      <div class="filter-items">
        <label class="filter-item">
          <input type="checkbox" id="filter-file" checked />
          <span class="color-dot" style="background-color: #58a6ff;"></span>
          Files
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-class" checked />
          <span class="color-dot" style="background-color: #f0883e;"></span>
          Classes
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-widget" checked />
          <span class="color-dot" style="background-color: #d2a8ff;"></span>
          Widgets
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-mixin" checked />
          <span class="color-dot" style="background-color: #f38ba8;"></span>
          Mixins
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-enum" checked />
          <span class="color-dot" style="background-color: #f9e2af;"></span>
          Enums
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-function" checked />
          <span class="color-dot" style="background-color: #3fb950;"></span>
          Functions
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-method" checked />
          <span class="color-dot" style="background-color: #888888;"></span>
          Methods
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-extension" checked />
          <span class="color-dot" style="background-color: #a371f7;"></span>
          Extensions
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-typedef" checked />
          <span class="color-dot" style="background-color: #56b6c2;"></span>
          Typedefs
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-variable" checked />
          <span class="color-dot" style="background-color: #e5c07b;"></span>
          Variables
        </label>
        <label class="filter-item">
          <input type="checkbox" id="filter-constructor" checked />
          <span class="color-dot" style="background-color: #da70d6;"></span>
          Constructors
        </label>
      </div>
    </div>

    <!-- Relationship Filters -->
    <div class="filter-group">
      <span class="filter-label">Relationships</span>
      <div class="filter-items">
        <label class="filter-item"><input type="checkbox" id="rel-imports" checked />Imports</label>
        <label class="filter-item"><input type="checkbox" id="rel-extends" checked />Extends</label>
        <label class="filter-item"><input type="checkbox" id="rel-mixes_in" checked />Mixes In</label>
        <label class="filter-item"><input type="checkbox" id="rel-implements" checked />Implements</label>
        <label class="filter-item"><input type="checkbox" id="rel-calls" checked />Calls</label>
        <label class="filter-item"><input type="checkbox" id="rel-contains" checked />Contains</label>
        <label class="filter-item"><input type="checkbox" id="rel-uses_class" checked />Uses Class</label>
        <label class="filter-item"><input type="checkbox" id="rel-uses_variable" checked />Uses Var</label>
      </div>
    </div>

    <!-- Zoom controls -->
    <div class="zoom-controls">
      <button class="btn btn-secondary" id="zoom-in" title="Zoom In">Zoom +</button>
      <button class="btn btn-secondary" id="zoom-out" title="Zoom Out">Zoom -</button>
      <button class="btn" id="zoom-fit" title="Fit to View">Fit</button>
    </div>
  </div>

  <!-- Floating Node Inspector -->
  <div class="inspector-card" id="inspector">
    <div class="inspector-header">
      <div class="inspector-name" id="inspect-name">Select a node</div>
      <div class="inspector-type" id="inspect-type" style="background-color: #58a6ff;">FILE</div>
    </div>
    <div class="inspector-path" id="inspect-path">Hover/click a node to see detail.</div>
    
    <div class="inspector-section" id="inspect-incoming-section">
      <span class="inspector-section-label">Referenced By / Parent</span>
      <div class="inspector-links-list" id="inspect-incoming">
        <!-- List of nodes -->
      </div>
    </div>
    
    <div class="inspector-section" id="inspect-outgoing-section">
      <span class="inspector-section-label">References / Contains</span>
      <div class="inspector-links-list" id="inspect-outgoing">
        <!-- List of nodes -->
      </div>
    </div>

    <button class="btn" id="inspect-open-btn" style="width: 100%; margin-top: 4px;">Open File</button>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
