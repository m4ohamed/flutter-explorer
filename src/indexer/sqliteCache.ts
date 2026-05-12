/**
 * SQLite Cache - Replaces the monolithic JSON cache.
 *
 * Why SQLite instead of one big JSON file?
 *   JSON:   read/write the entire file (could be 5MB+) on every file change
 *   SQLite: read/write only the changed row in milliseconds
 *
 * Falls back to no-op (memory-only) if better-sqlite3 is unavailable,
 * so the extension never crashes due to native module issues.
 */

import * as path from 'path';
import * as fs from 'fs';
import { DartFileInfo } from './dartParser';
import { TranslationInfo, DiagnosticInfo } from './indexManager';
import { PackageInfo } from '../providers/pubspecLockProvider';

// Lazily require better-sqlite3 to handle cases where it's not compiled yet.
let Database: any = null;
function getDatabase() {
    if (!Database) {
        try {
            Database = require('better-sqlite3');
        } catch {
            Database = null;
        }
    }
    return Database;
}

export class SqliteCache {
    private db: any = null;
    private available = false;

    constructor(workspaceRoot: string) {
        const DB = getDatabase();
        if (!DB) {
            console.warn('[FlutterExplorer] better-sqlite3 not available — using JSON fallback');
            return;
        }

        try {
            const dir = path.join(workspaceRoot, '.vscode');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const dbPath = path.join(dir, 'flutter-explorer.db');
            this.db = new DB(dbPath);
            this.db.pragma('journal_mode = WAL');   // faster concurrent reads
            this.db.pragma('synchronous = NORMAL'); // safe but not slow
            this._createTables();
            this.available = true;
        } catch (e) {
            console.warn('[FlutterExplorer] SQLite init error:', e);
            this.db = null;
        }
    }

    get isAvailable(): boolean {
        return this.available;
    }

    // ── Schema ──────────────────────────────────────────────────────────────────

    private _createTables(): void {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS dart_files (
        path       TEXT PRIMARY KEY,
        hash       TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS arb_files (
        path       TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_dart_hash ON dart_files(hash);
    `);
    }

    // ── Dart file operations ────────────────────────────────────────────────────

    /** Write or update a single dart file entry. O(1) — only touches one row. */
    upsertDartFile(relPath: string, hash: string, info: DartFileInfo): void {
        if (!this.available) return;
        try {
            this.db.prepare(`
        INSERT OR REPLACE INTO dart_files (path, hash, data, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(relPath, hash, JSON.stringify(info), Date.now());
        } catch (e) {
            console.error('[FlutterExplorer] SQLite upsertDartFile error:', e);
        }
    }

    /** Read a single dart file entry. */
    getDartFile(relPath: string): { hash: string; info: DartFileInfo } | null {
        if (!this.available) return null;
        try {
            const row = this.db.prepare(
                'SELECT hash, data FROM dart_files WHERE path = ?'
            ).get(relPath) as { hash: string; data: string } | undefined;
            if (!row) return null;
            return { hash: row.hash, info: JSON.parse(row.data) };
        } catch {
            return null;
        }
    }

    /** Delete a dart file entry (called on file delete). */
    deleteDartFile(relPath: string): void {
        if (!this.available) return;
        try {
            this.db.prepare('DELETE FROM dart_files WHERE path = ?').run(relPath);
        } catch (e) {
            console.error('[FlutterExplorer] SQLite deleteDartFile error:', e);
        }
    }

    /** Load all dart files at startup. */
    getAllDartFiles(): Array<{ path: string; hash: string; info: DartFileInfo }> {
        if (!this.available) return [];
        try {
            const rows = this.db.prepare(
                'SELECT path, hash, data FROM dart_files'
            ).all() as Array<{ path: string; hash: string; data: string }>;
            return rows.map(r => ({ path: r.path, hash: r.hash, info: JSON.parse(r.data) }));
        } catch {
            return [];
        }
    }

    // ── ARB file operations ─────────────────────────────────────────────────────

    upsertArbFile(relPath: string, translations: TranslationInfo[]): void {
        if (!this.available) return;
        try {
            this.db.prepare(`
        INSERT OR REPLACE INTO arb_files (path, data, updated_at)
        VALUES (?, ?, ?)
      `).run(relPath, JSON.stringify(translations), Date.now());
        } catch (e) {
            console.error('[FlutterExplorer] SQLite upsertArbFile error:', e);
        }
    }

    deleteArbFile(relPath: string): void {
        if (!this.available) return;
        try {
            this.db.prepare('DELETE FROM arb_files WHERE path = ?').run(relPath);
        } catch (e) {
            console.error('[FlutterExplorer] SQLite deleteArbFile error:', e);
        }
    }

    getAllArbFiles(): Array<{ path: string; translations: TranslationInfo[] }> {
        if (!this.available) return [];
        try {
            const rows = this.db.prepare(
                'SELECT path, data FROM arb_files'
            ).all() as Array<{ path: string; data: string }>;
            return rows.map(r => ({ path: r.path, translations: JSON.parse(r.data) }));
        } catch {
            return [];
        }
    }

    // ── Metadata (packages, diagnostics) ───────────────────────────────────────

    setMeta(key: string, value: unknown): void {
        if (!this.available) return;
        try {
            this.db.prepare(`
        INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)
      `).run(key, JSON.stringify(value));
        } catch (e) {
            console.error('[FlutterExplorer] SQLite setMeta error:', e);
        }
    }

    getMeta<T>(key: string): T | null {
        if (!this.available) return null;
        try {
            const row = this.db.prepare(
                'SELECT value FROM meta WHERE key = ?'
            ).get(key) as { value: string } | undefined;
            if (!row) return null;
            return JSON.parse(row.value) as T;
        } catch {
            return null;
        }
    }

    // ── Bulk clear ──────────────────────────────────────────────────────────────

    /** Called before a full re-index to start fresh. */
    clearAll(): void {
        if (!this.available) return;
        try {
            this.db.exec('DELETE FROM dart_files; DELETE FROM arb_files;');
        } catch (e) {
            console.error('[FlutterExplorer] SQLite clearAll error:', e);
        }
    }

    close(): void {
        try { this.db?.close(); } catch { /* ignore */ }
    }
}