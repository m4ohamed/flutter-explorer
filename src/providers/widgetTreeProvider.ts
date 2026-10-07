/**
 * Widget Tree Provider - Parses current file for widget tree visualization
 */
import * as vscode from 'vscode';
import { IndexManager } from '../indexer/indexManager';
import { WidgetInfo } from '../indexer/dartParser';

export interface WidgetTreeNode {
    name: string;
    line: number;
    children: WidgetTreeNode[];
    depth: number;
}

export interface OutlineSymbolNode {
    name: string;
    detail?: string;
    kind: string;
    badgeText: string;
    badgeClass: string;
    line: number;
    children?: OutlineSymbolNode[];
}

export class WidgetTreeProvider {
    constructor(private indexManager: IndexManager) { }

    /** Get widget tree for current active editor */
    getTreeForActiveEditor(): WidgetTreeNode[] | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return null;
        }
        const fileName = editor.document.fileName;
        if (!this.isSupportedFile(fileName)) {
            return null;
        }
        const content = editor.document.getText();
        const filePath = editor.document.fileName;
        const parsed = this.indexManager.parseWidgetTreeForContent(filePath, content);
        if (parsed.widgets.length === 0) { return null; }
        return this.flattenTree(parsed.widgets, 0);
    }

    /** Get widget tree for a specific file content */
    getTreeForContent(filePath: string, content: string): WidgetTreeNode[] {
        const parsed = this.indexManager.parseWidgetTreeForContent(filePath, content);
        return this.flattenTree(parsed.widgets, 0);
    }

    /** Convert WidgetInfo tree to flat renderable nodes */
    private flattenTree(widgets: WidgetInfo[], depth: number): WidgetTreeNode[] {
        const nodes: WidgetTreeNode[] = [];
        for (const w of widgets) {
            nodes.push({
                name: w.name,
                line: w.line,
                children: this.flattenTree(w.children, depth + 1),
                depth,
            });
        }
        return nodes;
    }

    /** Serialize tree for webview */
    async getTreeDataForWebview(): Promise<WebviewTreeData> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return { fileName: null, tree: [], classNames: [] };
        }
        const filePath = editor.document.fileName;
        if (!this.isSupportedFile(filePath)) {
            return { fileName: null, tree: [], classNames: [] };
        }
        const content = editor.document.getText();
        
        // Ensure project name is loaded for the active file's project
        await this.indexManager.ensureProjectName(filePath);

        // Try getting official hierarchical Outline from VS Code DocumentSymbolProvider
        let outlineNodes: OutlineSymbolNode[] = [];
        try {
            const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
                'vscode.executeDocumentSymbolProvider',
                editor.document.uri
            );
            if (symbols && symbols.length > 0) {
                outlineNodes = this.convertDocumentSymbols(symbols);
            }
        } catch (err) {
            console.error('[WidgetTreeProvider] Failed to fetch document symbols:', err);
        }

        const parsed = this.indexManager.parseWidgetTreeForContent(filePath, content);
        const fileName = filePath.split(/[/\\]/).pop() || '';
        return {
            fileName,
            filePath,
            outline: outlineNodes.length > 0 ? outlineNodes : undefined,
            tree: this.serializeWidgets(parsed.widgets),
            classNames: (parsed.classes || []).map(c => ({
                name: c.name,
                type: c.type,
                line: c.line,
            })),
            functions: (parsed.functions || []).map(f => ({ name: f.name, line: f.line, isPrivate: f.isPrivate })),
            variables: (parsed.variables || []).map(v => ({ name: v.name, line: v.line, isPrivate: v.isPrivate })),
            enums: (parsed.enums || []).map(e => ({ name: e.name, line: e.line })),
            mixins: (parsed.mixins || []).map(m => ({ name: m.name, line: m.line })),
            extensions: (parsed.extensions || []).map(e => ({ name: e.name, line: e.line })),
            typedefs: (parsed.typedefs || []).map(t => ({ name: t.name, line: t.line })),
        };
    }

    private convertDocumentSymbols(symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[]): OutlineSymbolNode[] {
        if (!symbols || !Array.isArray(symbols) || symbols.length === 0) return [];
        
        const isDocSymbol = 'range' in symbols[0];
        if (isDocSymbol) {
            return (symbols as vscode.DocumentSymbol[]).map(s => this.mapDocSymbol(s));
        }

        return (symbols as vscode.SymbolInformation[]).map(s => {
            const mapped = this.mapSymbolKind(s.kind, s.name);
            return {
                name: s.name,
                detail: s.containerName,
                kind: mapped.kind,
                badgeText: mapped.badgeText,
                badgeClass: mapped.badgeClass,
                line: s.location.range.start.line + 1,
                children: []
            };
        });
    }

    private mapDocSymbol(symbol: vscode.DocumentSymbol): OutlineSymbolNode {
        const rawName = symbol.name.trim();
        let mapped = this.mapSymbolKind(symbol.kind, rawName);
        let displayName = rawName;

        // Handle Markdown headings (e.g. # Title, ## Subtitle)
        const mdMatch = rawName.match(/^(#{1,6})\s+(.*)/);
        if (mdMatch) {
            mapped = {
                kind: 'heading',
                badgeText: `H${mdMatch[1].length}`,
                badgeClass: 'badge-class'
            };
            displayName = mdMatch[2].trim();
        } else if (rawName.startsWith('#')) {
            const hLen = rawName.match(/^(#{1,6})/)?.[1].length || 1;
            mapped = {
                kind: 'heading',
                badgeText: `H${hLen}`,
                badgeClass: 'badge-class'
            };
            displayName = rawName.replace(/^#+\s*/, '').trim();
        }

        return {
            name: displayName,
            detail: symbol.detail || undefined,
            kind: mapped.kind,
            badgeText: mapped.badgeText,
            badgeClass: mapped.badgeClass,
            line: symbol.range ? symbol.range.start.line + 1 : 1,
            children: symbol.children && symbol.children.length > 0
                ? symbol.children.map(c => this.mapDocSymbol(c))
                : []
        };
    }

    private mapSymbolKind(kind: vscode.SymbolKind, name: string): { kind: string; badgeText: string; badgeClass: string } {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return { kind: 'class', badgeText: 'class', badgeClass: 'badge-class' };
            case vscode.SymbolKind.Method:
                return { kind: 'method', badgeText: 'method', badgeClass: 'badge-function' };
            case vscode.SymbolKind.Function:
                return { kind: 'function', badgeText: 'fn', badgeClass: 'badge-function' };
            case vscode.SymbolKind.Constructor:
                return { kind: 'constructor', badgeText: 'ctor', badgeClass: 'badge-class' };
            case vscode.SymbolKind.Field:
            case vscode.SymbolKind.Property:
                return { kind: 'property', badgeText: 'prop', badgeClass: 'badge-property' };
            case vscode.SymbolKind.Variable:
                return { kind: 'variable', badgeText: 'var', badgeClass: 'badge-variable' };
            case vscode.SymbolKind.Constant:
                return { kind: 'constant', badgeText: 'const', badgeClass: 'badge-variable' };
            case vscode.SymbolKind.Interface:
                return { kind: 'interface', badgeText: 'interface', badgeClass: 'badge-typedef' };
            case vscode.SymbolKind.Enum:
                return { kind: 'enum', badgeText: 'enum', badgeClass: 'badge-enum' };
            case vscode.SymbolKind.EnumMember:
                return { kind: 'enumMember', badgeText: 'case', badgeClass: 'badge-enum' };
            case vscode.SymbolKind.Module:
            case vscode.SymbolKind.Namespace:
            case vscode.SymbolKind.Package:
                return { kind: 'module', badgeText: 'mod', badgeClass: 'badge-extension' };
            case vscode.SymbolKind.String: {
                const hMatch = name.match(/^(#{1,6})\s*/);
                if (hMatch) {
                    return { kind: 'heading', badgeText: `H${hMatch[1].length}`, badgeClass: 'badge-class' };
                }
                return { kind: 'string', badgeText: 'str', badgeClass: 'badge-variable' };
            }
            case vscode.SymbolKind.Number:
            case vscode.SymbolKind.Boolean:
            case vscode.SymbolKind.Array:
            case vscode.SymbolKind.Object:
            case vscode.SymbolKind.Key:
                return { kind: 'property', badgeText: 'key', badgeClass: 'badge-property' };
            case vscode.SymbolKind.Event:
                return { kind: 'event', badgeText: 'event', badgeClass: 'badge-function' };
            case vscode.SymbolKind.Operator:
                return { kind: 'operator', badgeText: 'op', badgeClass: 'badge-function' };
            case vscode.SymbolKind.TypeParameter:
                return { kind: 'type', badgeText: 'type', badgeClass: 'badge-typedef' };
            default:
                return { kind: 'symbol', badgeText: 'sym', badgeClass: 'badge-variable' };
        }
    }

    private serializeWidgets(widgets: WidgetInfo[]): SerializedWidget[] {
        if (!widgets || !Array.isArray(widgets)) return [];
        return widgets.map(w => ({
            name: w.name,
            line: w.line,
            properties: w.properties || [],
            children: this.serializeWidgets(w.children || []),
        }));
    }

    private isSupportedFile(fileName: string): boolean {
        return ['.dart', '.ts', '.tsx', '.js', '.jsx', '.kt', '.java', 
                '.xml', '.gradle', '.gradle.kts', '.html', '.md', '.css', '.json']
            .some(ext => fileName.endsWith(ext));
    }
}

export interface WebviewTreeData {
    fileName: string | null;
    filePath?: string | null;
    outline?: OutlineSymbolNode[];
    tree: SerializedWidget[];
    classNames: { name: string; type: string; line: number }[];
    functions?: { name: string; line: number; isPrivate: boolean }[];
    variables?: { name: string; line: number; isPrivate: boolean }[];
    enums?: { name: string; line: number }[];
    mixins?: { name: string; line: number }[];
    extensions?: { name: string; line: number }[];
    typedefs?: { name: string; line: number }[];
}

export interface SerializedWidget {
    name: string;
    line: number;
    properties: { name: string; value: string }[];
    children: SerializedWidget[];
}