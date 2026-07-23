import { DartParser } from '../src/indexer/dartParser.js';
import * as fs from 'fs';
import * as path from 'path';

const parser = new DartParser();
const projectDir = 'f:/flutter_course_platform/lib';

function getFiles(dir: string): string[] {
  const subdirs = fs.readdirSync(dir);
  const files: string[] = [];
  for (const subdir of subdirs) {
    const res = path.join(dir, subdir);
    if (fs.statSync(res).isDirectory()) {
      files.push(...getFiles(res));
    } else if (res.endsWith('.dart')) {
      files.push(res);
    }
  }
  return files;
}

const files = getFiles(projectDir);
let totalClasses = 0;
let totalMethods = 0;
let totalTopFuncs = 0;
let totalVariables = 0;

console.log(`Analyzing ${files.length} files...`);
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const result = parser.parse(file, content);
  totalClasses += result.classes.length;
  totalMethods += result.classes.reduce((sum, c) => sum + c.methods.length, 0);
  totalTopFuncs += result.functions.length;
  totalVariables += result.variables.length;
}

console.log('--- SUMMARY RESULTS ---');
console.log(`Analyzed Files        : ${files.length}`);
console.log(`Total Classes         : ${totalClasses}`);
console.log(`Total Methods         : ${totalMethods}`);
console.log(`Total Top-level Funcs : ${totalTopFuncs}`);
console.log(`Total Variables       : ${totalVariables}`);
