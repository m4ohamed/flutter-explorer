const assert = require('assert');
const { DartParser } = require('../out/indexer/dartParser');

const parser = new DartParser();

// 1. Riverpod Multi-line Provider with Dart 3 Record
const providerSource = `
final financialTransactionsProvider =
    StreamProvider.family<
      List<FinancialTransactionEntity>,
      ({int year, int month})
    >((ref, params) {
  final repository = ref.watch(financeRepositoryProvider);
  return repository.getTransactions(params.year, params.month);
});
`;
const providerResult = parser.parse('provider_test.dart', providerSource);
assert.strictEqual(providerResult.variables.length, 1, 'Should find exactly 1 top-level variable');
assert.strictEqual(providerResult.variables[0].name, 'financialTransactionsProvider');
assert.strictEqual(providerResult.variables[0].isFinal, true);
assert.strictEqual(providerResult.variables[0].isTopLevel, true);
console.log('✔ Test 1 passed: Riverpod Provider with multi-line Record type');

// 2. Dart 3 Record in Method Return Type
const recordMethodSource = `
class AuthRepositoryImpl {
  Future<Either<Failure, (UserEntity user, bool needsPasswordSetup)>> signInWithGoogle() async {
    return Right((user, false));
  }
}
`;
const recordMethodResult = parser.parse('auth_repo.dart', recordMethodSource);
assert.strictEqual(recordMethodResult.classes.length, 1);
const methods = recordMethodResult.classes[0].methods;
assert.strictEqual(methods.length, 1, 'Should find signInWithGoogle');
assert.strictEqual(methods[0].name, 'signInWithGoogle');
assert.strictEqual(methods[0].returnType, 'Future<Either<Failure, (UserEntity user, bool needsPasswordSetup)>>');
console.log('✔ Test 2 passed: Method return type with Dart 3 Record tuple');

// 3. Unnamed Extension
const extSource = `
extension on Duration {
  TimeOfDay toTimeOfDay() => TimeOfDay(hour: inHours, minute: inMinutes % 60);
}
`;
const extResult = parser.parse('ext_test.dart', extSource);
assert.strictEqual(extResult.extensions.length, 1, 'Should find unnamed extension');
assert.strictEqual(extResult.extensions[0].onType, 'Duration');
console.log('✔ Test 3 passed: Unnamed extension (extension on Duration)');

// 4. Generic extends and nullable extends
const eitherSource = `
final class Left<L, R> extends Either<L, R> {
  final L value;
  const Left(this.value);
}
class LocaleNotifier extends Notifier<Locale?> {
  Locale? build() => null;
}
`;
const eitherResult = parser.parse('either_test.dart', eitherSource);
assert.strictEqual(eitherResult.classes.length, 2);
assert.strictEqual(eitherResult.classes[0].extendsClass, 'Either<L, R>');
assert.strictEqual(eitherResult.classes[1].extendsClass, 'Notifier<Locale?>');
console.log('✔ Test 4 passed: Generics and nullability in extends clause');

// 5. Local function and internal calls should NOT be class methods
const localFuncSource = `
class RequestModel {
  factory RequestModel.fromFirestore(Map<String, dynamic> map, String docId) {
    DateTime parseTs(dynamic v) {
      if (v is Timestamp) return v.toDate();
      return DateTime.now();
    }
    return RequestModel(parseTs(map['ts']));
  }

  Future<void> send() async {
    await _shareFile(bytes: []);
    throw FirebaseAuthException(code: 'err');
  }
}
`;
const localFuncResult = parser.parse('request_model.dart', localFuncSource);
const reqMethods = localFuncResult.classes[0].methods.map(m => m.name);
assert(!reqMethods.includes('parseTs'), 'Local function parseTs must NOT be a class method');
assert(!reqMethods.includes('FirebaseAuthException'), 'throw FirebaseAuthException must NOT be a method');
assert(!reqMethods.includes('_shareFile'), 'await _shareFile call must NOT be a method declaration');
assert(reqMethods.includes('send'), 'send should be a method');
console.log('✔ Test 5 passed: Local functions and statement calls are not false positive methods');

// 6. Widget detection filtering
const widgetSource = `
class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => Container()));
    AppTheme.successColor(context);
    DurationFormatter.format(10);
    Localizations.localeOf(context);
    const style = TextStyle(fontSize: 14);

    return Scaffold(
      appBar: AppBar(title: const Text('Title')),
      body: Container(
        child: const SizedBox.shrink(),
      ),
    );
  }
}
`;
const widgetResult = parser.parse('widget_test.dart', widgetSource);
const widgetNames = widgetResult.widgets.map(w => w.name);
assert(!widgetNames.includes('Navigator'), 'Navigator must NOT be a widget');
assert(!widgetNames.includes('AppTheme'), 'AppTheme must NOT be a widget');
assert(!widgetNames.includes('DurationFormatter'), 'DurationFormatter must NOT be a widget');
assert(!widgetNames.includes('Localizations'), 'Localizations must NOT be a widget');
assert(!widgetNames.includes('TextStyle'), 'TextStyle must NOT be a widget');
assert(widgetNames.includes('Scaffold'), 'Scaffold should be a widget');
console.log('✔ Test 6 passed: Static helpers and utilities are filtered out from widgets');

// 7. Single-pass comment/string lexer with apostrophes
const commentSource = `
class Service {
  // We'll initialize the controller in the first build or via ref.listen
  void test() {
    print('done');
  }
}

class NextClass {
  void nextMethod() {}
}
`;
const commentResult = parser.parse('comment_test.dart', commentSource);
assert.strictEqual(commentResult.classes.length, 2, 'Should find both classes despite apostrophe in comment');
assert.strictEqual(commentResult.classes[1].name, 'NextClass');
console.log('✔ Test 7 passed: Single-pass lexer preserves code after comments with apostrophes');

console.log('\n🎉 ALL 7 GOLDEN TESTS PASSED PERFECTLY!');
