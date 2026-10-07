const fs = require('fs');
const content = fs.readFileSync('src/mcp-server.ts', 'utf8');

const toolRegex = /server\.registerTool\(\s*["']([^"']+)["'],\s*\{[\s\S]*?description:\s*["']([^"']+)["'],\s*inputSchema:\s*z\.object\(\{([\s\S]*?)\}\),?\s*\},?\s*async\s*\(([^)]*)\)\s*=>\s*\{/g;

let match;
const tools = [];
while ((match = toolRegex.exec(content)) !== null) {
  const name = match[1];
  const desc = match[2];
  const rawSchema = match[3].trim();
  const args = match[4].trim();
  
  // Extract parameter names and types
  const params = [];
  const paramRegex = /(\w+):\s*z\.([a-zA-Z]+)\(\)(?:\.([a-zA-Z]+)\([^)]*\))*/g;
  let pMatch;
  while ((pMatch = paramRegex.exec(rawSchema)) !== null) {
    const pName = pMatch[1];
    const isOptional = rawSchema.includes(`${pName}:`) && rawSchema.split(`${pName}:`)[1].split('\n')[0].includes('.optional()');
    params.push(`${pName}${isOptional ? '?' : ''}`);
  }

  tools.push({ name, desc, params, args });
}

console.log(`Matched ${tools.length} of 52 tools.`);
fs.writeFileSync('scratch/tools_extracted.json', JSON.stringify(tools, null, 2));
console.log('Saved to scratch/tools_extracted.json');
