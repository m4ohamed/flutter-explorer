import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { generateSkills } from './skillsGenerator';

export async function setupMcpConfig(extensionPath: string, workspaceRoot: string): Promise<void> {
    try {
        // Generate AI Skills instructions
        await generateSkills(workspaceRoot);

        const username = os.userInfo().username;
        const mcpServerPath = path.join(extensionPath, 'out', 'mcp-server.js').replace(/\\/g, '/');
        
        const mcpEntryDynamic = {
            command: "node",
            args: [mcpServerPath],
            env: {
                FLUTTER_PROJECT_PATH: "${workspaceFolder}"
            }
        };

        const mcpEntryStatic = {
            command: "node",
            args: [mcpServerPath],
            env: {
                FLUTTER_PROJECT_PATH: workspaceRoot
            }
        };

        // 1. Target: Global Gemini Configs
        const geminiConfigPath1 = `C:/Users/${username}/.gemini/config/mcp_config.json`;
        const geminiConfigPath2 = `C:/Users/${username}/.gemini/antigravity/mcp_config.json`;
        await updateJsonFile(geminiConfigPath1, "flutter-explorer-mcp", mcpEntryDynamic, false);
        await updateJsonFile(geminiConfigPath2, "flutter-explorer-mcp", mcpEntryDynamic, false);

        // 2. Target: Workspace .vscode/mcp.json (Uses 'servers' to satisfy VS Code validation)
        const vscodeMcpPath = path.join(workspaceRoot, '.vscode', 'mcp.json');
        await updateJsonFile(vscodeMcpPath, "flutter-explorer-mcp", mcpEntryDynamic, true);

        // 3. Target: Workspace .cursor/mcp.json
        const cursorMcpPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
        await updateJsonFile(cursorMcpPath, "flutter-explorer-mcp", mcpEntryDynamic, false);

        // 4. Target: Claude Desktop Global Config
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const claudeConfigPath = path.join(appData, 'Claude', 'claude_desktop_config.json').replace(/\\/g, '/');
        // Claude Desktop doesn't support ${workspaceFolder}, so we use the static workspaceRoot
        await updateJsonFile(claudeConfigPath, "flutter-explorer-mcp", mcpEntryStatic, false);

        vscode.window.showInformationMessage(`MCP Configured for user: ${username} (Gemini, Claude, Cursor, VS Code) 🚀`);
    } catch (error) {
        console.error('Error setting up MCP config:', error);
        vscode.window.showErrorMessage('Failed to setup MCP config automatically.');
    }
}

async function updateJsonFile(filePath: string, key: string, value: any, useServersKey: boolean): Promise<void> {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const mainKey = useServersKey ? "servers" : "mcpServers";
        let config: any = { [mainKey]: {} };

        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(content);
                
                // If it has 'servers' but not 'mcpServers', migrate it (or vice versa)
                const existingServers = parsed.mcpServers || parsed.servers || parsed;
                config[mainKey] = typeof existingServers === 'object' ? existingServers : {};
            } catch (e) {
                config = { [mainKey]: {} };
            }
        }

        // Ensure we are working with the correct nested structure
        if (!config[mainKey] || typeof config[mainKey] !== 'object') {
            config[mainKey] = {};
        }

        config[mainKey][key] = value;
        
        // Clean up: remove the other key if it exists to avoid validation errors
        const otherKey = useServersKey ? "mcpServers" : "servers";
        if (config[otherKey]) delete config[otherKey];

        // Write clean, validated JSON
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error(`Failed to update ${filePath}:`, e);
    }
}
