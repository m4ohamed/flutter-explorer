export abstract class BaseParser<TFileInfo = any> {
  abstract parse(filePath: string, content: string): TFileInfo;
  abstract preprocessSource(content: string): string;

  /**
   * Extract the full body of a class, function, or method from the source code
   */
  extractCodeBlock(
    content: string,
    elementType: 'class' | 'function' | 'method' | 'enum' | 'mixin' | 'extension',
    name: string,
    parentClass?: string,
    parsedInfo?: TFileInfo
  ): { body: string; startLine: number; endLine: number; comments: string[] } | null {

    const parsed = (parsedInfo ?? this.parse('__extract__', content)) as any;
    const lines = content.split('\n');

    let startLine = -1;
    let endLine = -1;

    switch (elementType) {
      case 'class': {
        const cls = parsed.classes?.find((c: any) => c.name === name);
        if (cls) { startLine = cls.line; endLine = cls.lineEnd ?? -1; }
        if (endLine === -1) {
          const ext = parsed.extensions?.find((e: any) =>
            name === 'unnamed extension' ? !e.name.startsWith('Unnamed') === false : e.name === name
          );
          if (ext) { startLine = ext.line; endLine = ext.lineEnd ?? -1; }
          const et = parsed.extensionTypes?.find((e: any) => e.name === name);
          if (et) { startLine = et.line; endLine = et.lineEnd ?? -1; }
        }
        break;
      }
      case 'enum': {
        const enm = parsed.enums?.find((e: any) => e.name === name);
        if (enm) { startLine = enm.line; endLine = enm.lineEnd ?? -1; }
        break;
      }
      case 'mixin': {
        const mix = parsed.mixins?.find((m: any) => m.name === name);
        if (mix) { startLine = mix.line; endLine = mix.lineEnd ?? -1; }
        break;
      }
      case 'extension': {
        const ext = parsed.extensions?.find((e: any) =>
          name === 'unnamed extension' ? !e.name.startsWith('Unnamed') === false : e.name === name
        );
        if (ext) { startLine = ext.line; endLine = ext.lineEnd ?? -1; }
        break;
      }
      case 'function': {
        const fn = parsed.functions?.find((f: any) => f.name === name && !f.parentClass);
        if (fn) { startLine = fn.line; endLine = fn.lineEnd ?? -1; }
        break;
      }
      case 'method': {
        let fn = parsed.functions?.find((f: any) => f.name === name && f.parentClass === parentClass);
        if (!fn) {
          for (const cls of (parsed.classes || [])) {
            const m = cls.methods?.find((m: any) => m.name === name);
            if (m && (!parentClass || cls.name === parentClass)) { fn = m; break; }
          }
        }
        if (!fn) {
          for (const e of (parsed.extensions || [])) {
            const m = e.methods?.find((m: any) => m.name === name);
            if (m && (!parentClass || e.name === parentClass)) { fn = m; break; }
          }
        }
        if (!fn) {
          for (const et of (parsed.extensionTypes || [])) {
            const m = et.methods?.find((m: any) => m.name === name);
            if (m && (!parentClass || et.name === parentClass)) { fn = m; break; }
          }
        }
        if (fn) { startLine = fn.line; endLine = fn.lineEnd ?? -1; }
        break;
      }
    }

    if (startLine === -1) return null;

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
          if (ch === '{') { depth++; started = true; }
          else if (ch === '}') {
            depth--;
            if (started && depth === 0) { endLine = i + 1; break; }
          }
        }
        if (endLine !== -1) break;

        if (i > startLine + 5000) break;
      }
    }

    if (endLine === -1) return null;

    const comments: string[] = [];
    for (let i = startLine - 2; i >= 0; i--) {
      const t = lines[i].trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
        comments.unshift(t);
      } else {
        break;
      }
    }

    const body = lines.slice(startLine - 1, endLine).join('\n');
    return { body, startLine, endLine, comments };
  }
}
