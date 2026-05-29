/**
 * Intl Generator — Built-in ARB → Dart localization code generator.
 *
 * Replicates the output of `intl_utils:generate` / Flutter Intl IDE plugin
 * so that no external dependency is needed.
 *
 * Supports:
 *   - Simple messages
 *   - Parameterized messages with {placeholder}
 *   - ICU plural: {count, plural, one{...} other{...}}
 *   - ICU gender: {gender, select, male{...} female{...} other{...}}
 *   - ICU select: {role, select, admin{...} other{...}}
 *   - Placeholder ordering from @key.placeholders metadata
 *   - Number/DateTime formatting placeholders
 *
 * Generated files:
 *   - lib/generated/l10n.dart            (class S + AppLocalizationDelegate)
 *   - lib/generated/intl/messages_all.dart
 *   - lib/generated/intl/messages_XX.dart  (one per locale)
 */
import * as fs from 'fs';
import * as path from 'path';

// ── Interfaces ──────────────────────────────────────────────────────────────

interface ArbPlaceholder {
  name: string;
  type: string; // 'String' | 'int' | 'double' | 'num' | 'DateTime' | 'Object'
  format?: string;
  optionalParameters?: Record<string, any>;
  isCustomDateFormat?: boolean;
}

/** ICU parsed segment inside a message value */
interface IcuSegment {
  variable: string;
  type: 'plural' | 'gender' | 'select';
  cases: Map<string, string>; // e.g. { one: '1 message', other: '{count} messages' }
}

interface ArbEntry {
  key: string;
  value: string;
  description: string;
  placeholders: ArbPlaceholder[];
  icu: IcuSegment | null; // null for simple/parameterized messages
}

interface ArbFile {
  locale: string;
  filePath: string;
  entries: ArbEntry[];
  entryMap: Map<string, ArbEntry>;
}

interface IntlConfig {
  enabled: boolean;
  arbDir: string;       // default: lib/l10n
  outputDir: string;    // default: lib/generated
  className: string;    // default: S
  mainLocale: string;   // default: en
  useDeferredLoading: boolean;
}

// ── Main Generator ──────────────────────────────────────────────────────────

export class IntlGenerator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Check whether this project uses flutter_intl and generation is enabled. */
  isEnabled(): boolean {
    return this.readConfig().enabled;
  }

  /** Read the current flutter_intl config from pubspec.yaml */
  getConfig(): IntlConfig {
    return this.readConfig();
  }

  /**
   * Initialize flutter_intl for the project.
   * Creates default ARB file and adds config to pubspec.yaml.
   */
  initialize(mainLocale: string = 'en'): string[] {
    const pubspecPath = path.join(this.projectRoot, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
      throw new Error('pubspec.yaml not found in project root');
    }

    const content = fs.readFileSync(pubspecPath, 'utf-8');
    const created: string[] = [];

    // Add flutter_intl config if not present
    if (!content.match(/^flutter_intl:/m)) {
      const configBlock = `\nflutter_intl:\n  enabled: true\n`;
      fs.writeFileSync(pubspecPath, content + configBlock, 'utf-8');
    }

    // Create default ARB directory and file
    const arbDir = path.join(this.projectRoot, 'lib', 'l10n');
    fs.mkdirSync(arbDir, { recursive: true });

    const arbFile = path.join(arbDir, `intl_${mainLocale}.arb`);
    if (!fs.existsSync(arbFile)) {
      const defaultArb = JSON.stringify({ [`@@locale`]: mainLocale }, null, 2);
      fs.writeFileSync(arbFile, defaultArb, 'utf-8');
      created.push(`lib/l10n/intl_${mainLocale}.arb`);
    }

    // Run generation
    const generated = this.generate();
    return [...created, ...generated];
  }

  /**
   * Add a new locale to the project.
   * Creates an ARB file with @@locale and runs generation.
   */
  addLocale(locale: string): string[] {
    const config = this.readConfig();
    const arbDir = path.join(this.projectRoot, config.arbDir);
    fs.mkdirSync(arbDir, { recursive: true });

    const arbFile = path.join(arbDir, `intl_${locale}.arb`);
    if (fs.existsSync(arbFile)) {
      throw new Error(`Locale "${locale}" already exists`);
    }

    // Create ARB with @@locale and copy keys from main locale (empty values)
    const mainArbPath = path.join(arbDir, `intl_${config.mainLocale}.arb`);
    let newArbData: Record<string, any> = { '@@locale': locale };

    if (fs.existsSync(mainArbPath)) {
      try {
        const mainData = JSON.parse(fs.readFileSync(mainArbPath, 'utf-8'));
        for (const key of Object.keys(mainData)) {
          if (!key.startsWith('@')) {
            newArbData[key] = ''; // Empty value — needs translation
          } else if (key.startsWith('@@')) {
            // Skip global metadata except @@locale
          } else {
            newArbData[key] = mainData[key]; // Copy @key metadata
          }
        }
      } catch { /* ignore parse errors */ }
    }

    fs.writeFileSync(arbFile, JSON.stringify(newArbData, null, 2), 'utf-8');

    const generated = this.generate();
    return [`${config.arbDir}/intl_${locale}.arb`, ...generated];
  }

  /**
   * Remove a locale from the project.
   * Deletes the ARB file and reruns generation.
   */
  removeLocale(locale: string): string[] {
    const config = this.readConfig();
    if (locale === config.mainLocale) {
      throw new Error(`Cannot remove main locale "${locale}"`);
    }

    const arbFile = path.join(this.projectRoot, config.arbDir, `intl_${locale}.arb`);
    if (!fs.existsSync(arbFile)) {
      throw new Error(`Locale "${locale}" not found`);
    }

    fs.unlinkSync(arbFile);

    // Also remove generated messages file
    const msgFile = path.join(this.projectRoot, config.outputDir, 'intl', `messages_${locale}.dart`);
    if (fs.existsSync(msgFile)) {
      fs.unlinkSync(msgFile);
    }

    const generated = this.generate();
    return generated;
  }

  /** Get list of existing locales */
  getLocales(): string[] {
    const config = this.readConfig();
    const arbDir = path.join(this.projectRoot, config.arbDir);
    if (!fs.existsSync(arbDir)) return [];

    return fs.readdirSync(arbDir)
      .filter(f => f.endsWith('.arb'))
      .map(f => {
        const match = f.match(/[_-]([a-z]{2,3}(?:_[A-Z]{2})?)\.arb$/);
        return match ? match[1] : null;
      })
      .filter((l): l is string => l !== null)
      .sort();
  }

  /**
   * Run the full generation pipeline.
   * Returns the list of generated file paths (relative to project root).
   */
  generate(): string[] {
    const config = this.readConfig();
    if (!config.enabled) return [];

    const arbFiles = this.loadArbFiles(config.arbDir);
    if (arbFiles.length === 0) return [];

    const mainArb = this.findMainArb(arbFiles, config.mainLocale);
    const locales = arbFiles.map(a => a.locale).sort();

    // Ensure output directories exist
    const outputDir = path.join(this.projectRoot, config.outputDir);
    const intlDir = path.join(outputDir, 'intl');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(intlDir, { recursive: true });

    const generated: string[] = [];

    // 1. Generate l10n.dart (class S)
    const l10nContent = this.generateL10nDart(mainArb, locales, config);
    const l10nPath = path.join(outputDir, 'l10n.dart');
    fs.writeFileSync(l10nPath, l10nContent, 'utf-8');
    generated.push(path.relative(this.projectRoot, l10nPath));

    // 2. Generate messages_XX.dart for each locale
    for (const arb of arbFiles) {
      const msgContent = this.generateMessagesDart(arb, mainArb);
      const msgPath = path.join(intlDir, `messages_${arb.locale}.dart`);
      fs.writeFileSync(msgPath, msgContent, 'utf-8');
      generated.push(path.relative(this.projectRoot, msgPath));
    }

    // 3. Generate messages_all.dart
    const allContent = this.generateMessagesAllDart(locales);
    const allPath = path.join(intlDir, 'messages_all.dart');
    fs.writeFileSync(allPath, allContent, 'utf-8');
    generated.push(path.relative(this.projectRoot, allPath));

    return generated;
  }

  // ── Config ────────────────────────────────────────────────────────────────

  private readConfig(): IntlConfig {
    const defaults: IntlConfig = {
      enabled: false,
      arbDir: 'lib/l10n',
      outputDir: 'lib/generated',
      className: 'S',
      mainLocale: 'en',
      useDeferredLoading: false,
    };

    const pubspecPath = path.join(this.projectRoot, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) return defaults;

    const content = fs.readFileSync(pubspecPath, 'utf-8');

    const flutterIntlMatch = content.match(/^flutter_intl:\s*$/m);
    if (!flutterIntlMatch) return defaults;

    const sectionStart = flutterIntlMatch.index! + flutterIntlMatch[0].length;
    // Extract lines until next top-level key (no indent)
    const restLines = content.substring(sectionStart).split(/\r?\n/);
    const sectionLines: string[] = [];
    for (const line of restLines) {
      if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t') && line.trim().length > 0) break;
      sectionLines.push(line);
    }
    const section = sectionLines.join('\n');

    const enabledMatch = section.match(/^\s+enabled:\s*(true|false)/m);
    if (enabledMatch) defaults.enabled = enabledMatch[1] === 'true';

    const arbDirMatch = section.match(/^\s+arb_dir:\s*(.+)/m);
    if (arbDirMatch) defaults.arbDir = arbDirMatch[1].trim();

    const outputDirMatch = section.match(/^\s+output_dir:\s*(.+)/m);
    if (outputDirMatch) defaults.outputDir = outputDirMatch[1].trim();

    const classNameMatch = section.match(/^\s+class_name:\s*(.+)/m);
    if (classNameMatch) defaults.className = classNameMatch[1].trim();

    const mainLocaleMatch = section.match(/^\s+main_locale:\s*(.+)/m);
    if (mainLocaleMatch) defaults.mainLocale = mainLocaleMatch[1].trim();

    const deferredMatch = section.match(/^\s+use_deferred_loading:\s*(true|false)/m);
    if (deferredMatch) defaults.useDeferredLoading = deferredMatch[1] === 'true';

    return defaults;
  }

  // ── ARB Parsing ───────────────────────────────────────────────────────────

  private loadArbFiles(arbDir: string): ArbFile[] {
    const arbDirPath = path.join(this.projectRoot, arbDir);
    if (!fs.existsSync(arbDirPath)) return [];

    const files = fs.readdirSync(arbDirPath).filter(f => f.endsWith('.arb'));
    const result: ArbFile[] = [];

    for (const file of files) {
      const filePath = path.join(arbDirPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(content);
        const arb = this.parseArbJson(json, filePath);
        if (arb) result.push(arb);
      } catch (e) {
        console.error(`[IntlGenerator] Failed to parse ARB file ${file}:`, e);
      }
    }

    return result;
  }

  private parseArbJson(json: Record<string, any>, filePath: string): ArbFile | null {
    let locale = json['@@locale'] as string | undefined;
    if (!locale) {
      const basename = path.basename(filePath, '.arb');
      const match = basename.match(/[_-]([a-z]{2,3}(?:_[A-Z]{2})?)$/);
      if (match) locale = match[1];
    }
    if (!locale) return null;

    const entries: ArbEntry[] = [];
    const entryMap = new Map<string, ArbEntry>();

    for (const key of Object.keys(json)) {
      if (key.startsWith('@')) continue;

      const value = String(json[key]);
      const meta = json[`@${key}`] as Record<string, any> | undefined;
      const description = meta?.description ?? '';

      // Parse placeholders — respect @meta ordering if available
      const placeholders = this.extractPlaceholders(value, meta);

      // Parse ICU format (plural, gender, select)
      const icu = this.parseIcu(value);

      const entry: ArbEntry = { key, value, description, placeholders, icu };
      entries.push(entry);
      entryMap.set(key, entry);
    }

    return { locale, filePath, entries, entryMap };
  }

  /**
   * Extract placeholders from value and metadata.
   * If @key.placeholders exists, use its key order (this overrides value order).
   */
  private extractPlaceholders(value: string, meta?: Record<string, any>): ArbPlaceholder[] {
    const placeholderMeta = meta?.placeholders as Record<string, any> | undefined;

    // If metadata defines placeholders, use that order
    if (placeholderMeta && Object.keys(placeholderMeta).length > 0) {
      return Object.entries(placeholderMeta).map(([name, info]) => ({
        name,
        type: this.normalizeDartType(info?.type ?? 'String'),
        format: info?.format,
        optionalParameters: info?.optionalParameters,
        isCustomDateFormat: info?.isCustomDateFormat === 'true',
      }));
    }

    // Otherwise, extract from {placeholder} patterns in value (excluding ICU)
    const placeholders: ArbPlaceholder[] = [];
    const seen = new Set<string>();

    // Match simple {name} but NOT {name, plural/select/gender, ...}
    const simplePattern = /\{(\w+)\}/g;
    let m: RegExpExecArray | null;

    while ((m = simplePattern.exec(value)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;

      // Check if this is an ICU pattern start (has comma after name)
      const afterBrace = value.substring(m.index! + 1);
      const commaCheck = afterBrace.match(/^(\w+)\s*,\s*(plural|select|gender)/);
      if (commaCheck) {
        // This is an ICU variable, still add as placeholder with appropriate type
        seen.add(name);
        const icuType = commaCheck[2];
        const type = icuType === 'plural' ? 'num' : 'String';
        placeholders.push({ name, type });
        continue;
      }

      seen.add(name);
      placeholders.push({ name, type: 'String' });
    }

    return placeholders;
  }

  private normalizeDartType(type: string): string {
    const lower = type.toLowerCase();
    if (lower === 'string') return 'String';
    if (lower === 'int') return 'int';
    if (lower === 'double') return 'double';
    if (lower === 'num') return 'num';
    if (lower === 'datetime') return 'DateTime';
    return 'Object';
  }

  // ── ICU Parsing ───────────────────────────────────────────────────────────

  /**
   * Parse ICU message format: {variable, type, case1{text} case2{text}}
   * Returns null for simple messages.
   */
  private parseIcu(value: string): IcuSegment | null {
    // Match: {variable, plural|select|gender, ...cases...}
    const icuPattern = /^\{(\w+)\s*,\s*(plural|select|gender)\s*,\s*/;
    const trimmed = value.trim();
    const match = trimmed.match(icuPattern);
    if (!match) return null;

    const variable = match[1];
    const rawType = match[2];
    const type: IcuSegment['type'] = rawType === 'gender' ? 'gender' :
      rawType === 'plural' ? 'plural' : 'select';

    // Parse cases: key{value} key{value} ...
    const casesStr = trimmed.substring(match[0].length);
    const cases = this.parseIcuCases(casesStr);

    return { variable, type, cases };
  }

  /**
   * Parse ICU cases string: one{1 message} other{{count} messages}}
   * Handles nested braces by counting depth.
   */
  private parseIcuCases(input: string): Map<string, string> {
    const cases = new Map<string, string>();
    let pos = 0;

    while (pos < input.length) {
      // Skip whitespace
      while (pos < input.length && /\s/.test(input[pos])) pos++;
      if (pos >= input.length || input[pos] === '}') break;

      // Read case name (e.g. "one", "other", "male", "=0")
      let caseName = '';
      while (pos < input.length && input[pos] !== '{' && !/\s/.test(input[pos])) {
        caseName += input[pos];
        pos++;
      }

      // Skip whitespace between name and {
      while (pos < input.length && /\s/.test(input[pos])) pos++;
      if (pos >= input.length || input[pos] !== '{') break;
      pos++; // skip {

      // Read case value, tracking brace depth
      let depth = 1;
      let caseValue = '';
      while (pos < input.length && depth > 0) {
        if (input[pos] === '{') depth++;
        else if (input[pos] === '}') depth--;
        if (depth > 0) caseValue += input[pos];
        pos++;
      }

      if (caseName) {
        cases.set(caseName, caseValue);
      }
    }

    return cases;
  }

  private findMainArb(arbFiles: ArbFile[], mainLocale: string): ArbFile {
    const main = arbFiles.find(a => a.locale === mainLocale);
    if (main) return main;
    // Fallback: the one with most keys
    return arbFiles.sort((a, b) => b.entries.length - a.entries.length)[0];
  }

  // ── Generate l10n.dart ────────────────────────────────────────────────────

  private generateL10nDart(mainArb: ArbFile, locales: string[], config: IntlConfig): string {
    const cls = config.className;
    const lines: string[] = [];

    // Header
    lines.push('// GENERATED CODE - DO NOT MODIFY BY HAND');
    lines.push("import 'package:flutter/material.dart';");
    lines.push("import 'package:intl/intl.dart';");
    lines.push("import 'intl/messages_all.dart';");
    lines.push('');
    lines.push('// **************************************************************************');
    lines.push('// Generator: Flutter Intl IDE plugin');
    lines.push('// Made by Localizely');
    lines.push('// **************************************************************************');
    lines.push('');
    lines.push('// ignore_for_file: non_constant_identifier_names, lines_longer_than_80_chars');
    lines.push('// ignore_for_file: join_return_with_assignment, prefer_final_in_for_each');
    lines.push('// ignore_for_file: avoid_redundant_argument_values, avoid_escaping_inner_quotes');
    lines.push('');

    // Class
    lines.push(`class ${cls} {`);
    lines.push(`  ${cls}();`);
    lines.push('');
    lines.push(`  static ${cls}? _current;`);
    lines.push('');
    lines.push(`  static ${cls} get current {`);
    lines.push(`    assert(_current != null,`);
    lines.push(`        'No instance of ${cls} was loaded. Try to initialize the ${cls} delegate before accessing ${cls}.current.');`);
    lines.push(`    return _current!;`);
    lines.push('  }');
    lines.push('');
    lines.push('  static const AppLocalizationDelegate delegate = AppLocalizationDelegate();');
    lines.push('');
    lines.push(`  static Future<${cls}> load(Locale locale) {`);
    lines.push('    final name = (locale.countryCode?.isEmpty ?? false)');
    lines.push('        ? locale.languageCode');
    lines.push('        : locale.toString();');
    lines.push('    final localeName = Intl.canonicalizedLocale(name);');
    lines.push('    return initializeMessages(localeName).then((_) {');
    lines.push('      Intl.defaultLocale = localeName;');
    lines.push(`      final instance = ${cls}();`);
    lines.push(`      ${cls}._current = instance;`);
    lines.push('');
    lines.push('      return instance;');
    lines.push('    });');
    lines.push('  }');
    lines.push('');
    lines.push(`  static ${cls} of(BuildContext context) {`);
    lines.push(`    final instance = ${cls}.maybeOf(context);`);
    lines.push(`    assert(instance != null,`);
    lines.push(`        'No instance of ${cls} present in the widget tree. Did you add ${cls}.delegate in localizationsDelegates?');`);
    lines.push('    return instance!;');
    lines.push('  }');
    lines.push('');
    lines.push(`  static ${cls}? maybeOf(BuildContext context) {`);
    lines.push(`    return Localizations.of<${cls}>(context, ${cls});`);
    lines.push('  }');

    // Generate members
    for (const entry of mainArb.entries) {
      lines.push('');
      lines.push(`  /// \`${this.escapeDocComment(entry.value)}\``);

      if (entry.icu) {
        // ICU message (plural/gender/select)
        this.generateIcuMember(lines, entry);
      } else if (entry.placeholders.length === 0) {
        // Simple getter
        lines.push(`  String get ${entry.key} {`);
        lines.push('    return Intl.message(');
        lines.push(`      '${this.escSQ(entry.value)}',`);
        lines.push(`      name: '${entry.key}',`);
        lines.push(`      desc: '${this.escSQ(entry.description)}',`);
        lines.push('      args: [],');
        lines.push('    );');
        lines.push('  }');
      } else {
        // Parameterized method
        const params = entry.placeholders.map(p => `${p.type} ${p.name}`).join(', ');
        const argNames = entry.placeholders.map(p => p.name).join(', ');
        const dartValue = entry.value.replace(/\{(\w+)\}/g, (_, n) => `\$${n}`);

        lines.push(`  String ${entry.key}(${params}) {`);
        lines.push('    return Intl.message(');
        lines.push(`      '${this.escSQ(dartValue)}',`);
        lines.push(`      name: '${entry.key}',`);
        lines.push(`      desc: '${this.escSQ(entry.description)}',`);
        lines.push(`      args: [${argNames}],`);
        lines.push('    );');
        lines.push('  }');
      }
    }

    lines.push('}');
    lines.push('');

    // AppLocalizationDelegate
    lines.push(`class AppLocalizationDelegate extends LocalizationsDelegate<${cls}> {`);
    lines.push('  const AppLocalizationDelegate();');
    lines.push('');
    lines.push('  List<Locale> get supportedLocales {');
    lines.push('    return const <Locale>[');
    for (const locale of locales) {
      if (locale.includes('_')) {
        const [lang, country] = locale.split('_');
        lines.push(`      Locale.fromSubtags(languageCode: '${lang}', countryCode: '${country}'),`);
      } else {
        lines.push(`      Locale.fromSubtags(languageCode: '${locale}'),`);
      }
    }
    lines.push('    ];');
    lines.push('  }');
    lines.push('');
    lines.push('  @override');
    lines.push('  bool isSupported(Locale locale) => _isSupported(locale);');
    lines.push('  @override');
    lines.push(`  Future<${cls}> load(Locale locale) => ${cls}.load(locale);`);
    lines.push('  @override');
    lines.push('  bool shouldReload(AppLocalizationDelegate old) => false;');
    lines.push('');
    lines.push('  bool _isSupported(Locale locale) {');
    lines.push('    for (var supportedLocale in supportedLocales) {');
    lines.push('      if (supportedLocale.languageCode == locale.languageCode) {');
    lines.push('        return true;');
    lines.push('      }');
    lines.push('    }');
    lines.push('    return false;');
    lines.push('  }');
    lines.push('}');
    lines.push('');

    return lines.join('\n');
  }

  /** Generate an ICU (plural/gender/select) member in l10n.dart */
  private generateIcuMember(lines: string[], entry: ArbEntry): void {
    const icu = entry.icu!;
    const placeholder = entry.placeholders.find(p => p.name === icu.variable);
    const paramType = placeholder?.type ?? (icu.type === 'plural' ? 'num' : 'String');
    const allParams = entry.placeholders.length > 0
      ? entry.placeholders.map(p => `${p.type} ${p.name}`).join(', ')
      : `${paramType} ${icu.variable}`;
    const allArgNames = entry.placeholders.length > 0
      ? entry.placeholders.map(p => p.name).join(', ')
      : icu.variable;

    lines.push(`  String ${entry.key}(${allParams}) {`);

    if (icu.type === 'plural') {
      lines.push(`    return Intl.plural(`);
      lines.push(`      ${icu.variable},`);
      for (const [caseName, caseValue] of icu.cases) {
        const dartVal = caseValue.replace(/\{(\w+)\}/g, (_, n) => `\$${n}`);
        lines.push(`      ${caseName}: '${this.escSQ(dartVal)}',`);
      }
      lines.push(`      name: '${entry.key}',`);
      lines.push(`      desc: '${this.escSQ(entry.description)}',`);
      lines.push(`      args: [${allArgNames}],`);
      lines.push('    );');
    } else if (icu.type === 'gender') {
      lines.push(`    return Intl.gender(`);
      lines.push(`      ${icu.variable},`);
      for (const [caseName, caseValue] of icu.cases) {
        const dartVal = caseValue.replace(/\{(\w+)\}/g, (_, n) => `\$${n}`);
        lines.push(`      ${caseName}: '${this.escSQ(dartVal)}',`);
      }
      lines.push(`      name: '${entry.key}',`);
      lines.push(`      desc: '${this.escSQ(entry.description)}',`);
      lines.push(`      args: [${allArgNames}],`);
      lines.push('    );');
    } else {
      // select
      lines.push(`    return Intl.select(`);
      lines.push(`      ${icu.variable},`);
      lines.push('      {');
      for (const [caseName, caseValue] of icu.cases) {
        const dartVal = caseValue.replace(/\{(\w+)\}/g, (_, n) => `\$${n}`);
        lines.push(`        '${caseName}': '${this.escSQ(dartVal)}',`);
      }
      lines.push('      },');
      lines.push(`      name: '${entry.key}',`);
      lines.push(`      desc: '${this.escSQ(entry.description)}',`);
      lines.push(`      args: [${allArgNames}],`);
      lines.push('    );');
    }

    lines.push('  }');
  }

  // ── Generate messages_XX.dart ─────────────────────────────────────────────

  private generateMessagesDart(arb: ArbFile, mainArb: ArbFile): string {
    const lines: string[] = [];

    lines.push('// DO NOT EDIT. This is code generated via package:intl/generate_localized.dart');
    lines.push(`// This is a library that provides messages for a ${arb.locale} locale. All the`);
    lines.push('// messages from the main program should be duplicated here with the same');
    lines.push('// function name.');
    lines.push('');
    lines.push('// Ignore issues from commonly used lints in this file.');
    lines.push('// ignore_for_file:unnecessary_brace_in_string_interps, unnecessary_new');
    lines.push('// ignore_for_file:prefer_single_quotes,comment_references, directives_ordering');
    lines.push('// ignore_for_file:annotate_overrides,prefer_generic_function_type_aliases');
    lines.push('// ignore_for_file:unused_import, file_names, avoid_escaping_inner_quotes');
    lines.push('// ignore_for_file:unnecessary_string_interpolations, unnecessary_string_escapes');
    lines.push('');
    lines.push("import 'package:intl/intl.dart';");
    lines.push("import 'package:intl/message_lookup_by_library.dart';");
    lines.push('');
    lines.push('final messages = new MessageLookup();');
    lines.push('');
    lines.push('typedef String MessageIfAbsent(String messageStr, List<dynamic> args);');
    lines.push('');
    lines.push('class MessageLookup extends MessageLookupByLibrary {');
    lines.push(`  String get localeName => '${arb.locale}';`);
    lines.push('');

    // Collect entries that need static methods (parameterized or ICU)
    // Sort by key alphabetically for stable m0, m1, m2 indices
    const complexEntries: { key: string; mainEntry: ArbEntry; localEntry: ArbEntry }[] = [];

    for (const mainEntry of mainArb.entries) {
      if (mainEntry.placeholders.length > 0 || mainEntry.icu) {
        const localEntry = arb.entryMap.get(mainEntry.key);
        if (localEntry) {
          complexEntries.push({ key: mainEntry.key, mainEntry, localEntry });
        }
      }
    }
    complexEntries.sort((a, b) => a.key.localeCompare(b.key));

    // Generate static methods
    for (let i = 0; i < complexEntries.length; i++) {
      const { mainEntry, localEntry } = complexEntries[i];

      if (mainEntry.icu) {
        // ICU message
        const icu = mainEntry.icu;
        const localIcu = localEntry.icu ?? icu; // fallback to main if local doesn't parse
        const paramNames = mainEntry.placeholders.map(p => p.name).join(', ') || icu.variable;

        if (icu.type === 'plural') {
          const cases: string[] = [];
          for (const [cn, cv] of localIcu.cases) {
            const dartVal = cv.replace(/\{(\w+)\}/g, (_, n) => `\${${n}}`);
            cases.push(`${cn}: '${this.escSQ(dartVal)}'`);
          }
          lines.push(`  static String m${i}(${paramNames}) => "\${Intl.plural(${icu.variable}, ${cases.join(', ')})}";`);
        } else if (icu.type === 'gender') {
          const cases: string[] = [];
          for (const [cn, cv] of localIcu.cases) {
            const dartVal = cv.replace(/\{(\w+)\}/g, (_, n) => `\${${n}}`);
            cases.push(`${cn}: '${this.escSQ(dartVal)}'`);
          }
          lines.push(`  static String m${i}(${paramNames}) => "\${Intl.gender(${icu.variable}, ${cases.join(', ')})}";`);
        } else {
          // select
          const cases: string[] = [];
          for (const [cn, cv] of localIcu.cases) {
            const dartVal = cv.replace(/\{(\w+)\}/g, (_, n) => `\${${n}}`);
            cases.push(`'${cn}': '${this.escSQ(dartVal)}'`);
          }
          lines.push(`  static String m${i}(${paramNames}) => "\${Intl.select(${icu.variable}, {${cases.join(', ')}})}";`);
        }
      } else {
        // Simple parameterized message
        const paramNames = mainEntry.placeholders.map(p => p.name).join(', ');
        const dartString = localEntry.value.replace(/\{(\w+)\}/g, (_, n) => `\${${n}}`);
        lines.push(`  static String m${i}(${paramNames}) => "${this.escDQ(dartString)}";`);
      }
      lines.push('');
    }

    // Build key → method index lookup
    const keyToMethodIdx = new Map<string, number>();
    for (let i = 0; i < complexEntries.length; i++) {
      keyToMethodIdx.set(complexEntries[i].key, i);
    }

    // Generate _notInlinedMessages map
    lines.push('  final messages = _notInlinedMessages(_notInlinedMessages);');
    lines.push('  static Map<String, Function> _notInlinedMessages(_) => <String, Function>{');

    const sortedKeys = [...arb.entryMap.keys()].sort();
    for (const key of sortedKeys) {
      const methodIdx = keyToMethodIdx.get(key);
      if (methodIdx !== undefined) {
        lines.push(`        "${key}": m${methodIdx},`);
      } else {
        const localEntry = arb.entryMap.get(key)!;
        lines.push(`        "${key}": MessageLookupByLibrary.simpleMessage("${this.escDQ(localEntry.value)}"),`);
      }
    }

    lines.push('      };');
    lines.push('}');
    lines.push('');

    return lines.join('\n');
  }

  // ── Generate messages_all.dart ────────────────────────────────────────────

  private generateMessagesAllDart(locales: string[]): string {
    const lines: string[] = [];

    lines.push('// DO NOT EDIT. This is code generated via package:intl/generate_localized.dart');
    lines.push('// This is a library that looks up messages for specific locales by');
    lines.push('// delegating to the appropriate library.');
    lines.push('');
    lines.push('// Ignore issues from commonly used lints in this file.');
    lines.push('// ignore_for_file:implementation_imports, file_names, unnecessary_new');
    lines.push('// ignore_for_file:unnecessary_brace_in_string_interps, directives_ordering');
    lines.push('// ignore_for_file:argument_type_not_assignable, invalid_assignment');
    lines.push('// ignore_for_file:prefer_single_quotes, prefer_generic_function_type_aliases');
    lines.push('// ignore_for_file:comment_references');
    lines.push('');
    lines.push("import 'dart:async';");
    lines.push('');
    lines.push("import 'package:intl/intl.dart';");
    lines.push("import 'package:intl/message_lookup_by_library.dart';");
    lines.push("import 'package:intl/src/intl_helpers.dart';");
    lines.push('');

    for (const locale of locales) {
      lines.push(`import 'messages_${locale}.dart' as messages_${locale};`);
    }
    lines.push('');

    lines.push('typedef Future<dynamic> LibraryLoader();');
    lines.push('Map<String, LibraryLoader> _deferredLibraries = {');
    for (const locale of locales) {
      lines.push(`  '${locale}': () => new Future.value(null),`);
    }
    lines.push('};');
    lines.push('');

    lines.push('MessageLookupByLibrary? _findExact(String localeName) {');
    lines.push('  switch (localeName) {');
    for (const locale of locales) {
      lines.push(`    case '${locale}':`);
      lines.push(`      return messages_${locale}.messages;`);
    }
    lines.push('    default:');
    lines.push('      return null;');
    lines.push('  }');
    lines.push('}');
    lines.push('');

    lines.push('/// User programs should call this before using [localeName] for messages.');
    lines.push('Future<bool> initializeMessages(String localeName) async {');
    lines.push('  var availableLocale = Intl.verifiedLocale(');
    lines.push("      localeName, (locale) => _deferredLibraries[locale] != null,");
    lines.push("      onFailure: (_) => null);");
    lines.push('  if (availableLocale == null) {');
    lines.push('    return new Future.value(false);');
    lines.push('  }');
    lines.push('  var lib = _deferredLibraries[availableLocale];');
    lines.push('  await (lib == null ? new Future.value(false) : lib());');
    lines.push('  initializeInternalMessageLookup(() => new CompositeMessageLookup());');
    lines.push('  messageLookup.addLocale(availableLocale, _findGeneratedMessagesFor);');
    lines.push('  return new Future.value(true);');
    lines.push('}');
    lines.push('');

    lines.push('bool _messagesExistFor(String locale) {');
    lines.push('  try {');
    lines.push('    return _findExact(locale) != null;');
    lines.push('  } catch (e) {');
    lines.push('    return false;');
    lines.push('  }');
    lines.push('}');
    lines.push('');

    lines.push('MessageLookupByLibrary? _findGeneratedMessagesFor(String locale) {');
    lines.push('  var actualLocale =');
    lines.push("      Intl.verifiedLocale(locale, _messagesExistFor, onFailure: (_) => null);");
    lines.push('  if (actualLocale == null) return null;');
    lines.push('  return _findExact(actualLocale);');
    lines.push('}');
    lines.push('');

    return lines.join('\n');
  }

  // ── String Helpers ────────────────────────────────────────────────────────

  /** Escape for Dart single-quoted string */
  private escSQ(s: string): string {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  }

  /** Escape for Dart double-quoted string (keeps $ for interpolation) */
  private escDQ(s: string): string {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  }

  /** Escape for doc comment */
  private escapeDocComment(s: string): string {
    return s.replace(/\n/g, '\\n').replace(/`/g, "'");
  }
}
