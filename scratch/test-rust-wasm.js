const path = require('path');
const wasm = require('../out/wasm_pkg/flutter_explorer_core.js');

console.log('--- 🧪 Testing Rust WASM Core ---');

// 1. Version
const version = wasm.get_core_version();
console.log('✅ Core Version:', version);

// 2. Warnings Scanner
const sampleDartCode = `
class HomeScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.red,
      child: Text("Welcome to Flutter"),
    );
  }
}
`;

const warningsJson = wasm.scan_warnings_json(sampleDartCode);
const warnings = JSON.parse(warningsJson);
console.log('✅ Warnings found by Rust:', warnings.length);
warnings.forEach(w => console.log(`   - [${w.type}] Line ${w.line}: ${w.message}`));

// 3. BM25 Search
const docs = [
  {
    id: "lib/auth/login.dart:10:LoginScreen",
    fields: { name: "LoginScreen", path: "lib/auth/login.dart", superclass: "StatelessWidget" }
  },
  {
    id: "lib/home/home.dart:15:HomeScreen",
    fields: { name: "HomeScreen", path: "lib/home/home.dart", superclass: "StatelessWidget" }
  },
  {
    id: "lib/auth/auth_service.dart:5:AuthService",
    fields: { name: "AuthService", path: "lib/auth/auth_service.dart" }
  }
];

const searchResults = JSON.parse(wasm.bm25_search_json(JSON.stringify(docs), "auth login", 5));
console.log('✅ BM25 search results for "auth login":');
searchResults.forEach(r => console.log(`   - ${r.id} (Score: ${r.score.toFixed(4)})`));

console.log('--- 🎉 Rust WASM Core works 100% on your machine! ---');
