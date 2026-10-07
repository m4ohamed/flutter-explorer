const fs = require('fs');
const content = fs.readFileSync('src/mcp-server.ts', 'utf8');
const toolMatches = [...content.matchAll(/server\.registerTool\(\s*["']([^"']+)["']/g)];
console.log('Total tools count:', toolMatches.length);
toolMatches.forEach((m, idx) => console.log((idx+1) + '. ' + m[1]));
