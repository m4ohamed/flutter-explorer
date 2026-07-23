import { DartParser } from '../src/indexer/dartParser';
import * as fs from 'fs';

const parser = new DartParser();

const files = [
  'f:/flutter_course_platform/lib/main.dart',
  'f:/flutter_course_platform/lib/features/lesson/presentation/providers/content_providers.dart',
  'f:/flutter_course_platform/lib/features/progress/presentation/providers/progress_providers.dart',
  'f:/flutter_course_platform/lib/features/lesson/presentation/widgets/block_widgets.dart',
  'f:/flutter_course_platform/lib/features/progress/data/repositories/shared_prefs_progress_repository.dart',
];

let totalMethods = 0;
let totalWidgets = 0;
let totalVars = 0;
let totalFuncs = 0;

for (const fp of files) {
  const content = fs.readFileSync(fp, 'utf8');
  const res = parser.parse(fp, content);
  
  const methods = res.classes.reduce((sum, c) => sum + c.methods.length, 0)
    + res.extensions.reduce((sum, e) => sum + e.methods.length, 0)
    + res.extensionTypes.reduce((sum, e) => sum + e.methods.length, 0);
  
  totalMethods += methods;
  totalWidgets += res.widgets.length;
  totalVars += res.variables.length;
  totalFuncs += res.functions.length;

  console.log(`\n=================== FILE: ${fp.split('/').pop()} ===================`);
  console.log('Classes:', res.classes.map(c => c.name));
  console.log('Functions:', res.functions.map(f => `${f.name} (line ${f.line})`));
  console.log('Variables:', res.variables.map(v => `${v.name} (line ${v.line})`));
  console.log('Widgets:', res.widgets.length);
  for (const c of res.classes) {
    if (c.methods.length > 0)
      console.log(`  Class ${c.name} methods:`, c.methods.map(m => m.name));
  }
}

console.log('\n--- TOTALS ---');
console.log('Total Methods:', totalMethods);
console.log('Total Widgets:', totalWidgets);
console.log('Total Variables:', totalVars);
console.log('Total Functions:', totalFuncs);
