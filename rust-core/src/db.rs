#[cfg(not(target_arch = "wasm32"))]
use rusqlite::{params, Connection, Result};
#[cfg(not(target_arch = "wasm32"))]
use std::collections::HashSet;
#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

#[cfg(not(target_arch = "wasm32"))]
pub struct NativeSqliteCache;

#[cfg(not(target_arch = "wasm32"))]
impl NativeSqliteCache {
    /// Deterministic 64-bit FNV-1a hash for fast content change detection without extra crates
    pub fn compute_hash(content: &str) -> String {
        const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
        const FNV_PRIME: u64 = 0x00000100000001b3;

        let mut hash = FNV_OFFSET_BASIS;
        for byte in content.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        format!("{:016x}", hash)
    }

    /// Open SQLite database with WAL mode and fast pragmas matching sqliteCache.ts
    pub fn open(db_path: &Path) -> Result<Connection> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(db_path)?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 10000;
             PRAGMA cache_size = -64000;",
        )?;

        Self::create_tables(&conn)?;

        Ok(conn)
    }

    /// Match tables from flutter-explorer sqliteCache.ts
    fn create_tables(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS dart_files (
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
            );",
        )?;
        Ok(())
    }

    fn now_millis() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }

    /// Insert or update a parsed Dart file
    pub fn upsert_dart_file(conn: &Connection, path: &str, hash: &str, data: &str) -> Result<()> {
        conn.execute(
            "INSERT INTO dart_files (path, hash, data, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET
                hash = excluded.hash,
                data = excluded.data,
                updated_at = excluded.updated_at;",
            params![path, hash, data, Self::now_millis()],
        )?;
        Ok(())
    }

    /// Read a specific Dart file's cached JSON data only if its content hash matches
    pub fn get_dart_file_if_hash_matches(
        conn: &Connection,
        path: &str,
        expected_hash: &str,
    ) -> Result<Option<String>> {
        let mut stmt =
            conn.prepare_cached("SELECT hash, data FROM dart_files WHERE path = ?1 LIMIT 1;")?;
        let mut rows = stmt.query(params![path])?;

        if let Some(row) = rows.next()? {
            let stored_hash: String = row.get(0).unwrap_or_default();
            if stored_hash == expected_hash {
                let data: String = row.get(1)?;
                return Ok(Some(data));
            }
        }
        Ok(None)
    }

    /// Read a specific Dart file's cached JSON data regardless of hash (supports VS Code cached rows)
    pub fn get_dart_file(conn: &Connection, path: &str) -> Result<Option<String>> {
        let mut stmt =
            conn.prepare_cached("SELECT data FROM dart_files WHERE path = ?1 LIMIT 1;")?;
        let mut rows = stmt.query(params![path])?;

        if let Some(row) = rows.next()? {
            let data: String = row.get(0)?;
            Ok(Some(data))
        } else {
            Ok(None)
        }
    }

    /// Delete a removed Dart file from the SQLite cache
    pub fn delete_dart_file(conn: &Connection, path: &str) -> Result<()> {
        conn.execute("DELETE FROM dart_files WHERE path = ?1;", params![path])?;
        Ok(())
    }

    /// Remove stale entries for files that no longer exist on disk
    pub fn prune_missing_files(
        conn: &Connection,
        existing_paths: &HashSet<String>,
    ) -> Result<usize> {
        let mut stmt = conn.prepare("SELECT path FROM dart_files;")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

        let mut removed = 0usize;
        for cached_path in rows.flatten() {
            if !existing_paths.contains(&cached_path) {
                let _ = Self::delete_dart_file(conn, &cached_path);
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Fetch all cached Dart files for instant memory indexing
    pub fn get_all_dart_files(conn: &Connection) -> Result<Vec<(String, String)>> {
        let mut stmt = conn.prepare("SELECT path, data FROM dart_files;")?;
        let rows = stmt.query_map([], |row| {
            let path: String = row.get(0)?;
            let data: String = row.get(1)?;
            Ok((path, data))
        })?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    }

    /// Fetch all cached ARB localization files (`(path, json_data)`)
    pub fn get_all_arb_files(conn: &Connection) -> Result<Vec<(String, String)>> {
        let mut stmt = conn.prepare("SELECT path, data FROM arb_files;")?;
        let rows = stmt.query_map([], |row| {
            let path: String = row.get(0)?;
            let data: String = row.get(1)?;
            Ok((path, data))
        })?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    }

    /// Insert or update an ARB localization file in the SQLite cache
    pub fn upsert_arb_file(conn: &Connection, path: &str, data: &str) -> Result<()> {
        conn.execute(
            "INSERT INTO arb_files (path, data, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at;",
            params![path, data, Self::now_millis()],
        )?;
        Ok(())
    }

    /// Read a metadata key (e.g. `diagnostics`, `packages`) stored by the VS Code extension
    pub fn get_metadata(conn: &Connection, key: &str) -> Result<Option<String>> {
        let mut stmt = conn.prepare_cached("SELECT data FROM metadata WHERE key = ?1 LIMIT 1;")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            let data: String = row.get(0)?;
            Ok(Some(data))
        } else {
            Ok(None)
        }
    }

    /// Write a metadata key (e.g. `diagnostics`, `packages`)
    pub fn set_metadata(conn: &Connection, key: &str, data: &str) -> Result<()> {
        conn.execute(
            "INSERT INTO metadata (key, data, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at;",
            params![key, data, Self::now_millis()],
        )?;
        Ok(())
    }

    /// Safely count rows in an allowed cache table
    pub fn count_table(conn: &Connection, table: &str) -> usize {
        let sql = match table {
            "dart_files" => "SELECT COUNT(*) FROM dart_files;",
            "arb_files" => "SELECT COUNT(*) FROM arb_files;",
            "metadata" => "SELECT COUNT(*) FROM metadata;",
            _ => return 0,
        };
        conn.query_row(sql, [], |row| row.get(0)).unwrap_or(0)
    }
}
