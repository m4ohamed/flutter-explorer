import { DartParser } from '../src/indexer/dartParser';
import * as fs from 'fs';

const content = fs.readFileSync('f:/flutter_course_platform/lib/features/lesson/presentation/providers/content_providers.dart', 'utf8');

class VerboseParser extends DartParser {
  public parseWithLog(filePath: string, content: string) {
    const lines = content.split('\n');
    const masked = this.preprocessSource(content);
    const maskedLines = masked.split('\n');
    const P = (DartParser as any).P;

    let braceDepth = 0;
    const syncedLines = new Set<number>();
    const syncBraces = (lineIdx: number, count: number = 1) => {
      for (let k = 0; k < count; k++) {
        const idx = lineIdx + k;
        if (idx >= maskedLines.length || syncedLines.has(idx)) continue;
        syncedLines.add(idx);
        const mLine = maskedLines[idx];
        for (const ch of mLine) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = maskedLines[i].trim();
      const lineNum = i + 1;
      if (trimmed === '') { syncBraces(i); continue; }
      
      console.log(`Line ${lineNum} (depth=${braceDepth}): '${trimmed}'`);
      
      const varMatch = trimmed.match(P.topVar);
      if (varMatch) {
        console.log(` -> topVar match: name='${varMatch[4]}', type='${varMatch[3]}', val='${varMatch[5]}'`);
      }

      syncBraces(i);
    }
  }
}

new VerboseParser().parseWithLog('content_providers.dart', content);
