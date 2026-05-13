/**
 * SQLite Cache - Replaces the monolithic JSON cache.
 *
 * Why SQLite instead of one big JSON file?
 *   JSON:   read/write the entire file (could be 5MB+) on every file change
 *   SQLite: read/write only the changed row in milliseconds
 *
 * Falls back to JSON file if better-sqlite3 is unavailable.
 */

import * as path from 'path';
import * as fs from 'fs';
import { DartFileInfo } from './dartParser';
import { TranslationInfo, DiagnosticInfo } from './indexManager';
import { PackageInfo } from '../providers/pubspecLockProvider';

import { ProjectDetector } from '../utils/projectDetector';

// Lazily require better-sqlite3 to handle cases where it's not compiled yet.
let Database: any = null;
function getDatabase() {
    if (!Database) {
        try {
            Database = require('better-sqlite3');
        } catch (err: any) {
            console.error('[FlutterExplorer] Failed to load better-sqlite3:', err.message || err);
            Database = null;
        }
    }
    return Database;
}

export class SqliteCache {
    private db: any = null;
    private available = false;
    private jsonPath: string | null = null;
    private jsonCache: {
        dartFiles: Record<string, { hash: string; data: string }>;
        arbFiles: Record<string, { data: string; updated_at: number }>;
        meta: Record<string, any>;
    } = { dartFiles: {}, arbFiles: {}, meta: {} };

    constructor(workspaceRoot: string) {
        const DB = getDatabase();
        try {
            const dataDir = ProjectDetector.getDataDir(workspaceRoot);
            this.jsonPath = path.join(dataDir, 'flutter-explorer.json');
            const dbPath = path.join(dataDir, 'flutter-explorer.db');
            
            // Legacy check: Move from .vscode if exists
            const legacyDir = path.join(workspaceRoot, '.vscode');
            const legacyDb = path.join(legacyDir, 'flutter-explorer.db');
            if (fs.existsSync(legacyDb) && !fs.existsSync(dbPath)) {
                console.log('[FlutterExplorer] Migrating legacy database from .vscode to .flutter-explorer');
                fs.copyFileSync(legacyDb, dbPath);
                
                // Clean up or move side files
                for (const suffix of ['-wal', '-shm', '-journal']) {
                    const sideFile = legacyDb + suffix;
                    const targetSideFile = dbPath + suffix;
                    if (fs.existsSync(sideFile)) {
                        try {
                            fs.copyFileSync(sideFile, targetSideFile);
                            fs.unlinkSync(sideFile); // Remove old side file
                        } catch (e) {
                            console.warn(`[FlutterExplorer] Could not migrate side-file ${suffix}:`, e);
                        }
                    }
                }
                // Optional: fs.unlinkSync(legacyDb); // Should we delete the old db? Keeping for now.
            }
            
            if (DB) {
                try {
                    this.db = new DB(dbPath);
                    this.db.pragma('journal_mode = WAL');
                    this.db.pragma('synchronous = NORMAL');
                    this._createTables();
                    this.available = true;
                    console.log('[FlutterExplorer] SQLite cache initialized.');
                } catch (err: any) {
                    const msg = err.message || String(err);
                    if (msg.includes('NODE_MODULE_VERSION') || msg.includes('compiled against')) {
                        console.error('[FlutterExplorer] SQLite ABI mismatch detected. Rebuild required.');
                        // Still fallback to JSON instead of crashing
                        this._loadJson();
                    } else {
                        throw err;
                    }
                }
            } else {
                this._loadJson();
                console.log('[FlutterExplorer] SQLite not available — using JSON fallback.');
            }
        } catch (e) {
            console.warn('[FlutterExplorer] Cache init error, using memory only:', e);
            this.db = null;
            this.available = false;
        }
    }

    get isAvailable(): boolean {
        return this.available;
    }

    private _createTables(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS dart_files (
        path TEXT PRIMARY KEY,
        hash TEXT,
        data TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS arb_files (
        path TEXT PRIMARY KEY,
        data TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        data TEXT,
        updated_at INTEGER
      );
    `);
    }

    // ── Dart file operations ───────────────────────────────────────────────────

    /** Write or update a single dart file entry. O(1) — only touches one row. */
    upsertDartFile(relPath: string, hash: string, info: DartFileInfo): void {
        if (this.available) {
            try {
                this.db.prepare(`
          INSERT OR REPLACE INTO dart_files (path, hash, data, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(relPath, hash, JSON.stringify(info), Date.now());
            } catch (e) {
                console.error('[FlutterExplorer] SQLite upsertDartFile error:', e);
            }
        } else {
            this.jsonCache.dartFiles[relPath] = { hash, data: JSON.stringify(info) };
            this._saveJson();
        }
    }

    /** Read a single dart file entry. */
    getDartFile(relPath: string): { hash: string; info: DartFileInfo } | null {
        if (this.available) {
            try {
                const row = this.db.prepare(
                    'SELECT hash, data FROM dart_files WHERE path = ?'
                ).get(relPath) as { hash: string; data: string } | undefined;
                if (!row) return null;
                return { hash: row.hash, info: JSON.parse(row.data) };
            } catch {
                return null;
            }
        } else {
            const entry = this.jsonCache.dartFiles[relPath];
            if (!entry) return null;
            return { hash: entry.hash, info: JSON.parse(entry.data) };
        }
    }

    /** Delete a dart file entry (called on file delete). */
    deleteDartFile(relPath: string): void {
        if (this.available) {
            try {
                this.db.prepare('DELETE FROM dart_files WHERE path = ?').run(relPath);
            } catch (e) {
                console.error('[FlutterExplorer] SQLite deleteDartFile error:', e);
            }
        } else {
            delete this.jsonCache.dartFiles[relPath];
            this._saveJson();
        }
    }

    /** Load all dart files at startup. */
    getAllDartFiles(): Array<{ path: string; hash: string; info: DartFileInfo }> {
        if (this.available) {
            try {
                const rows = this.db.prepare(
                    'SELECT path, hash, data FROM dart_files'
                ).all() as Array<{ path: string; hash: string; data: string }>;
                return rows.map(r => ({ path: r.path, hash: r.hash, info: JSON.parse(r.data) }));
            } catch {
                return [];
            }
        } else {
            return Object.entries(this.jsonCache.dartFiles).map(([path, entry]) => ({
                path, hash: entry.hash, info: JSON.parse(entry.data)
            }));
        }
    }

    // ── ARB file operations ─────────────────────────────────────────────────────

    upsertArbFile(relPath: string, translations: TranslationInfo[]): void {
        if (this.available) {
            try {
                this.db.prepare(`
          INSERT OR REPLACE INTO arb_files (path, data, updated_at)
          VALUES (?, ?, ?)
        `).run(relPath, JSON.stringify(translations), Date.now());
            } catch (e) {
                console.error('[FlutterExplorer] SQLite upsertArbFile error:', e);
            }
        } else {
            this.jsonCache.arbFiles[relPath] = { data: JSON.stringify(translations), updated_at: Date.now() };
            this._saveJson();
        }
    }

    deleteArbFile(relPath: string): void {
        if (this.available) {
            try {
                this.db.prepare('DELETE FROM arb_files WHERE path = ?').run(relPath);
            } catch (e) {
                console.error('[FlutterExplorer] SQLite deleteArbFile error:', e);
            }
        } else {
            delete this.jsonCache.arbFiles[relPath];
            this._saveJson();
        }
    }

    getAllArbFiles(): Array<{ path: string; translations: TranslationInfo[] }> {
        if (this.available) {
            try {
                const rows = this.db.prepare(
                    'SELECT path, data FROM arb_files'
                ).all() as Array<{ path: string; data: string }>;
                return rows.map(r => ({ path: r.path, translations: JSON.parse(r.data) }));
            } catch {
                return [];
            }
        } else {
            return Object.entries(this.jsonCache.arbFiles).map(([path, entry]) => ({
                path, translations: JSON.parse(entry.data)
            }));
        }
    }

    // ── Metadata operations ─────────────────────────────────────────────────────

    setMeta(key: string, value: any): void {
        if (this.available) {
            try {
                this.db.prepare(`
          INSERT OR REPLACE INTO metadata (key, data, updated_at)
          VALUES (?, ?, ?)
        `).run(key, JSON.stringify(value), Date.now());
            } catch (e) {
                console.error('[FlutterExplorer] SQLite setMeta error:', e);
            }
        } else {
            this.jsonCache.meta[key] = value;
            this._saveJson();
        }
    }

    getMeta<T>(key: string): T | null {
        if (this.available) {
            try {
                const row = this.db.prepare(
                    'SELECT data FROM metadata WHERE key = ?'
                ).get(key) as { data: string } | undefined;
                if (!row) return null;
                return JSON.parse(row.data) as T;
            } catch {
                return null;
            }
        } else {
            return (this.jsonCache.meta[key] as T) || null;
        }
    }

    clearAll(): void {
        if (this.available) {
            try {
                this.db.prepare('DELETE FROM dart_files').run();
                this.db.prepare('DELETE FROM arb_files').run();
                this.db.prepare('DELETE FROM metadata').run();
            } catch (e) {
                console.error('[FlutterExplorer] SQLite clearAll error:', e);
            }
        } else {
            this.jsonCache = { dartFiles: {}, arbFiles: {}, meta: {} };
            this._saveJson();
        }
    }

    /**
     * Finds the innermost node at a cursor position.
     * Useful for jumping from a file location to a graph node.
     */
    getNodeAtCursor(relPath: string, line: number): any | null {
        const fileInfo = this.getDartFile(relPath);
        if (!fileInfo) return null;

        let bestNode: any = null;
        let smallestSpan = Infinity;

        // Check classes
        for (const cls of fileInfo.info.classes) {
            // we don't have lineEnd for classes yet, assuming 100 lines for now or just check start
            if (cls.line <= line && line <= cls.line + 50) {
                bestNode = { type: 'class', name: cls.name };
                smallestSpan = 50;
            }
        }
        
        // Check functions
        for (const func of fileInfo.info.functions) {
            if (func.line <= line && line <= func.line + 20) {
                bestNode = { type: 'function', name: func.name };
                smallestSpan = 20;
            }
        }

        return bestNode;
    }

    /**
     * BFS traversal to find impacted nodes within maxDepth.
     * This is the "Blast Radius" implementation.
     */
    getImpactRadius(changedFiles: string[], maxDepth: number = 2): any {
        const allFiles = this.getAllDartFiles();
        const seeds = new Set<string>();
        
        // 1. Initial seeds: all nodes in changed files
        for (const relPath of changedFiles) {
            const file = allFiles.find(f => f.path === relPath);
            if (file) {
                file.info.classes.forEach(c => seeds.add(c.name));
                file.info.functions.forEach(f => seeds.add(f.name));
            }
        }

        // 2. BFS
        const visited = new Set<string>(seeds);
        let frontier = new Set<string>(seeds);
        const impacted = new Set<string>();
        
        for (let depth = 0; depth < maxDepth; depth++) {
            const nextFrontier = new Set<string>();
            for (const name of frontier) {
                // Find all nodes that depend on 'name'
                for (const file of allFiles) {
                    // Check if this file calls 'name'
                    const calls = file.info.functionCalls.filter(c => c.name === name);
                    if (calls.length > 0) {
                        // Find which node in THIS file is calling it
                        // (Simplification: just mark the whole file or its classes as impacted)
                        file.info.classes.forEach(c => {
                            if (!visited.has(c.name)) {
                                nextFrontier.add(c.name);
                                visited.add(c.name);
                                impacted.add(c.name);
                            }
                        });
                    }
                    
                    // Check inheritance
                    file.info.classes.forEach(c => {
                        if (c.extendsClass === name && !visited.has(c.name)) {
                            nextFrontier.add(c.name);
                            visited.add(c.name);
                            impacted.add(c.name);
                        }
                    });
                }
            }
            frontier = nextFrontier;
            if (frontier.size === 0) break;
        }

        return {
            seeds: Array.from(seeds),
            impacted: Array.from(impacted),
            depth: maxDepth
        };
    }

    private _loadJson(): void {
        if (!this.jsonPath || !fs.existsSync(this.jsonPath)) return;
        try {
            const content = fs.readFileSync(this.jsonPath, 'utf-8');
            this.jsonCache = JSON.parse(content);
        } catch (e) {
            console.error('[FlutterExplorer] Error loading JSON cache:', e);
        }
    }

    private _saveJson(): void {
        if (!this.jsonPath) return;
        try {
            fs.writeFileSync(this.jsonPath, JSON.stringify(this.jsonCache, null, 2));
        } catch (e) {
            console.error('[FlutterExplorer] Error saving JSON cache:', e);
        }
    }
}