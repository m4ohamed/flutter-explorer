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
}
export class DependencyGraphProvider {
    constructor(private indexManager: IndexManager) { }
    /** Get full dependency graph data for webview */
    getGraphData(): GraphData {
        const depNodes = this.indexManager.getDependencyGraph();
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const seen = new Set<string>();
        for (const dep of depNodes) {
            if (!seen.has(dep.file)) {
                seen.add(dep.file);
                nodes.push({
                    id: dep.file,
                    label: this.getShortName(dep.file),
                    group: this.getGroup(dep.file),
                });
            }
            for (const imp of dep.imports) {
                edges.push({ from: dep.file, to: imp });
                if (!seen.has(imp)) {
                    seen.add(imp);
                    nodes.push({
                        id: imp,
                        label: this.getShortName(imp),
                        group: this.getGroup(imp),
                    });
                }
            }
        }
        // Find most imported file
        let mostImported: string | null = null;
        let maxImports = 0;
        for (const dep of depNodes) {
            if (dep.importedBy.length > maxImports) {
                maxImports = dep.importedBy.length;
                mostImported = dep.file;
            }
        }
        return {
            nodes,
            edges,
            stats: {
                totalFiles: nodes.length,
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
            const safeLabel = node.label.replace(/[[\]()]/g, '');
            mermaid += `  ${id}["${safeLabel}"]\n`;
        }
        for (const edge of graph.edges) {
            const fromId = idMap.get(edge.from);
            const toId = idMap.get(edge.to);
            if (fromId && toId) {
                mermaid += `  ${fromId} --> ${toId}\n`;
            }
        }
        return mermaid;
    }
    private getShortName(filePath: string): string {
        const parts = filePath.split('/');
        return parts[parts.length - 1] || filePath;
    }
    private getGroup(filePath: string): string {
        const parts = filePath.split('/');
        if (parts.length >= 2) { return parts[parts.length - 2]; }
        return 'root';
    }
}