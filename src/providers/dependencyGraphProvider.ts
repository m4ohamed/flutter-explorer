/**
 * Dependency Graph Provider - Builds and serializes the import dependency graph
 */
import * as path from 'path';
import { IndexManager } from '../indexer/indexManager';

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    stats: { totalFiles: number; totalEdges: number; mostImported: string | null };
}

export interface GraphNode {
    id: string;
    label: string;
    group: string; // folder name or category for coloring/grouping
    file?: string;
    line?: number;
    layer?: string;
}

export interface GraphEdge {
    from: string;
    to: string;
    source: string;
    target: string;
    type: string; // 'imports', 'extends', 'with', 'calls', 'contains', 'mixes_in', 'implements'
}

export class DependencyGraphProvider {
    constructor(private indexManager: IndexManager) { }

    /** Get full dependency graph data for webview */
    getGraphData(): GraphData {
        const detailed = this.indexManager.getDetailedGraph();

        // 1. Map and normalize nodes
        const nodes: GraphNode[] = (detailed.nodes || []).map((n: any) => {
            let cleanFile = n.file || '';
            if (!cleanFile && typeof n.id === 'string' && n.id.startsWith('file:')) {
                cleanFile = n.id.substring('file:'.length);
            }

            // Group by directory folder for file nodes, or type for symbol nodes
            let group = n.type || 'unknown';
            if (n.type === 'file' && cleanFile) {
                const dir = path.dirname(cleanFile).replace(/\\/g, '/');
                group = dir === '.' ? 'root' : dir;
            }

            return {
                id: n.id,
                label: n.name || n.label || n.id,
                group,
                file: cleanFile || undefined,
                line: n.line,
                layer: n.layer,
            };
        });

        // 2. Map and normalize edges (ensuring both source/target and from/to exist)
        const edges: GraphEdge[] = (detailed.edges || []).map((e: any) => {
            const src = e.source || e.from || '';
            const tgt = e.target || e.to || '';
            return {
                from: src,
                to: tgt,
                source: src,
                target: tgt,
                type: e.type || 'imports',
            };
        });

        // 3. Dynamically calculate most imported file from 'imports' edges
        const importCounts = new Map<string, number>();
        for (const edge of edges) {
            if (edge.type === 'imports') {
                const targetId = edge.target;
                importCounts.set(targetId, (importCounts.get(targetId) || 0) + 1);
            }
        }

        let mostImported: string | null = null;
        let maxImports = 0;
        for (const [id, count] of importCounts.entries()) {
            if (count > maxImports) {
                maxImports = count;
                mostImported = id.replace(/^file:/, '');
            }
        }

        const totalFiles = nodes.filter(n => n.id.startsWith('file:') || n.file).length;

        return {
            nodes,
            edges,
            stats: {
                totalFiles: totalFiles > 0 ? totalFiles : nodes.length,
                totalEdges: edges.length,
                mostImported,
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
            const safeLabel = (node.label || node.id).replace(/[[\]()"]/g, '');
            mermaid += `  ${id}["${safeLabel}"]\n`;
        }
        for (const edge of graph.edges) {
            const fromId = idMap.get(edge.from) || idMap.get(edge.source);
            const toId = idMap.get(edge.to) || idMap.get(edge.target);
            if (fromId && toId) {
                // Label the edge with the relationship type
                mermaid += `  ${fromId} -- "${edge.type}" --> ${toId}\n`;
            }
        }
        return mermaid;
    }
}