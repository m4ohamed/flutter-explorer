# Localization Management

*Description: Manage ARB translations, find missing keys, and update localizations*

## Localization Management

Efficiently manage Flutter localization (ARB files) and ensure all keys are translated.

### Steps

1. Run `flutter_get_missing_translations` to identify keys present in some languages but missing in others.
2. Use `flutter_list_translations` to get a full overview of all translation keys.
3. Use `flutter_update_translation` to add or update translations for multiple languages at once.
4. If a feature is removed, use `flutter_delete_translation` to clean up the ARB files.

### Best Practices

- Always run `flutter_get_missing_translations` before a release.
- Use descriptive keys for translations to make them easier to find via `flutter_search`.
