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

  // Dummy variable names indicating mock data
  private static readonly MOCK_VAR_REGEX =
    /\b(?:final|const|var|List<[\w?]+>|Map<[\w?,\s]+>)\s+(mock\w*|dummy\w*|fake\w*|sample\w*|stub\w*|temp\w*)\s*=/i;

  // Placeholder texts in UI
  private static readonly DUMMY_TEXT_REGEX =
    /['"](?:Lorem ipsum[^'"]*|John Doe|Jane Doe|test@test\.com|user@example\.com|\+?1234567890?|اسم تجريبي|نص تجريبي|عنوان تجريبي|بيانات وهمية)['"]/i;

  // Empty or simple no-op lambdas
  private static readonly EMPTY_CALLBACK_REGEX =
    /\b(onPressed|onTap|onLongPress|onDoubleTap|onChanged|onSubmitted|onSaved|onSelected|onTapDown|onTapUp)\s*:\s*(\(\s*[\w?,\s]*\)\s*(?:async\s*)?\{\s*\}|\(\s*[\w?,\s]*\)\s*=>\s*\{\s*\}|\(\s*[\w?,\s]*\)\s*=>\s*(?:null|true|false)\b)/;

  // Callbacks that only do print/debugPrint/log
  private static readonly LOG_ONLY_CALLBACK_REGEX =
    /\b(onPressed|onTap|onChanged|onSubmitted)\s*:\s*\(\s*[\w?,\s]*\)\s*(?:async\s*)?\{\s*(?:print|debugPrint|log)\s*\([^)]*\)\s*;\s*\}/;

  // Disabled/null callback directly assigned
  private static readonly NULL_CALLBACK_REGEX =
    /\b(onPressed|onTap)\s*:\s*null\b/;

  // TODO / MOCK / STUB comments
  private static readonly TODO_COMMENT_REGEX =
    /\/\/\s*(TODO|FIXME|MOCK|DUMMY|STUB|TEMP|HACK|PLACEHOLDER)\b:?\s*(.*)$/i;

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

      // 2. Empty / No-op Callbacks
      const emptyCbMatch = maskedLine.match(MockupAnalyzer.EMPTY_CALLBACK_REGEX);
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

      // 3. Print / Log-only callbacks
      const logCbMatch = maskedLine.match(MockupAnalyzer.LOG_ONLY_CALLBACK_REGEX);
      if (logCbMatch && !this.isInComment(maskedLine, logCbMatch.index ?? 0)) {
        const handlerName = logCbMatch[1];
        warnings.push({
          type: 'mockup_empty_callback',
          category: 'callback',
          severity: 'warning',
          message: `Callback '${handlerName}' only logs to console without real action`,
          line: lineNum,
          codeSnippet: logCbMatch[0],
          suggestion: `Connect ${handlerName} to a state controller, bloc, or service.`,
        });
      }

      // 3.5. Null/disabled callbacks (onPressed: null)
      const nullCbMatch = maskedLine.match(MockupAnalyzer.NULL_CALLBACK_REGEX);
      if (nullCbMatch && !this.isInComment(maskedLine, nullCbMatch.index ?? 0)) {
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

      // 4. Placeholder / Stub Widgets
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

      // 4.5. Empty Container() and SizedBox.shrink() as stub widgets
      if (/\bContainer\s*\(\s*\)/.test(maskedLine) && !this.isInComment(maskedLine, maskedLine.indexOf('Container'))) {
        warnings.push({
          type: 'mockup_stub_widget',
          category: 'widget',
          severity: 'info',
          message: 'Empty Container() may be a placeholder widget',
          line: lineNum,
          codeSnippet: trimmed,
          suggestion: 'Replace empty Container() with meaningful widget or SizedBox if only spacing is needed.',
        });
      }

      if (/\bSizedBox\.shrink\s*\(\s*\)/.test(maskedLine) && !this.isInComment(maskedLine, maskedLine.indexOf('SizedBox'))) {
        warnings.push({
          type: 'mockup_stub_widget',
          category: 'widget',
          severity: 'info',
          message: 'SizedBox.shrink() may be a stub placeholder',
          line: lineNum,
          codeSnippet: trimmed,
          suggestion: 'Verify SizedBox.shrink() is intentional and not a temporary stub.',
        });
      }

      // 5. Hardcoded Mock Data / Variables
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

      // 8. Fake Delays (Future.delayed)
      if (/\bFuture\.delayed\s*\(/.test(maskedLine) && !this.isInComment(maskedLine, maskedLine.indexOf('Future.delayed'))) {
        // Check if file seems to be a UI screen / widget rather than a test or animation controller
        if (normalizedPath.includes('/pages/') || normalizedPath.includes('/screens/') || normalizedPath.includes('/widgets/') || normalizedPath.includes('/presentation/')) {
          warnings.push({
            type: 'mockup_fake_delay',
            category: 'async',
            severity: 'info',
            message: 'Simulated delay (Future.delayed) in UI presentation layer',
            line: lineNum,
            codeSnippet: trimmed,
            suggestion: 'Ensure this is replaced with a real async data call or repository method.',
          });
        }
      }
    }

    // 9. Multi-line widget inspection: Checkbox / Switch with hardcoded value and empty onChanged
    this.analyzeInputWidgets(maskedLines, warnings);

    return warnings;
  }

  /**
   * Scan multi-line blocks for input controls without state binding.
   * Uses masked lines to avoid false matches inside string literals.
   */
  private static analyzeInputWidgets(maskedLines: string[], warnings: MockupWarningInfo[]): void {
    const fullText = maskedLines.join('\n');

    // Match Checkbox / Switch blocks — uses [^)]+ which works on masked content
    // where nested parentheses inside strings are already flattened
    const toggleRegex = /\b(Checkbox|Switch|Radio|CupertinoSwitch)\s*\(\s*([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = toggleRegex.exec(fullText)) !== null) {
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
  }

  /**
   * Check if the given index in a line falls within a comment.
   * Handles // inside string literals (e.g. 'https://...') by tracking quote state.
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
        // Start of string
        if (ch === "'" || ch === '"') {
          inString = ch;
        }
        // Real comment found outside any string
        if (ch === '/' && line[i + 1] === '/') {
          return true;
        }
      }
    }
    return false;
  }
}
