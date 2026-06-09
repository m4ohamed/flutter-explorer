/**
 * Dependency Graph Provider - Builds and serializes the import dependency graph
 */
import { IndexManager, DependencyNode } from '../indexer/indexManager';
export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    stats: { totalFiles: number; totalEdges: number; mostImported: string | null };
}
export interface GraphNode {
    id: string;
    label: string;
    group: string; // folder name for coloring
}
export interface GraphEdge {
    from: string;
    to: string;
    type: string; // 'imports', 'extends', 'with', 'calls', 'contains'
}
export class DependencyGraphProvider {
    constructor(private indexManager: IndexManager) { }
    /** Get full dependency graph data for webview */
    getGraphData(): GraphData {
        const detailed = this.indexManager.getDetailedGraph();
        const nodes: GraphNode[] = detailed.nodes.map(n => ({
            id: n.id,
            label: n.name || n.label || n.id,
            group: n.type, // Group by type (file, class, function, etc.)
        }));
        const edges: GraphEdge[] = detailed.edges;

        return {
            nodes,
            edges,
            stats: {
                totalFiles: nodes.filter(n => n.group === 'file').length,
                totalEdges: edges.length,
                mostImported: null, // Could be calculated but skipping for now
            },
        };
    }
    /** Generate Mermaid diagram string */
    getMermaidDiagram(): string {
        const graph = this.getGraphData();
        if (graph.nodes.length === 0) { return 'graph LR\n  empty[No dependencies found]'; }
        let mermaid = 'graph LR\n';
        const idMap = new Map<string, string>();
        let counter = 0;
        for (const node of graph.nodes) {
            const id = `n${counter++}`;
            idMap.set(node.id, id);
            const safeLabel = node.label.replace(/[[\]()]/g, '');
            mermaid += `  ${id}["${safeLabel}"]\n`;
        }
        for (const edge of graph.edges) {
            const fromId = idMap.get(edge.from);
            const toId = idMap.get(edge.to);
            if (fromId && toId) {
                // Label the edge with the relationship type
                mermaid += `  ${fromId} -- "${edge.type}" --> ${toId}\n`;
            }
        }
        return mermaid;
    }
}