const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = "E:\\New folder\\sad\\sadara\\.flutter-explorer\\flutter-explorer.db";
const projectPath = "E:\\New folder\\sad\\sadara";

// محاكاة دالة readIndex() من mcp-server.ts  
function readIndex() {
    try {
        console.log('Connecting to database...');
        const db = new Database(dbPath, { readonly: true });

        console.log('Reading dart files from SQLite...');
        const dartRows = db.prepare('SELECT path, data FROM dart_files').all();
        console.log(`Found ${dartRows.length} dart files in SQLite`);

        if (dartRows.length > 0) {
            const index = {
                dart: {},
                arb: {},
                packages: [],
                diagnostics: []
            };

            // هذا بالضبط ما يفعله MCP server في السطر 58  
            for (const row of dartRows) {
                console.log(`Processing: ${row.path}`);
                const info = JSON.parse(row.data);
                index.dart[row.path] = info;
            }

            db.close();
            return index;
        }

        db.close();
        return null;
    } catch (error) {
        console.error("Error reading index:", error);
        return null;
    }
}

// محاكاة دالة flutter_get_code_block من mcp-server.ts  
function flutter_get_code_block(index, elementType, name, filePath = null, parentClass = null) {
    if (!index || !index.dart) {
        console.log('❌ Index not found or empty');
        return null;
    }

    console.log(`\n=== Searching for ${elementType} "${name}" ===`);

    let targetFile = filePath;

    // إذا لم يتم توفير filePath، ابحث عن العنصر  
    if (!targetFile) {
        console.log('Searching in all files...');
        for (const file in index.dart) {
            const info = index.dart[file];
            let found = false;

            if (elementType === 'class') {
                found = info.classes && info.classes.some(c => c.name === name);
            } else if (elementType === 'function') {
                found = info.functions && info.functions.some(f => f.name === name && !f.parentClass);
            } else if (elementType === 'method') {
                found = info.functions && info.functions.some(f => f.name === name && f.parentClass === parentClass);
            }

            if (found) {
                targetFile = file;
                console.log(`✅ Found in: ${file}`);
                break;
            }
        }
    }

    if (!targetFile) {
        console.log(`❌ Element not found: ${elementType} ${name}`);
        return null;
    }

    const info = index.dart[targetFile];
    console.log(`\n📋 File info for ${targetFile}:`);
    console.log(`  - Classes: ${info.classes ? info.classes.length : 0}`);
    console.log(`  - Functions: ${info.functions ? info.functions.length : 0}`);

    if (info.classes) {
        console.log(`  - Class names: ${info.classes.map(c => c.name).join(', ')}`);
    }

    return {
        elementType,
        name,
        filePath: targetFile,
        fileInfo: info
    };
}

console.log('=== MCP Server Simulation ===\n');

// 1. قراءة الفهرس  
const index = readIndex();

if (!index) {
    console.log('❌ Failed to read index');
} else {
    console.log(`\n✅ Index loaded successfully`);
    console.log(`   Total files in index: ${Object.keys(index.dart).length}`);

    // 2. عرض جميع الكلاسات المتاحة  
    console.log('\n=== All Classes in Index ===');
    for (const file in index.dart) {
        const info = index.dart[file];
        if (info.classes && info.classes.length > 0) {
            for (const cls of info.classes) {
                console.log(`  - ${cls.name} (${file}) - type: ${cls.type}, extends: ${cls.extendsClass}`);
            }
        }
    }

    // 3. محاولة البحث عن EmployeeDashboardScreen  
    console.log('\n=== Test: Search for EmployeeDashboardScreen ===');
    const result = flutter_get_code_block(index, 'class', 'EmployeeDashboardScreen');

    if (result) {
        console.log('\n✅ SUCCESS: Found the class!');
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log('\n❌ FAILED: Could not find the class');
    }

    // 4. فحص البيانات الخام للملف المحدد  
    console.log('\n=== Raw Data Check ===');
    const targetFile = 'lib/presentation/screens/employee/employee_dashboard_screen.dart';
    if (index.dart[targetFile]) {
        console.log(`File: ${targetFile}`);
        console.log('Raw data from database:');
        console.log(JSON.stringify(index.dart[targetFile], null, 2));
    } else {
        console.log(`❌ File not found in index: ${targetFile}`);
    }
}