import 'dart:convert';
import 'dart:io';
import 'package:analyzer/dart/analysis/analysis_context_collection.dart';
import 'package:analyzer/dart/analysis/results.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';
import 'package:analyzer/source/line_info.dart';
import 'package:path/path.dart' as p;


void main(List<String> args) async {
  if (args.isEmpty) {
    stderr.writeln('Usage: dart dart_analyzer.dart <project_path>');
    exit(1);
  }

  // Handle paths with spaces that might be split across args by Windows shell
  String rawPath = args.join(' ').trim();
  if ((rawPath.startsWith('"') && rawPath.endsWith('"')) ||
      (rawPath.startsWith("'") && rawPath.endsWith("'"))) {
    rawPath = rawPath.substring(1, rawPath.length - 1).trim();
  }

  final projectPath = p.absolute(rawPath);
  final libPath = p.join(projectPath, 'lib');

  if (!Directory(libPath).existsSync()) {
    stderr.writeln('Dart Analyzer Error: Directory lib does not exist at $libPath (project: $projectPath)');
    stdout.write(jsonEncode([]));
    return;
  }

  try {
    stderr.writeln('START_ANALYSIS:Warming up Dart SDK Analyzer & resolving package graph...');
    final collection = AnalysisContextCollection(includedPaths: [libPath]);
    int totalFiles = 0;
    for (final context in collection.contexts) {
      totalFiles += context.contextRoot.analyzedFiles().where((p) => p.endsWith('.dart')).length;
    }
    stderr.writeln('TOTAL:$totalFiles');

    final results = <Map<String, dynamic>>[];
    int fileCount = 0;

    for (final context in collection.contexts) {
      for (final path in context.contextRoot.analyzedFiles()) {
        if (!path.endsWith('.dart')) continue;

        try {
          stderr.writeln('ANALYZING:${p.basename(path)}');
          // getResolvedUnit gives us AST + Elements + LineInfo with a 4s per-file timeout
          final result = await context.currentSession.getResolvedUnit(path).timeout(
            const Duration(seconds: 4),
            onTimeout: () {
              stderr.writeln('TIMEOUT_SKIPPING:${p.basename(path)}');
              return null as dynamic;
            },
          );
          if (result is ResolvedUnitResult) {
            final unit = result.unit;
            final lineInfo = result.lineInfo;

            final fileInfo = {
              'filePath': p.relative(path, from: projectPath).replaceAll(r'\', '/'),
              'classes': <Map<String, dynamic>>[],
              'functions': <Map<String, dynamic>>[],
              'enums': <Map<String, dynamic>>[],
              'mixins': <Map<String, dynamic>>[],
              'extensions': <Map<String, dynamic>>[],
              'extensionTypes': <Map<String, dynamic>>[],
              'typedefs': <Map<String, dynamic>>[],
              'variables': <Map<String, dynamic>>[],
              'properties': <Map<String, dynamic>>[],
              'constructors': <Map<String, dynamic>>[],
              'annotations': <Map<String, dynamic>>[],
              'imports': <Map<String, dynamic>>[],
              'exports': <String>[],
              'widgets': <Map<String, dynamic>>[],
              'functionCalls': <Map<String, dynamic>>[],
            };

            final allAnnotations = fileInfo['annotations'] as List<Map<String, dynamic>>;
            final fileProps = fileInfo['properties'] as List<Map<String, dynamic>>;
            final fileCtors = fileInfo['constructors'] as List<Map<String, dynamic>>;

            // 1. Directives Analysis (Imports & Exports)
            for (final directive in unit.directives) {
              if (directive is ImportDirective) {
                final showNames = <String>[];
                final hideNames = <String>[];
                for (final combinator in directive.combinators) {
                  if (combinator is ShowCombinator) {
                    showNames.addAll(combinator.shownNames.map((id) => id.name));
                  } else if (combinator is HideCombinator) {
                    hideNames.addAll(combinator.hiddenNames.map((id) => id.name));
                  }
                }
                (fileInfo['imports'] as List).add({
                  'path': directive.uri.stringValue ?? '',
                  'alias': directive.prefix?.name,
                  'showNames': showNames,
                  'hideNames': hideNames,
                  'line': lineInfo.getLocation(directive.offset).lineNumber,
                });
              } else if (directive is ExportDirective) {
                (fileInfo['exports'] as List).add(directive.uri.stringValue ?? '');
              }
            }

            // 2. Elements Analysis (Classes, Methods, Constructors, Properties, Annotations, etc.)
            for (final declaration in unit.declarations) {
              if (declaration is ClassDeclaration) {
                final clazz = declaration.declaredElement;
                if (clazz == null) continue;
                final methods = <Map<String, dynamic>>[];
                final props = <Map<String, dynamic>>[];

                // Class annotations
                _extractMetadata(declaration.metadata, 'class', clazz.name, lineInfo, allAnnotations);

                // Methods
                for (final method in clazz.methods) {
                  final mLine = lineInfo.getLocation(method.nameOffset).lineNumber;
                  methods.add({
                    'name': method.name,
                    'returnType': method.returnType.getDisplayString(withNullability: true),
                    'params': method.parameters.map((p) => p.getDisplayString(withNullability: true)).join(', '),
                    'isPrivate': method.isPrivate,
                    'isStatic': method.isStatic,
                    'isAsync': method.isAsynchronous,
                    'line': mLine,
                  });
                }

                // Method annotations
                for (final member in declaration.members) {
                  if (member is MethodDeclaration) {
                    _extractMetadata(member.metadata, 'method', member.name.lexeme, lineInfo, allAnnotations);
                  } else if (member is FieldDeclaration) {
                    for (final variable in member.fields.variables) {
                      _extractMetadata(member.metadata, 'field', variable.name.lexeme, lineInfo, allAnnotations);
                    }
                  } else if (member is ConstructorDeclaration) {
                    final ctorName = member.name != null
                        ? '${declaration.name.lexeme}.${member.name!.lexeme}'
                        : declaration.name.lexeme;
                    _extractMetadata(member.metadata, 'constructor', ctorName, lineInfo, allAnnotations);
                  }
                }

                // Fields -> Properties (added to both class properties and file-level properties)
                for (final field in clazz.fields) {
                  final fLine = lineInfo.getLocation(field.nameOffset).lineNumber;
                  final propData = {
                    'name': field.name,
                    'type': field.type.getDisplayString(withNullability: true),
                    'className': clazz.name,
                    'isFinal': field.isFinal,
                    'isConst': field.isConst,
                    'isStatic': field.isStatic,
                    'isPrivate': field.isPrivate,
                    'isGetter': false,
                    'isSetter': false,
                    'line': fLine,
                  };
                  props.add(propData);
                  fileProps.add(propData);
                }

                // Accessors (Getters / Setters)
                for (final accessor in clazz.accessors) {
                  if (accessor.isSynthetic) continue;
                  final aLine = lineInfo.getLocation(accessor.nameOffset).lineNumber;
                  final propData = {
                    'name': accessor.name.replaceAll('=', ''),
                    'type': accessor.returnType.getDisplayString(withNullability: true),
                    'className': clazz.name,
                    'isFinal': false,
                    'isConst': false,
                    'isStatic': accessor.isStatic,
                    'isPrivate': accessor.isPrivate,
                    'isGetter': accessor.isGetter,
                    'isSetter': accessor.isSetter,
                    'line': aLine,
                  };
                  props.add(propData);
                  fileProps.add(propData);
                }

                // Constructors
                for (final ctor in clazz.constructors) {
                  if (ctor.isSynthetic) continue;
                  final ctorName = ctor.name.isEmpty ? clazz.name : '${clazz.name}.${ctor.name}';
                  int offset = ctor.nameOffset;
                  if (offset < 0) offset = declaration.offset;
                  final ctorLine = lineInfo.getLocation(offset).lineNumber;

                  fileCtors.add({
                    'name': ctorName,
                    'className': clazz.name,
                    'isFactory': ctor.isFactory,
                    'isConst': ctor.isConst,
                    'params': ctor.parameters.map((p) => p.getDisplayString(withNullability: true)).join(', '),
                    'line': ctorLine,
                  });
                }

                final clsLine = lineInfo.getLocation(clazz.nameOffset).lineNumber;
                final clsLineEnd = lineInfo.getLocation(declaration.endToken.offset).lineNumber;

                (fileInfo['classes'] as List).add({
                  'name': clazz.name,
                  'extendsClass': clazz.supertype?.getDisplayString(withNullability: true),
                  'implements': clazz.interfaces.map((i) => i.getDisplayString(withNullability: true)).toList(),
                  'mixins': clazz.mixins.map((m) => m.getDisplayString(withNullability: true)).toList(),
                  'isAbstract': clazz.isAbstract,
                  'isPrivate': clazz.isPrivate,
                  'methods': methods,
                  'properties': props,
                  'line': clsLine,
                  'lineEnd': clsLineEnd,
                });
              } else if (declaration is FunctionDeclaration) {
                final function = declaration.declaredElement;
                if (function == null) continue;
                _extractMetadata(declaration.metadata, 'function', function.name, lineInfo, allAnnotations);

                final fnLine = lineInfo.getLocation(function.nameOffset).lineNumber;
                final fnLineEnd = lineInfo.getLocation(declaration.endToken.offset).lineNumber;

                (fileInfo['functions'] as List).add({
                  'name': function.name,
                  'returnType': function.returnType.getDisplayString(withNullability: true),
                  'params': function.parameters.map((p) => p.getDisplayString(withNullability: true)).join(', '),
                  'isPrivate': function.isPrivate,
                  'isAsync': function.isAsynchronous,
                  'line': fnLine,
                  'lineEnd': fnLineEnd,
                });
              } else if (declaration is EnumDeclaration) {
                final enm = declaration.declaredElement;
                if (enm == null) continue;
                _extractMetadata(declaration.metadata, 'enum', enm.name, lineInfo, allAnnotations);

                (fileInfo['enums'] as List).add({
                  'name': enm.name,
                  'values': enm.fields.where((f) => f.isEnumConstant).map((f) => f.name).toList(),
                  'isPrivate': enm.isPrivate,
                  'line': lineInfo.getLocation(enm.nameOffset).lineNumber,
                  'lineEnd': lineInfo.getLocation(declaration.endToken.offset).lineNumber,
                });
              } else if (declaration is MixinDeclaration) {
                final mixin = declaration.declaredElement;
                if (mixin == null) continue;
                _extractMetadata(declaration.metadata, 'mixin', mixin.name, lineInfo, allAnnotations);

                (fileInfo['mixins'] as List).add({
                  'name': mixin.name,
                  'isPrivate': mixin.isPrivate,
                  'line': lineInfo.getLocation(mixin.nameOffset).lineNumber,
                  'lineEnd': lineInfo.getLocation(declaration.endToken.offset).lineNumber,
                });
              } else if (declaration is ExtensionDeclaration) {
                final ext = declaration.declaredElement;
                if (ext == null) continue;
                _extractMetadata(declaration.metadata, 'extension', ext.name ?? '', lineInfo, allAnnotations);

                final methods = <Map<String, dynamic>>[];
                for (final method in ext.methods) {
                  methods.add({
                    'name': method.name,
                    'returnType': method.returnType.getDisplayString(withNullability: true),
                    'params': method.parameters.map((p) => p.getDisplayString(withNullability: true)).join(', '),
                    'isPrivate': method.isPrivate,
                    'isStatic': method.isStatic,
                    'isAsync': method.isAsynchronous,
                    'line': lineInfo.getLocation(method.nameOffset).lineNumber,
                  });
                }
                (fileInfo['extensions'] as List).add({
                  'name': ext.name ?? '',
                  'onType': ext.extendedType.getDisplayString(withNullability: true),
                  'isPrivate': ext.isPrivate,
                  'methods': methods,
                  'line': lineInfo.getLocation(ext.nameOffset != -1 ? ext.nameOffset : declaration.offset).lineNumber,
                  'lineEnd': lineInfo.getLocation(declaration.endToken.offset).lineNumber,
                });
              // ignore: experimental_member_use
              } else if (declaration is ExtensionTypeDeclaration) {
                final extType = declaration.declaredElement;
                final name = declaration.name.lexeme;
                _extractMetadata(declaration.metadata, 'extensionType', name, lineInfo, allAnnotations);

                final methods = <Map<String, dynamic>>[];
                final props = <Map<String, dynamic>>[];

                if (extType != null) {
                  for (final method in extType.methods) {
                    methods.add({
                      'name': method.name,
                      'returnType': method.returnType.getDisplayString(withNullability: true),
                      'params': method.parameters.map((p) => p.getDisplayString(withNullability: true)).join(', '),
                      'isPrivate': method.isPrivate,
                      'isStatic': method.isStatic,
                      'isAsync': method.isAsynchronous,
                      'line': lineInfo.getLocation(method.nameOffset).lineNumber,
                    });
                  }
                }

                (fileInfo['extensionTypes'] as List).add({
                  'name': name,
                  'representationType': declaration.representation.fieldType.toSource(),
                  'implements': declaration.implementsClause?.interfaces.map((i) => i.toSource()).toList() ?? <String>[],
                  'isConst': declaration.constKeyword != null,
                  'isPrivate': name.startsWith('_'),
                  'methods': methods,
                  'properties': props,
                  'line': lineInfo.getLocation(declaration.name.offset).lineNumber,
                  'lineEnd': lineInfo.getLocation(declaration.endToken.offset).lineNumber,
                });
              } else if (declaration is GenericTypeAlias) {
                final typedef_ = declaration.declaredElement;
                if (typedef_ == null) continue;
                final tName = typedef_.name ?? declaration.name.lexeme;
                _extractMetadata(declaration.metadata, 'typedef', tName, lineInfo, allAnnotations);

                (fileInfo['typedefs'] as List).add({
                  'name': tName,
                  'isPrivate': typedef_.isPrivate,
                  'line': lineInfo.getLocation(typedef_.nameOffset != -1 ? typedef_.nameOffset : declaration.offset).lineNumber,
                });
              } else if (declaration is FunctionTypeAlias) {
                final typedef_ = declaration.declaredElement;
                if (typedef_ == null) continue;
                final tName = typedef_.name;
                _extractMetadata(declaration.metadata, 'typedef', tName, lineInfo, allAnnotations);

                (fileInfo['typedefs'] as List).add({
                  'name': tName,
                  'isPrivate': typedef_.isPrivate,
                  'line': lineInfo.getLocation(typedef_.nameOffset != -1 ? typedef_.nameOffset : declaration.offset).lineNumber,
                });
              } else if (declaration is TopLevelVariableDeclaration) {
                final firstVar = declaration.variables.variables.isNotEmpty ? declaration.variables.variables.first.name.lexeme : '';
                _extractMetadata(declaration.metadata, 'variable', firstVar, lineInfo, allAnnotations);

                for (final variable in declaration.variables.variables) {
                  final element = variable.declaredElement;
                  if (element == null) continue;
                  final vLine = lineInfo.getLocation(element.nameOffset).lineNumber;

                  (fileInfo['variables'] as List).add({
                    'name': element.name,
                    'type': element.type.getDisplayString(withNullability: true),
                    'isFinal': element.isFinal,
                    'isConst': element.isConst,
                    'isPrivate': element.isPrivate,
                    'isTopLevel': true,
                    'line': vLine,
                  });

                  // Also append top-level variable to file properties
                  fileProps.add({
                    'name': element.name,
                    'type': element.type.getDisplayString(withNullability: true),
                    'className': null,
                    'isFinal': element.isFinal,
                    'isConst': element.isConst,
                    'isStatic': false,
                    'isPrivate': element.isPrivate,
                    'isGetter': false,
                    'isSetter': false,
                    'line': vLine,
                  });
                }
              }
            }

            // 3. Widget Tree Analysis (AST Traversal)
            final widgetVisitor = WidgetTreeVisitor(lineInfo);
            unit.accept(widgetVisitor);
            fileInfo['widgets'] = widgetVisitor.widgets;

            // 4. Function Calls Analysis (AST Traversal)
            final callVisitor = FunctionCallVisitor(lineInfo);
            unit.accept(callVisitor);
            fileInfo['functionCalls'] = callVisitor.calls;

            results.add(fileInfo);
          }
        } catch (e) {
          // Skip files that fail to analyze
        } finally {
          fileCount++;
          stderr.writeln('PROGRESS:$fileCount');
        }
      }
    }

    stderr.writeln('PROGRESS:$fileCount');
    stdout.write(jsonEncode(results));
  } catch (e, stack) {
    stderr.writeln('Analysis failed: $e');
    stderr.writeln(stack);
    exit(1);
  }
}

void _extractMetadata(
  NodeList<Annotation>? metadata,
  String target,
  String? targetName,
  LineInfo lineInfo,
  List<Map<String, dynamic>> targetList,
) {
  if (metadata == null) return;
  for (final ann in metadata) {
    targetList.add({
      'name': ann.name.toSource(),
      'target': target,
      'targetName': targetName ?? '',
      'line': lineInfo.getLocation(ann.offset).lineNumber,
    });
  }
}

class WidgetTreeVisitor extends RecursiveAstVisitor<void> {
  final LineInfo lineInfo;
  final List<Map<String, dynamic>> widgets = [];
  final List<Map<String, dynamic>> _stack = [];

  WidgetTreeVisitor(this.lineInfo);

  @override
  void visitInstanceCreationExpression(InstanceCreationExpression node) {
    String name = '';
    try {
      final dynamic t = node.constructorName.type;
      try {
        name = t.name2?.lexeme?.toString() ?? '';
      } catch (_) {
        try {
          name = t.name?.name?.toString() ?? '';
        } catch (_) {
          name = t.toString().split('<').first;
        }
      }
      if (name.isEmpty) {
        name = t.toString().split('<').first;
      }
    } catch (e) {
      super.visitInstanceCreationExpression(node);
      return;
    }

    // Heuristic for Widgets: Starts with UpperCase, not common non-widget types
    if (name.isNotEmpty && name[0] == name[0].toUpperCase() && 
        !['String', 'int', 'double', 'bool', 'List', 'Map', 'Set', 'Future', 'Stream', 'Duration', 'DateTime', 'TextEditingController', 'GlobalKey', 'AnimationController', 'ScrollController'].contains(name)) {
      
      final widget = {
        'name': name,
        'line': lineInfo.getLocation(node.offset).lineNumber,
        'children': <Map<String, dynamic>>[],
        'properties': <Map<String, dynamic>>[],
      };

      // Extract simple properties (named arguments)
      for (final arg in node.argumentList.arguments) {
        if (arg is NamedExpression) {
          final propName = arg.name.label.name;
          final propValue = arg.expression.toString();
          (widget['properties'] as List).add({
            'name': propName,
            'value': propValue.length > 50 ? '${propValue.substring(0, 47)}...' : propValue,
          });
        }
      }

      if (_stack.isNotEmpty) {
        (_stack.last['children'] as List).add(widget);
      } else {
        // Only add top-level widgets (usually inside build methods)
        if (_isInsideBuildMethod(node)) {
          widgets.add(widget);
        }
      }

      _stack.add(widget);
      super.visitInstanceCreationExpression(node);
      _stack.removeLast();
    } else {
      super.visitInstanceCreationExpression(node);
    }
  }

  bool _isInsideBuildMethod(AstNode node) {
    AstNode? parent = node.parent;
    while (parent != null) {
      if (parent is MethodDeclaration) {
        if (parent.name.lexeme == 'build') return true;
      }
      parent = parent.parent;
    }
    return false;
  }
}

class FunctionCallVisitor extends RecursiveAstVisitor<void> {
  final LineInfo lineInfo;
  final List<Map<String, dynamic>> calls = [];

  FunctionCallVisitor(this.lineInfo);

  @override
  void visitMethodInvocation(MethodInvocation node) {
    calls.add({
      'name': node.methodName.name,
      'line': lineInfo.getLocation(node.methodName.offset).lineNumber,
    });
    super.visitMethodInvocation(node);
  }

  @override
  void visitFunctionExpressionInvocation(FunctionExpressionInvocation node) {
    if (node.function is SimpleIdentifier) {
      calls.add({
        'name': (node.function as SimpleIdentifier).name,
        'line': lineInfo.getLocation(node.function.offset).lineNumber,
      });
    }
    super.visitFunctionExpressionInvocation(node);
  }
}
