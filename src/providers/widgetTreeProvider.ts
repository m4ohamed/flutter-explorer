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

        const parsed = this.indexManager.parseWidgetTreeForContent(filePath, content);
        const fileName = filePath.split(/[/\\]/).pop() || '';
        return {
            fileName,
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