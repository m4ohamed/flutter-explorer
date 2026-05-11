# Error Log & Fixes

## Pending Improvements
- [x] Add `enumUsages` and `mixinUsages` to `DartFileInfo`.
- [x] Enhance `analyzeUsages` to search for all new element types (extensions, typedefs, etc.).
- [x] Support `enum` and `mixin` in `flutter_get_reverse_deps`.
- [x] Fix `Extensions` method/property collection in `DartParser`.
- [x] Propagate all new usage types in `buildReverseDependencies`.

## Fixed Errors
- Fixed `DartFileInfo` initialization missing `enumUsages` and `mixinUsages`.
- Fixed `SearchResult` type union missing `'file'`.
- Fixed missing support for `enums` and `mixins` in reverse dependencies.
- Fixed extension method/property collection.
