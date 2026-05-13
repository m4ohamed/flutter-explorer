const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join('c:/Users/m4oha/OneDrive/Desktop/new/.flutter-explorer', 'flutter-explorer.db');

try {
    const db = new Database(dbPath, { readonly: true });
    
    console.log('Tables:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log(JSON.stringify(tables, null, 2));

    for (const table of tables) {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
        console.log(`Table ${table.name}: ${count.count} rows`);
    }

} catch (err) {
    console.error('Database error:', err.message);
}
