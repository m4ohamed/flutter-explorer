const fs = require('fs');
const path = require('path');
const targetFile = path.join(process.cwd(), 'src/mcp-server.ts');
let content = fs.readFileSync(targetFile, 'utf8');

// Replace any remaining "const parser = new DartParser();"
content = content.replace(/\s+const parser = new DartParser\(\);\r?\n/g, "\n");

// Just to be sure we don't have multiple parser = getParserForFile for the same block
content = content.replace(/const parser = getParserForFile\(targetFile\);\s*const parser = getParserForFile\(targetFile\);/g, "const parser = getParserForFile(targetFile);");

fs.writeFileSync(targetFile, content);
console.log('Cleaned up parser declarations');
