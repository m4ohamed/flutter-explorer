# Flutter Explorer - Error Log

## Errors Found & Fixed

### 1. Hardcoded Text False Positives in Imports/Exports
- **Problem**: The regex for detecting `Text()` widgets was matching strings inside `import` and `export` statements.
- **Fix**: Added checks to skip lines starting with `import` or `export` during warning analysis.
- **File**: `src/indexer/dartParser.ts`
