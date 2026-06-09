/// <reference lib="dom" />
import * as d3 from "d3";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeKind = "File" | "Class" | "Function" | "Widget" | "Enum" | "Mixin" | "Method" | "Extension" | "Typedef" | "Variable" | "Constructor";

interface GraphNode {
  id: string;
  name: string;
  kind: NodeKind;
  filePath: string;
  line?: number;
  group?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

interface SimNode extends d3.SimulationNodeDatum, GraphNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
  kind: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_COLOR: Record<NodeKind, string> = {
  File: "#58a6ff",
  Class: "#f0883e",
  Function: "#3fb950",
  Widget: "#d2a8ff",
  Enum: "#f9e2af",
  Mixin: "#f38ba8",
  Method: "#888888",
  Extension: "#a371f7",
  Typedef: "#56b6c2",
  Variable: "#e5c07b",
  Constructor: "#da70d6",
};

const NODE_RADIUS: Record<NodeKind, number> = {
  File: 14,
  Class: 10,
  Function: 7,
  Widget: 12,
  Enum: 8,
  Mixin: 8,
  Method: 6,
  Extension: 10,
  Typedef: 7,
  Variable: 6,
  Constructor: 6,
};

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

const vscodeApi = acquireVsCodeApi();

let rawNodes: GraphNode[] = [];
let rawEdges: GraphEdge[] = [];

let filteredNodes: SimNode[] = [];
let filteredEdges: SimLink[] = [];

let simulation: d3.Simulation<SimNode, SimLink> | null = null;
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let container: d3.Selection<SVGGElement, unknown, null, undefined>;
let linkGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
let nodeGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
let labelGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;

let selectedNode: SimNode | null = null;
let hoveredNode: SimNode | null = null;
let searchPattern: string = "";

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init(): void {
  const graphEl = document.getElementById("graph-area")!;
  const width = window.innerWidth;
  const height = window.innerHeight;

  svg = d3.select(graphEl as any)
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${width} ${height}`);

  // Setup markers/arrows defs
  const defs = svg.append("defs");
  const relations = [
    "imports", "extends", "with", "mixes_in", "implements", "calls", "contains", "uses_class", "uses_variable", "default"
  ];
  relations.forEach(rel => {
    defs.append("marker")
      .attr("id", `arrow-${rel}`)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", getRelationColor(rel));
  });

  container = svg.append("g").attr("class", "graph-container");
  linkGroup = container.append("g").attr("class", "links");
  nodeGroup = container.append("g").attr("class", "nodes");
  labelGroup = container.append("g").attr("class", "labels");

  zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.05, 10])
    .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, any>) => {
      container.attr("transform", event.transform.toString());
    });

  svg.call(zoomBehavior);

  // Setup UI control listeners
  setupControlListeners();

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.command) {
      case "setData":
        setData(message.nodes, message.edges);
        break;
      case "setTheme":
        updateTheme(message.theme);
        break;
    }
  });

  vscodeApi.postMessage({ command: "ready" });
}

function getRelationColor(rel: string): string {
  switch (rel.toLowerCase()) {
    case "imports": return "#58a6ff";
    case "extends": return "#f0883e";
    case "with":
    case "mixes_in": return "#f38ba8";
    case "implements": return "#e2b714";
    case "uses_class": return "#a371f7";
    case "uses_variable": return "#ff79c6";
    case "calls": return "#3fb950";
    case "contains": return "rgba(120, 120, 120, 0.3)";
    default: return "#888888";
  }
}

function setupControlListeners(): void {
  // Checkboxes for filtering
  const checkboxes = [
    "filter-file", "filter-class", "filter-widget", "filter-mixin", "filter-enum", "filter-function", "filter-method",
    "filter-extension", "filter-typedef", "filter-variable", "filter-constructor",
    "rel-imports", "rel-extends", "rel-mixes_in", "rel-implements", "rel-calls", "rel-contains", "rel-uses_class", "rel-uses_variable"
  ];
  checkboxes.forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      applyFilters();
    });
  });

  // Search box listener
  const searchInput = document.getElementById("node-search") as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchPattern = searchInput.value.trim();
      applyFilters();
    });
  }

  // Zoom controls
  document.getElementById("zoom-in")?.addEventListener("click", () => {
    svg.transition().duration(300).call(zoomBehavior.scaleBy as any, 1.3);
  });
  document.getElementById("zoom-out")?.addEventListener("click", () => {
    svg.transition().duration(300).call(zoomBehavior.scaleBy as any, 1 / 1.3);
  });
  document.getElementById("zoom-fit")?.addEventListener("click", () => {
    zoomFit();
  });

  // Open file button in inspector
  document.getElementById("inspect-open-btn")?.addEventListener("click", () => {
    if (selectedNode) {
      vscodeApi.postMessage({
        command: "nodeClicked",
        filePath: selectedNode.filePath,
        line: selectedNode.line || 1
      });
    }
  });
}

function getFilters() {
  return {
    kinds: {
      File: (document.getElementById("filter-file") as HTMLInputElement)?.checked ?? true,
      Class: (document.getElementById("filter-class") as HTMLInputElement)?.checked ?? true,
      Widget: (document.getElementById("filter-widget") as HTMLInputElement)?.checked ?? true,
      Mixin: (document.getElementById("filter-mixin") as HTMLInputElement)?.checked ?? true,
      Enum: (document.getElementById("filter-enum") as HTMLInputElement)?.checked ?? true,
      Function: (document.getElementById("filter-function") as HTMLInputElement)?.checked ?? true,
      Method: (document.getElementById("filter-method") as HTMLInputElement)?.checked ?? true,
      Extension: (document.getElementById("filter-extension") as HTMLInputElement)?.checked ?? true,
      Typedef: (document.getElementById("filter-typedef") as HTMLInputElement)?.checked ?? true,
      Variable: (document.getElementById("filter-variable") as HTMLInputElement)?.checked ?? true,
      Constructor: (document.getElementById("filter-constructor") as HTMLInputElement)?.checked ?? true,
    },
    edges: {
      imports: (document.getElementById("rel-imports") as HTMLInputElement)?.checked ?? true,
      extends: (document.getElementById("rel-extends") as HTMLInputElement)?.checked ?? true,
      with: (document.getElementById("rel-mixes_in") as HTMLInputElement)?.checked ?? true,
      mixes_in: (document.getElementById("rel-mixes_in") as HTMLInputElement)?.checked ?? true,
      implements: (document.getElementById("rel-implements") as HTMLInputElement)?.checked ?? true,
      calls: (document.getElementById("rel-calls") as HTMLInputElement)?.checked ?? true,
      contains: (document.getElementById("rel-contains") as HTMLInputElement)?.checked ?? true,
      uses_class: (document.getElementById("rel-uses_class") as HTMLInputElement)?.checked ?? true,
      uses_variable: (document.getElementById("rel-uses_variable") as HTMLInputElement)?.checked ?? true,
    }
  };
}

function setData(nodes: GraphNode[], edges: GraphEdge[]): void {
  rawNodes = nodes;
  rawEdges = edges;
  applyFilters();
}

function applyFilters(): void {
  const filters = getFilters();
  
  const nodeMap = new Map<string, SimNode>();
  const nodesToUse: SimNode[] = [];
  
  // Persist existing layout positions to prevent layout resetting completely
  const existingNodePos = new Map<string, {x: number, y: number, fx: number|null, fy: number|null}>();
  filteredNodes.forEach(n => {
    if (n.x !== undefined && n.y !== undefined) {
      existingNodePos.set(n.id, { x: n.x, y: n.y, fx: n.fx || null, fy: n.fy || null });
    }
  });

  rawNodes.forEach(node => {
    const isKindAllowed = filters.kinds[node.kind];
    
    const isSearchMatch = searchPattern === "" || 
                          node.name.toLowerCase().includes(searchPattern.toLowerCase());

    if (isKindAllowed && isSearchMatch) {
      const simNode = { ...node } as SimNode;
      const pos = existingNodePos.get(node.id);
      if (pos) {
        simNode.x = pos.x;
        simNode.y = pos.y;
        simNode.fx = pos.fx;
        simNode.fy = pos.fy;
      }
      nodesToUse.push(simNode);
      nodeMap.set(node.id, simNode);
    }
  });

  filteredNodes = nodesToUse;

  // Build parentMap from contains relationships to support bubbling up dependencies when detailed nodes are hidden
  const parentMap = new Map<string, string>();
  rawEdges.forEach(edge => {
    if (edge.kind.toLowerCase() === "contains") {
      parentMap.set(edge.target, edge.source);
    }
  });

  // Helper to find the nearest visible ancestor of a node (including itself)
  function getVisibleAncestor(nodeId: string): SimNode | null {
    let currentId = nodeId;
    while (currentId) {
      const node = nodeMap.get(currentId);
      if (node) return node;
      currentId = parentMap.get(currentId) || "";
    }
    return null;
  }

  filteredEdges = [];
  const seenEdges = new Set<string>();

  rawEdges.forEach(edge => {
    const relType = edge.kind.toLowerCase();

    // Contains relations represent physical nesting and should only be drawn if both parent and child are directly visible
    if (relType === "contains") {
      const isRelAllowed = (filters.edges as any)[relType] ?? true;
      if (isRelAllowed) {
        const src = nodeMap.get(edge.source);
        const tgt = nodeMap.get(edge.target);
        if (src && tgt) {
          filteredEdges.push({
            source: src,
            target: tgt,
            kind: edge.kind
          } as SimLink);
        }
      }
      return;
    }

    // Other relations (calls, extends, with, imports) bubble up to the nearest visible ancestor
    const src = getVisibleAncestor(edge.source);
    const tgt = getVisibleAncestor(edge.target);
    if (src && tgt && src.id !== tgt.id) {
      const isRelAllowed = (filters.edges as any)[relType] ?? true;
      if (isRelAllowed) {
        const edgeKey = `${src.id}->${tgt.id}:${edge.kind}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          filteredEdges.push({
            source: src,
            target: tgt,
            kind: edge.kind
          } as SimLink);
        }
      }
    }
  });

  // Update statistics
  const statsEl = document.getElementById("graph-stats");
  if (statsEl) {
    statsEl.textContent = `${filteredNodes.length} nodes · ${filteredEdges.length} links`;
  }

  // Update inspector if selectedNode was filtered out
  if (selectedNode && !nodeMap.has(selectedNode.id)) {
    selectedNode = null;
    document.getElementById("inspector")!.style.display = "none";
  }

  buildGraph();
}

function buildGraph(): void {
  if (simulation) simulation.stop();

  const width = window.innerWidth;
  const height = window.innerHeight;

  const links = linkGroup.selectAll<SVGLineElement, SimLink>("line")
    .data(filteredEdges)
    .join("line")
    .attr("stroke", (d: SimLink) => getRelationColor(d.kind))
    .attr("stroke-opacity", 0.5)
    .attr("stroke-width", 1)
    .attr("marker-end", (d: SimLink) => `url(#arrow-${d.kind.toLowerCase()})`);

  const nodes = nodeGroup.selectAll<SVGCircleElement, SimNode>("circle")
    .data(filteredNodes, (d: any) => d.id)
    .join("circle")
    .attr("r", (d: SimNode) => NODE_RADIUS[d.kind] || 8)
    .attr("fill", (d: SimNode) => NODE_COLOR[d.kind] || "#ccc")
    .attr("cursor", "pointer")
    .on("click", (event, d: SimNode) => {
      event.stopPropagation();
      focusOnNode(d);
    })
    .on("mouseover", (event, d: SimNode) => {
      hoveredNode = d;
      if (!selectedNode) {
        highlightNode(d);
      }
    })
    .on("mouseout", () => {
      hoveredNode = null;
      if (!selectedNode) {
        highlightNode(null);
      }
    })
    .call(d3.drag<SVGCircleElement, SimNode>()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended));

  const labels = labelGroup.selectAll<SVGTextElement, SimNode>("text")
    .data(filteredNodes, (d: any) => d.id)
    .join("text")
    .text((d: SimNode) => d.name)
    .attr("font-size", "10px")
    .attr("font-weight", "500")
    .attr("dx", (d: SimNode) => (NODE_RADIUS[d.kind] || 8) + 4)
    .attr("dy", 4)
    .attr("fill", "var(--vscode-editor-foreground, #ccc)")
    .attr("pointer-events", "none");

  // Clicking SVG resets selection
  svg.on("click", () => {
    selectedNode = null;
    document.getElementById("inspector")!.style.display = "none";
    highlightNode(null);
  });

  simulation = d3.forceSimulation<SimNode>(filteredNodes)
    .force("link", d3.forceLink<SimNode, SimLink>(filteredEdges).id((d: any) => d.id).distance(d => {
      if (d.kind === "contains") return 40;
      return 100;
    }))
    .force("charge", d3.forceManyBody().strength(-150))
    .force("collide", d3.forceCollide<SimNode>().radius(d => (NODE_RADIUS[d.kind] || 8) + 20).iterations(2))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .on("tick", () => {
      links
        .attr("x1", (d: SimLink) => d.source.x!)
        .attr("y1", (d: SimLink) => d.source.y!)
        .attr("x2", (d: SimLink) => {
          const targetRadius = NODE_RADIUS[d.target.kind] || 8;
          const dx = d.target.x! - d.source.x!;
          const dy = d.target.y! - d.source.y!;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) return d.target.x!;
          // Stop line at node radius boundary
          return d.target.x! - (dx / dist) * (targetRadius + 6);
        })
        .attr("y2", (d: SimLink) => {
          const targetRadius = NODE_RADIUS[d.target.kind] || 8;
          const dx = d.target.x! - d.source.x!;
          const dy = d.target.y! - d.source.y!;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) return d.target.y!;
          return d.target.y! - (dy / dist) * (targetRadius + 6);
        });

      nodes
        .attr("cx", (d: SimNode) => d.x!)
        .attr("cy", (d: SimNode) => d.y!);

      labels
        .attr("x", (d: SimNode) => d.x!)
        .attr("y", (d: SimNode) => d.y!);
    });

  // Keep highlighted state if we have a selected node
  if (selectedNode) {
    highlightNode(selectedNode);
  }
}

function dragstarted(event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) {
  if (!event.active) simulation?.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragended(event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d: SimNode) {
  if (!event.active) simulation?.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

function highlightNode(node: SimNode | null): void {
  if (!node) {
    nodeGroup.selectAll("circle").attr("stroke", null).attr("stroke-width", null).style("opacity", 1);
    linkGroup.selectAll("line").style("opacity", 0.5).attr("stroke-width", 1);
    labelGroup.selectAll("text").style("opacity", 1);
    return;
  }

  const connectedIds = new Set<string>([node.id]);
  filteredEdges.forEach(e => {
    if (e.source.id === node.id) connectedIds.add(e.target.id);
    if (e.target.id === node.id) connectedIds.add(e.source.id);
  });

  nodeGroup.selectAll<SVGCircleElement, SimNode>("circle")
    .style("opacity", d => connectedIds.has(d.id) ? 1 : 0.15)
    .attr("stroke", d => d.id === node.id ? "#ffffff" : null)
    .attr("stroke-width", d => d.id === node.id ? 2 : null);
    
  linkGroup.selectAll<SVGLineElement, SimLink>("line")
    .style("opacity", e => (e.source.id === node.id || e.target.id === node.id) ? 1 : 0.05)
    .attr("stroke-width", e => (e.source.id === node.id || e.target.id === node.id) ? 1.8 : 1);
    
  labelGroup.selectAll<SVGTextElement, SimNode>("text")
    .style("opacity", d => connectedIds.has(d.id) ? 1 : 0.15);
}

function showInspector(node: SimNode): void {
  selectedNode = node;
  const card = document.getElementById("inspector")!;
  card.style.display = "flex";
  
  const nameEl = document.getElementById("inspect-name")!;
  const typeEl = document.getElementById("inspect-type")!;
  const pathEl = document.getElementById("inspect-path")!;
  const incomingEl = document.getElementById("inspect-incoming")!;
  const outgoingEl = document.getElementById("inspect-outgoing")!;
  
  nameEl.textContent = node.name;
  typeEl.textContent = node.kind.toUpperCase();
  typeEl.style.backgroundColor = NODE_COLOR[node.kind] || "#999";
  
  pathEl.textContent = `${node.filePath}:${node.line || 1}`;
  
  // Find incoming and outgoing links
  const incoming: { node: SimNode; rel: string }[] = [];
  const outgoing: { node: SimNode; rel: string }[] = [];
  
  filteredEdges.forEach(e => {
    const srcNode = e.source;
    const tgtNode = e.target;
    if (srcNode.id === node.id) {
      outgoing.push({ node: tgtNode, rel: e.kind });
    }
    if (tgtNode.id === node.id) {
      incoming.push({ node: srcNode, rel: e.kind });
    }
  });
  
  // Render incoming list
  if (incoming.length === 0) {
    incomingEl.innerHTML = `<div style="font-size:11px;opacity:0.5;padding:4px 0;">No incoming links</div>`;
  } else {
    incomingEl.innerHTML = incoming.map(inc => {
      return `<div class="inspector-link-item" data-id="${inc.node.id}">
        <span style="font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">${escapeHtml(inc.node.name)}</span>
        <span class="link-rel-type" style="color: ${getRelationColor(inc.rel)};">${inc.rel}</span>
      </div>`;
    }).join("");
  }
  
  // Render outgoing list
  if (outgoing.length === 0) {
    outgoingEl.innerHTML = `<div style="font-size:11px;opacity:0.5;padding:4px 0;">No outgoing links</div>`;
  } else {
    outgoingEl.innerHTML = outgoing.map(out => {
      return `<div class="inspector-link-item" data-id="${out.node.id}">
        <span style="font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">${escapeHtml(out.node.name)}</span>
        <span class="link-rel-type" style="color: ${getRelationColor(out.rel)};">${out.rel}</span>
      </div>`;
    }).join("");
  }
  
  // Register click handlers for connected items in inspector
  card.querySelectorAll(".inspector-link-item").forEach(item => {
    item.addEventListener("click", () => {
      const targetId = item.getAttribute("data-id");
      const targetNode = filteredNodes.find(n => n.id === targetId);
      if (targetNode) {
        focusOnNode(targetNode);
      }
    });
  });
}

function focusOnNode(node: SimNode): void {
  showInspector(node);
  highlightNode(node);
  
  // Pan and Zoom to node position
  const width = window.innerWidth;
  const height = window.innerHeight;
  const currentTransform = d3.zoomTransform(svg.node()!);
  const scale = Math.max(currentTransform.k, 1.4);
  
  svg.transition().duration(750).call(
    zoomBehavior.transform as any,
    d3.zoomIdentity.translate(width / 2 - scale * node.x!, height / 2 - scale * node.y!).scale(scale)
  );
}

function zoomFit(): void {
  if (filteredNodes.length === 0) return;
  
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  filteredNodes.forEach(d => {
    const r = NODE_RADIUS[d.kind] || 8;
    if (d.x! - r < minX) minX = d.x! - r;
    if (d.x! + r > maxX) maxX = d.x! + r;
    if (d.y! - r < minY) minY = d.y! - r;
    if (d.y! + r > maxY) maxY = d.y! + r;
  });
  
  const dx = maxX - minX;
  const dy = maxY - minY;
  const x = (minX + maxX) / 2;
  const y = (minY + maxY) / 2;
  
  const scale = Math.max(0.1, Math.min(3, 0.8 / Math.max(dx / width, dy / height)));
  
  svg.transition().duration(750).call(
    zoomBehavior.transform as any,
    d3.zoomIdentity.translate(width / 2 - scale * x, height / 2 - scale * y).scale(scale)
  );
}

function updateTheme(theme: string) {
  document.body.className = theme;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

window.addEventListener("DOMContentLoaded", init);
