import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;

// ── Test harness ─────────────────────────────────────────────────────────────

int _passed = 0;
int _failed = 0;
final List<String> _failures = [];

void check(bool condition, String message) {
  if (condition) {
    print('  ✅ $message');
    _passed++;
  } else {
    print('  ❌ $message');
    _failed++;
    _failures.add(message);
  }
}

void group(String name, void Function() body) {
  print('\n── $name ─────────────────────────────────────');
  body();
}

// ── File fixtures ─────────────────────────────────────────────────────────────

const String kMockFile = r'''
abstract class Widget {}
abstract class BuildContext {}
abstract class Key {}
class StatelessWidget extends Widget { const StatelessWidget({Key? key}); }
class StatefulWidget extends Widget { const StatefulWidget({Key? key}); }
abstract class State<T extends StatefulWidget> { Widget build(BuildContext context); void setState(void Function() fn){} }
class Text extends Widget { const Text(String data); }
class ElevatedButton extends Widget { const ElevatedButton({required void Function() onPressed, required Widget child}); }
class Scaffold extends Widget { const Scaffold({Widget? appBar, Widget? body, Widget? floatingActionButton}); }
class AppBar extends Widget { const AppBar({Widget? title}); }
class Center extends Widget { const Center({Widget? child}); }
class Column extends Widget { const Column({List<Widget>? children}); }
class FloatingActionButton extends Widget { const FloatingActionButton({required void Function() onPressed, required Widget child}); }
class Icon extends Widget { const Icon(dynamic icon); }
class Icons { static const add = 'add'; }
class TextEditingController {}
class GlobalKey {}
class Future { static Future<int> value(int v) => throw UnimplementedError(); }
''';

/// A realistic Flutter file with StatelessWidget, StatefulWidget, enums,
/// mixins, extensions, typedefs, and top-level functions.
const String kWidgetFile = r'''
import 'flutter_mock.dart';

enum Status { active, inactive, pending }

typedef StringCallback = void Function(String value);

mixin Loggable {
  void log(String msg) => print(msg);
}

extension StringX on String {
  String get capitalized => isEmpty ? this : '${this[0].toUpperCase()}${substring(1)}';
}

class CounterState {
  int count = 0;
}

class MyButton extends StatelessWidget {
  final String label;
  final VoidCallback onPressed;

  const MyButton({Key? key, required this.label, required this.onPressed}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: onPressed,
      child: Text(label),
    );
  }
}

class CounterPage extends StatefulWidget {
  const CounterPage({Key? key}) : super(key: key);

  @override
  State<CounterPage> createState() => _CounterPageState();
}

class _CounterPageState extends State<CounterPage> with Loggable {
  int _count = 0;

  void _increment() {
    setState(() => _count++);
    log('Count: $_count');
  }

  @override
  Widget build(BuildContext context) {
    final controller = TextEditingController();
    final key = GlobalKey();
    final future = Future.value(1);
    
    return Scaffold(
      appBar: AppBar(title: const Text('Counter')),
      body: Center(
        child: Column(
          children: [
            Text('$_count'),
            MyButton(label: 'Increment', onPressed: _increment),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _increment,
        child: const Icon(Icons.add),
      ),
    );
  }
}

int add(int a, int b) => a + b;
String formatCount(int n) => '$n items';
''';

/// A non-widget Dart file: models, services, no Flutter deps.
const String kModelFile = r'''
class UserModel {
  final String id;
  final String name;
  final String? email;

  const UserModel({required this.id, required this.name, this.email});

  UserModel copyWith({String? name, String? email}) =>
      UserModel(id: id, name: name ?? this.name, email: email ?? this.email);

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'email': email};

  factory UserModel.fromJson(Map<String, dynamic> json) =>
      UserModel(id: json['id'] as String, name: json['name'] as String, email: json['email'] as String?);
}

abstract class Repository<T> {
  Future<T?> findById(String id);
  Future<List<T>> findAll();
  Future<void> save(T entity);
  Future<void> delete(String id);
}

class UserRepository extends Repository<UserModel> {
  final Map<String, UserModel> _store = {};

  @override
  Future<UserModel?> findById(String id) async => _store[id];

  @override
  Future<List<UserModel>> findAll() async => _store.values.toList();

  @override
  Future<void> save(UserModel entity) async => _store[entity.id] = entity;

  @override
  Future<void> delete(String id) async => _store.remove(id);
}
''';

/// File with tricky edge cases: private classes, const constructors,
/// factory constructors, multiple enums, extension types.
const String kEdgeCaseFile = r'''
enum Color { red, green, blue }
enum Direction { north, south, east, west }

class _PrivateClass {
  final int value;
  const _PrivateClass(this.value);
}

class Singleton {
  static final Singleton _instance = Singleton._internal();
  factory Singleton() => _instance;
  Singleton._internal();

  void doWork() {}
}

class GenericBox<T> {
  T value;
  GenericBox(this.value);
  T get() => value;
  void set(T v) { value = v; }
}

const globalConst = 42;
final globalFinal = 'hello';
''';

// ── Test runner ───────────────────────────────────────────────────────────────

Future<List<Map<String, dynamic>>> runAnalyzer(
    String scriptPath, String projectPath) async {
  final result = await Process.run('dart', [scriptPath, projectPath]);

  if (result.exitCode != 0) {
    throw Exception(
        'Analyzer exited with code ${result.exitCode}\nStderr: ${result.stderr}');
  }

  final stdout = result.stdout as String;
  final decoded = jsonDecode(stdout) as List;
  return decoded.cast<Map<String, dynamic>>();
}

Set<String> extractWidgetNames(List widgetList) {
  final names = <String>{};
  for (final w in widgetList) {
    names.add(w['name'] as String);
    if (w['children'] != null) {
      names.addAll(extractWidgetNames(w['children'] as List));
    }
  }
  return names;
}

// ── Main ──────────────────────────────────────────────────────────────────────

void main() async {
  print('dart_analyzer.dart — Integration Test Suite');
  print('============================================');

  // Locate script
  final scriptPath =
      p.join(Directory.current.path, 'tools', 'dart_analyzer.dart');
  if (!File(scriptPath).existsSync()) {
    print('ERROR: dart_analyzer.dart not found at $scriptPath');
    exit(1);
  }

  // Create temp project
  final tempDir = Directory.systemTemp.createTempSync('dart_analyzer_test_');
  final libDir = Directory(p.join(tempDir.path, 'lib'))
    ..createSync(recursive: true);

  try {
    // Write fixture files
    File(p.join(libDir.path, 'flutter_mock.dart')).writeAsStringSync(kMockFile);
    File(p.join(libDir.path, 'widget_file.dart'))
        .writeAsStringSync(kWidgetFile);
    File(p.join(libDir.path, 'model_file.dart')).writeAsStringSync(kModelFile);
    File(p.join(libDir.path, 'edge_cases.dart'))
        .writeAsStringSync(kEdgeCaseFile);

    // Write minimal pubspec.yaml
    File(p.join(tempDir.path, 'pubspec.yaml')).writeAsStringSync('''
name: test_project
environment:
  sdk: '>=3.0.0 <4.0.0'
''');

    print('\nRunning analyzer (this may take a few seconds)...');
    final results = await runAnalyzer(scriptPath, tempDir.path);

    // Index by file name for easy lookup
    final byFile = <String, Map<String, dynamic>>{};
    for (final r in results) {
      final fileName = p.basename(r['filePath'] as String);
      byFile[fileName] = r;
    }

    // ── SUITE 1: Output completeness ─────────────────────────────────────────

    group('Output completeness', () {
      check(results.length == 4,
          'Analyzer returns results for all 4 files (got ${results.length})');
      check(byFile.containsKey('widget_file.dart'),
          'widget_file.dart present in output');
      check(byFile.containsKey('flutter_mock.dart'),
          'flutter_mock.dart present in output');
      check(byFile.containsKey('model_file.dart'),
          'model_file.dart present in output');
      check(byFile.containsKey('edge_cases.dart'),
          'edge_cases.dart present in output');

      for (final r in results) {
        final file = p.basename(r['filePath'] as String);
        final keys = [
          'classes',
          'functions',
          'enums',
          'mixins',
          'extensions',
          'typedefs',
          'variables',
          'widgets'
        ];
        for (final key in keys) {
          check(r.containsKey(key), '$file: output contains "$key" field');
        }
      }
    });

    // ── SUITE 2: Class extraction ─────────────────────────────────────────────

    group('Class extraction — widget_file.dart', () {
      final f = byFile['widget_file.dart']!;
      final classes = (f['classes'] as List).cast<Map<String, dynamic>>();
      final classNames = classes.map((c) => c['name'] as String).toSet();

      check(classNames.contains('MyButton'), 'MyButton found');
      check(classNames.contains('CounterPage'), 'CounterPage found');
      check(
          classNames.contains('_CounterPageState'), '_CounterPageState found');
      check(classNames.contains('CounterState'), 'CounterState found');

      final myButton = classes.firstWhere((c) => c['name'] == 'MyButton');
      check(
          myButton['extendsClass']?.toString().contains('StatelessWidget') ==
              true,
          'MyButton extends StatelessWidget');
      check(myButton['isAbstract'] == false, 'MyButton is not abstract');
      check(myButton['isPrivate'] == false, 'MyButton is not private');
    });

    group('Class extraction — model_file.dart', () {
      final f = byFile['model_file.dart']!;
      final classes = (f['classes'] as List).cast<Map<String, dynamic>>();
      final classNames = classes.map((c) => c['name'] as String).toSet();

      check(classNames.contains('UserModel'), 'UserModel found');
      check(classNames.contains('Repository'), 'Repository found');
      check(classNames.contains('UserRepository'), 'UserRepository found');

      final repo = classes.firstWhere((c) => c['name'] == 'Repository');
      check(repo['isAbstract'] == true, 'Repository is abstract');

      final userRepo = classes.firstWhere((c) => c['name'] == 'UserRepository');
      check(userRepo['extendsClass']?.toString().contains('Repository') == true,
          'UserRepository extends Repository<UserModel>');
    });

    group('Class extraction — edge_cases.dart', () {
      final f = byFile['edge_cases.dart']!;
      final classes = (f['classes'] as List).cast<Map<String, dynamic>>();
      final classNames = classes.map((c) => c['name'] as String).toSet();

      check(classNames.contains('_PrivateClass'), '_PrivateClass found');
      check(classNames.contains('Singleton'), 'Singleton found');
      check(classNames.contains('GenericBox'), 'GenericBox found');

      final priv = classes.firstWhere((c) => c['name'] == '_PrivateClass');
      check(priv['isPrivate'] == true, '_PrivateClass.isPrivate = true');

      final singleton = classes.firstWhere((c) => c['name'] == 'Singleton');
      final methods =
          (singleton['methods'] as List).cast<Map<String, dynamic>>();
      check(methods.any((m) => m['name'] == 'doWork'),
          'Singleton.doWork method found');
    });

    // ── SUITE 3: Method extraction ────────────────────────────────────────────

    group('Method extraction', () {
      final f = byFile['widget_file.dart']!;
      final classes = (f['classes'] as List).cast<Map<String, dynamic>>();

      final counterState =
          classes.firstWhere((c) => c['name'] == '_CounterPageState');
      final methods =
          (counterState['methods'] as List).cast<Map<String, dynamic>>();
      final methodNames = methods.map((m) => m['name'] as String).toSet();

      check(methodNames.contains('build'), '_CounterPageState.build found');
      check(methodNames.contains('_increment'),
          '_CounterPageState._increment found');

      final increment = methods.firstWhere((m) => m['name'] == '_increment');
      check(increment['isPrivate'] == true, '_increment.isPrivate = true');
      check(increment['isStatic'] == false, '_increment.isStatic = false');

      final userModel = (byFile['model_file.dart']!['classes'] as List)
          .cast<Map<String, dynamic>>()
          .firstWhere((c) => c['name'] == 'UserModel');
      final userMethods =
          (userModel['methods'] as List).cast<Map<String, dynamic>>();
      final userMethodNames =
          userMethods.map((m) => m['name'] as String).toSet();
      check(userMethodNames.contains('copyWith'), 'UserModel.copyWith found');
      check(userMethodNames.contains('toJson'), 'UserModel.toJson found');
    });

    // ── SUITE 4: Enum extraction ──────────────────────────────────────────────

    group('Enum extraction', () {
      final wf = byFile['widget_file.dart']!;
      final wEnums = (wf['enums'] as List).cast<Map<String, dynamic>>();
      check(wEnums.any((e) => e['name'] == 'Status'),
          'Status enum found in widget_file');
      final status = wEnums.firstWhere((e) => e['name'] == 'Status');
      final values = (status['values'] as List).cast<String>();
      check(
          values.contains('active') &&
              values.contains('inactive') &&
              values.contains('pending'),
          'Status has values: active, inactive, pending');

      final ef = byFile['edge_cases.dart']!;
      final eEnums = (ef['enums'] as List).cast<Map<String, dynamic>>();
      check(eEnums.length == 2,
          'edge_cases.dart has 2 enums (got ${eEnums.length})');
      check(eEnums.any((e) => e['name'] == 'Color'), 'Color enum found');
      check(
          eEnums.any((e) => e['name'] == 'Direction'), 'Direction enum found');

      final color = eEnums.firstWhere((e) => e['name'] == 'Color');
      final colorValues = (color['values'] as List).cast<String>();
      check(colorValues.length == 3,
          'Color has 3 values (got ${colorValues.length})');
    });

    // ── SUITE 5: Mixin extraction ─────────────────────────────────────────────

    group('Mixin extraction', () {
      final f = byFile['widget_file.dart']!;
      final mixins = (f['mixins'] as List).cast<Map<String, dynamic>>();
      check(mixins.any((m) => m['name'] == 'Loggable'), 'Loggable mixin found');
      check(mixins.length == 1,
          'Only 1 mixin in widget_file (got ${mixins.length})');
    });

    // ── SUITE 6: Extension extraction ────────────────────────────────────────

    group('Extension extraction', () {
      final f = byFile['widget_file.dart']!;
      final extensions = (f['extensions'] as List).cast<Map<String, dynamic>>();
      check(extensions.any((e) => e['name'] == 'StringX'),
          'StringX extension found');
      final strX = extensions.firstWhere((e) => e['name'] == 'StringX');
      check(strX['onType']?.toString().contains('String') == true,
          'StringX.onType = String');
    });

    // ── SUITE 7: Typedef extraction ───────────────────────────────────────────

    group('Typedef extraction', () {
      final f = byFile['widget_file.dart']!;
      final typedefs = (f['typedefs'] as List).cast<Map<String, dynamic>>();
      check(typedefs.any((t) => t['name'] == 'StringCallback'),
          'StringCallback typedef found');
    });

    // ── SUITE 8: Top-level function extraction ────────────────────────────────

    group('Top-level function extraction', () {
      final f = byFile['widget_file.dart']!;
      final functions = (f['functions'] as List).cast<Map<String, dynamic>>();
      final funcNames = functions.map((f) => f['name'] as String).toSet();

      check(funcNames.contains('add'), 'add() function found');
      check(funcNames.contains('formatCount'), 'formatCount() function found');

      final addFn = functions.firstWhere((f) => f['name'] == 'add');
      check(addFn['returnType']?.toString() == 'int', 'add() returnType = int');
    });

    // ── SUITE 9: Top-level variable extraction ────────────────────────────────

    group('Top-level variable extraction', () {
      final f = byFile['edge_cases.dart']!;
      final variables = (f['variables'] as List).cast<Map<String, dynamic>>();
      final varNames = variables.map((v) => v['name'] as String).toSet();

      check(varNames.contains('globalConst'), 'globalConst found');
      check(varNames.contains('globalFinal'), 'globalFinal found');

      final gc = variables.firstWhere((v) => v['name'] == 'globalConst');
      check(gc['isConst'] == true, 'globalConst.isConst = true');
      check(gc['isFinal'] == false, 'globalConst.isFinal = false');

      final gf = variables.firstWhere((v) => v['name'] == 'globalFinal');
      check(gf['isFinal'] == true, 'globalFinal.isFinal = true');
      check(gf['isConst'] == false, 'globalFinal.isConst = false');
    });

    // ── SUITE 10: Widget tree heuristic ──────────────────────────────────────

    group('Widget tree heuristic', () {
      final f = byFile['widget_file.dart']!;
      final widgets = f['widgets'] as List;
      final allNames = extractWidgetNames(widgets);

      print('  Found widget names: $allNames');

      // Non-widget types that appear as instantiations — must be excluded
      check(!allNames.contains('DateTime'), 'DateTime excluded');
      check(!allNames.contains('TextEditingController'),
          'TextEditingController excluded');
      check(!allNames.contains('GlobalKey'), 'GlobalKey excluded');
      check(!allNames.contains('Future'), 'Future excluded');

      // Actual Flutter widgets — must be included
      check(allNames.contains('Scaffold'), 'Scaffold found');
      check(allNames.contains('AppBar'), 'AppBar found');
      check(allNames.contains('Center'), 'Center found');
      check(allNames.contains('Column'), 'Column found');
      check(allNames.contains('ElevatedButton'), 'ElevatedButton found');
      check(allNames.contains('FloatingActionButton'),
          'FloatingActionButton found');
      check(allNames.contains('Text'), 'Text found');
      check(allNames.contains('Icon'), 'Icon found');
      check(allNames.contains('MyButton'), 'MyButton (custom widget) found');

      // Hierarchy check: Scaffold should be top-level
      check(widgets.any((w) => w['name'] == 'Scaffold'),
          'Scaffold is a top-level widget node');
    });

    // ── SUITE 11: Line numbers ────────────────────────────────────────────────

    group('Line numbers', () {
      final f = byFile['widget_file.dart']!;
      final classes = (f['classes'] as List).cast<Map<String, dynamic>>();
      final myButton = classes.firstWhere((c) => c['name'] == 'MyButton');
      final line = myButton['line'] as int;

      check(line > 0, 'MyButton.line > 0 (got $line)');
      check(line < 100, 'MyButton.line < 100 (got $line)');

      // Status enum should appear before MyButton (earlier in file)
      final enums = (f['enums'] as List).cast<Map<String, dynamic>>();
      final statusLine =
          enums.firstWhere((e) => e['name'] == 'Status')['line'] as int;
      check(statusLine < line,
          'Status enum appears before MyButton (line $statusLine < $line)');
    });

    // ── SUITE 12: Properties ─────────────────────────────────────────────────

    group('Class properties', () {
      final f = byFile['model_file.dart']!;
      final classes = (f['classes'] as List).cast<Map<String, dynamic>>();
      final userModel = classes.firstWhere((c) => c['name'] == 'UserModel');
      final props =
          (userModel['properties'] as List).cast<Map<String, dynamic>>();
      final propNames = props.map((p) => p['name'] as String).toSet();

      check(propNames.contains('id'), 'UserModel.id property found');
      check(propNames.contains('name'), 'UserModel.name property found');
      check(propNames.contains('email'), 'UserModel.email property found');

      final idProp = props.firstWhere((p) => p['name'] == 'id');
      check(idProp['isFinal'] == true, 'id.isFinal = true');
      check(idProp['type']?.toString() == 'String', 'id.type = String');
    });

    // ── SUITE 13: Privacy detection ──────────────────────────────────────────

    group('Privacy detection', () {
      final f = byFile['edge_cases.dart']!;
      final classes = (f['classes'] as List).cast<Map<String, dynamic>>();

      final priv = classes.firstWhere((c) => c['name'] == '_PrivateClass');
      check(priv['isPrivate'] == true, '_PrivateClass.isPrivate = true');

      final singleton = classes.firstWhere((c) => c['name'] == 'Singleton');
      check(singleton['isPrivate'] == false, 'Singleton.isPrivate = false');

      final wf = byFile['widget_file.dart']!;
      final wClasses = (wf['classes'] as List).cast<Map<String, dynamic>>();
      final counterState =
          wClasses.firstWhere((c) => c['name'] == '_CounterPageState');
      check(counterState['isPrivate'] == true,
          '_CounterPageState.isPrivate = true');
    });
  } finally {
    tempDir.deleteSync(recursive: true);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  print('\n════════════════════════════════════════════');
  print('Results: $_passed passed, $_failed failed');
  if (_failures.isNotEmpty) {
    print('\nFailed checks:');
    for (final f in _failures) {
      print('  • $f');
    }
    print('');
  }
  exit(_failed > 0 ? 1 : 0);
}
