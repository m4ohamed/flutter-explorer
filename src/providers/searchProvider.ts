/**
 * Search Provider - Handles search queries across the index
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { IndexManager, SearchResult } from '../indexer/indexManager';
export class SearchProvider {
    constructor(private indexManager: IndexManager, private workspaceRoot: string) { }
    search(query: string, filter?: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation' | 'call' | 'extension' | 'typedef' | 'variable' | 'constructor' | 'property' | 'annotation'): SearchResult[] {
        if ((!query || query.trim().length === 0) && !filter) { return []; }
        return this.indexManager.search(query.trim(), filter);
    }
    async openResult(result: SearchResult): Promise<void> {
        const absPath = path.join(this.workspaceRoot, result.file);
        const uri = vscode.Uri.file(absPath);
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            const position = new vscode.Position(Math.max(0, result.line - 1), 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        } catch {
            vscode.window.showErrorMessage(`Could not open file: ${result.file}`);
        }
    }
    /** Get serializable results for webview */
    getSearchResultsForWebview(query: string, filter?: string): WebviewSearchResult[] {
        const validFilter = filter as any;
        const results = this.search(query, validFilter);
        return results.map(r => ({
            name: r.name,
            type: r.type,
            subType: r.subType,
            file: r.file,
            fileName: path.basename(r.file),
            line: r.line,
            isPrivate: r.isPrivate,
            icon: this.getIcon(r.type),
        }));
    }
    private getIcon(type: string): string {
        switch (type) {
            case 'class': return '🔷';
            case 'function': return '⚡';
            case 'widget': return '🧩';
            case 'enum': return '📋';
            case 'mixin': return '🔗';
            case 'translation': return '🌐';
            case 'call': return '📞';
            case 'extension': return '🧬';
            case 'typedef': return '🏷️';
            case 'variable': return '💎';
            case 'constructor': return '🛠️';
            case 'property': return '🔑';
            case 'annotation': return '🏷️';
            default: return '📄';
        }
    }
}
export interface WebviewSearchResult {
    name: string;
    type: string;
    subType: string;
    file: string;
    fileName: string;
    line: number;
    isPrivate: boolean;
    icon: string;
}