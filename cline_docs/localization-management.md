# Localization Management

*Description: Manage ARB translations, batch auto-translation, ICU syntax validation, unused key cleanup, and intl code generation in Flutter*

# Localization Management

Efficiently audit, translate, validate, and generate code for Flutter localization (ARB files).

## Workflow

### 1. Audit & Gap Detection
1. **Find Missing Keys**: Call `flutter_get_missing_translations` or `flutter_list_translations` to identify untranslated keys across locales.
2. **Batch Payload Generation**: Call `flutter_auto_translate_missing` with `action: "generate_payload"` to extract all missing keys formatted for translation.

### 2. Updating & Batch Translation
1. **Batch Apply**: Call `flutter_auto_translate_missing` with `action: "batch_apply"` and `translations` map to write translated keys across all ARB files simultaneously.
2. **Single Key Update**: Use `flutter_update_translation` to add/modify an individual key with `arValue`, `enValue`, or custom locale maps.
3. **Delete Obsolete Keys**: Use `flutter_delete_translation` to remove deprecated keys from all ARB files at once.

### 3. Validation & Code Generation
1. **Validate ICU Formats**: Run `flutter_validate_icu_translations` to verify ICU plural syntax (`zero`, `one`, `other`), variable placeholders (`{name}`), and curly brace balancing across all languages.
2. **Detect Dead Keys**: Run `flutter_find_unused_translations` to flag keys declared in ARB but never referenced in `lib/`.
3. **Regenerate Code**: Run `flutter_run_intl_generate` to generate fresh `l10n.dart` and `messages_*.dart` files.