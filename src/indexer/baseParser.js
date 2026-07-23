"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseParser = void 0;
class BaseParser {
    findMethodInParsed(parsed, name, parentClass) {
        const containers = [
            ...(parsed.classes ?? []),
            ...(parsed.extensions ?? []),
            ...(parsed.extensionTypes ?? []),
        ];
        for (const container of containers) {
            const m = container.methods?.find((m) => m.name === name);
            if (m && (!parentClass || container.name === parentClass))
                return m;
        }
        return parsed.functions?.find((f) => f.name === name && !f.parentClass);
    }
    /**
     * Extract the full body of a class, function, or method from the source code
     */
    extractCodeBlock(content, elementType, name, parentClass, parsedInfo) {
        const parsed = (parsedInfo ?? this.parse('__extract__', content));
        const lines = content.split('\n');
        let startLine = -1;
        let endLine = -1;
        switch (elementType) {
            case 'class': {
                const cls = parsed.classes?.find((c) => c.name === name);
                if (cls) {
                    startLine = cls.line;
                    endLine = cls.lineEnd ?? -1;
                    break;
                }
                const ext = parsed.extensions?.find((e) => name === 'unnamed extension' ? e.name.startsWith('UnnamedExtension_') : e.name === name);
                if (ext) {
                    startLine = ext.line;
                    endLine = ext.lineEnd ?? -1;
                    break;
                }
                const et = parsed.extensionTypes?.find((e) => e.name === name);
                if (et) {
                    startLine = et.line;
                    endLine = et.lineEnd ?? -1;
                }
                break;
            }
            case 'enum': {
                const enm = parsed.enums?.find((e) => e.name === name);
                if (enm) {
                    startLine = enm.line;
                    endLine = enm.lineEnd ?? -1;
                }
                break;
            }
            case 'mixin': {
                const mix = parsed.mixins?.find((m) => m.name === name);
                if (mix) {
                    startLine = mix.line;
                    endLine = mix.lineEnd ?? -1;
                }
                break;
            }
            case 'extension': {
                const ext = parsed.extensions?.find((e) => name === 'unnamed extension' ? e.name.startsWith('UnnamedExtension_') : e.name === name);
                if (ext) {
                    startLine = ext.line;
                    endLine = ext.lineEnd ?? -1;
                }
                break;
            }
            case 'function': {
                const fn = parsed.functions?.find((f) => f.name === name && !f.parentClass);
                if (fn) {
                    startLine = fn.line;
                    endLine = fn.lineEnd ?? -1;
                }
                break;
            }
            case 'method': {
                const fn = this.findMethodInParsed(parsed, name, parentClass);
                if (fn) {
                    startLine = fn.line;
                    endLine = fn.lineEnd ?? -1;
                }
                break;
            }
        }
        if (startLine === -1)
            return null;
        if (endLine === -1) {
            const masked = this.preprocessSource(content);
            const maskedLines = masked.split('\n');
            let depth = 0;
            let started = false;
            for (let i = startLine - 1; i < maskedLines.length; i++) {
                const mLine = maskedLines[i];
                if (!started && mLine.trim().endsWith(';')) {
                    endLine = i + 1;
                    break;
                }
                for (const ch of mLine) {
                    if (ch === '{') {
                        depth++;
                        started = true;
                    }
                    else if (ch === '}') {
                        depth--;
                        if (started && depth === 0) {
                            endLine = i + 1;
                            break;
                        }
                    }
                }
                if (endLine !== -1)
                    break;
                if (i > startLine + BaseParser.MAX_BLOCK_SCAN_LINES)
                    break;
            }
        }
        if (endLine === -1)
            return null;
        const comments = [];
        for (let i = startLine - 2; i >= 0; i--) {
            const t = lines[i].trim();
            if (t.startsWith('@'))
                continue;
            if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
                comments.unshift(t);
            }
            else {
                break;
            }
        }
        const body = lines.slice(startLine - 1, endLine).join('\n');
        return { body, startLine, endLine, comments };
    }
}
exports.BaseParser = BaseParser;
BaseParser.MAX_BLOCK_SCAN_LINES = 5000;
