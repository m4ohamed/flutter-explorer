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

type NodeKind = "File" | "Class" | "Function" | "Widget" | "Enum" | "Mixin";

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
};

const NODE_RADIUS: Record<NodeKind, number> = {
  File: 15,
  Class: 10,
  Function: 7,
  Widget: 12,
  Enum: 8,
  Mixin: 8,
};

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

const vscodeApi = acquireVsCodeApi();

let allNodes: SimNode[] = [];
let allEdges: SimLink[] = [];
let simulation: d3.Simulation<SimNode, SimLink> | null = null;
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let container: d3.Selection<SVGGElement, unknown, null, undefined>;
let linkGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
let nodeGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
let labelGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;

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

  container = svg.append("g").attr("class", "graph-container");
  linkGroup = container.append("g").attr("class", "links");
  nodeGroup = container.append("g").attr("class", "nodes");
  labelGroup = container.append("g").attr("class", "labels");

  zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 8])
    .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, any>) => {
      container.attr("transform", event.transform.toString());
    });

  svg.call(zoomBehavior);

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

function setData(nodes: GraphNode[], edges: GraphEdge[]): void {
  allNodes = nodes.map(n => ({ ...n } as SimNode));
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  allEdges = [];
  for (const e of edges) {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (src && tgt) {
      allEdges.push({
        source: src,
        target: tgt,
        kind: e.kind
      } as SimLink);
    }
  }

  buildGraph();
}

function buildGraph(): void {
  if (simulation) simulation.stop();

  const width = window.innerWidth;
  const height = window.innerHeight;

  const links = linkGroup.selectAll<SVGLineElement, SimLink>("line")
    .data(allEdges)
    .join("line")
    .attr("stroke", "#999")
    .attr("stroke-opacity", 0.6)
    .attr("stroke-width", 1);

  const nodes = nodeGroup.selectAll<SVGCircleElement, SimNode>("circle")
    .data(allNodes)
    .join("circle")
    .attr("r", (d: SimNode) => NODE_RADIUS[d.kind] || 8)
    .attr("fill", (d: SimNode) => NODE_COLOR[d.kind] || "#ccc")
    .attr("cursor", "pointer")
    .on("click", (_event, d: SimNode) => {
      vscodeApi.postMessage({
        command: "nodeClicked",
        filePath: d.filePath,
        line: d.line || 1
      });
    })
    .call(d3.drag<SVGCircleElement, SimNode>()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended));

  const labels = labelGroup.selectAll<SVGTextElement, SimNode>("text")
    .data(allNodes)
    .join("text")
    .text((d: SimNode) => d.name)
    .attr("font-size", "10px")
    .attr("dx", 12)
    .attr("dy", 4)
    .attr("fill", "var(--vscode-editor-foreground, #ccc)")
    .attr("pointer-events", "none");

  simulation = d3.forceSimulation<SimNode>(allNodes)
    .force("link", d3.forceLink<SimNode, SimLink>(allEdges).id((d: any) => d.id).distance(100))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .on("tick", () => {
      links
        .attr("x1", (d: SimLink) => d.source.x!)
        .attr("y1", (d: SimLink) => d.source.y!)
        .attr("x2", (d: SimLink) => d.target.x!)
        .attr("y2", (d: SimLink) => d.target.y!);

      nodes
        .attr("cx", (d: SimNode) => d.x!)
        .attr("cy", (d: SimNode) => d.y!);

      labels
        .attr("x", (d: SimNode) => d.x!)
        .attr("y", (d: SimNode) => d.y!);
    });
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

function updateTheme(theme: string) {
  document.body.className = theme;
}

window.addEventListener("DOMContentLoaded", init);
