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
      name: n.label,
      kind: n.type.charAt(0).toUpperCase() + n.type.slice(1),
      filePath: n.path,
      line: n.line || 1
    }));
    
    const edges = detailed.edges.map(e => ({
      source: e.from,
      target: e.to,
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
  <style>
    body {
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      overflow: hidden;
    }
    #graph-area {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="graph-area"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
