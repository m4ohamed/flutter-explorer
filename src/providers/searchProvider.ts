/**
 * Search Provider - Handles search queries across the index
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { IndexManager, SearchResult } from '../indexer/indexManager';

export class SearchProvider {
    constructor(private indexManager: IndexManager, private workspaceRoot: string) { }

    search(
        query: string,
        filter?: 'class' | 'function' | 'widget' | 'enum' | 'mixin' | 'translation' | 'call' | 'extension' | 'typedef' | 'variable' | 'constructor' | 'property' | 'annotation' | 'file' | 'extensionType'
    ): SearchResult[] {
        if ((!query || query.trim().length === 0) && !filter) { return []; }
        const rawResults = this.indexManager.search(query.trim(), filter);
        return this.rankResults(rawResults, query.trim());
    }

    private rankResults(results: SearchResult[], query: string): SearchResult[] {
        if (!query) {
            return [...results].sort((a, b) => {
                const countA = a.usageCount || 0;
                const countB = b.usageCount || 0;
                if (countB !== countA) return countB - countA;
                return a.name.localeCompare(b.name);
            });
        }

        const q = query.toLowerCase();
        return [...results].sort((a, b) => {
            const nameA = a.name.toLowerCase();
            const nameB = b.name.toLowerCase();

            // 1. Exact match gets highest priority
            const exactA = nameA === q;
            const exactB = nameB === q;
            if (exactA && !exactB) return -1;
            if (!exactA && exactB) return 1;

            // 2. Starts with gets next priority
            const startsA = nameA.startsWith(q);
            const startsB = nameB.startsWith(q);
            if (startsA && !startsB) return -1;
            if (!startsA && startsB) return 1;

            // 3. Higher usage count gets next priority
            const countA = a.usageCount || 0;
            const countB = b.usageCount || 0;
            if (countB !== countA) return countB - countA;

            // 4. Shorter name is more concise/relevant
            if (a.name.length !== b.name.length) {
                return a.name.length - b.name.length;
            }

            // 5. Alphabetical fallback
            return a.name.localeCompare(b.name);
        });
    }

    async openResult(result: SearchResult): Promise<void> {
        const cleanFile = result.file.replace(/^file:\/\/?/, '').replace(/^file:/, '');
        const absPath = path.isAbsolute(cleanFile) ? cleanFile : path.join(this.workspaceRoot, cleanFile);
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
    getSearchResultsForWebview(query: string, filter?: string, maxResults: number = 150): WebviewSearchResult[] {
        const VALID_FILTERS = [
            'class', 'function', 'widget', 'enum', 'mixin', 'translation',
            'call', 'extension', 'typedef', 'variable', 'constructor', 'property',
            'annotation', 'file', 'extensionType'
        ] as const;
        const validFilter = VALID_FILTERS.includes(filter as any) ? (filter as typeof VALID_FILTERS[number]) : undefined;
        const results = this.search(query, validFilter);
        const limitedResults = results.slice(0, maxResults);

        return limitedResults.map(r => ({
            name: r.name,
            type: r.type,
            subType: r.subType,
            file: r.file,
            fileName: path.basename(r.file),
            line: r.line,
            isPrivate: r.isPrivate,
            icon: this.getIcon(r.type),
            relativePath: r.file.replace(/\\/g, '/'),
            usageCount: r.usageCount,
        }));
    }

    private getIcon(type: string): string {
        switch (type) {
            case 'class': return '🔷';
            case 'function': return '⚡';
            case 'widget': return '🧩';
            case 'enum': return '🟣';
            case 'mixin': return '🟠';
            case 'translation': return '🌐';
            case 'call': return '📞';
            case 'extension': return '🧬';
            case 'extensionType': return '🛡️';
            case 'typedef': return '🏷️';
            case 'variable': return '💎';
            case 'constructor': return '🛠️';
            case 'property': return '🔑';
            case 'annotation': return '🏷️';
            case 'file': return '📄';
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
    relativePath: string;
    usageCount?: number;
}