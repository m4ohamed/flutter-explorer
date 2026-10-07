/**
 * Mockup & Incomplete UI Analyzer for Flutter & Dart
 *
 * Detects mockup, dummy, placeholder, and unimplemented UI code:
 * - Empty / No-op event handlers & callbacks (onPressed: () {}, onTap: () => {})
 * - Callbacks with only logging/printing or placeholder snackbars
 * - Hardcoded dummy/mock lists, sample data, placeholder URLs
 * - Placeholder widgets (Placeholder(), throw UnimplementedError())
 * - Unbound input fields (TextField / Checkbox without controller or dynamic handlers)
 * - Fake async delays (Future.delayed without actual backend/data persistence)
 * - TODO / MOCK / STUB annotations in UI widgets
 */

export type MockupWarningType =
  | 'mockup_empty_callback'
  | 'mockup_null_callback'
  | 'mockup_fake_data'
  | 'mockup_stub_widget'
  | 'mockup_unbound_input'
  | 'mockup_fake_delay'
  | 'mockup_todo_comment';

export interface MockupWarningInfo {
  type: MockupWarningType;
  category: 'callback' | 'data' | 'widget' | 'input' | 'async' | 'comment';
  severity: 'warning' | 'info';
  message: string;
  line: number;
  codeSnippet?: string;
  suggestion?: string;
}

export class MockupAnalyzer {
  // Common placeholder URLs
  private static readonly PLACEHOLDER_URL_REGEX =
    /(?:https?:\/\/)?(?:via\.placeholder\.com|picsum\.photos|placehold\.co|dummyimage\.com|avatar\.iran\.liara\.run|placeholder\.com)/i;

  // Dummy variable names indicating mock data (Dart, Kotlin, Java, TS/JS)
  private static readonly MOCK_VAR_REGEX =
    /\b(?:final|const|var|val|let|List<[\w?]+>|Map<[\w?,\s]+>|ArrayList<[\w?]+>|Set<[\w?]+>|Array<[\w?]+>)\s+(mock(?!up)\w*|dummy\w*|fake\w*|sample\w*|stub\w*|temp(?!db)\w*)\b\s*[:=]/i;

  // Kotlin / Java singleton mock objects or classes: object MockStore, object DummyData, class FakeApi
  private static readonly MOCK_OBJECT_REGEX =
    /\b(?:object|class)\s+(Mock(?!up)\w*|Dummy\w*|Fake\w*|Stub\w*|Sample\w*)\b/;

  // Placeholder texts in UI
  private static readonly DUMMY_TEXT_REGEX =
    /['"](?:Lorem ipsum[^'"]*|John Doe|Jane Doe|test@test\.com|user@example\.com|\+?1234567890?|اسم تجريبي|نص تجريبي|عنوان تجريبي|بيانات وهمية)['"]/i;

  // Flutter / Dart empty or simple no-op lambdas: onPressed: () {}, onTap: () => {}
  private static readonly EMPTY_CALLBACK_REGEX =
    /\b(onPressed|onTap|onLongPress|onDoubleTap|onChanged|onSubmitted|onSaved|onSelected|onTapDown|onTapUp)\s*:\s*(\(\s*[\w?,\s]*\)\s*(?:async\s*)?\{\s*\}|\(\s*[\w?,\s]*\)\s*=>\s*\{\s*\}|\(\s*[\w?,\s]*\)\s*=>\s*(?:null|true|false)\b)/;

  // Jetpack Compose / Kotlin call-site empty lambdas: onClick = {}, onClick = { }, onValueChange = { _ -> }
  private static readonly COMPOSE_EMPTY_CALLBACK_REGEX =
    /\b(onClick|onValueChange|onCheckedChange|onItemClick|onDismissRequest|onRefresh|onSearch|onBack|onEdit|onDelete|onSave|onSelect|onLongClick|onMenuClick|onCurrencyClick|onLanguageClick|onCardClick|onItemSelect)\s*=\s*\{\s*(?:[\w?,\s\-]+->\s*)?\s*\}/;

  // Android View listeners (Kotlin & Java): setOnClickListener { }, setOnClickListener(null), setOnClickListener(v -> {})
  private static readonly ANDROID_LISTENER_EMPTY_REGEX =
    /\b(setOnClickListener|setOnItemClickListener|setOnCheckedChangeListener|setOnLongClickListener|setOnTouchListener)\s*(?:\{\s*(?:[\w?,\s\-]+->\s*)?\s*\}|\(\s*(?:null|\(?\w*(?:,\s*\w+)*\)?\s*->\s*\{\s*\}|new\s+[\w.]+\s*\([^)]*\)\s*\{\s*(?:@Override\s+)?public\s+void\s+\w+\s*\([^)]*\)\s*\{\s*\}\s*\}\s*)\))/;

  // React / Web empty callbacks: onClick={() => {}}, onChange={() => {}}
  private static readonly REACT_EMPTY_CALLBACK_REGEX =
    /\b(onClick|onChange|onSubmit|onSelect|onPress|onBlur|onFocus)\s*=\s*\{\s*(?:\(\s*[\w?,\s]*\)\s*=>\s*\{\s*\}|function\s*\([^)]*\)\s*\{\s*\})\s*\}/;

  // Callbacks that only do print/debugPrint/log in Flutter
  private static readonly LOG_ONLY_CALLBACK_REGEX =
    /\b(onPressed|onTap|onChanged|onSubmitted)\s*:\s*\(\s*[\w?,\s]*\)\s*(?:async\s*)?\{\s*(?:print|debugPrint|log)\s*\([^)]*\)\s*;\s*\}/;

  // Callbacks that only log in Android / Jetpack Compose: onClick = { Log.d(...); }, onClick = { println(...) }
  private static readonly ANDROID_LOG_ONLY_CALLBACK_REGEX =
    /\b(onClick|onValueChange|onCheckedChange|setOnClickListener)\s*(?:=\s*|\()\s*\{\s*(?:Log\.[deviaw]|println|Toast\.makeText|System\.out\.print)\s*\([^)]*\)(?:\.show\(\))?\s*;?\s*\}/;

  // React / Web callbacks that only console.log
  private static readonly REACT_LOG_ONLY_CALLBACK_REGEX =
    /\b(onClick|onChange|onSubmit|onPress)\s*=\s*\{\s*(?:\(\s*[\w?,\s]*\)\s*=>\s*|function\s*\([^)]*\)\s*\{\s*)console\.(?:log|debug|warn|error)\s*\([^)]*\);?\s*\}?\s*\}/;

  // Disabled/null callback directly assigned in Flutter
  private static readonly NULL_CALLBACK_REGEX =
    /\b(onPressed|onTap)\s*:\s*null\b/;

  // TODO / MOCK / STUB comments in code or XML (// TODO or <!-- TODO -->)
  private static readonly TODO_COMMENT_REGEX =
    /(?:\/\/|<!--)\s*(TODO|FIXME|MOCK|DUMMY|STUB|TEMP|HACK|PLACEHOLDER)\b:?\s*(.*?)(?:-->)?$/i;

  // Kotlin & Java stubs: TODO(), throw NotImplementedError(), throw UnsupportedOperationException()
  private static readonly KOTLIN_STUB_REGEX =
    /\b(?:TODO\s*\([^)]*\)|throw\s+(?:new\s+)?(?:NotImplementedError|UnsupportedOperationException)\s*\([^)]*\))/;

  // Android XML layout dummy sample data: tools:text="@tools:sample/lorem", tools:src="@tools:sample/avatars"
  private static readonly ANDROID_XML_SAMPLE_DATA_REGEX =
    /\btools:(?:text|src|srcCompat|listitem)\s*=\s*"(@tools:sample\/[^"]+|@layout\/[^"]*(?:dummy|mock|sample|placeholder)[^"]*)"/i;

  /**
   * Analyze a source file and return all detected mockup/dummy code warnings.
   */
  public static analyze(
    filePath: string,
    content: string,
    maskedContent?: string
  ): MockupWarningInfo[] {
    const warnings: MockupWarningInfo[] = [];
    const lines = content.split('\n');
    const maskedLines = (maskedContent ?? content).split('\n');
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (normalizedPath.includes('mockupAnalyzer') || normalizedPath.startsWith('scratch/') || normalizedPath.includes('/scratch/')) {
      return [];
    }
    const isTestFile = /(?:[._-](?:test|spec)\.[a-zA-Z0-9]+|\b(?:test|tests|androidTest)\/)/i.test(normalizedPath);

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const trimmed = line.trim();
      // Use masked line for regex checks to avoid false positives inside string literals
      const maskedLine = maskedLines[i] ?? line;

      // Skip completely empty lines
      if (!trimmed) continue;

      // 1. TODO / MOCK / STUB comment detection
      const todoMatch = trimmed.match(MockupAnalyzer.TODO_COMMENT_REGEX);
      if (todoMatch) {
        const tag = todoMatch[1].toUpperCase();
        const detail = todoMatch[2].trim();
        warnings.push({
          type: 'mockup_todo_comment',
          category: 'comment',
          severity: 'info',
          message: `Incomplete UI marker [${tag}]${detail ? ': ' + detail : ''}`,
          line: lineNum,
          codeSnippet: trimmed,
          suggestion: 'Complete the pending implementation or replace the stub.',
        });
      }

      // 2. Empty / No-op Callbacks (Flutter, Compose, Android View, React)
      const emptyCbMatch =
        maskedLine.match(MockupAnalyzer.EMPTY_CALLBACK_REGEX) ||
        maskedLine.match(MockupAnalyzer.COMPOSE_EMPTY_CALLBACK_REGEX) ||
        maskedLine.match(MockupAnalyzer.ANDROID_LISTENER_EMPTY_REGEX) ||
        maskedLine.match(MockupAnalyzer.REACT_EMPTY_CALLBACK_REGEX);

      if (emptyCbMatch && !this.isInComment(maskedLine, emptyCbMatch.index ?? 0)) {
        const handlerName = emptyCbMatch[1];
        warnings.push({
          type: 'mockup_empty_callback',
          category: 'callback',
          severity: 'warning',
          message: `Empty callback '${handlerName}' has no functionality`,
          line: lineNum,
          codeSnippet: emptyCbMatch[0],
          suggestion: `Implement actual business logic or action handler for ${handlerName}.`,
        });
      }

      // 3. Print / Log-only callbacks (Flutter, Android, React)
      const logCbMatch =
        maskedLine.match(MockupAnalyzer.LOG_ONLY_CALLBACK_REGEX) ||
        maskedLine.match(MockupAnalyzer.ANDROID_LOG_ONLY_CALLBACK_REGEX) ||
        maskedLine.match(MockupAnalyzer.REACT_LOG_ONLY_CALLBACK_REGEX);

      if (logCbMatch && !this.isInComment(maskedLine, logCbMatch.index ?? 0)) {
        const handlerName = logCbMatch[1];
        warnings.push({
          type: 'mockup_empty_callback',
          category: 'callback',
          severity: 'warning',
          message: `Callback '${handlerName}' only logs without real action`,
          line: lineNum,
          codeSnippet: logCbMatch[0],
          suggestion: `Connect ${handlerName} to a state controller, ViewModel, or service.`,
        });
      }

      // 3.5. Null/disabled callbacks (onPressed: null) — skip if part of a ternary expression (_enabled ? action : null)
      const nullCbMatch = maskedLine.match(MockupAnalyzer.NULL_CALLBACK_REGEX);
      if (nullCbMatch && !maskedLine.includes('?') && !this.isInComment(maskedLine, nullCbMatch.index ?? 0)) {
        const handlerName = nullCbMatch[1];
        warnings.push({
          type: 'mockup_null_callback',
          category: 'callback',
          severity: 'info',
          message: `Callback '${handlerName}' is explicitly set to null (disabled)`,
          line: lineNum,
          codeSnippet: nullCbMatch[0],
          suggestion: `Consider if ${handlerName}: null is intentional or needs a real handler.`,
        });
      }

      // 4. Placeholder / Stub Widgets & Methods (Flutter Placeholder, UnimplementedError, Kotlin TODO(), NotImplementedError)
      if (/\bPlaceholder\s*\(/.test(maskedLine) && !this.isInComment(maskedLine, maskedLine.indexOf('Placeholder'))) {
        warnings.push({
          type: 'mockup_stub_widget',
          category: 'widget',
          severity: 'warning',
          message: 'Placeholder() widget found in UI',
          line: lineNum,
          codeSnippet: trimmed,
          suggestion: 'Replace Placeholder widget with actual UI component.',
        });
      }

      if (/\bthrow\s+UnimplementedError\s*\(/.test(maskedLine) && !this.isInComment(maskedLine, maskedLine.indexOf('UnimplementedError'))) {
        warnings.push({
          type: 'mockup_stub_widget',
          category: 'widget',
          severity: 'warning',
          message: 'Unimplemented method (throws UnimplementedError)',
          line: lineNum,
          codeSnippet: trimmed,
          suggestion: 'Provide real implementation for this method.',
        });
      }

      const kotlinStubMatch = maskedLine.match(MockupAnalyzer.KOTLIN_STUB_REGEX);
      if (kotlinStubMatch && !this.isInComment(maskedLine, kotlinStubMatch.index ?? 0)) {
        warnings.push({
          type: 'mockup_stub_widget',
          category: 'widget',
          severity: 'warning',
          message: `Unimplemented stub detected: '${kotlinStubMatch[0]}'`,
          line: lineNum,
          codeSnippet: trimmed,
          suggestion: 'Provide a real implementation for this method or handler.',
        });
      }

      // 5. Hardcoded Mock Data / Variables & Mock Objects (skip test files)
      if (!isTestFile) {
        const mockVarMatch = maskedLine.match(MockupAnalyzer.MOCK_VAR_REGEX);
        if (mockVarMatch && !this.isInComment(maskedLine, mockVarMatch.index ?? 0)) {
          const varName = mockVarMatch[1];
          warnings.push({
            type: 'mockup_fake_data',
            category: 'data',
            severity: 'warning',
            message: `Mock/dummy data variable detected: '${varName}'`,
            line: lineNum,
            codeSnippet: trimmed,
            suggestion: 'Fetch data dynamically from a repository, database, or API service.',
          });
        }

        const mockObjMatch = maskedLine.match(MockupAnalyzer.MOCK_OBJECT_REGEX);
        if (mockObjMatch && !this.isInComment(maskedLine, mockObjMatch.index ?? 0)) {
          const objName = mockObjMatch[1];
          warnings.push({
            type: 'mockup_fake_data',
            category: 'data',
            severity: 'warning',
            message: `Mock/dummy singleton or class detected: '${objName}'`,
            line: lineNum,
            codeSnippet: trimmed,
            suggestion: 'Replace mock store/class with production repository or dependency injection.',
          });
        }
      }

      // 6. Placeholder URLs (use raw line here to capture actual URLs from strings)
      const urlMatch = line.match(MockupAnalyzer.PLACEHOLDER_URL_REGEX);
      if (urlMatch && !this.isInComment(maskedLine, urlMatch.index ?? 0)) {
        warnings.push({
          type: 'mockup_fake_data',
          category: 'data',
          severity: 'info',
          message: `Placeholder image service used: ${urlMatch[0]}`,
          line: lineNum,
          codeSnippet: trimmed,
          suggestion: 'Use production CDN URLs or dynamic image assets.',
        });
      }

      // 7. Dummy text patterns (use raw line to capture actual text content)
      const dummyTextMatch = line.match(MockupAnalyzer.DUMMY_TEXT_REGEX);
      if (dummyTextMatch && !this.isInComment(maskedLine, dummyTextMatch.index ?? 0)) {
        warnings.push({
          type: 'mockup_fake_data',
          category: 'data',
          severity: 'info',
          message: `Mock placeholder text found: ${dummyTextMatch[0]}`,
          line: lineNum,
          codeSnippet: dummyTextMatch[0],
          suggestion: 'Replace placeholder copy with localized strings or dynamic data.',
        });
      }

      // 7.5. Android XML Layout dummy sample data (tools:sample/...)
      const xmlSampleMatch = line.match(MockupAnalyzer.ANDROID_XML_SAMPLE_DATA_REGEX);
      if (xmlSampleMatch && !this.isInComment(maskedLine, xmlSampleMatch.index ?? 0)) {
        warnings.push({
          type: 'mockup_fake_data',
          category: 'data',
          severity: 'info',
          message: `Android tools:sample placeholder data used: ${xmlSampleMatch[1]}`,
          line: lineNum,
          codeSnippet: trimmed,
          suggestion: 'Replace tools:sample preview attributes with dynamic data bindings in production.',
        });
      }

      // 8. Fake Delays (Future.delayed, Thread.sleep, delay) - ignore if part of a timer/cooldown loop
      const hasFakeDelay =
        /\bFuture\.delayed\s*\(/.test(maskedLine) ||
        /\b(?:Thread\.sleep|delay)\s*\(\s*\d+/.test(maskedLine);

      if (hasFakeDelay && !this.isInComment(maskedLine, 0)) {
        const contextLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join('\n');
        const isTimerOrCooldown = /timer|countdown|cooldown|resend|periodic|doWhile|while/i.test(contextLines);
        // Check if file seems to be a UI screen / widget rather than a test or background worker
        const isUiLayer =
          normalizedPath.includes('/pages/') ||
          normalizedPath.includes('/screens/') ||
          normalizedPath.includes('/widgets/') ||
          normalizedPath.includes('/presentation/') ||
          normalizedPath.includes('/ui/') ||
          normalizedPath.includes('/compose/') ||
          normalizedPath.includes('/activities/') ||
          normalizedPath.includes('/fragments/');

        if (!isTimerOrCooldown && isUiLayer && !isTestFile) {
          warnings.push({
            type: 'mockup_fake_delay',
            category: 'async',
            severity: 'info',
            message: 'Simulated delay found in UI presentation layer',
            line: lineNum,
            codeSnippet: trimmed,
            suggestion: 'Ensure this delay is replaced with a real async data call or repository flow.',
          });
        }
      }
    }

    // 9. Multi-line widget inspection: Checkbox / Switch with hardcoded values and empty handlers
    this.analyzeInputWidgets(maskedLines, warnings);

    return warnings;
  }

  /**
   * Scan multi-line blocks for input controls without state binding (Flutter & Jetpack Compose).
   * Uses masked lines to avoid false matches inside string literals.
   */
  private static analyzeInputWidgets(maskedLines: string[], warnings: MockupWarningInfo[]): void {
    const fullText = maskedLines.join('\n');

    // 1. Flutter Checkbox / Switch / Radio
    const flutterToggleRegex = /\b(Checkbox|Switch|Radio|CupertinoSwitch)\s*\(\s*([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = flutterToggleRegex.exec(fullText)) !== null) {
      const widgetName = match[1];
      const body = match[2];
      const matchIndex = match.index;
      const lineNum = fullText.substring(0, matchIndex).split('\n').length;

      const hasHardcodedValue = /\bvalue\s*:\s*(?:true|false)\b/.test(body);
      const hasEmptyOrNullHandler = /\bonChanged\s*:\s*(?:null|\(\s*[\w?,\s]*\)\s*\{\s*\}|\(\s*[\w?,\s]*\)\s*=>\s*\{\s*\})/.test(body);

      if (hasHardcodedValue && hasEmptyOrNullHandler) {
        warnings.push({
          type: 'mockup_unbound_input',
          category: 'input',
          severity: 'warning',
          message: `${widgetName} has hardcoded boolean value and unfunctional onChanged`,
          line: lineNum,
          codeSnippet: `${widgetName}(...)`,
          suggestion: `Bind ${widgetName} value to a state variable and update it in onChanged.`,
        });
      }
    }

    // 2. Jetpack Compose Checkbox / Switch / RadioButton
    const composeToggleRegex = /\b(Checkbox|Switch|RadioButton|TriStateCheckbox)\s*\(\s*([^)]+)\)/g;
    while ((match = composeToggleRegex.exec(fullText)) !== null) {
      const widgetName = match[1];
      const body = match[2];
      const matchIndex = match.index;
      const lineNum = fullText.substring(0, matchIndex).split('\n').length;

      const hasHardcodedState = /\b(?:checked|selected)\s*=\s*(?:true|false)\b/.test(body);
      const hasEmptyHandler = /\b(?:onCheckedChange|onClick)\s*=\s*\{\s*(?:[\w?,\s\-]+->\s*)?\s*\}/.test(body);

      if (hasHardcodedState && hasEmptyHandler) {
        warnings.push({
          type: 'mockup_unbound_input',
          category: 'input',
          severity: 'warning',
          message: `${widgetName} has hardcoded boolean state and empty callback in Compose`,
          line: lineNum,
          codeSnippet: `${widgetName}(...)`,
          suggestion: `Bind ${widgetName} state to a mutableStateOf variable and update it in the callback.`,
        });
      }
    }
  }

  /**
   * Check if the given index in a line falls within a comment.
   * Handles //, /*, <!-- inside string literals by tracking quote state.
   */
  private static isInComment(line: string, index: number): boolean {
    let inString: string | null = null;
    for (let i = 0; i < index && i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        // End of string if matching quote and not escaped
        if (ch === inString && line[i - 1] !== '\\') {
          inString = null;
        }
      } else {
        // Start of string (single, double, or template backtick)
        if (ch === "'" || ch === '"' || ch === '`') {
          inString = ch;
        }
        // Real comment found outside any string (// or <!--)
        if (ch === '/' && line[i + 1] === '/') {
          return true;
        }
        if (ch === '<' && line.substring(i, i + 4) === '<!--') {
          return true;
        }
      }
    }
    return false;
  }
}
