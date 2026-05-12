const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const production = process.argv.includes('--production');
const watch = process.argv.includes('watch');
/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
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
async function main() {
    if (watch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('[esbuild] Watching for changes...');
    } else {
        await esbuild.build(buildOptions);
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