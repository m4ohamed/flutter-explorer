import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArbEditor, parseIcuMessage } from '../src/mcp-arb-editor';

// Keep backups out of the real home directory.
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-home-'));
process.env.USERPROFILE = process.env.HOME;

function project(files: Record<string, string>): { root: string; editor: ArbEditor } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-arb-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return { root, editor: new ArbEditor(root) };
}
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

const EN = JSON.stringify({ '@@locale': 'en', hello: 'Hello', bye: 'Bye' }, null, 4) + '\n';
const AR = JSON.stringify({ '@@locale': 'ar', hello: 'مرحبا', bye: 'وداعا' }, null, 4) + '\n';

test('a corrupt ARB file makes the write abort instead of wiping it (old code overwrote it with one key)', () => {
  const broken = '{\n  "@@locale": "ar",\n  "hello": "مرحبا",\n  <<<<<<< HEAD\n}\n';
  const { root, editor } = project({ 'lib/l10n/app_en.arb': EN, 'lib/l10n/app_ar.arb': broken });
  const r = editor.updateTranslation('newKey', { en: 'New', ar: 'جديد' });
  assert.equal(r.success, false);
  assert.match(r.message, /Cannot parse lib\/l10n\/app_ar\.arb/);
  assert.equal(read(root, 'lib/l10n/app_ar.arb'), broken);
  assert.equal(read(root, 'lib/l10n/app_en.arb'), EN, 'nothing is written when any file is unreadable');
});

test('values go only to matching locales; formatting is preserved', () => {
  const { root, editor } = project({
    'lib/l10n/app_en.arb': EN,
    'lib/l10n/app_ar.arb': AR.replace(/\n/g, '\r\n'),
    'lib/l10n/app_fr.arb': JSON.stringify({ '@@locale': 'fr', hello: 'Bonjour' }, null, 2) + '\n',
  });
  const r = editor.updateTranslation('welcome', { en: 'Welcome', ar: 'أهلا' }, undefined, 'greeting');
  assert.equal(r.success, true);
  assert.deepEqual(r.updatedFiles.sort(), ['lib/l10n/app_ar.arb', 'lib/l10n/app_en.arb']);
  assert.deepEqual(r.skippedFiles, ['lib/l10n/app_fr.arb']);

  const fr = JSON.parse(read(root, 'lib/l10n/app_fr.arb'));
  assert.equal(fr.welcome, undefined, 'French file must not receive English text');

  const enText = read(root, 'lib/l10n/app_en.arb');
  assert.match(enText, /^ {4}"welcome": "Welcome"/m, '4-space indentation kept');
  const arText = read(root, 'lib/l10n/app_ar.arb');
  assert.ok(arText.includes('\r\n') && !/[^\r]\n/.test(arText), 'CRLF kept');
  assert.equal(JSON.parse(arText).welcome, 'أهلا');
  assert.equal(JSON.parse(enText)['@welcome'].description, 'greeting');
});

test('legacy call with only enValue no longer writes "" into the Arabic file', () => {
  const { root, editor } = project({ 'lib/l10n/app_en.arb': EN, 'lib/l10n/app_ar.arb': AR });
  const r = editor.updateTranslation('onlyEnglish', '', 'English text');
  assert.equal(r.success, true);
  assert.equal(JSON.parse(read(root, 'lib/l10n/app_ar.arb')).onlyEnglish, undefined);
  assert.equal(JSON.parse(read(root, 'lib/l10n/app_en.arb')).onlyEnglish, 'English text');
});

test('single ARB file project: value is used even though locale cannot be matched', () => {
  const { root, editor } = project({ 'lib/l10n/intl_messages.arb': JSON.stringify({ a: 'A' }) });
  const r = editor.updateTranslation('b', { en: 'B' });
  assert.equal(r.success, true);
  assert.equal(JSON.parse(read(root, 'lib/l10n/intl_messages.arb')).b, 'B');
});

test('invalid keys are rejected', () => {
  const { editor } = project({ 'lib/l10n/app_en.arb': EN });
  for (const bad of ['__proto__', 'constructor', 'a-b', '@x', '1abc', '', 'a b']) {
    assert.equal(editor.updateTranslation(bad, { en: 'x' }).success, false, bad);
  }
});

test('batch apply reads once, writes each changed file once and reports failures', () => {
  const { root, editor } = project({ 'lib/l10n/app_en.arb': EN, 'lib/l10n/app_ar.arb': AR });
  const r = editor.batchApplyTranslations([
    { key: 'k1', translations: { en: 'One', ar: 'واحد' } },
    { key: 'k2', translations: { en: 'Two', ar: 'اثنان' }, description: 'two' },
    { key: 'bad-key', translations: { en: 'x' } },
    { key: 'k3', translations: { de: 'Drei' } }, // no German file
  ]);
  assert.equal(r.appliedCount, 2);
  assert.deepEqual(r.failedKeys?.sort(), ['bad-key', 'k3']);
  const en = JSON.parse(read(root, 'lib/l10n/app_en.arb'));
  const ar = JSON.parse(read(root, 'lib/l10n/app_ar.arb'));
  assert.equal(en.k1, 'One'); assert.equal(ar.k2, 'اثنان'); assert.equal(en['@k2'].description, 'two');
});

test('delete removes key and metadata everywhere, refuses when a file is corrupt', () => {
  const withMeta = JSON.stringify({ '@@locale': 'en', hello: 'Hello', '@hello': { description: 'd' }, bye: 'Bye' }, null, 2) + '\n';
  const { root, editor } = project({ 'lib/l10n/app_en.arb': withMeta, 'lib/l10n/app_ar.arb': AR });
  const r = editor.deleteTranslation('hello');
  assert.equal(r.success, true);
  assert.equal(JSON.parse(read(root, 'lib/l10n/app_en.arb')).hello, undefined);
  assert.equal(JSON.parse(read(root, 'lib/l10n/app_en.arb'))['@hello'], undefined);

  fs.writeFileSync(path.join(root, 'lib/l10n/app_ar.arb'), '{ broken');
  const r2 = editor.deleteTranslation('bye');
  assert.equal(r2.success, false);
  assert.equal(JSON.parse(read(root, 'lib/l10n/app_en.arb')).bye, 'Bye');
});

test('getAllTranslations reports unreadable files instead of hiding them', () => {
  const { editor } = project({ 'lib/l10n/app_en.arb': EN, 'lib/l10n/app_ar.arb': '{ nope' });
  const r = editor.getAllTranslations();
  assert.deepEqual(r.unreadableFiles, ['lib/l10n/app_ar.arb']);
  assert.deepEqual(r.keys, ['bye', 'hello']);
});

test('findArbFiles skips platform folders and node_modules', () => {
  const { editor } = project({
    'lib/l10n/app_en.arb': EN, 'android/app/x.arb': '{}', 'ios/Pods/y.arb': '{}', 'node_modules/z/z.arb': '{}', 'assets/l10n/app_ar.arb': AR,
  });
  assert.deepEqual(editor.findArbFiles(), ['assets/l10n/app_ar.arb', 'lib/l10n/app_en.arb']);
});

test('unused translations ignore generated localisation code but see real usage', () => {
  const { editor } = project({
    'lib/l10n/app_en.arb': JSON.stringify({ usedKey: 'a', stringUse: 'b', unusedKey: 'c', onlyInGenerated: 'd' }),
    'lib/main.dart': "import 'x.dart';\nvoid main() { print(S.of(context).usedKey); print('stringUse'.tr()); }\n",
    'lib/generated/l10n.dart': 'class S { String get usedKey => 1; String get unusedKey => 2; String get onlyInGenerated => 3; String get stringUse => 4; }',
    'lib/generated/intl/messages_en.dart': "'unusedKey': () => 'c', 'onlyInGenerated': () => 'd'",
    'lib/l10n/app_localizations_en.dart': 'String get unusedKey => "c";',
  });
  const r = editor.findUnusedTranslations();
  assert.deepEqual(r.unusedKeys.map(u => u.key).sort(), ['onlyInGenerated', 'unusedKey']);
  assert.equal(r.scannedFiles, 1);
});

// ── ICU ─────────────────────────────────────────────────────────────────────

test('ICU: plural/select branches are parsed properly', () => {
  const p = parseIcuMessage('{count, plural, =0{No items} one{1 item} other{{count} items for {user}}}');
  assert.deepEqual(Array.from(p.args).sort(), ['count', 'user']);
  assert.deepEqual(p.errors, []);

  const s = parseIcuMessage('{gender, select, male{He} female{She} other{They}} replied');
  assert.deepEqual(Array.from(s.args), ['gender'], 'branch words are not placeholders (old regex reported He/She/They)');
  assert.deepEqual(s.errors, []);
});

test('ICU: missing other branch, unclosed braces and unmatched braces are reported', () => {
  assert.equal(parseIcuMessage('{n, plural, one{x}}').errors[0].kind, 'other');
  assert.ok(parseIcuMessage('Hello {name').errors.length > 0);
  assert.ok(parseIcuMessage('Hello name}').errors.length > 0);
  assert.ok(parseIcuMessage('Hi {}').errors.length > 0);
});

test('ICU: quoted braces and typed arguments', () => {
  assert.deepEqual(parseIcuMessage("Use '{' to open and '}' to close").errors, []);
  assert.deepEqual(Array.from(parseIcuMessage('Total {price, number, currency}').args), ['price']);
  assert.deepEqual(Array.from(parseIcuMessage('{n, plural, offset:1 =0{none} other{# more}}').args), ['n']);
});

test('validateIcuPlaceholders compares locales and checks metadata', () => {
  const en = { '@@locale': 'en', msg: 'Hi {name}, you have {count, plural, =0{nothing} other{{count} items}}', '@msg': { placeholders: { name: {} } }, ok: 'Fine' };
  const ar = { '@@locale': 'ar', msg: 'مرحبا {name}', ok: 'تمام' };
  const { editor } = project({ 'lib/l10n/app_en.arb': JSON.stringify(en), 'lib/l10n/app_ar.arb': JSON.stringify(ar) });
  const r = editor.validateIcuPlaceholders();
  const types = r.issues.map(i => i.type).sort();
  assert.deepEqual(types, ['mismatched_placeholders', 'missing_metadata_placeholder']);
  assert.match(r.issues.find(i => i.type === 'mismatched_placeholders')!.message, /missing \[count\]/);
  assert.equal(r.valid, false);
});

test('missing translations payload still works', () => {
  const { editor } = project({
    'lib/l10n/app_en.arb': JSON.stringify({ '@@locale': 'en', a: 'A', b: 'B', '@b': { description: 'bee' } }),
    'lib/l10n/app_ar.arb': JSON.stringify({ '@@locale': 'ar', a: 'ا' }),
  });
  const r = editor.generateMissingTranslationsPayload('en');
  assert.equal(r.totalMissingEntries, 1);
  assert.equal(r.entries[0].key, 'b');
  assert.equal(r.entries[0].description, 'bee');
  assert.deepEqual(r.entries[0].missingInLocales, ['ar']);
});
