#[cfg(not(target_arch = "wasm32"))]
use rusqlite::{params, Connection, Result};
#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

#[cfg(not(target_arch = "wasm32"))]
pub struct NativeSqliteCache;

#[cfg(not(target_arch = "wasm32"))]
impl NativeSqliteCache {
    /// Open SQLite database with WAL mode and fast pragmas
    pub fn open(db_path: &Path) -> Result<Connection> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(db_path)?;

        // Apply high-performance, concurrency-friendly Pragmas
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
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

    /// Insert or update a parsed Dart file
    pub fn upsert_dart_file(conn: &Connection, path: &str, hash: &str, data: &str) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        conn.execute(
            "INSERT INTO dart_files (path, hash, data, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET
                hash = excluded.hash,
                data = excluded.data,
                updated_at = excluded.updated_at;",
            params![path, hash, data, now],
        )?;
        Ok(())
    }

    /// Read a specific Dart file's cached JSON data
    pub fn get_dart_file(conn: &Connection, path: &str) -> Result<Option<String>> {
        let mut stmt = conn.prepare("SELECT data FROM dart_files WHERE path = ?1 LIMIT 1;")?;
        let mut rows = stmt.query(params![path])?;

        if let Some(row) = rows.next()? {
            let data: String = row.get(0)?;
            Ok(Some(data))
        } else {
            Ok(None)
        }
    }

    /// Fetch all cached files for instant memory indexing
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

    /// Count rows in a table
    pub fn count_table(conn: &Connection, table: &str) -> usize {
        let sql = format!("SELECT COUNT(*) FROM {};", table);
        conn.query_row(&sql, [], |row| row.get(0)).unwrap_or(0)
    }
}
