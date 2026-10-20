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
    
    // Map of node degrees & neighbors
    const degreeMap = new Map<string, { inDegree: number; outDegree: number; inNeighbors: string[]; outNeighbors: string[] }>();
    for (const node of detailed.nodes) {
      degreeMap.set(node.id, { inDegree: 0, outDegree: 0, inNeighbors: [], outNeighbors: [] });
    }

    const validEdges: Array<{ source: string; target: string; kind: string }> = [];
    for (const edge of detailed.edges) {
      if (degreeMap.has(edge.source) && degreeMap.has(edge.target)) {
        degreeMap.get(edge.source)!.outDegree++;
        degreeMap.get(edge.source)!.outNeighbors.push(edge.target);
        degreeMap.get(edge.target)!.inDegree++;
        degreeMap.get(edge.target)!.inNeighbors.push(edge.source);
        validEdges.push({
          source: edge.source,
          target: edge.target,
          kind: (edge.type || 'CALLS').toUpperCase()
        });
      }
    }

    const layerCounts: Record<string, number> = {
      Presentation: 0,
      Domain: 0,
      Data: 0,
      Core: 0,
      Utils: 0
    };

    const nodes = detailed.nodes.map(n => {
      const fp = (n.file || '').toLowerCase().replace(/\\/g, '/');
      let layer = 'Core';
      if (fp.includes('/presentation/') || fp.includes('/views/') || fp.includes('/pages/') || fp.includes('/screens/') || fp.includes('/ui/') || fp.includes('/widgets/')) {
        layer = 'Presentation';
      } else if (fp.includes('/domain/') || fp.includes('/bloc/') || fp.includes('/cubit/') || fp.includes('/notifier/') || fp.includes('/usecases/') || fp.includes('/entities/')) {
        layer = 'Domain';
      } else if (fp.includes('/data/') || fp.includes('/models/') || fp.includes('/datasources/') || fp.includes('/network/') || fp.includes('/services/') || fp.includes('/repositories/')) {
        layer = 'Data';
      } else if (fp.includes('/utils/') || fp.includes('/helpers/') || fp.includes('/common/')) {
        layer = 'Utils';
      }
      
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
      const deg = degreeMap.get(n.id) || { inDegree: 0, outDegree: 0, inNeighbors: [], outNeighbors: [] };

      return {
        id: n.id,
        name: n.name,
        kind: n.type ? n.type.charAt(0).toUpperCase() + n.type.slice(1) : 'Symbol',
        filePath: n.file,
        line: n.line || 1,
        layer,
        inDegree: deg.inDegree,
        outDegree: deg.outDegree,
        degree: deg.inDegree + deg.outDegree,
        inNeighbors: deg.inNeighbors,
        outNeighbors: deg.outNeighbors
      };
    });

    this.panel.webview.postMessage({
      command: "setData",
      nodes,
      edges: validEdges,
      layers: Object.entries(layerCounts).map(([name, count]) => ({ name, count }))
    });
  }

  private async openFile(filePath: string, line: number): Promise<void> {
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
  <style>
    :root {
      --bg: var(--vscode-editor-background, #0f0f1a);
      --panel: var(--vscode-sideBar-background, #1a1a2e);
      --border: var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
      --input-border: var(--vscode-input-border, rgba(255, 255, 255, 0.2));
      --input-bg: var(--vscode-input-background, rgba(0, 0, 0, 0.25));
      --text: var(--vscode-editor-foreground, #e0e0e0);
      --text-muted: var(--vscode-descriptionForeground, #888888);
      --accent: var(--vscode-button-background, #007acc);
      --accent-hover: var(--vscode-button-hoverBackground, #0098ff);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --highlight-ring: #4e79a7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      display: flex;
      height: 100vh;
      width: 100vw;
      overflow: hidden;
      user-select: none;
    }

    #graph-container {
      flex: 1;
      height: 100%;
      position: relative;
      background: radial-gradient(circle at 50% 50%, rgba(30, 30, 45, 0.4) 0%, rgba(15, 15, 25, 0.95) 100%);
    }

    #network {
      width: 100%;
      height: 100%;
      outline: none;
    }

    /* Floating Canvas Controls */
    .canvas-controls {
      position: absolute;
      bottom: 20px;
      left: 20px;
      z-index: 10;
      display: flex;
      gap: 8px;
      background: var(--panel);
      padding: 6px;
      border-radius: 8px;
      border: 1px solid var(--border);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }

    .ctrl-btn {
      background: var(--input-bg);
      color: var(--text);
      border: 1px solid var(--input-border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: all 0.2s ease;
    }

    .ctrl-btn:hover {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
    }

    /* Modern Graphify-style Sidebar */
    #sidebar {
      width: 320px;
      min-width: 300px;
      max-width: 360px;
      background: var(--panel);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      height: 100%;
      box-shadow: -4px 0 20px rgba(0, 0, 0, 0.25);
      z-index: 20;
    }

    .sidebar-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .sidebar-header h2 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .badge-pill {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      background: var(--accent);
      color: var(--accent-fg);
      font-weight: 600;
    }

    /* Search Section */
    #search-wrap {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      position: relative;
    }

    #search {
      width: 100%;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      outline: none;
      transition: border-color 0.2s ease;
    }

    #search:focus {
      border-color: var(--accent);
    }

    #search-results {
      position: absolute;
      top: 50px;
      left: 16px;
      right: 16px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      max-height: 220px;
      overflow-y: auto;
      z-index: 50;
      display: none;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    }

    .search-item {
      padding: 7px 10px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    .search-item:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .search-item .sym-name {
      font-weight: 500;
      color: var(--text);
    }

    .search-item .sym-kind {
      font-size: 10px;
      color: var(--text-muted);
      background: var(--input-bg);
      padding: 2px 6px;
      border-radius: 4px;
    }

    /* Info Panel */
    #info-panel {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.1);
    }

    .panel-section-title {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    #info-content .empty {
      color: var(--text-muted);
      font-style: italic;
      font-size: 12px;
      padding: 8px 0;
    }

    .node-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }

    .node-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      word-break: break-word;
    }

    .node-kind-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 12px;
      background: var(--accent);
      color: var(--accent-fg);
      white-space: nowrap;
    }

    .node-field {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .node-field b {
      color: var(--text);
      font-weight: 500;
    }

    .open-file-btn {
      width: 100%;
      margin-top: 10px;
      background: var(--accent);
      color: var(--accent-fg);
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.2s ease;
    }

    .open-file-btn:hover {
      background: var(--accent-hover);
    }

    /* Neighbors List */
    #neighbors-section {
      margin-top: 12px;
      border-top: 1px solid var(--border);
      padding-top: 10px;
    }

    #neighbors-list {
      max-height: 140px;
      overflow-y: auto;
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .neighbor-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: var(--input-bg);
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      border-left: 3px solid var(--accent);
      transition: all 0.2s ease;
    }

    .neighbor-item:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateX(2px);
    }

    .neighbor-item .rel-direction {
      font-size: 10px;
      color: var(--text-muted);
    }

    /* Legend / Communities */
    #legend-wrap {
      flex: 1;
      overflow-y: auto;
      padding: 14px 16px;
    }

    #legend-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    #legend-controls label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-muted);
    }

    .legend-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: background 0.2s ease;
    }

    .legend-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .legend-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-count {
      font-size: 11px;
      color: var(--text-muted);
      background: var(--input-bg);
      padding: 1px 6px;
      border-radius: 8px;
    }

    /* Stats Footer */
    #stats {
      padding: 10px 16px;
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-muted);
      background: var(--panel);
      display: flex;
      justify-content: space-between;
    }

    /* Scrollbars */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }
  </style>
</head>
<body>
  <div id="graph-container">
    <div id="network"></div>
    <div class="canvas-controls">
      <button class="ctrl-btn" id="btn-fit"><span>⛶</span> Fit Graph</button>
      <button class="ctrl-btn" id="btn-stabilize"><span>⚡</span> Stabilize</button>
      <button class="ctrl-btn" id="btn-reset"><span>↺</span> Reset Focus</button>
    </div>
  </div>

  <div id="sidebar">
    <div class="sidebar-header">
      <h2><span>🌐</span> Architecture Map</h2>
      <span class="badge-pill" id="total-badge">0</span>
    </div>

    <div id="search-wrap">
      <input id="search" type="text" placeholder="Search classes, widgets, functions..." autocomplete="off">
      <div id="search-results"></div>
    </div>

    <div id="info-panel">
      <div class="panel-section-title">
        <span>Node Inspector</span>
        <span id="selected-layer-pill"></span>
      </div>
      <div id="info-content">
        <div class="empty">Click on any node to view architecture details</div>
      </div>
      <div id="neighbors-section" style="display: none;">
        <div class="panel-section-title">Connected Neighbors</div>
        <div id="neighbors-list"></div>
      </div>
    </div>

    <div id="legend-wrap">
      <div class="panel-section-title">
        <span>Architecture Layers</span>
        <label><input type="checkbox" id="select-all-cb" checked> All</label>
      </div>
      <div class="legend-list" id="legend"></div>
    </div>

    <div id="stats">
      <span id="stats-nodes">0 nodes</span>
      <span id="stats-edges">0 connections</span>
    </div>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
