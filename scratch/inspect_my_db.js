const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = "E:\\New folder\\sad\\sadara\\.flutter-explorer\\flutter-explorer.db";
const projectPath = "E:\\New folder\\sad\\sadara";

// محاكاة أداة flutter_get_code_block من MCP server  
function getCodeBlock(className, elementType = 'class', filePath = null, parentClass = null) {
    try {
        console.log(`Connecting to database...`);
        const db = new Database(dbPath, { readonly: true });

        // قراءة جميع ملفات Dart من الفهرس  
        const dartFiles = db.prepare('SELECT path, data FROM dart_files').all();
        console.log(`Found ${dartFiles.length} indexed files`);

        let targetFile = null;
        let fileInfo = null;

        // البحث عن الكلاس في الفهرس  
        for (const row of dartFiles) {
            const info = JSON.parse(row.data);

            if (elementType === 'class') {
                if (info.classes && info.classes.some(c => c.name === className)) {
                    targetFile = row.path;
                    fileInfo = info;
                    break;
                }
            } else if (elementType === 'function') {
                if (info.functions && info.functions.some(f => f.name === className && !f.parentClass)) {
                    targetFile = row.path;
                    fileInfo = info;
                    break;
                }
            } else if (elementType === 'method') {
                if (info.functions && info.functions.some(f => f.name === className && f.parentClass === parentClass)) {
                    targetFile = row.path;
                    fileInfo = info;
                    break;
                }
            }
        }

        db.close();

        if (!targetFile) {
            console.log(`❌ ${elementType} '${className}' not found in index`);
            return null;
        }

        console.log(`✅ Found in file: ${targetFile}`);

        // قراءة الملف الأصلي  
        const fullPath = path.join(projectPath, targetFile);
        const fileContent = fs.readFileSync(fullPath, 'utf-8');

        // استخراج الكود باستخدام regex بسيط (محاكاة DartParser.extractCodeBlock)  
        const codeBlock = extractCodeBlockSimple(fileContent, elementType, className, parentClass);

        if (!codeBlock) {
            console.log(`❌ Could not extract code block`);
            return null;
        }

        return {
            elementType,
            name: className,
            filePath: targetFile,
            startLine: codeBlock.startLine,
            endLine: codeBlock.endLine,
            body: codeBlock.body
        };

    } catch (error) {
        console.error('❌ Error:', error.message);
        return null;
    }
}

// دالة بسيطة لاستخراج كود كلاس أو دالة (محاكاة DartParser)  
function extractCodeBlockSimple(content, elementType, name, parentClass = null) {
    const lines = content.split('\n');
    let startLine = -1;
    let endLine = -1;
    let braceCount = 0;
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!inBlock) {
            // البحث عن بداية الكلاس/الدالة  
            let pattern = '';
            if (elementType === 'class') {
                pattern = new RegExp(`class\\s+${name}\\s`);
            } else if (elementType === 'function') {
                pattern = new RegExp(`\\b${name}\\s*\\(`);
            } else if (elementType === 'method') {
                pattern = new RegExp(`\\b${name}\\s*\\(`);
            }

            if (pattern.test(line)) {
                // التحقق من parentClass للـ methods  
                if (elementType === 'method' && parentClass) {
                    // نحتاج للتحقق أننا داخل الكلاس الصحيح  
                    // هذا تبسيط، في الواقع نحتاج تحليل أفضل  
                }

                startLine = i + 1;
                inBlock = true;

                // حساب الأقواس المتعرجة  
                braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

                if (braceCount === 0 && line.includes('{')) {
                    // سطر واحد  
                    endLine = i + 1;
                    break;
                }
            }
        } else {
            // نحن داخل البلوك  
            braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

            if (braceCount === 0) {
                endLine = i + 1;
                break;
            }
        }
    }

    if (startLine === -1 || endLine === -1) {
        return null;
    }

    const body = lines.slice(startLine - 1, endLine).join('\n');

    return {
        startLine,
        endLine,
        body
    };
}

// مثال الاستخدام  
console.log('=== MCP Simulation: Get Code Block ===\n');

const result = getCodeBlock('EmployeeDashboardScreen', 'class');

if (result) {
    console.log('\n📋 Result:');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n📄 Code Body:');
    console.log('─'.repeat(50));
    console.log(result.body);
    console.log('─'.repeat(50));
} else {
    console.log('\n❌ Class not found. Try searching for available classes:');

    // عرض الكلاسات المتاحة  
    const db = new Database(dbPath, { readonly: true });
    const dartFiles = db.prepare('SELECT path, data FROM dart_files').all();

    console.log('\n📚 Available Classes:');
    for (const row of dartFiles) {
        const info = JSON.parse(row.data);
        if (info.classes && info.classes.length > 0) {
            for (const cls of info.classes) {
                console.log(`  - ${cls.name} (${row.path}:${cls.line})`);
            }
        }
    }

    db.close();
}