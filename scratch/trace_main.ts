import { DartParser } from '../src/indexer/dartParser';
import * as fs from 'fs';

const parser = new DartParser();
const content = fs.readFileSync('f:/flutter_course_platform/lib/main.dart', 'utf8');

// Preprocess
const preprocessed = parser.preprocessSource(content);
const lines = preprocessed.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  if (trimmed.startsWith('Future<void> main()')) {
    console.log(`FOUND MAIN AT LINE ${i + 1}: '${trimmed}'`);
    const fLookahead = lines.slice(i, i + 30).join('\n');
    console.log('fLookahead:', JSON.stringify(fLookahead.substring(0, 50)));
    const P = (DartParser as any).P;
    const f = fLookahead.match(P.topFunc);
    console.log('Match result:', f);
  }
}
