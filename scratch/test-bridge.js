const { RustBridge } = require('../out/indexer/rustBridge.js');

console.log('--- 🧪 Testing RustBridge in TypeScript/Node ---');
const bridge = RustBridge.getInstance();
const status = bridge.getStatus();
console.log('Bridge Status:', status);

const sampleCode = `
class SettingsPage extends StatelessWidget {
  Widget build(BuildContext context) {
    return Text("Settings Hardcoded");
  }
}
`;
const warnings = bridge.scanWarnings('lib/settings.dart', sampleCode);
console.log('Warnings detected through Bridge:', warnings);
