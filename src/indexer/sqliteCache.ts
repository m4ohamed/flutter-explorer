/**
 * SQLite Cache - Replaces the monolithic JSON cache.
 *
 * Uses dynamic loading for `sqlite3` to prevent Electron ABI crashes in VS Code,
 * and configures WAL mode for lock-free concurrent access with the Rust MCP server.
 */

import * as path from 'path';
import * as fs from 'fs';
import { DartFileInfo } from './dartParser';
import { TranslationInfo } from './indexManager';
import { ProjectDetector } from '../utils/projectDetector';
import type sqlite3Type from 'sqlite3';

// Load native `sqlite3` addon dynamically inside a protective try/catch so an Electron
// NODE_MODULE_VERSION mismatch never crashes extension activation at module load time.
let sqlite3Lib: typeof sqlite3Type | null = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sqlite3Lib = require('sqlite3');
} catch (err) {
    console.warn('[FlutterExplorer] Native sqlite3 addon unavailable; falling back to JSON/memory cache:', err);
    sqlite3Lib = null;
}

export class SqliteCache {
    private db: sqlite3Type.Database | null = null;
    private available = false;
    private readonlyMode = false;
    private workspaceRoot: string;
    private dbPath: string = '';
    private dbFilename: string = 'flutter-explorer.db';
    private jsonPath: string | null = null;
    private jsonCache: {
        dartFiles: Record<string, { hash: string; data: string }>;
        arbFiles: Record<string, { data: string; updated_at: number }>;
        meta: Record<string, any>;
    } = { dartFiles: {}, arbFiles: {}, meta: {} };

    constructor(workspaceRoot: string, options: { readonly?: boolean; dbName?: string } = {}) {
        this.workspaceRoot = workspaceRoot;
        this.readonlyMode = !!options.readonly;
        this.dbFilename = options.dbName || 'flutter-explorer.db';

        try {
            const dataDir = ProjectDetector.getDataDir(workspaceRoot);
            this.dbPath = path.join(dataDir, this.dbFilename);
            this.jsonPath = path.join(dataDir, this.dbFilename.replace('.db', '.json'));
            const dbPath = this.dbPath;

            // Legacy check: Move from .vscode if exists
            const legacyDir = path.join(workspaceRoot, '.vscode');
            const legacyDb = path.join(legacyDir, 'flutter-explorer.db');
            if (fs.existsSync(legacyDb) && !fs.existsSync(dbPath)) {
                console.log('[FlutterExplorer] Migrating legacy database from .vscode to .flutter-explorer');
                fs.copyFileSync(legacyDb, dbPath);

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
                    fs.unlinkSync(legacyJson);
                } catch (e) {
                    console.warn('[FlutterExplorer] Could not delete legacy JSON cache:', e);
                }
            }

            if (!sqlite3Lib) {
                this.available = false;
                this._loadJson();
                return;
            }

            const mode = this.readonlyMode
                ? sqlite3Lib.OPEN_READONLY
                : (sqlite3Lib.OPEN_READWRITE | sqlite3Lib.OPEN_CREATE);
            this.available = true;
            this.db = new sqlite3Lib.Database(dbPath, mode, (err) => {
                if (err) {
                    console.error(`[FlutterExplorer] Failed to initialize sqlite3 database: ${err.message || String(err)}`);
                    this.db = null;
                    this.available = false;
                    this._loadJson();
                } else {
                    console.log(`[FlutterExplorer] sqlite3 cache initialized (${this.readonlyMode ? 'READONLY' : 'READ/WRITE'}).`);
                }
            });

            this.db.serialize();

            this.db.exec('PRAGMA busy_timeout = 10000;', () => {});
            if (!this.readonlyMode) {
                // Unified WAL mode across both TypeScript and Rust NativeSqliteCache to prevent lock contention
                this.db.exec('PRAGMA journal_mode = WAL;', () => {});
                this.db.exec('PRAGMA synchronous = NORMAL;', () => {});
                this.db.exec('PRAGMA wal_autocheckpoint = 1000;', () => {});
                this._createTables();
            }
        } catch (e) {
            console.warn('[FlutterExplorer] Cache init error, using memory/JSON fallback:', e);
            this.db = null;
            this.available = false;
            this._loadJson();
        }
    }

    close(): void {
        if (!this.db) return;
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

    async getDiagnostics(): Promise<any> {
        const dbPath = this.dbPath || ProjectDetector.getDbPath(this.workspaceRoot);
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
                const getCount = (table: 'dart_files' | 'arb_files' | 'metadata'): Promise<number> => {
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
        } else if (stats.exists && sqlite3Lib) {
            try {
                await new Promise<void>((resolve, reject) => {
                    let tempDb: sqlite3Type.Database | null = null;
                    tempDb = new sqlite3Lib!.Database(dbPath, sqlite3Lib!.OPEN_READONLY, (err) => {
                        if (err) {
                            reject(err);
                        } else if (tempDb) {
                            tempDb.close((closeErr) => {
                                if (closeErr) reject(closeErr);
                                else resolve();
                            });
                        } else {
                            resolve();
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
        if (this.available && !this.readonlyMode && this.db) {
            this.db.exec('PRAGMA wal_checkpoint(PASSIVE);', () => {});
        }
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
        if (files.length === 0) return Promise.resolve();

        if (this.available && !this.readonlyMode && this.db) {
            return new Promise((resolve) => {
                let settled = false;
                const finish = () => {
                    if (!settled) {
                        settled = true;
                        resolve();
                    }
                };

                // Safety timeout so an OS/OneDrive file lock never hangs indexing forever
                const timer = setTimeout(() => {
                    console.warn('[FlutterExplorer] SQLite batchUpsertDartFiles timed out after 10s; continuing.');
                    finish();
                }, 10000);

                this.db!.serialize(() => {
                    this.db!.run('BEGIN TRANSACTION');
                    const stmt = this.db!.prepare(`
                        INSERT OR REPLACE INTO dart_files (path, hash, data, updated_at)
                        VALUES (?, ?, ?, ?)
                    `);
                    let pending = files.length;
                    const now = Date.now();

                    for (const item of files) {
                        stmt.run([item.relPath, item.hash ?? null, JSON.stringify(item.info), now], () => {
                            pending--;
                            if (pending === 0) {
                                stmt.finalize(() => {
                                    this.db?.run('COMMIT', (err) => {
                                        clearTimeout(timer);
                                        if (err) {
                                            this.db?.run('ROLLBACK', () => {});
                                            console.error('[FlutterExplorer] SQLite batchUpsertDartFiles error:', err);
                                        }
                                        finish();
                                    });
                                });
                            }
                        });
                    }
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
            return Promise.resolve(Object.entries(this.jsonCache.dartFiles).map(([p, entry]) => ({
                path: p, hash: entry.hash, info: JSON.parse(entry.data)
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
            return Promise.resolve(Object.entries(this.jsonCache.arbFiles).map(([p, entry]) => ({
                path: p, translations: JSON.parse(entry.data)
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

        for (const cls of fileInfo.info.classes || []) {
            checkCandidate(cls.line, cls.lineEnd ?? (cls.line + 100), { type: 'class', name: cls.name });
            if (cls.methods) {
                for (const method of cls.methods) {
                    checkCandidate(method.line, method.lineEnd ?? (method.line + 80), { type: 'method', name: method.name, parentClass: cls.name });
                }
            }
        }

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

        for (const func of fileInfo.info.functions || []) {
            checkCandidate(func.line, func.lineEnd ?? (func.line + 80), { type: 'function', name: func.name });
        }

        if (fileInfo.info.enums) {
            for (const en of fileInfo.info.enums) {
                checkCandidate(en.line, (en as any).lineEnd ?? (en.line + 30), { type: 'enum', name: en.name });
            }
        }

        if (fileInfo.info.mixins) {
            for (const mx of fileInfo.info.mixins) {
                checkCandidate(mx.line, (mx as any).lineEnd ?? (mx.line + 60), { type: 'mixin', name: mx.name });
            }
        }

        if (fileInfo.info.typedefs) {
            for (const td of fileInfo.info.typedefs) {
                checkCandidate(td.line, td.line + 5, { type: 'typedef', name: td.name });
            }
        }

        return bestNode;
    }

    async getImpactRadius(changedFiles: string[], maxDepth: number = 2): Promise<any> {
        const allFiles = await this.getAllDartFiles();
        const seeds = new Set<string>();

        for (const relPath of changedFiles) {
            const file = allFiles.find(f => f.path === relPath);
            if (file) {
                file.info.classes?.forEach(c => seeds.add(c.name));
                file.info.functions?.forEach(f => seeds.add(f.name));
                file.info.mixins?.forEach(m => seeds.add(m.name));
                file.info.extensionTypes?.forEach(et => seeds.add(et.name));
                file.info.extensions?.forEach(ext => seeds.add(ext.name));
                file.info.typedefs?.forEach(td => seeds.add(td.name));
            }
        }

        const visited = new Set<string>(seeds);
        let frontier = new Set<string>(seeds);
        const impacted = new Set<string>();

        for (let depth = 0; depth < maxDepth; depth++) {
            const nextFrontier = new Set<string>();
            for (const name of frontier) {
                for (const file of allFiles) {
                    const calls = (file.info.functionCalls || []).filter(c => c.name === name);
                    if (calls.length > 0) {
                        file.info.classes?.forEach(c => {
                            if (!visited.has(c.name)) {
                                nextFrontier.add(c.name);
                                visited.add(c.name);
                                impacted.add(c.name);
                            }
                        });
                        file.info.functions?.forEach(f => {
                            if (!visited.has(f.name)) {
                                nextFrontier.add(f.name);
                                visited.add(f.name);
                                impacted.add(f.name);
                            }
                        });
                    }

                    file.info.classes?.forEach(c => {
                        const isDerived = c.extendsClass === name ||
                            (c.implements && c.implements.includes(name)) ||
                            (c.mixins && c.mixins.includes(name));
                        if (isDerived && !visited.has(c.name)) {
                            nextFrontier.add(c.name);
                            visited.add(c.name);
                            impacted.add(c.name);
                        }
                    });

                    file.info.extensionTypes?.forEach(et => {
                        const isRelated = et.representationType === name ||
                            (et.implements && et.implements.includes(name));
                        if (isRelated && !visited.has(et.name)) {
                            nextFrontier.add(et.name);
                            visited.add(et.name);
                            impacted.add(et.name);
                        }
                    });

                    file.info.extensions?.forEach(ext => {
                        if (ext.onType === name && !visited.has(ext.name)) {
                            nextFrontier.add(ext.name);
                            visited.add(ext.name);
                            impacted.add(ext.name);
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