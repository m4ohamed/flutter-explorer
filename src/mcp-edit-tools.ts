import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { editFile, replaceLines, writeTextFile, Failure, EditSummary } from './utils/fileEditor';

/**
 * Registers the file-writing tools. Kept out of mcp-server.ts so the logic stays unit-testable
 * (see tests/fileEditor.test.ts and tests/mcpEditTools.test.ts).
 *
 * Set FLUTTER_EXPLORER_READONLY=1 in the MCP server's environment to disable all three tools.
 */
export function registerEditTools(server: McpServer, getProjectRoot: () => string): void {
  const respond = (result: EditSummary | Failure) => {
    if (!result.ok) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    const { ok: _ok, ...rest } = result;
    return { content: [{ type: "text" as const, text: JSON.stringify(rest, null, 2) }] };
  };

  const readOnly = () =>
    process.env.FLUTTER_EXPLORER_READONLY === '1'
      ? ({ ok: false, error: 'Writing is disabled: FLUTTER_EXPLORER_READONLY=1 is set for this MCP server.' } as Failure)
      : null;

  const pathOf = (a: { filePath?: string; relativePath?: string; path?: string }) =>
    a.filePath || a.relativePath || a.path;

  server.registerTool(
    "flutter_edit_file",
    {
      description:
        "Edit a text file inside the active project by replacing an exact string. oldString must match exactly ONE place " +
        "(whitespace, indentation and line endings included) unless replaceAll is true; if it matches several places the call " +
        "fails and lists their line numbers so you can add context. Read the code first with flutter_read_lines / flutter_get_code_block " +
        "and copy oldString from there. Preserves BOM and CRLF/LF, backs the file up, and returns a numbered preview. " +
        "Use dryRun to preview without writing. Run flutter_get_impact_analysis before changing widely used symbols and " +
        "flutter_run_analyze afterwards.",
      inputSchema: z.object({
        filePath: z.string().optional().describe("Path to the file (relative to the project root, or absolute inside it)"),
        relativePath: z.string().optional().describe("Alias for filePath"),
        path: z.string().optional().describe("Alias for filePath"),
        oldString: z.string().describe("Exact text to replace; must be unique in the file unless replaceAll is true"),
        newString: z.string().describe("Replacement text (empty string deletes the matched text)"),
        replaceAll: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match (default: false)"),
        expectedCount: z.number().int().optional().describe("Fail without writing unless oldString matches exactly this many places"),
        dryRun: z.boolean().optional().describe("Validate and preview the edit without writing (default: false)"),
      }),
    },
    async (args) => {
      const blocked = readOnly();
      if (blocked) { return respond(blocked); }
      return respond(editFile(getProjectRoot(), {
        filePath: pathOf(args),
        oldString: args.oldString,
        newString: args.newString,
        replaceAll: args.replaceAll,
        expectedCount: args.expectedCount,
        dryRun: args.dryRun,
      }));
    }
  );

  server.registerTool(
    "flutter_replace_lines",
    {
      description:
        "Replace an inclusive 1-based line range of a text file with new content (use flutter_read_lines to get the numbers). " +
        "Pass endLine = startLine - 1 to insert before startLine without removing anything; pass newContent \"\" to delete the lines. " +
        "Pass expectedOldText (the lines you expect to remove) to refuse the edit if the file changed since you read it. " +
        "Preserves BOM and CRLF/LF, backs the file up, and returns a numbered preview. Use dryRun to preview.",
      inputSchema: z.object({
        filePath: z.string().optional().describe("Path to the file (relative to the project root, or absolute inside it)"),
        relativePath: z.string().optional().describe("Alias for filePath"),
        path: z.string().optional().describe("Alias for filePath"),
        startLine: z.number().int().describe("First line to replace (1-indexed)"),
        endLine: z.number().int().describe("Last line to replace (inclusive); startLine - 1 means insert"),
        newContent: z.string().describe("Text that replaces the range (empty string deletes it)"),
        expectedOldText: z.string().optional().describe("Fail without writing unless the removed lines equal this text"),
        dryRun: z.boolean().optional().describe("Validate and preview the edit without writing (default: false)"),
      }),
    },
    async (args) => {
      const blocked = readOnly();
      if (blocked) { return respond(blocked); }
      return respond(replaceLines(getProjectRoot(), {
        filePath: pathOf(args),
        startLine: args.startLine,
        endLine: args.endLine,
        newContent: args.newContent,
        expectedOldText: args.expectedOldText,
        dryRun: args.dryRun,
      }));
    }
  );

  server.registerTool(
    "flutter_write_file",
    {
      description:
        "Create a new text file inside the active project (parent folders are created). Refuses to replace an existing file " +
        "unless overwrite is true; for targeted changes to an existing file prefer flutter_edit_file. Existing BOM and CRLF " +
        "line endings are kept when overwriting; the old content is backed up. Cannot write into .git, node_modules, " +
        ".dart_tool or .flutter-explorer. Use dryRun to preview.",
      inputSchema: z.object({
        filePath: z.string().optional().describe("Path to the file (relative to the project root, or absolute inside it)"),
        relativePath: z.string().optional().describe("Alias for filePath"),
        path: z.string().optional().describe("Alias for filePath"),
        content: z.string().describe("Complete file content"),
        overwrite: z.boolean().optional().describe("Allow replacing an existing file (default: false)"),
        dryRun: z.boolean().optional().describe("Validate and preview without writing (default: false)"),
      }),
    },
    async (args) => {
      const blocked = readOnly();
      if (blocked) { return respond(blocked); }
      return respond(writeTextFile(getProjectRoot(), {
        filePath: pathOf(args),
        content: args.content,
        overwrite: args.overwrite,
        dryRun: args.dryRun,
      }));
    }
  );
}
