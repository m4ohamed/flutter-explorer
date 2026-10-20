/// <reference lib="dom" />
import { Network, Options } from "vis-network";
import { DataSet } from "vis-data";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();

interface RawNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  line: number;
  layer: string;
  inDegree: number;
  outDegree: number;
  degree: number;
  inNeighbors: string[];
  outNeighbors: string[];
}

interface RawEdge {
  source: string;
  target: string;
  kind: string;
}

interface LayerCount {
  name: string;
  count: number;
}

const LAYER_PALETTE: Record<string, { background: string; border: string; highlight: { background: string; border: string } }> = {
  Presentation: { background: "#4E79A7", border: "#2E4763", highlight: { background: "#729ECE", border: "#4E79A7" } },
  Domain: { background: "#F28E2B", border: "#A85B10", highlight: { background: "#FFBE7D", border: "#F28E2B" } },
  Data: { background: "#59A14F", border: "#35682D", highlight: { background: "#8CD17D", border: "#59A14F" } },
  Core: { background: "#E15759", border: "#9A3234", highlight: { background: "#FF9D9A", border: "#E15759" } },
  Utils: { background: "#76B7B2", border: "#497A76", highlight: { background: "#A0D5D1", border: "#76B7B2" } },
};

const DEFAULT_LAYER_COLOR = { background: "#BAB0AC", border: "#7E7672", highlight: { background: "#D3CECB", border: "#BAB0AC" } };

let network: Network | null = null;
let nodesDataSet: DataSet<any> | null = null;
let edgesDataSet: DataSet<any> | null = null;

let allNodes: Map<string, RawNode> = new Map();
let allEdges: RawEdge[] = [];
let enabledLayers: Set<string> = new Set();
let selectedNodeId: string | null = null;

// Initialize Webview
window.addEventListener("DOMContentLoaded", () => {
  setupUIEventListeners();
  vscodeApi.postMessage({ command: "ready" });
});

// Handle incoming messages from VS Code
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.command) {
    case "setData":
      loadGraphData(msg.nodes || [], msg.edges || [], msg.layers || []);
      break;
  }
});

function setupUIEventListeners(): void {
  // Search input
  const searchInput = document.getElementById("search") as HTMLInputElement;
  const searchResults = document.getElementById("search-results") as HTMLDivElement;

  if (searchInput && searchResults) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        searchResults.style.display = "none";
        searchResults.innerHTML = "";
        return;
      }

      const matches: RawNode[] = [];
      for (const node of allNodes.values()) {
        if (!enabledLayers.has(node.layer)) continue;
        if (node.name.toLowerCase().includes(q) || node.filePath.toLowerCase().includes(q)) {
          matches.push(node);
          if (matches.length >= 10) break;
        }
      }

      if (matches.length === 0) {
        searchResults.innerHTML = `<div style="padding: 8px 12px; color: var(--text-muted); font-size: 11px;">No matching symbols found</div>`;
        searchResults.style.display = "block";
        return;
      }

      searchResults.innerHTML = matches
        .map(
          (m) => `
        <div class="search-item" data-id="${m.id}">
          <span class="sym-name">${escapeHtml(m.name)}</span>
          <span class="sym-kind">${escapeHtml(m.kind)}</span>
        </div>
      `
        )
        .join("");
      searchResults.style.display = "block";

      searchResults.querySelectorAll(".search-item").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.getAttribute("data-id");
          if (id) {
            selectAndFocusNode(id);
            searchResults.style.display = "none";
            searchInput.value = "";
          }
        });
      });
    });

    document.addEventListener("click", (e) => {
      if (!searchInput.contains(e.target as Node) && !searchResults.contains(e.target as Node)) {
        searchResults.style.display = "none";
      }
    });
  }

  // Canvas buttons
  document.getElementById("btn-fit")?.addEventListener("click", () => {
    network?.fit({ animation: { duration: 600, easingFunction: "easeInOutQuad" } });
  });

  document.getElementById("btn-stabilize")?.addEventListener("click", () => {
    network?.stabilize(100);
  });

  document.getElementById("btn-reset")?.addEventListener("click", () => {
    clearSelection();
    network?.fit({ animation: { duration: 500, easingFunction: "easeInOutQuad" } });
  });

  // Select all checkbox
  const selectAllCb = document.getElementById("select-all-cb") as HTMLInputElement;
  if (selectAllCb) {
    selectAllCb.addEventListener("change", () => {
      const checked = selectAllCb.checked;
      document.querySelectorAll<HTMLInputElement>(".layer-cb").forEach((cb) => {
        cb.checked = checked;
        const layer = cb.getAttribute("data-layer");
        if (layer) {
          if (checked) enabledLayers.add(layer);
          else enabledLayers.delete(layer);
        }
      });
      refreshGraphFiltering();
    });
  }
}

function loadGraphData(nodes: RawNode[], edges: RawEdge[], layers: LayerCount[]): void {
  allNodes.clear();
  nodes.forEach((n) => allNodes.set(n.id, n));
  allEdges = edges;

  // Initialize enabled layers
  enabledLayers = new Set(layers.map((l) => l.name));

  // Render Legend
  renderLegend(layers);

  // Update Stats
  const totalBadge = document.getElementById("total-badge");
  const statsNodes = document.getElementById("stats-nodes");
  const statsEdges = document.getElementById("stats-edges");
  if (totalBadge) totalBadge.textContent = `${nodes.length}`;
  if (statsNodes) statsNodes.textContent = `${nodes.length} symbols`;
  if (statsEdges) statsEdges.textContent = `${edges.length} connections`;

  // Prepare Vis Data
  const visNodes = nodes.map((n) => createVisNode(n));
  const visEdges = edges.map((e, idx) => ({
    id: `e_${idx}`,
    from: e.source,
    to: e.target,
    title: e.kind,
    arrows: { to: { enabled: true, scaleFactor: 0.5 } },
    color: { color: "rgba(120, 135, 160, 0.28)", highlight: "#4E79A7", opacity: 0.8 },
  }));

  nodesDataSet = new DataSet(visNodes);
  edgesDataSet = new DataSet(visEdges);

  const container = document.getElementById("network");
  if (!container) return;

  const options: Options = {
    nodes: {
      shape: "dot",
      scaling: { min: 10, max: 36 },
      shadow: { enabled: true, color: "rgba(0,0,0,0.45)", size: 7, x: 2, y: 2 },
    },
    edges: {
      width: 1.2,
      smooth: { enabled: true, type: "continuous", roundness: 0.2 },
    },
    physics: {
      solver: "forceAtlas2Based",
      forceAtlas2Based: {
        gravitationalConstant: -45,
        centralGravity: 0.009,
        springLength: 95,
        springConstant: 0.05,
        damping: 0.45,
      },
      stabilization: { iterations: 140, updateInterval: 25 },
    },
    interaction: {
      hover: true,
      tooltipDelay: 150,
      zoomView: true,
      dragView: true,
      hideEdgesOnDrag: false,
    },
  };

  if (network) {
    network.destroy();
  }

  network = new Network(container, { nodes: nodesDataSet, edges: edgesDataSet }, options);

  // Network Events
  network.on("selectNode", (params) => {
    if (params.nodes && params.nodes.length > 0) {
      const id = String(params.nodes[0]);
      highlightNodeNeighborhood(id);
    }
  });

  network.on("deselectNode", () => {
    clearSelection();
  });

  network.on("doubleClick", (params) => {
    if (params.nodes && params.nodes.length > 0) {
      const node = allNodes.get(String(params.nodes[0]));
      if (node) {
        vscodeApi.postMessage({
          command: "nodeClicked",
          filePath: node.filePath,
          line: node.line,
        });
      }
    }
  });
}

function createVisNode(n: RawNode) {
  const col = LAYER_PALETTE[n.layer] || DEFAULT_LAYER_COLOR;
  const radius = Math.min(35, Math.max(12, 10 + Math.sqrt(n.degree) * 3.5));

  return {
    id: n.id,
    label: n.name,
    title: `${n.name} (${n.kind})\n${n.filePath}:${n.line}\nConnections: ${n.degree}`,
    size: radius,
    color: {
      background: col.background,
      border: col.border,
      highlight: col.highlight,
    },
    font: {
      size: Math.min(14, Math.max(10, 9 + Math.sqrt(n.degree))),
      color: "#ffffff",
      face: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
      strokeWidth: 2,
      strokeColor: "#0f0f1a",
    },
  };
}

function renderLegend(layers: LayerCount[]): void {
  const legend = document.getElementById("legend");
  if (!legend) return;

  legend.innerHTML = layers
    .map((l) => {
      const col = LAYER_PALETTE[l.name] || DEFAULT_LAYER_COLOR;
      return `
      <div class="legend-item">
        <div class="legend-left">
          <input type="checkbox" class="layer-cb" data-layer="${escapeHtml(l.name)}" checked>
          <div class="legend-dot" style="background: ${col.background};"></div>
          <span>${escapeHtml(l.name)}</span>
        </div>
        <span class="legend-count">${l.count}</span>
      </div>
    `;
    })
    .join("");

  legend.querySelectorAll<HTMLInputElement>(".layer-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const layer = cb.getAttribute("data-layer");
      if (layer) {
        if (cb.checked) enabledLayers.add(layer);
        else enabledLayers.delete(layer);
        refreshGraphFiltering();
      }
    });
  });
}

function refreshGraphFiltering(): void {
  if (!nodesDataSet || !edgesDataSet) return;

  const updatedNodes: any[] = [];
  for (const n of allNodes.values()) {
    const isVisible = enabledLayers.has(n.layer);
    updatedNodes.push({
      id: n.id,
      hidden: !isVisible,
    });
  }
  nodesDataSet.update(updatedNodes);

  // Auto-hide orphan edges
  const updatedEdges: any[] = [];
  allEdges.forEach((e, idx) => {
    const s = allNodes.get(e.source);
    const t = allNodes.get(e.target);
    const hidden = !s || !t || !enabledLayers.has(s.layer) || !enabledLayers.has(t.layer);
    updatedEdges.push({
      id: `e_${idx}`,
      hidden,
    });
  });
  edgesDataSet.update(updatedEdges);
}

function highlightNodeNeighborhood(nodeId: string): void {
  selectedNodeId = nodeId;
  const node = allNodes.get(nodeId);
  if (!node || !nodesDataSet || !edgesDataSet) return;

  const neighborIds = new Set<string>([...node.inNeighbors, ...node.outNeighbors, nodeId]);

  // Dim unrelated nodes
  const nodeUpdates: any[] = [];
  for (const n of allNodes.values()) {
    if (!enabledLayers.has(n.layer)) continue;
    const isNeighbor = neighborIds.has(n.id);
    const col = LAYER_PALETTE[n.layer] || DEFAULT_LAYER_COLOR;

    nodeUpdates.push({
      id: n.id,
      opacity: isNeighbor ? 1.0 : 0.15,
      color: isNeighbor
        ? { background: col.background, border: col.border, highlight: col.highlight }
        : { background: "rgba(90, 90, 110, 0.2)", border: "rgba(90, 90, 110, 0.3)" },
    });
  }
  nodesDataSet.update(nodeUpdates);

  // Update edges
  const edgeUpdates: any[] = [];
  allEdges.forEach((e, idx) => {
    const isConnected = e.source === nodeId || e.target === nodeId;
    edgeUpdates.push({
      id: `e_${idx}`,
      color: isConnected
        ? { color: "#4E79A7", highlight: "#FFBE7D", opacity: 1.0 }
        : { color: "rgba(80, 80, 100, 0.08)", opacity: 0.1 },
      width: isConnected ? 2.5 : 0.8,
    });
  });
  edgesDataSet.update(edgeUpdates);

  // Populate Inspector Card
  populateInspector(node);
}

function clearSelection(): void {
  selectedNodeId = null;
  if (!nodesDataSet || !edgesDataSet) return;

  const nodeUpdates: any[] = [];
  for (const n of allNodes.values()) {
    if (!enabledLayers.has(n.layer)) continue;
    const col = LAYER_PALETTE[n.layer] || DEFAULT_LAYER_COLOR;
    nodeUpdates.push({
      id: n.id,
      opacity: 1.0,
      color: { background: col.background, border: col.border, highlight: col.highlight },
    });
  }
  nodesDataSet.update(nodeUpdates);

  const edgeUpdates: any[] = [];
  allEdges.forEach((e, idx) => {
    edgeUpdates.push({
      id: `e_${idx}`,
      color: { color: "rgba(120, 135, 160, 0.28)", opacity: 0.8 },
      width: 1.2,
    });
  });
  edgesDataSet.update(edgeUpdates);

  // Reset Info Panel
  const infoContent = document.getElementById("info-content");
  const neighborsSection = document.getElementById("neighbors-section");
  const layerPill = document.getElementById("selected-layer-pill");
  if (infoContent) infoContent.innerHTML = `<div class="empty">Click on any node to view architecture details</div>`;
  if (neighborsSection) neighborsSection.style.display = "none";
  if (layerPill) layerPill.innerHTML = "";
}

function selectAndFocusNode(nodeId: string): void {
  if (!network) return;
  network.selectNodes([nodeId]);
  network.focus(nodeId, {
    scale: 1.2,
    animation: { duration: 750, easingFunction: "easeInOutQuad" },
  });
  highlightNodeNeighborhood(nodeId);
}

function populateInspector(node: RawNode): void {
  const infoContent = document.getElementById("info-content");
  const neighborsSection = document.getElementById("neighbors-section");
  const neighborsList = document.getElementById("neighbors-list");
  const layerPill = document.getElementById("selected-layer-pill");

  const col = LAYER_PALETTE[node.layer] || DEFAULT_LAYER_COLOR;
  if (layerPill) {
    layerPill.innerHTML = `<span style="font-size: 10px; color: ${col.background}; font-weight: 600;">● ${escapeHtml(node.layer)}</span>`;
  }

  if (infoContent) {
    infoContent.innerHTML = `
      <div class="node-header">
        <div class="node-name">${escapeHtml(node.name)}</div>
        <div class="node-kind-badge">${escapeHtml(node.kind)}</div>
      </div>
      <div class="node-field"><b>File:</b> <span>${escapeHtml(node.filePath || "Unknown")}</span></div>
      <div class="node-field"><b>Line:</b> <span>${node.line}</span></div>
      <div class="node-field"><b>Connections:</b> <span>${node.degree} (In: ${node.inDegree}, Out: ${node.outDegree})</span></div>
      
      <button class="open-file-btn" id="btn-open-file">
        <span>↗</span> Open in VS Code Editor
      </button>
    `;

    document.getElementById("btn-open-file")?.addEventListener("click", () => {
      vscodeApi.postMessage({
        command: "nodeClicked",
        filePath: node.filePath,
        line: node.line,
      });
    });
  }

  // Populate Neighbors
  if (neighborsSection && neighborsList) {
    const allNeighborIds = [
      ...node.inNeighbors.map((id) => ({ id, dir: "← Caller" })),
      ...node.outNeighbors.map((id) => ({ id, dir: "→ Calls" })),
    ];

    if (allNeighborIds.length > 0) {
      neighborsSection.style.display = "block";
      neighborsList.innerHTML = allNeighborIds
        .map((item) => {
          const n = allNodes.get(item.id);
          const name = n ? n.name : item.id;
          const kind = n ? n.kind : "";
          return `
          <div class="neighbor-item" data-id="${item.id}">
            <div>
              <b>${escapeHtml(name)}</b> <span style="font-size: 10px; color: var(--text-muted);">(${escapeHtml(kind)})</span>
            </div>
            <span class="rel-direction">${item.dir}</span>
          </div>
        `;
        })
        .join("");

      neighborsList.querySelectorAll(".neighbor-item").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.getAttribute("data-id");
          if (id) selectAndFocusNode(id);
        });
      });
    } else {
      neighborsSection.style.display = "none";
    }
  }
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
