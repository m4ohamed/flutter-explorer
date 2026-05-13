
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = "E:\\New folder\\sad\\sadara\\.flutter-explorer\\flutter-explorer.db";

try {
    console.log(`Connecting to ${dbPath}...`);
    const db = new Database(dbPath, { readonly: true });
    
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log("Tables:", tables);

    for (const table of tables) {
        const count = db.prepare(`SELECT count(*) as count FROM ${table.name}`).get();
        console.log(`Table ${table.name}: ${count.count} rows`);
    }

    const hasDartFiles = tables.some(t => t.name === 'dart_files');
    if (hasDartFiles) {
        const sample = db.prepare("SELECT path FROM dart_files LIMIT 5").all();
        console.log("Sample dart_files paths:", sample);
    }

    db.close();
} catch (e) {
    console.error("Error:", e);
}
