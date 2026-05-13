const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.join('c:/Users/m4oha/OneDrive/Desktop/new', '.flutter-explorer');
const dbPath = path.join(dataDir, 'flutter-explorer.db');
const jsonPath = path.join(dataDir, 'flutter-explorer.json');

try {
    console.log('Opening database:', dbPath);
    const db = new Database(dbPath, { readonly: true });

    // SQLite automatically handles the -wal file when you open the main .db file.
    
    const dartFiles = db.prepare('SELECT path, hash, data FROM dart_files').all();
    const arbFiles = db.prepare('SELECT path, data FROM arb_files').all();
    const metadata = db.prepare('SELECT key, data FROM metadata').all();

    const jsonCache = {
        dartFiles: {},
        arbFiles: {},
        meta: {}
    };

    for (const row of dartFiles) {
        try {
            jsonCache.dartFiles[row.path] = { hash: row.hash, data: JSON.parse(row.data) };
        } catch {
            jsonCache.dartFiles[row.path] = { hash: row.hash, data: row.data };
        }
    }

    for (const row of arbFiles) {
        try {
            jsonCache.arbFiles[row.path] = { data: JSON.parse(row.data), updated_at: Date.now() };
        } catch {
            jsonCache.arbFiles[row.path] = { data: row.data, updated_at: Date.now() };
        }
    }

    for (const row of metadata) {
        try {
            jsonCache.meta[row.key] = JSON.parse(row.data);
        } catch {
            jsonCache.meta[row.key] = row.data;
        }
    }

    fs.writeFileSync(jsonPath, JSON.stringify(jsonCache, null, 2));
    console.log('Successfully exported database to JSON:', jsonPath);
    console.log(`Exported ${dartFiles.length} Dart files, ${arbFiles.length} ARB files.`);

} catch (err) {
    console.error('Export error:', err.message);
}
