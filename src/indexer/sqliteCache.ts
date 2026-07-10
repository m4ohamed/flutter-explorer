/**
 * SQLite Cache - Replaces the monolithic JSON cache.
 *
 * Now uses sqlite3 instead of node-sqlite3-wasm.
 * Works natively in Node.js with asynchronous API wrapped in Promises.
 */

import * as path from 'path';
import * as fs from 'fs';
import { DartFileInfo } from './dartParser';
import { TranslationInfo, DiagnosticInfo } from './indexManager';
import { PackageInfo } from '../providers/pubspecLockProvider';

import { ProjectDetector } from '../utils/projectDetector';

import sqlite3 from 'sqlite3';

export class SqliteCache {
    private db: sqlite3.Database | null = null;
    private available = false;
    private readonlyMode = false;
    private workspaceRoot: string;
    private jsonPath: string | null = null;
    // We still keep the JSON fallback just in case of file system permission issues.
    private jsonCache: {
        dartFiles: Record<string, { hash: string; data: string }>;
        arbFiles: Record<string, { data: string; updated_at: number }>;
        meta: Record<string, any>;
    } = { dartFiles: {}, arbFiles: {}, meta: {} };

    constructor(workspaceRoot: string, options: { readonly?: boolean; dbName?: string } = {}) {
        this.workspaceRoot = workspaceRoot;
        this.readonlyMode = !!options.readonly;

        try {
            const dataDir = ProjectDetector.getDataDir(workspaceRoot);
            const dbFilename = options.dbName || 'flutter-explorer.db';
            this.jsonPath = path.join(dataDir, dbFilename.replace('.db', '.json'));
            const dbPath = path.join(dataDir, dbFilename);

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
                            fs.unlinkSync(sideFile);
                        } catch (e) {
                            console.warn(`[FlutterExplorer] Could not migrate side-file ${suffix}:`, e);
                        }
                    }
                }
            }

            // Legacy JSON cleanup
            const legacyJson = path.join(legacyDir, 'flutter-explorer.json');
            if (fs.existsSync(legacyJson)) {
                try {
                    console.log('[FlutterExplorer] Cleaning up legacy JSON cache from .vscode');
                    fs.unlinkSync(legacyJson);
                } catch (e) {
                    console.warn('[FlutterExplorer] Could not delete legacy JSON cache:', e);
                }
            }

            // Initialize sqlite3
            const mode = this.readonlyMode ? sqlite3.OPEN_READONLY : (sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
            this.available = true; // Set available immediately so callers queue queries
            this.db = new sqlite3.Database(dbPath, mode, (err) => {
                if (err) {
                    console.error(`[FlutterExplorer] Failed to initialize sqlite3 database: ${err.message || String(err)}`);
                    this.db = null;
                    this.available = false;
                    this._loadJson();
                } else {
                    console.log(`[FlutterExplorer] sqlite3 cache initialized (${this.readonlyMode ? 'READONLY' : 'READ/WRITE'}).`);
                }
            });

            this.db.serialize(); // Put database into serialized mode permanently so all queries queue sequentially

            this.db.exec('PRAGMA busy_timeout = 10000', () => {});
            if (!this.readonlyMode) {
                this.db.exec('PRAGMA journal_mode = DELETE', () => {});
                this.db.exec('PRAGMA synchronous = NORMAL', () => {});
                this._createTables();
            }
        } catch (e) {
            console.warn('[FlutterExplorer] Cache init error, using memory only:', e);
            this.db = null;
            this.available = false;
        }
    }

    /**
     * ✅ إغلاق الـ DB بأمان عند تعطيل الـ extension.
     * يحتوي على guard ضد double-close.
     */
    close(): void {
        if (!this.db) return; // ✅ guard — لو اتنادى تاني مرة مش هيعمل حاجة
        try {
            this.db.close((err) => {
                if (err) console.error('[FlutterExplorer] Error closing SQLite database:', err);
                else console.error('[FlutterExplorer] SQLite database connection closed cleanly.');
            });
        } catch (e) {
            console.error('[FlutterExplorer] Error closing SQLite database:', e);
        } finally {
            this.db = null;
            this.available = false;
        }
    }

    get isAvailable(): boolean {
        return this.available;
    }

    /**
     * Returns granular diagnostic information about the cache status.
     */
    async getDiagnostics(): Promise<any> {
        const dbPath = ProjectDetector.getDbPath(this.workspaceRoot);
        const stats = {
            available: this.available,
            readonly: this.readonlyMode,
            dbPath: dbPath,
            exists: fs.existsSync(dbPath),
            counts: {
                dart_files: 0,
                arb_files: 0,
                metadata: 0
            },
            error: null as string | null
        };

        if (this.available && this.db) {
            try {
                const getCount = (table: string): Promise<number> => {
                    return new Promise((resolve) => {
                        this.db!.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row: any) => {
                            if (err || !row) resolve(0);
                            else resolve(row.count || 0);
                        });
                    });
                };
                stats.counts.dart_files = await getCount('dart_files');
                stats.counts.arb_files = await getCount('arb_files');
                stats.counts.metadata = await getCount('metadata');
            } catch (e: any) {
                stats.error = e.message || String(e);
            }
        } else if (stats.exists) {
            try {
                await new Promise<void>((resolve, reject) => {
                    let tempDb: sqlite3.Database | null = null;
                    tempDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            if (tempDb) {
                                tempDb.close((closeErr) => {
                                    if (closeErr) reject(closeErr);
                                    else resolve();
                                });
                            } else {
                                resolve();
                            }
                        }
                    });
                });
            } catch (e: any) {
                stats.error = `Could not open database file: ${e.message || String(e)}`;
            }
        }

        return stats;
    }

    private _createTables(): void {
        const sql = `
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
        `;
        this.db?.exec(sql, (err) => {
            if (err) console.error('[FlutterExplorer] Error creating tables:', err);
        });
    }

    checkpoint(): void {
        // DELETE mode لا يحتاج checkpoint
    }

    // ── Dart file operations ───────────────────────────────────────────────────

    async upsertDartFile(relPath: string, hash: string | undefined, info: DartFileInfo): Promise<void> {
        if (this.available && !this.readonlyMode && this.db) {
            return new Promise((resolve) => {
                const sql = `
                    INSERT OR REPLACE INTO dart_files (path, hash, data, updated_at)
                    VALUES (?, ?, ?, ?)
                `;
                this.db!.run(sql, [relPath, hash ?? null, JSON.stringify(info), Date.now()], (err) => {
                    if (err) console.error('[FlutterExplorer] SQLite upsertDartFile error:', err);
                    resolve();
                });
            });
        } else {
            this.jsonCache.dartFiles[relPath] = { hash: hash ?? '', data: JSON.stringify(info) };
            this._saveJson();
            return Promise.resolve();
        }
    }

    async batchUpsertDartFiles(files: Array<{ relPath: string; hash: string | undefined; info: DartFileInfo }>): Promise<void> {
        if (this.available && !this.readonlyMode && this.db) {
            return new Promise((resolve) => {
                this.db!.serialize(() => {
                    this.db!.run('BEGIN TRANSACTION');
                    const stmt = this.db!.prepare(`
                        INSERT OR REPLACE INTO dart_files (path, hash, data, updated_at)
                        VALUES (?, ?, ?, ?)
                    `);
                    for (const item of files) {
                        stmt.run([item.relPath, item.hash ?? null, JSON.stringify(item.info), Date.now()]);
                    }
                    stmt.finalize();
                    this.db!.run('COMMIT', (err) => {
                        if (err) {
                            this.db!.run('ROLLBACK');
                            console.error('[FlutterExplorer] SQLite batchUpsertDartFiles error:', err);
                        }
                        resolve();
                    });
                });
            });
        } else {
            for (const f of files) {
                this.jsonCache.dartFiles[f.relPath] = { hash: f.hash ?? '', data: JSON.stringify(f.info) };
            }
            this._saveJson();
            return Promise.resolve();
        }
    }

    async getDartFile(relPath: string): Promise<{ hash: string; info: DartFileInfo } | null> {
        if (this.available && this.db) {
            return new Promise((resolve) => {
                this.db!.get('SELECT hash, data FROM dart_files WHERE path = ?', [relPath], (err, row: any) => {
                    if (err || !row) {
                        resolve(null);
                    } else {
                        try {
                            resolve({ hash: row.hash, info: JSON.parse(row.data) });
                        } catch {
                            resolve(null);
                        }
                    }
                });
            });
        } else {
            const entry = this.jsonCache.dartFiles[relPath];
            if (!entry) return Promise.resolve(null);
            return Promise.resolve({ hash: entry.hash, info: JSON.parse(entry.data) });
        }
    }

    async deleteDartFile(relPath: string): Promise<void> {
        if (this.available && !this.readonlyMode && this.db) {
            return new Promise((resolve) => {
                this.db!.run('DELETE FROM dart_files WHERE path = ?', [relPath], (err) => {
                    if (err) console.error('[FlutterExplorer] SQLite deleteDartFile error:', err);
                    resolve();
                });
            });
        } else {
            delete this.jsonCache.dartFiles[relPath];
            this._saveJson();
            return Promise.resolve();
        }
    }

    async getAllDartFiles(): Promise<Array<{ path: string; hash: string; info: DartFileInfo }>> {
        if (this.available && this.db) {
            return new Promise((resolve) => {
                this.db!.all('SELECT path, hash, data FROM dart_files', (err, rows: any[]) => {
                    if (err || !rows) {
                        resolve([]);
                    } else {
                        const result: Array<{ path: string; hash: string; info: DartFileInfo }> = [];
                        for (const r of rows) {
                            try {
                                result.push({ path: r.path, hash: r.hash, info: JSON.parse(r.data) });
                            } catch { /* skip corrupt */ }
                        }
                        resolve(result);
                    }
                });
            });
        } else {
            return Promise.resolve(Object.entries(this.jsonCache.dartFiles).map(([path, entry]) => ({
                path, hash: entry.hash, info: JSON.parse(entry.data)
            })));
        }
    }

    // ── ARB file operations ─────────────────────────────────────────────────────

    async upsertArbFile(relPath: string, translations: TranslationInfo[]): Promise<void> {
        if (this.available && !this.readonlyMode && this.db) {
            return new Promise((resolve) => {
                const sql = `
                    INSERT OR REPLACE INTO arb_files (path, data, updated_at)
                    VALUES (?, ?, ?)
                `;
                this.db!.run(sql, [relPath, JSON.stringify(translations), Date.now()], (err) => {
                    if (err) console.error('[FlutterExplorer] SQLite upsertArbFile error:', err);
                    resolve();
                });
            });
        } else {
            this.jsonCache.arbFiles[relPath] = { data: JSON.stringify(translations), updated_at: Date.now() };
            this._saveJson();
            return Promise.resolve();
        }
    }

    async deleteArbFile(relPath: string): Promise<void> {
        if (this.available && !this.readonlyMode && this.db) {
            return new Promise((resolve) => {
                this.db!.run('DELETE FROM arb_files WHERE path = ?', [relPath], (err) => {
                    if (err) console.error('[FlutterExplorer] SQLite deleteArbFile error:', err);
                    resolve();
                });
            });
        } else {
            delete this.jsonCache.arbFiles[relPath];
            this._saveJson();
            return Promise.resolve();
        }
    }

    async getAllArbFiles(): Promise<Array<{ path: string; translations: TranslationInfo[] }>> {
        if (this.available && this.db) {
            return new Promise((resolve) => {
                this.db!.all('SELECT path, data FROM arb_files', (err, rows: any[]) => {
                    if (err || !rows) {
                        resolve([]);
                    } else {
                        const result: Array<{ path: string; translations: TranslationInfo[] }> = [];
                        for (const r of rows) {
                            try {
                                result.push({ path: r.path, translations: JSON.parse(r.data) });
                            } catch { /* skip corrupt */ }
                        }
                        resolve(result);
                    }
                });
            });
        } else {
            return Promise.resolve(Object.entries(this.jsonCache.arbFiles).map(([path, entry]) => ({
                path, translations: JSON.parse(entry.data)
            })));
        }
    }

    // ── Metadata operations ─────────────────────────────────────────────────────

    async setMeta(key: string, value: any): Promise<void> {
        if (this.available && !this.readonlyMode && this.db) {
            return new Promise((resolve) => {
                const sql = `
                    INSERT OR REPLACE INTO metadata (key, data, updated_at)
                    VALUES (?, ?, ?)
                `;
                this.db!.run(sql, [key, JSON.stringify(value), Date.now()], (err) => {
                    if (err) console.error('[FlutterExplorer] SQLite setMeta error:', err);
                    resolve();
                });
            });
        } else {
            this.jsonCache.meta[key] = value;
            this._saveJson();
            return Promise.resolve();
        }
    }

    async getMeta<T>(key: string): Promise<T | null> {
        if (this.available && this.db) {
            return new Promise((resolve) => {
                this.db!.get('SELECT data FROM metadata WHERE key = ?', [key], (err, row: any) => {
                    if (err || !row) {
                        resolve(null);
                    } else {
                        try {
                            resolve(JSON.parse(row.data) as T);
                        } catch {
                            resolve(null);
                        }
                    }
                });
            });
        } else {
            return Promise.resolve((this.jsonCache.meta[key] as T) || null);
        }
    }

    async clearAll(): Promise<void> {
        if (this.available && !this.readonlyMode && this.db) {
            return new Promise((resolve) => {
                this.db!.serialize(() => {
                    this.db!.run('DELETE FROM dart_files');
                    this.db!.run('DELETE FROM arb_files');
                    this.db!.run('DELETE FROM metadata', (err) => {
                        if (err) console.error('[FlutterExplorer] SQLite clearAll error:', err);
                        resolve();
                    });
                });
            });
        } else {
            this.jsonCache = { dartFiles: {}, arbFiles: {}, meta: {} };
            this._saveJson();
            return Promise.resolve();
        }
    }

    /**
     * Finds the innermost node at a cursor position.
     */
    async getNodeAtCursor(relPath: string, line: number): Promise<any | null> {
        const fileInfo = await this.getDartFile(relPath);
        if (!fileInfo) return null;

        let bestNode: any = null;
        let bestRange = Infinity;

        const checkCandidate = (start: number, end: number, node: any) => {
            if (start <= line && line <= end) {
                const range = end - start;
                if (range < bestRange) {
                    bestRange = range;
                    bestNode = node;
                }
            }
        };

        // Classes
        for (const cls of fileInfo.info.classes) {
            checkCandidate(cls.line, cls.lineEnd ?? (cls.line + 100), { type: 'class', name: cls.name });
            if (cls.methods) {
                for (const method of cls.methods) {
                    checkCandidate(method.line, method.lineEnd ?? (method.line + 80), { type: 'method', name: method.name, parentClass: cls.name });
                }
            }
        }

        // Extensions
        if (fileInfo.info.extensions) {
            for (const ext of fileInfo.info.extensions) {
                checkCandidate(ext.line, (ext as any).lineEnd ?? (ext.line + 100), { type: 'extension', name: ext.name });
                if (ext.methods) {
                    for (const method of ext.methods) {
                        checkCandidate(method.line, method.lineEnd ?? (method.line + 80), { type: 'method', name: method.name, parentClass: ext.name });
                    }
                }
            }
        }

        // Extension Types
        if (fileInfo.info.extensionTypes) {
            for (const et of fileInfo.info.extensionTypes) {
                checkCandidate(et.line, et.lineEnd ?? (et.line + 100), { type: 'extensionType', name: et.name });
                if (et.methods) {
                    for (const method of et.methods) {
                        checkCandidate(method.line, method.lineEnd ?? (method.line + 80), { type: 'method', name: method.name, parentClass: et.name });
                    }
                }
            }
        }

        // Top-level functions
        for (const func of fileInfo.info.functions) {
            checkCandidate(func.line, func.lineEnd ?? (func.line + 80), { type: 'function', name: func.name });
        }

        return bestNode;
    }

    /**
     * BFS traversal to find impacted nodes within maxDepth.
     */
    async getImpactRadius(changedFiles: string[], maxDepth: number = 2): Promise<any> {
        const allFiles = await this.getAllDartFiles();
        const seeds = new Set<string>();

        for (const relPath of changedFiles) {
            const file = allFiles.find(f => f.path === relPath);
            if (file) {
                file.info.classes.forEach(c => seeds.add(c.name));
                file.info.functions.forEach(f => seeds.add(f.name));
            }
        }

        const visited = new Set<string>(seeds);
        let frontier = new Set<string>(seeds);
        const impacted = new Set<string>();

        for (let depth = 0; depth < maxDepth; depth++) {
            const nextFrontier = new Set<string>();
            for (const name of frontier) {
                for (const file of allFiles) {
                    const calls = file.info.functionCalls.filter(c => c.name === name);
                    if (calls.length > 0) {
                        file.info.classes.forEach(c => {
                            if (!visited.has(c.name)) {
                                nextFrontier.add(c.name);
                                visited.add(c.name);
                                impacted.add(c.name);
                            }
                        });
                    }

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