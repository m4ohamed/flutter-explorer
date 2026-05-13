const Database = require('better-sqlite3');
const path = require('path');

const dbPath = 'c:/Users/m4oha/OneDrive/Desktop/new/.flutter-explorer/flutter-explorer.db';

try {
    console.log('Opening database to perform checkpoint:', dbPath);
    const db = new Database(dbPath);
    
    // Force a full checkpoint (merge WAL into DB)
    console.log('Performing checkpoint...');
    db.pragma('wal_checkpoint(TRUNCATE)');
    
    console.log('Checkpoint complete. Data should now be in the main .db file.');
    db.close();

} catch (err) {
    console.error('Checkpoint error:', err.message);
}
