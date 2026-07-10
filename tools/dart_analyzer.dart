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

  final projectPath = p.absolute(args[0]);
  final libPath = p.join(projectPath, 'lib');

  if (!Directory(libPath).existsSync()) {
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
          // getResolvedUnit gives us AST + Elements + LineInfo
          final result = await context.currentSession.getResolvedUnit(path);
          if (result is ResolvedUnitResult) {
            final unit = result.unit;
            final lineInfo = result.lineInfo;

            final fileInfo = {
              'filePath': p.relative(path, from: projectPath),
              'classes': <Map<String, dynamic>>[],
              'functions': <Map<String, dynamic>>[],
              'enums': <Map<String, dynamic>>[],
              'mixins': <Map<String, dynamic>>[],
              'extensions': <Map<String, dynamic>>[],
              'typedefs': <Map<String, dynamic>>[],
              'variables': <Map<String, dynamic>>[],
              'properties': <Map<String, dynamic>>[],
              'widgets': <Map<String, dynamic>>[],
              'functionCalls': <Map<String, dynamic>>[],
            };

            // 1. Elements Analysis (Classes, Methods, etc.)
            for (final declaration in unit.declarations) {
              if (declaration is ClassDeclaration) {
                final clazz = declaration.declaredElement!;
                final methods = <Map<String, dynamic>>[];
                final props = <Map<String, dynamic>>[];

                for (final method in clazz.methods) {
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

                for (final field in clazz.fields) {
                  props.add({
                    'name': field.name,
                    'type': field.type.getDisplayString(withNullability: true),
                    'isFinal': field.isFinal,
                    'isConst': field.isConst,
                    'isStatic': field.isStatic,
                    'isPrivate': field.isPrivate,
                    'isGetter': false,
                    'isSetter': false,
                    'line': lineInfo.getLocation(field.nameOffset).lineNumber,
                  });
                }

                for (final accessor in clazz.accessors) {
                  if (accessor.isSynthetic) continue;
                  props.add({
                    'name': accessor.name.replaceAll('=', ''),
                    'type': accessor.returnType.getDisplayString(withNullability: true),
                    'isFinal': false,
                    'isConst': false,
                    'isStatic': accessor.isStatic,
                    'isPrivate': accessor.isPrivate,
                    'isGetter': accessor.isGetter,
                    'isSetter': accessor.isSetter,
                    'line': lineInfo.getLocation(accessor.nameOffset).lineNumber,
                  });
                }

                (fileInfo['classes'] as List).add({
                  'name': clazz.name,
                  'extendsClass': clazz.supertype?.getDisplayString(withNullability: true),
                  'implements': clazz.interfaces.map((i) => i.getDisplayString(withNullability: true)).toList(),
                  'mixins': clazz.mixins.map((m) => m.getDisplayString(withNullability: true)).toList(),
                  'isAbstract': clazz.isAbstract,
                  'isPrivate': clazz.isPrivate,
                  'methods': methods,
                  'properties': props,
                  'line': lineInfo.getLocation(clazz.nameOffset).lineNumber,
                });
              } else if (declaration is FunctionDeclaration) {
                final function = declaration.declaredElement!;
                (fileInfo['functions'] as List).add({
                  'name': function.name,
                  'returnType': function.returnType.getDisplayString(withNullability: true),
                  'params': function.parameters.map((p) => p.getDisplayString(withNullability: true)).join(', '),
                  'isPrivate': function.isPrivate,
                  'isAsync': function.isAsynchronous,
                  'line': lineInfo.getLocation(function.nameOffset).lineNumber,
                });
              } else if (declaration is EnumDeclaration) {
                final enm = declaration.declaredElement!;
                (fileInfo['enums'] as List).add({
                  'name': enm.name,
                  'values': enm.fields.where((f) => f.isEnumConstant).map((f) => f.name).toList(),
                  'isPrivate': enm.isPrivate,
                  'line': lineInfo.getLocation(enm.nameOffset).lineNumber,
                });
              } else if (declaration is MixinDeclaration) {
                final mixin = declaration.declaredElement!;
                (fileInfo['mixins'] as List).add({
                  'name': mixin.name,
                  'isPrivate': mixin.isPrivate,
                  'line': lineInfo.getLocation(mixin.nameOffset).lineNumber,
                });
              } else if (declaration is ExtensionDeclaration) {
                final ext = declaration.declaredElement!;
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
                });
              } else if (declaration is GenericTypeAlias) {
                final typedef_ = declaration.declaredElement!;
                (fileInfo['typedefs'] as List).add({
                  'name': typedef_.name,
                  'isPrivate': typedef_.isPrivate,
                  'line': lineInfo.getLocation(typedef_.nameOffset).lineNumber,
                });
              } else if (declaration is FunctionTypeAlias) {
                final typedef_ = declaration.declaredElement!;
                (fileInfo['typedefs'] as List).add({
                  'name': typedef_.name,
                  'isPrivate': typedef_.isPrivate,
                  'line': lineInfo.getLocation(typedef_.nameOffset).lineNumber,
                });

              } else if (declaration is TopLevelVariableDeclaration) {
                for (final variable in declaration.variables.variables) {
                  final element = variable.declaredElement!;
                  (fileInfo['variables'] as List).add({
                    'name': element.name,
                    'type': element.type.getDisplayString(withNullability: true),
                    'isFinal': element.isFinal,
                    'isConst': element.isConst,
                    'isPrivate': element.isPrivate,
                    'line': lineInfo.getLocation(element.nameOffset).lineNumber,
                  });
                }
              }
            }

            // 2. Widget Tree Analysis (AST Traversal)
            final widgetVisitor = WidgetTreeVisitor(lineInfo);
            unit.accept(widgetVisitor);
            fileInfo['widgets'] = widgetVisitor.widgets;

            // 3. Function Calls Analysis (AST Traversal)
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
        // To be more precise, we could check if we are inside a method named 'build'
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
