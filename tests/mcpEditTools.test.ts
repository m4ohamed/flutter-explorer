import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerEditTools } from '../src/mcp-edit-tools';

async function connect(root: string) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerEditTools(server, () => root);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function textOf(result: any): string {
  return result.content.map((c: any) => c.text).join('\n');
}

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-mcp-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  return root;
}

test('all three tools are listed with their schemas', async () => {
  const { client, close } = await connect(makeProject());
  const { tools } = await client.listTools();
  const names = tools.map(t => t.name).sort();
  assert.deepEqual(names, ['flutter_edit_file', 'flutter_replace_lines', 'flutter_write_file']);
  const edit = tools.find(t => t.name === 'flutter_edit_file')!;
  assert.deepEqual(Object.keys((edit.inputSchema as any).properties).sort(),
    ['dryRun', 'expectedCount', 'filePath', 'newString', 'oldString', 'path', 'relativePath', 'replaceAll']);
  assert.deepEqual([...(edit.inputSchema as any).required].sort(), ['newString', 'oldString']);
  await close();
});

test('edit, replace lines and write work end to end, using any path alias', async () => {
  const root = makeProject();
  const { client, close } = await connect(root);
  const file = path.join(root, 'lib', 'main.dart');
  fs.writeFileSync(file, 'void main() {\n  print("a");\n}\n');

  const edit: any = await client.callTool({
    name: 'flutter_edit_file',
    arguments: { relativePath: 'lib/main.dart', oldString: 'print("a")', newString: 'print("b")' },
  });
  assert.notEqual(edit.isError, true);
  const body = JSON.parse(textOf(edit));
  assert.equal(body.action, 'edited');
  assert.equal(body.replaced, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'void main() {\n  print("b");\n}\n');

  const lines: any = await client.callTool({
    name: 'flutter_replace_lines',
    arguments: { path: 'lib/main.dart', startLine: 3, endLine: 2, newContent: '// end' },
  });
  assert.notEqual(lines.isError, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'void main() {\n  print("b");\n// end\n}\n');

  const created: any = await client.callTool({
    name: 'flutter_write_file',
    arguments: { filePath: 'lib/new/widget.dart', content: 'class W {}\n' },
  });
  assert.notEqual(created.isError, true);
  assert.equal(JSON.parse(textOf(created)).action, 'created');
  assert.equal(fs.readFileSync(path.join(root, 'lib', 'new', 'widget.dart'), 'utf8'), 'class W {}\n');
  await close();
});

test('failures come back as isError results, not exceptions', async () => {
  const root = makeProject();
  const { client, close } = await connect(root);
  fs.writeFileSync(path.join(root, 'lib', 'a.dart'), 'x\nx\n');

  const ambiguous: any = await client.callTool({
    name: 'flutter_edit_file',
    arguments: { filePath: 'lib/a.dart', oldString: 'x', newString: 'y' },
  });
  assert.equal(ambiguous.isError, true);
  assert.match(textOf(ambiguous), /matches 2 places/);

  const escape: any = await client.callTool({
    name: 'flutter_write_file',
    arguments: { filePath: '../escape.txt', content: 'no' },
  });
  assert.equal(escape.isError, true);
  assert.match(textOf(escape), /outside the project root/);
  assert.equal(fs.existsSync(path.join(root, '..', 'escape.txt')), false);

  const noPath: any = await client.callTool({
    name: 'flutter_edit_file',
    arguments: { oldString: 'a', newString: 'b' },
  });
  assert.equal(noPath.isError, true);
  assert.match(textOf(noPath), /File path is required/);
  await close();
});

test('schema validation rejects a missing oldString before the handler runs', async () => {
  const { client, close } = await connect(makeProject());
  let rejected = false;
  try {
    const r: any = await client.callTool({ name: 'flutter_edit_file', arguments: { filePath: 'lib/a.dart', newString: 'b' } });
    rejected = r.isError === true;
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true);
  await close();
});

test('FLUTTER_EXPLORER_READONLY=1 disables every writing tool', async () => {
  const root = makeProject();
  const file = path.join(root, 'lib', 'a.dart');
  fs.writeFileSync(file, 'keep\n');
  const { client, close } = await connect(root);
  process.env.FLUTTER_EXPLORER_READONLY = '1';
  try {
    for (const [name, args] of [
      ['flutter_edit_file', { filePath: 'lib/a.dart', oldString: 'keep', newString: 'lost' }],
      ['flutter_replace_lines', { filePath: 'lib/a.dart', startLine: 1, endLine: 1, newContent: 'lost' }],
      ['flutter_write_file', { filePath: 'lib/b.dart', content: 'lost', overwrite: true }],
    ] as const) {
      const r: any = await client.callTool({ name, arguments: args as any });
      assert.equal(r.isError, true, name);
      assert.match(textOf(r), /FLUTTER_EXPLORER_READONLY/);
    }
    assert.equal(fs.readFileSync(file, 'utf8'), 'keep\n');
    assert.equal(fs.existsSync(path.join(root, 'lib', 'b.dart')), false);
  } finally {
    delete process.env.FLUTTER_EXPLORER_READONLY;
    await close();
  }
});

test('the tools follow the project root when it changes between calls', async () => {
  const rootA = makeProject();
  const rootB = makeProject();
  fs.writeFileSync(path.join(rootA, 'lib', 'a.dart'), 'A\n');
  fs.writeFileSync(path.join(rootB, 'lib', 'a.dart'), 'B\n');
  let current = rootA;

  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerEditTools(server, () => current);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);

  await client.callTool({ name: 'flutter_edit_file', arguments: { filePath: 'lib/a.dart', oldString: 'A', newString: 'A2' } });
  current = rootB;
  await client.callTool({ name: 'flutter_edit_file', arguments: { filePath: 'lib/a.dart', oldString: 'B', newString: 'B2' } });

  assert.equal(fs.readFileSync(path.join(rootA, 'lib', 'a.dart'), 'utf8'), 'A2\n');
  assert.equal(fs.readFileSync(path.join(rootB, 'lib', 'a.dart'), 'utf8'), 'B2\n');
  await client.close();
  await server.close();
});
