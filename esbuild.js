const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    // 1. Node.js Build (Extension and MCP Server)
    const nodeBuildOptions = {
        entryPoints: ['src/extension.ts', 'src/mcp-server.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outdir: 'out',
        external: ['vscode', 'better-sqlite3'],
        logLevel: 'info',
        target: 'es2020',
    };

    // 2. Browser Build (Webview Graph)
    const browserBuildOptions = {
        entryPoints: {
            'webview-graph': 'src/webview/graph.ts'
        },
        bundle: true,
        format: 'iife', // Use IIFE for webview scripts
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'browser',
        outdir: 'out',
        logLevel: 'info',
        target: 'es2020',
    };

    if (watch) {
        const nodeCtx = await esbuild.context(nodeBuildOptions);
        const browserCtx = await esbuild.context(browserBuildOptions);
        await nodeCtx.watch();
        await browserCtx.watch();
        console.log('Watching for file changes...');
        // Small delay to ensure initial build is captured by the watcher
        setTimeout(() => {
            console.log('Found 0 errors.');
        }, 500);
    } else {
        await esbuild.build(nodeBuildOptions);
        await esbuild.build(browserBuildOptions);
        console.log('[esbuild] Build complete.');
    }

    // Copy webview media files to out/
    const mediaDir = path.join(__dirname, 'src', 'webview', 'media');
    const outMediaDir = path.join(__dirname, 'out', 'media');
    if (!fs.existsSync(outMediaDir)) {
        fs.mkdirSync(outMediaDir, { recursive: true });
    }
    if (fs.existsSync(mediaDir)) {
        const files = fs.readdirSync(mediaDir);
        for (const file of files) {
            fs.copyFileSync(path.join(mediaDir, file), path.join(outMediaDir, file));
        }
        console.log(`[esbuild] Copied ${files.length} media files to out/media/`);
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});