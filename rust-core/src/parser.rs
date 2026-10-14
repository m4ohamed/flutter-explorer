use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartWidgetProperty {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartWidgetInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub line: usize,
    #[serde(default)]
    pub children: Vec<DartWidgetInfo>,
    #[serde(default)]
    pub properties: Vec<DartWidgetProperty>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartImportInfo {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default, alias = "showNames")]
    pub show_names: Vec<String>,
    #[serde(default, alias = "hideNames")]
    pub hide_names: Vec<String>,
    #[serde(default)]
    pub line: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartPropertyInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default, alias = "className")]
    pub class_name: Option<String>,
    #[serde(default, alias = "isFinal")]
    pub is_final: bool,
    #[serde(default, alias = "isConst")]
    pub is_const: bool,
    #[serde(default, alias = "isStatic")]
    pub is_static: bool,
    #[serde(default, alias = "isPrivate")]
    pub is_private: bool,
    #[serde(default, alias = "isGetter")]
    pub is_getter: bool,
    #[serde(default, alias = "isSetter")]
    pub is_setter: bool,
    #[serde(default)]
    pub line: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartConstructorInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default, alias = "className")]
    pub class_name: String,
    #[serde(default, alias = "isFactory")]
    pub is_factory: bool,
    #[serde(default, alias = "isConst")]
    pub is_const: bool,
    #[serde(default)]
    pub params: String,
    #[serde(default)]
    pub line: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartVariableInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub line: usize,
    #[serde(default, alias = "isConst")]
    pub is_const: bool,
    #[serde(default, alias = "isFinal")]
    pub is_final: bool,
    #[serde(default, alias = "isPrivate")]
    pub is_private: bool,
    #[serde(default, alias = "isTopLevel")]
    pub is_top_level: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartTypedefInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub signature: String,
    #[serde(default)]
    pub line: usize,
    #[serde(default, alias = "isPrivate")]
    pub is_private: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartMixinInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub on: Option<String>,
    #[serde(default)]
    pub line: usize,
    #[serde(default, alias = "lineEnd")]
    pub line_end: Option<usize>,
    #[serde(default, alias = "isPrivate")]
    pub is_private: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartExtensionInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default, alias = "onType")]
    pub on_type: String,
    #[serde(default)]
    pub methods: Vec<DartMethod>,
    #[serde(default)]
    pub properties: Vec<DartPropertyInfo>,
    #[serde(default)]
    pub line: usize,
    #[serde(default, alias = "lineEnd")]
    pub line_end: Option<usize>,
    #[serde(default, alias = "isPrivate")]
    pub is_private: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartAnnotationInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub target: String,
    #[serde(default, alias = "targetName")]
    pub target_name: String,
    #[serde(default)]
    pub line: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartFunctionCall {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub line: usize,
    #[serde(default, alias = "callerClass")]
    pub caller_class: Option<String>,
    #[serde(default, alias = "callerFunction")]
    pub caller_function: Option<String>,
    #[serde(default)]
    pub context: String,
    #[serde(default, alias = "isStatic")]
    pub is_static: bool,
    #[serde(default, alias = "isChained")]
    pub is_chained: bool,
    #[serde(default)]
    pub receiver: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartMethod {
    #[serde(default)]
    pub name: String,
    #[serde(default, alias = "returnType")]
    pub return_type: String,
    #[serde(default)]
    pub params: String,
    #[serde(default)]
    pub line: usize,
    #[serde(default, alias = "lineEnd")]
    pub line_end: Option<usize>,
    #[serde(default, alias = "isPrivate")]
    pub is_private: bool,
    #[serde(default, alias = "isAsync")]
    pub is_async: bool,
    #[serde(default, alias = "isStatic")]
    pub is_static: bool,
    #[serde(default, alias = "parentClass")]
    pub parent_class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartClass {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub line: usize,
    #[serde(default, alias = "lineEnd")]
    pub line_end: Option<usize>,
    #[serde(default, alias = "extendsClass")]
    pub extends_class: Option<String>,
    #[serde(default)]
    pub mixins: Vec<String>,
    #[serde(default)]
    pub implements: Vec<String>,
    #[serde(default, alias = "isAbstract")]
    pub is_abstract: bool,
    #[serde(default, alias = "isPrivate")]
    pub is_private: bool,
    #[serde(default)]
    pub methods: Vec<DartMethod>,
    #[serde(default)]
    pub properties: Vec<DartPropertyInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartEnum {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub values: Vec<String>,
    #[serde(default)]
    pub line: usize,
    #[serde(default, alias = "lineEnd")]
    pub line_end: Option<usize>,
    #[serde(default, alias = "isPrivate")]
    pub is_private: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_comment: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawImportEntry {
    Str(String),
    Obj(DartImportInfo),
}

fn deserialize_imports<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let items: Vec<RawImportEntry> = Vec::deserialize(deserializer).unwrap_or_default();
    Ok(items
        .into_iter()
        .map(|item| match item {
            RawImportEntry::Str(s) => s,
            RawImportEntry::Obj(o) => o.path,
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartParsedAst {
    #[serde(default)]
    pub classes: Vec<DartClass>,
    #[serde(default)]
    pub functions: Vec<DartMethod>,
    #[serde(default)]
    pub enums: Vec<DartEnum>,
    #[serde(default)]
    pub widgets: Vec<DartWidgetInfo>,
    #[serde(default)]
    pub mixins: Vec<DartMixinInfo>,
    #[serde(default)]
    pub extensions: Vec<DartExtensionInfo>,
    #[serde(default)]
    pub typedefs: Vec<DartTypedefInfo>,
    #[serde(default)]
    pub variables: Vec<DartVariableInfo>,
    #[serde(default)]
    pub constructors: Vec<DartConstructorInfo>,
    #[serde(default)]
    pub properties: Vec<DartPropertyInfo>,
    #[serde(default)]
    pub annotations: Vec<DartAnnotationInfo>,
    #[serde(default, alias = "functionCalls")]
    pub function_calls: Vec<DartFunctionCall>,
    #[serde(default, deserialize_with = "deserialize_imports")]
    pub imports: Vec<String>,
    #[serde(default, alias = "importDetails")]
    pub import_details: Vec<DartImportInfo>,
    #[serde(default)]
    pub exports: Vec<String>,
    #[serde(default, alias = "linesCount")]
    pub total_lines: usize,
}

struct ActiveMethodState {
    method: DartMethod,
    is_class_member: bool,
    is_extension_member: bool,
    base_brace_depth: usize,
    has_opened_brace: bool,
    is_arrow_expr: bool,
}

struct WidgetStackItem {
    widget: DartWidgetInfo,
    indent: usize,
}

fn widget_call_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:\b|return\s+|=>\s+)(_?[A-Z][A-Za-z0-9_]*)(?:<[^>]*>)?(?:\.([A-Za-z0-9_]+))?\s*\(").unwrap()
    })
}

fn fn_call_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:([a-zA-Z_][a-zA-Z0-9_]*)\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(").unwrap()
    })
}

fn non_widget_types() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| {
        [
            "Navigator", "AppTheme", "Theme", "DurationFormatter", "Localizations",
            "Clipboard", "HapticFeedback", "Uuid", "DateFormat", "HiveService",
            "BadgeHelper", "_DS", "ReportPdfGenerator", "ShareParams", "XFile",
            "AsyncValue", "AsyncData", "AsyncLoading", "AsyncError",
            "TextStyle", "Border", "BorderRadius", "Radius", "BoxDecoration", "EdgeInsets",
            "File", "Uint8List", "ByteData", "Platform", "TargetPlatform", "WidgetsBinding",
            "SystemChrome", "MediaQuery", "ScaffoldMessenger", "FocusScope", "FocusManager",
            "String", "int", "double", "bool", "num", "List", "Map", "Set",
            "Future", "Stream", "Duration", "DateTime", "TextEditingController",
            "GlobalKey", "AnimationController", "ScrollController", "TabController",
            "PageController", "FocusNode", "Color", "Colors", "Paint", "Canvas",
            "Path", "Offset", "Size", "Rect", "Key", "ValueKey", "ObjectKey", "UniqueKey",
        ]
        .into_iter()
        .collect()
    })
}

pub struct PureDartParser;

impl PureDartParser {
    pub fn parse(source: &str) -> DartParsedAst {
        let lines: Vec<&str> = source.lines().collect();
        let total_lines = lines.len();

        let mut classes = Vec::new();
        let mut functions = Vec::new();
        let mut enums = Vec::new();
        let mut widgets = Vec::new();
        let mut mixins = Vec::new();
        let mut extensions = Vec::new();
        let mut typedefs = Vec::new();
        let mut variables = Vec::new();
        let mut constructors = Vec::new();
        let mut properties = Vec::new();
        let mut annotations = Vec::new();
        let mut function_calls = Vec::new();
        let mut imports = Vec::new();
        let mut import_details = Vec::new();
        let mut exports = Vec::new();

        let mut sanitized_lines: Vec<String> = Vec::with_capacity(total_lines);
        let mut in_block_comment = false;
        for raw in &lines {
            sanitized_lines.push(Self::sanitize_line(raw, &mut in_block_comment));
        }

        let mut current_class: Option<DartClass> = None;
        let mut class_brace_depth: usize = 0;
        let mut class_has_opened = false;

        let mut current_ext: Option<DartExtensionInfo> = None;
        let mut ext_brace_depth: usize = 0;
        let mut ext_has_opened = false;

        let mut current_enum: Option<DartEnum> = None;
        let mut enum_brace_depth: usize = 0;
        let mut enum_has_opened = false;
        let mut enum_values_finished = false;

        let mut current_method: Option<ActiveMethodState> = None;
        let mut brace_level: usize = 0;
        let mut pending_doc_lines: Vec<String> = Vec::new();

        for idx in 0..total_lines {
            let line_num = idx + 1;
            let raw_line = lines[idx];
            let trimmed_raw = raw_line.trim();

            if trimmed_raw.starts_with("///") {
                let doc_text = trimmed_raw.trim_start_matches("///").trim().to_string();
                if !doc_text.is_empty() {
                    pending_doc_lines.push(doc_text);
                }
                continue;
            }

            if trimmed_raw.starts_with("//") {
                continue;
            }

            // Top-level imports / exports
            if brace_level == 0 {
                if trimmed_raw.starts_with("import ") {
                    if let Some(info) = Self::parse_import_line(trimmed_raw, line_num) {
                        imports.push(info.path.clone());
                        import_details.push(info);
                    }
                } else if trimmed_raw.starts_with("export ") {
                    if let Some(uri) = Self::extract_quoted_uri(trimmed_raw) {
                        exports.push(uri);
                    }
                }
            }

            let line = sanitized_lines[idx].trim();
            if line.is_empty() {
                continue;
            }

            // Annotations (`@override`, `@immutable`, `@freezed`)
            if let Some(rest) = line.strip_prefix('@') {
                let anno_name = rest
                    .split(|c: char| !c.is_alphanumeric() && c != '_')
                    .next()
                    .unwrap_or("")
                    .trim();
                if !anno_name.is_empty() {
                    let next_line = sanitized_lines.get(idx + 1).map(|s| s.trim()).unwrap_or("");
                    let (target, target_name) = Self::infer_annotation_target(next_line);
                    annotations.push(DartAnnotationInfo {
                        name: anno_name.to_string(),
                        target,
                        target_name,
                        line: line_num,
                    });
                }
                if !line.contains('{') && !line.contains(';') {
                    continue;
                }
            }

            let open_braces = line.chars().filter(|&c| c == '{').count();
            let close_braces = line.chars().filter(|&c| c == '}').count();

            let take_doc_comment = |docs: &mut Vec<String>| -> Option<String> {
                if docs.is_empty() {
                    None
                } else {
                    let joined = docs.join(" ");
                    docs.clear();
                    Some(joined)
                }
            };

            // 1. Top-level declarations (Class, Mixin, Extension, Enum, Typedef)
            if current_class.is_none() && current_ext.is_none() && current_enum.is_none() && brace_level == 0 {
                if let Some(td) = Self::try_parse_typedef(line, line_num) {
                    typedefs.push(td);
                } else if let Some(ext) = Self::try_parse_extension(line, line_num) {
                    ext_brace_depth = brace_level;
                    ext_has_opened = open_braces > 0;
                    current_ext = Some(ext);
                } else if let Some(mut cls) = Self::try_parse_class(line, line_num) {
                    cls.doc_comment = take_doc_comment(&mut pending_doc_lines);
                    if cls.r#type == "mixin" {
                        mixins.push(DartMixinInfo {
                            name: cls.name.clone(),
                            on: cls.extends_class.clone(),
                            line: line_num,
                            line_end: None,
                            is_private: cls.is_private,
                        });
                    }
                    class_brace_depth = brace_level;
                    class_has_opened = open_braces > 0;
                    current_class = Some(cls);
                } else if let Some(mut enm) = Self::try_parse_enum(line, line_num) {
                    enm.doc_comment = take_doc_comment(&mut pending_doc_lines);
                    enum_brace_depth = brace_level;
                    enum_has_opened = open_braces > 0;
                    enum_values_finished = false;
                    if open_braces > 0 {
                        if let Some(open_pos) = line.find('{') {
                            let after_open = &line[open_pos + 1..];
                            let inside = if let Some(close_pos) = after_open.find('}') {
                                &after_open[..close_pos]
                            } else {
                                after_open
                            };
                            Self::extract_enum_values(inside, &mut enm.values, &mut enum_values_finished);
                        }
                    }
                    current_enum = Some(enm);
                }
            } else if let Some(ref mut enm) = current_enum {
                if enum_has_opened && !enum_values_finished && brace_level == enum_brace_depth + 1 {
                    let slice = if let Some(close_pos) = line.find('}') {
                        &line[..close_pos]
                    } else {
                        line
                    };
                    Self::extract_enum_values(slice, &mut enm.values, &mut enum_values_finished);
                }
            }

            // 2. Class / Extension member level OR Top-level Function / Variable level
            let at_class_member_level = current_class.is_some()
                && class_has_opened
                && brace_level == class_brace_depth + 1
                && current_method.is_none();
            let at_ext_member_level = current_ext.is_some()
                && ext_has_opened
                && brace_level == ext_brace_depth + 1
                && current_method.is_none();
            let at_top_level = current_class.is_none()
                && current_ext.is_none()
                && current_enum.is_none()
                && brace_level == 0
                && current_method.is_none();

            if at_class_member_level || at_ext_member_level {
                let container_name = current_class
                    .as_ref()
                    .map(|c| c.name.clone())
                    .or_else(|| current_ext.as_ref().map(|e| e.name.clone()));

                // Check Constructor first if inside a class
                let mut matched_member = false;
                if let Some(ref cls_name) = container_name {
                    if at_class_member_level {
                        if let Some(ctor) = Self::try_parse_constructor(line, line_num, cls_name) {
                            constructors.push(ctor);
                            matched_member = true;
                        }
                    }
                }

                // Check Method / Getter / Setter
                if !matched_member {
                    if let Some(mut method) = Self::try_parse_method(line, line_num, container_name.as_deref()) {
                        method.doc_comment = take_doc_comment(&mut pending_doc_lines);
                        method.parent_class = container_name.clone();
                        matched_member = true;

                        // If it's a getter or setter, also record it in `properties`
                        if line.contains(" get ") || line.starts_with("get ") || line.contains(" set ") || line.starts_with("set ") {
                            let is_getter = line.contains(" get ") || line.starts_with("get ");
                            let prop = DartPropertyInfo {
                                name: method.name.clone(),
                                r#type: method.return_type.clone(),
                                class_name: container_name.clone(),
                                is_final: false,
                                is_const: false,
                                is_static: method.is_static,
                                is_private: method.is_private,
                                is_getter,
                                is_setter: !is_getter,
                                line: line_num,
                            };
                            properties.push(prop.clone());
                            if let Some(ref mut cls) = current_class {
                                cls.properties.push(prop);
                            } else if let Some(ref mut ext) = current_ext {
                                ext.properties.push(prop);
                            }
                        }

                        let is_single_line_complete = (open_braces > 0 && open_braces == close_braces)
                            || (open_braces == 0 && line.ends_with(';'));

                        if is_single_line_complete {
                            method.line_end = Some(line_num);
                            if let Some(ref mut cls) = current_class {
                                cls.methods.push(method);
                            } else if let Some(ref mut ext) = current_ext {
                                ext.methods.push(method);
                            }
                        } else {
                            current_method = Some(ActiveMethodState {
                                method,
                                is_class_member: at_class_member_level,
                                is_extension_member: at_ext_member_level,
                                base_brace_depth: brace_level,
                                has_opened_brace: open_braces > 0,
                                is_arrow_expr: line.contains("=>") && open_braces == 0,
                            });
                        }
                    }
                }

                // Check Class Field / Property declaration
                if !matched_member {
                    if let Some(prop) = Self::try_parse_field_property(line, line_num, container_name.as_deref()) {
                        if let Some(ref mut cls) = current_class {
                            cls.properties.push(prop.clone());
                        } else if let Some(ref mut ext) = current_ext {
                            ext.properties.push(prop.clone());
                        }
                        properties.push(prop);
                    }
                }
            } else if at_top_level {
                if let Some(mut method) = Self::try_parse_method(line, line_num, None) {
                    method.doc_comment = take_doc_comment(&mut pending_doc_lines);
                    let is_single_line_complete = (open_braces > 0 && open_braces == close_braces)
                        || (open_braces == 0 && line.ends_with(';'));
                    if is_single_line_complete {
                        method.line_end = Some(line_num);
                        functions.push(method);
                    } else {
                        current_method = Some(ActiveMethodState {
                            method,
                            is_class_member: false,
                            is_extension_member: false,
                            base_brace_depth: brace_level,
                            has_opened_brace: open_braces > 0,
                            is_arrow_expr: line.contains("=>") && open_braces == 0,
                        });
                    }
                } else if let Some(var_info) = Self::try_parse_top_variable(line, line_num) {
                    variables.push(var_info);
                }
            }

            // 3. Extract function calls inside methods/functions
            if current_method.is_some() {
                let caller_cls = current_class
                    .as_ref()
                    .map(|c| c.name.clone())
                    .or_else(|| current_ext.as_ref().map(|e| e.name.clone()));
                let caller_fn = current_method.as_ref().map(|m| m.method.name.clone());
                Self::extract_line_function_calls(
                    line,
                    trimmed_raw,
                    line_num,
                    caller_cls.as_deref(),
                    caller_fn.as_deref(),
                    &mut function_calls,
                );
            }

            if !pending_doc_lines.is_empty() {
                pending_doc_lines.clear();
            }

            // Update brace nesting
            brace_level += open_braces;
            if brace_level >= close_braces {
                brace_level -= close_braces;
            } else {
                brace_level = 0;
            }

            if open_braces > 0 {
                if current_class.is_some() {
                    class_has_opened = true;
                }
                if current_ext.is_some() {
                    ext_has_opened = true;
                }
                if current_enum.is_some() {
                    enum_has_opened = true;
                }
                if let Some(ref mut m_state) = current_method {
                    m_state.has_opened_brace = true;
                }
            }

            // 4. Check if active method / function ended on this line
            if let Some(ref m_state) = current_method {
                let ended_by_brace = m_state.has_opened_brace
                    && close_braces > 0
                    && brace_level <= m_state.base_brace_depth;
                let ended_by_semicolon = m_state.is_arrow_expr
                    && brace_level <= m_state.base_brace_depth
                    && line.ends_with(';');
                let ended_by_abstract_semi = !m_state.has_opened_brace
                    && brace_level <= m_state.base_brace_depth
                    && line.ends_with(';');

                if ended_by_brace || ended_by_semicolon || ended_by_abstract_semi {
                    let mut finished = current_method.take().unwrap();
                    finished.method.line_end = Some(line_num);
                    if finished.is_class_member {
                        if let Some(ref mut cls) = current_class {
                            cls.methods.push(finished.method);
                        }
                    } else if finished.is_extension_member {
                        if let Some(ref mut ext) = current_ext {
                            ext.methods.push(finished.method);
                        }
                    } else {
                        functions.push(finished.method);
                    }
                }
            }

            // 5. Check if current enum ended
            if let Some(ref mut enm) = current_enum {
                if enum_has_opened && close_braces > 0 && brace_level <= enum_brace_depth {
                    enm.line_end = Some(line_num);
                    enums.push(enm.clone());
                    current_enum = None;
                    enum_has_opened = false;
                }
            }

            // 6. Check if current extension ended
            if let Some(ref mut ext) = current_ext {
                if ext_has_opened && close_braces > 0 && brace_level <= ext_brace_depth {
                    if let Some(mut unclosed_method) = current_method.take() {
                        unclosed_method.method.line_end = Some(line_num);
                        ext.methods.push(unclosed_method.method);
                    }
                    ext.line_end = Some(line_num);
                    extensions.push(ext.clone());
                    current_ext = None;
                    ext_has_opened = false;
                }
            }

            // 7. Check if current class ended
            if let Some(ref mut cls) = current_class {
                if class_has_opened && close_braces > 0 && brace_level <= class_brace_depth {
                    if let Some(mut unclosed_method) = current_method.take() {
                        unclosed_method.method.line_end = Some(line_num);
                        cls.methods.push(unclosed_method.method);
                    }
                    cls.line_end = Some(line_num);
                    classes.push(cls.clone());
                    current_class = None;
                    class_has_opened = false;
                }
            }
        }

        // Flush any unclosed entities at EOF
        if let Some(mut unclosed_method) = current_method.take() {
            unclosed_method.method.line_end = Some(total_lines);
            if unclosed_method.is_class_member {
                if let Some(ref mut cls) = current_class {
                    cls.methods.push(unclosed_method.method);
                }
            } else if unclosed_method.is_extension_member {
                if let Some(ref mut ext) = current_ext {
                    ext.methods.push(unclosed_method.method);
                }
            } else {
                functions.push(unclosed_method.method);
            }
        }
        if let Some(mut cls) = current_class {
            cls.line_end = Some(total_lines);
            classes.push(cls);
        }
        if let Some(mut ext) = current_ext {
            ext.line_end = Some(total_lines);
            extensions.push(ext);
        }
        if let Some(mut enm) = current_enum {
            enm.line_end = Some(total_lines);
            enums.push(enm);
        }

        // 8. Build nested WidgetInfo trees from `build()` methods across all classes
        for cls in &classes {
            for m in &cls.methods {
                if m.name == "build" {
                    let start_idx = m.line.saturating_sub(1);
                    let end_idx = m.line_end.unwrap_or(total_lines).min(total_lines);
                    if start_idx < end_idx {
                        let method_widgets = Self::parse_widget_tree_slice(
                            &lines[start_idx..end_idx],
                            &sanitized_lines[start_idx..end_idx],
                            m.line,
                        );
                        widgets.extend(method_widgets);
                    }
                }
            }
        }

        DartParsedAst {
            classes,
            functions,
            enums,
            widgets,
            mixins,
            extensions,
            typedefs,
            variables,
            constructors,
            properties,
            annotations,
            function_calls,
            imports,
            import_details,
            exports,
            total_lines,
        }
    }

    /// Builds a nested `Vec<DartWidgetInfo>` hierarchy from the lines of a `build()` method
    pub fn parse_widget_tree_slice(
        raw_lines: &[&str],
        masked_lines: &[String],
        start_line: usize,
    ) -> Vec<DartWidgetInfo> {
        let mut root_widgets: Vec<DartWidgetInfo> = Vec::new();
        let mut stack: Vec<WidgetStackItem> = Vec::new();
        let re = widget_call_regex();
        let excluded = non_widget_types();

        const NON_WIDGET_SUFFIXES: &[&str] = &[
            "Entity", "Model", "Exception", "Error", "State", "Result", "Params",
            "Provider", "Repository", "Source", "Service", "Helper", "Util", "Utils", "Data",
        ];
        const STATIC_HELPER_METHODS: &[&str] = &[
            "of", "lerp", "copyWith", "maybeOf", "sizeOf", "paddingOf", "values",
            "parse", "tryParse", "fromJson", "toJson", "push", "pop", "format",
            "formatDecimalDays", "formatDuration", "successColor", "lightImpact",
            "setData", "getData", "get", "set", "watch", "read", "select", "show",
            "showDialog", "showSnackBar",
        ];

        for i in 0..masked_lines.len() {
            let orig_line = raw_lines[i];
            let orig_trimmed = orig_line.trim();
            if orig_trimmed.is_empty()
                || orig_trimmed.starts_with("//")
                || orig_trimmed.starts_with("/*")
                || orig_trimmed.starts_with('*')
                || orig_trimmed.starts_with("import ")
                || orig_trimmed.starts_with("export ")
            {
                continue;
            }

            let m_line = &masked_lines[i];
            let trimmed_masked = m_line.trim();
            if trimmed_masked.is_empty() {
                continue;
            }

            // Skip the `Widget build(BuildContext context)` signature line itself unless it's a one-liner `=>`
            if i == 0 && trimmed_masked.contains("build(") && !trimmed_masked.contains("=>") {
                continue;
            }

            let base_indent = m_line.len() - m_line.trim_start().len();

            for cap in re.captures_iter(trimmed_masked) {
                let full_match = match cap.get(0) {
                    Some(m) => m,
                    None => continue,
                };
                let name = match cap.get(1) {
                    Some(m) => m.as_str(),
                    None => continue,
                };
                let dot_method = cap.get(2).map(|m| m.as_str());

                if excluded.contains(name) {
                    continue;
                }
                if NON_WIDGET_SUFFIXES.iter().any(|suf| name.ends_with(suf)) {
                    continue;
                }
                if let Some(dm) = dot_method {
                    if STATIC_HELPER_METHODS.contains(&dm) {
                        continue;
                    }
                }

                // Compute effective column indent so multiple widgets on the same line nest properly
                let effective_indent = base_indent + full_match.start();

                // Extract optional first positional detail (e.g. `Text('Hello')` or `Icon(Icons.add)`)
                let mut props = Vec::new();
                if let Some(name_pos) = orig_trimmed.find(name) {
                    let after_name = &orig_trimmed[name_pos + name.len()..];
                    if let Some(open_p) = after_name.find('(') {
                        let rem = after_name[open_p + 1..].trim();
                        if rem.starts_with(")") && rem[1..].trim_start().starts_with("=>") {
                            continue;
                        }
                        if let Some(lit) = Self::extract_leading_string_literal(rem) {
                            if !lit.is_empty() {
                                props.push(DartWidgetProperty {
                                    name: "detail".to_string(),
                                    value: lit,
                                });
                            }
                        } else if rem.starts_with("Icons.") {
                            let icon_val: String = rem
                                .chars()
                                .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '.')
                                .collect();
                            if !icon_val.is_empty() {
                                props.push(DartWidgetProperty {
                                    name: "detail".to_string(),
                                    value: icon_val,
                                });
                            }
                        }
                    }
                }

                let widget = DartWidgetInfo {
                    name: name.to_string(),
                    line: start_line + i,
                    children: Vec::new(),
                    properties: props,
                };

                // Pop completed sibling/child widgets whose indent >= effective_indent
                while let Some(top) = stack.last() {
                    if top.indent >= effective_indent {
                        let finished = stack.pop().unwrap();
                        if let Some(parent) = stack.last_mut() {
                            parent.widget.children.push(finished.widget);
                        } else {
                            root_widgets.push(finished.widget);
                        }
                    } else {
                        break;
                    }
                }

                stack.push(WidgetStackItem {
                    widget,
                    indent: effective_indent,
                });
            }
        }

        // Flush remaining stack items into their parents
        while let Some(finished) = stack.pop() {
            if let Some(parent) = stack.last_mut() {
                parent.widget.children.push(finished.widget);
            } else {
                root_widgets.push(finished.widget);
            }
        }

        root_widgets
    }

    fn extract_leading_string_literal(rem: &str) -> Option<String> {
        let first = rem.chars().next()?;
        if first != '\'' && first != '"' {
            return None;
        }
        let rest = &rem[first.len_utf8()..];
        let end_idx = rest.find(first)?;
        Some(rest[..end_idx].to_string())
    }

    fn parse_import_line(raw_line: &str, line_num: usize) -> Option<DartImportInfo> {
        let path = Self::extract_quoted_uri(raw_line)?;
        let no_semi = raw_line.trim_end_matches(';').trim();

        let mut alias = None;
        if let Some(as_idx) = no_semi.find(" as ") {
            let after_as = no_semi[as_idx + 4..].trim();
            let alias_tok = after_as.split_whitespace().next().unwrap_or("").trim();
            if !alias_tok.is_empty() {
                alias = Some(alias_tok.to_string());
            }
        }

        let mut show_names = Vec::new();
        if let Some(show_idx) = no_semi.find(" show ") {
            let after_show = no_semi[show_idx + 6..].trim();
            let end = after_show.find(" hide ").unwrap_or(after_show.len());
            for s in after_show[..end].split(',') {
                let t = s.trim();
                if !t.is_empty() {
                    show_names.push(t.to_string());
                }
            }
        }

        let mut hide_names = Vec::new();
        if let Some(hide_idx) = no_semi.find(" hide ") {
            let after_hide = no_semi[hide_idx + 6..].trim();
            let end = after_hide.find(" show ").unwrap_or(after_hide.len());
            for s in after_hide[..end].split(',') {
                let t = s.trim();
                if !t.is_empty() {
                    hide_names.push(t.to_string());
                }
            }
        }

        Some(DartImportInfo {
            path,
            alias,
            show_names,
            hide_names,
            line: line_num,
        })
    }

    fn extract_quoted_uri(line: &str) -> Option<String> {
        for quote in ['\'', '"'] {
            if let Some(start) = line.find(quote) {
                let rest = &line[start + 1..];
                if let Some(end) = rest.find(quote) {
                    let uri = rest[..end].trim();
                    if !uri.is_empty() {
                        return Some(uri.to_string());
                    }
                }
            }
        }
        None
    }

    fn infer_annotation_target(next_line: &str) -> (String, String) {
        if next_line.contains("class ") || next_line.starts_with("enum ") || next_line.starts_with("mixin ") {
            let words: Vec<&str> = next_line.split_whitespace().collect();
            for i in 0..words.len() {
                if matches!(words[i], "class" | "enum" | "mixin") {
                    if let Some(&name) = words.get(i + 1) {
                        let clean = name.split(|c: char| c == '<' || c == '{').next().unwrap_or(name);
                        return ("class".to_string(), clean.to_string());
                    }
                }
            }
        }
        if let Some(paren_idx) = next_line.find('(') {
            let before = next_line[..paren_idx].trim();
            if let Some(last_tok) = before.split_whitespace().last() {
                let clean = last_tok.split('<').next().unwrap_or(last_tok);
                return ("function".to_string(), clean.to_string());
            }
        }
        ("member".to_string(), String::new())
    }

    fn try_parse_typedef(line: &str, line_num: usize) -> Option<DartTypedefInfo> {
        let after = line.strip_prefix("typedef ")?.trim();
        if let Some(eq_idx) = after.find('=') {
            let left = after[..eq_idx].trim();
            let name = left.split('<').next().unwrap_or(left).trim();
            let sig = after[eq_idx + 1..].trim_end_matches(';').trim();
            if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
                return Some(DartTypedefInfo {
                    name: name.to_string(),
                    signature: sig.to_string(),
                    line: line_num,
                    is_private: name.starts_with('_'),
                });
            }
        }
        None
    }

    fn try_parse_extension(line: &str, line_num: usize) -> Option<DartExtensionInfo> {
        let after = line.strip_prefix("extension ")?.trim();
        let before_brace = after.split('{').next().unwrap_or(after).trim();
        let on_idx = before_brace.find(" on ")?;
        let raw_name = before_brace[..on_idx].trim();
        let name = if raw_name.is_empty() {
            format!("UnnamedExtension_{}", line_num)
        } else {
            raw_name.split('<').next().unwrap_or(raw_name).trim().to_string()
        };
        let on_type = before_brace[on_idx + 4..].trim().to_string();
        let is_private = name.starts_with('_');

        Some(DartExtensionInfo {
            name,
            on_type,
            methods: Vec::new(),
            properties: Vec::new(),
            line: line_num,
            line_end: None,
            is_private,
        })
    }

    fn try_parse_constructor(line: &str, line_num: usize, class_name: &str) -> Option<DartConstructorInfo> {
        let mut s = line;
        let is_const = if let Some(r) = s.strip_prefix("const ") {
            s = r.trim_start();
            true
        } else {
            false
        };
        let is_factory = if let Some(r) = s.strip_prefix("factory ") {
            s = r.trim_start();
            true
        } else {
            false
        };

        if !s.starts_with(class_name) {
            return None;
        }
        let after_cls = &s[class_name.len()..];
        let paren_idx = after_cls.find('(')?;
        let prefix = after_cls[..paren_idx].trim();

        let ctor_name = if prefix.is_empty() {
            class_name.to_string()
        } else if let Some(named) = prefix.strip_prefix('.') {
            if named.chars().all(|c| c.is_alphanumeric() || c == '_') && !named.is_empty() {
                named.to_string()
            } else {
                return None;
            }
        } else {
            return None;
        };

        let close_paren = s.rfind(')')?;
        let open_paren_abs = class_name.len() + paren_idx;
        let params = if close_paren > open_paren_abs {
            s[open_paren_abs + 1..close_paren].trim().to_string()
        } else {
            String::new()
        };

        Some(DartConstructorInfo {
            name: ctor_name,
            class_name: class_name.to_string(),
            is_factory,
            is_const,
            params,
            line: line_num,
        })
    }

    fn try_parse_field_property(
        line: &str,
        line_num: usize,
        class_name: Option<&str>,
    ) -> Option<DartPropertyInfo> {
        if !line.ends_with(';') || line.contains("=>") {
            return None;
        }
        let before_eq = line.split('=').next().unwrap_or(line).trim_end_matches(';').trim();
        if before_eq.contains('(') || before_eq.contains(')') || before_eq.contains('{') {
            return None;
        }

        let mut tokens: Vec<&str> = before_eq.split_whitespace().collect();
        if tokens.is_empty() {
            return None;
        }

        let is_static = if tokens.first() == Some(&"static") {
            tokens.remove(0);
            true
        } else {
            false
        };
        if tokens.first() == Some(&"late") {
            tokens.remove(0);
        }
        let is_final = if tokens.first() == Some(&"final") {
            tokens.remove(0);
            true
        } else {
            false
        };
        let is_const = if tokens.first() == Some(&"const") {
            tokens.remove(0);
            true
        } else {
            false
        };
        if tokens.first() == Some(&"var") {
            tokens.remove(0);
        }

        if tokens.is_empty() {
            return None;
        }

        let name = (*tokens.last()?).to_string();
        if name.is_empty()
            || !name.chars().all(|c| c.is_alphanumeric() || c == '_')
            || matches!(name.as_str(), "return" | "break" | "continue" | "rethrow" | "super" | "this")
        {
            return None;
        }

        let r#type = if tokens.len() > 1 {
            tokens[..tokens.len() - 1].join(" ")
        } else if is_final || is_const {
            "dynamic".to_string()
        } else {
            return None;
        };

        Some(DartPropertyInfo {
             is_private: name.starts_with('_'),
            name,
            r#type,
            class_name: class_name.map(|s| s.to_string()),
            is_final,
            is_const,
            is_static,
            is_getter: false,
            is_setter: false,
            line: line_num,
        })
    }

    fn try_parse_top_variable(line: &str, line_num: usize) -> Option<DartVariableInfo> {
        if !line.starts_with("final ")
            && !line.starts_with("const ")
            && !line.starts_with("var ")
            && !line.starts_with("late ")
        {
            return None;
        }
        let prop = Self::try_parse_field_property(line, line_num, None)?;
        Some(DartVariableInfo {
            name: prop.name,
            r#type: prop.r#type,
            value: None,
            line: line_num,
            is_const: prop.is_const,
            is_final: prop.is_final,
            is_private: prop.is_private,
            is_top_level: true,
        })
    }

    fn extract_line_function_calls(
        sanitized_line: &str,
        raw_trimmed: &str,
        line_num: usize,
        caller_class: Option<&str>,
        caller_function: Option<&str>,
        out: &mut Vec<DartFunctionCall>,
    ) {
        const IGNORED_CALLS: &[&str] = &[
            "if", "for", "while", "switch", "catch", "return", "await", "async",
            "throw", "assert", "super", "this", "print", "setState", "Scaffold",
            "Container", "Text", "Column", "Row", "Stack", "Padding", "SizedBox",
            "Expanded", "Flexible", "Center", "Align", "Icon",
        ];
        let re = fn_call_regex();
        for cap in re.captures_iter(sanitized_line) {
            let receiver = cap.get(1).map(|m| m.as_str().to_string());
            let fn_name = match cap.get(2) {
                Some(m) => m.as_str(),
                None => continue,
            };
            if IGNORED_CALLS.contains(&fn_name) {
                continue;
            }
            if Some(fn_name) == caller_function {
                continue;
            }
            let is_static = receiver
                .as_ref()
                .map_or(true, |r| r.chars().next().map_or(false, |c| c.is_ascii_uppercase()));
            let is_chained = receiver.is_some();
            out.push(DartFunctionCall {
                name: fn_name.to_string(),
                line: line_num,
                caller_class: caller_class.map(|s| s.to_string()),
                caller_function: caller_function.map(|s| s.to_string()),
                context: raw_trimmed.chars().take(160).collect(),
                is_static,
                is_chained,
                receiver,
            });
        }
    }

    fn sanitize_line(line: &str, in_block_comment: &mut bool) -> String {
        let chars: Vec<char> = line.chars().collect();
        let mut out = String::with_capacity(line.len());
        let mut i = 0;
        let mut in_single_quote = false;
        let mut in_double_quote = false;

        while i < chars.len() {
            let c = chars[i];
            let next = chars.get(i + 1).copied();

            if *in_block_comment {
                if c == '*' && next == Some('/') {
                    *in_block_comment = false;
                    out.push_str("  ");
                    i += 2;
                } else {
                    out.push(' ');
                    i += 1;
                }
                continue;
            }

            if in_single_quote {
                if c == '\\' {
                    out.push_str("  ");
                    i += 2;
                    continue;
                }
                if c == '\'' {
                    in_single_quote = false;
                    out.push('\'');
                } else {
                    out.push(' ');
                }
                i += 1;
                continue;
            }

            if in_double_quote {
                if c == '\\' {
                    out.push_str("  ");
                    i += 2;
                    continue;
                }
                if c == '"' {
                    in_double_quote = false;
                    out.push('"');
                } else {
                    out.push(' ');
                }
                i += 1;
                continue;
            }

            if c == '/' && next == Some('/') {
                break;
            }
            if c == '/' && next == Some('*') {
                *in_block_comment = true;
                out.push_str("  ");
                i += 2;
                continue;
            }

            if c == '\'' {
                in_single_quote = true;
                out.push('\'');
                i += 1;
                continue;
            }
            if c == '"' {
                in_double_quote = true;
                out.push('"');
                i += 1;
                continue;
            }

            out.push(c);
            i += 1;
        }

        out
    }

    fn strip_generics(s: &str) -> String {
        let mut out = String::new();
        let mut depth = 0usize;
        for c in s.chars() {
            if c == '<' {
                depth += 1;
            } else if c == '>' {
                depth = depth.saturating_sub(1);
            } else if depth == 0 {
                out.push(c);
            }
        }
        out.trim().to_string()
    }

    fn split_top_level_commas(s: &str) -> Vec<String> {
        let mut items = Vec::new();
        let mut current = String::new();
        let mut angle_depth = 0usize;

        for c in s.chars() {
            match c {
                '<' => {
                    angle_depth += 1;
                    current.push(c);
                }
                '>' => {
                    angle_depth = angle_depth.saturating_sub(1);
                    current.push(c);
                }
                ',' if angle_depth == 0 => {
                    let trimmed = Self::strip_generics(&current);
                    if !trimmed.is_empty() {
                        items.push(trimmed);
                    }
                    current.clear();
                }
                _ => current.push(c),
            }
        }

        let trimmed = Self::strip_generics(&current);
        if !trimmed.is_empty() {
            items.push(trimmed);
        }
        items
    }

    fn is_widget_superclass(ext: &str) -> bool {
        let base = Self::strip_generics(ext);
        matches!(
            base.as_str(),
            "StatelessWidget"
                | "StatefulWidget"
                | "ConsumerWidget"
                | "ConsumerStatefulWidget"
                | "HookWidget"
                | "HookConsumerWidget"
                | "InheritedWidget"
                | "InheritedNotifier"
                | "InheritedModel"
                | "RenderObjectWidget"
                | "SingleChildRenderObjectWidget"
                | "MultiChildRenderObjectWidget"
                | "State"
        ) || base.ends_with("Widget")
            || base.ends_with("State")
    }

    fn try_parse_class(line: &str, line_num: usize) -> Option<DartClass> {
        let is_mixin_decl = line.starts_with("mixin ") || line.starts_with("base mixin ");
        if !line.contains("class ") && !is_mixin_decl {
            return None;
        }

        let is_abstract = line.split_whitespace().any(|w| w == "abstract" || w == "sealed");

        let after_keyword = if let Some(class_idx) = line.find("class ") {
            line[class_idx + 6..].trim()
        } else if let Some(mixin_idx) = line.find("mixin ") {
            line[mixin_idx + 6..].trim()
        } else {
            return None;
        };

        let name_end = after_keyword
            .find(|c: char| c.is_whitespace() || c == '{' || c == '<')
            .unwrap_or(after_keyword.len());
        let class_name = after_keyword[..name_end].trim().to_string();

        if class_name.is_empty() || !class_name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return None;
        }

        let is_private = class_name.starts_with('_');
        let before_brace = line.split('{').next().unwrap_or(line);

        let mut extends_class = None;
        for kw in [" extends ", " on "] {
            if let Some(ext_idx) = before_brace.find(kw) {
                let after_ext = before_brace[ext_idx + kw.len()..].trim();
                let clause_end = [" with ", " implements "]
                    .iter()
                    .filter_map(|next_kw| after_ext.find(next_kw))
                    .min()
                    .unwrap_or(after_ext.len());
                let raw_ext = after_ext[..clause_end].trim();
                let clean_ext = Self::strip_generics(raw_ext);
                if !clean_ext.is_empty() {
                    extends_class = Some(clean_ext);
                    break;
                }
            }
        }

        let r#type = if is_mixin_decl && !line.contains("class ") {
            "mixin".to_string()
        } else if let Some(ref ext) = extends_class {
            if Self::is_widget_superclass(ext) {
                "widget".to_string()
            } else {
                "class".to_string()
            }
        } else {
            "class".to_string()
        };

        let mut mixins = Vec::new();
        if let Some(with_idx) = before_brace.find(" with ") {
            let after_with = before_brace[with_idx + 6..].trim();
            let with_end = after_with.find(" implements ").unwrap_or(after_with.len());
            mixins = Self::split_top_level_commas(&after_with[..with_end]);
        }

        let mut implements = Vec::new();
        if let Some(imp_idx) = before_brace.find(" implements ") {
            let after_imp = before_brace[imp_idx + 12..].trim();
            implements = Self::split_top_level_commas(after_imp);
        }

        Some(DartClass {
            name: class_name,
            r#type,
            line: line_num,
            line_end: None,
            extends_class,
            mixins,
            implements,
            is_abstract,
            is_private,
            methods: Vec::new(),
            properties: Vec::new(),
            doc_comment: None,
        })
    }

    fn try_parse_enum(line: &str, line_num: usize) -> Option<DartEnum> {
        let after_enum = line.strip_prefix("enum ")?.trim();
        let name_end = after_enum
            .find(|c: char| c.is_whitespace() || c == '{' || c == '<')
            .unwrap_or(after_enum.len());
        let name = after_enum[..name_end].trim().to_string();

        if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return None;
        }

        let is_private = name.starts_with('_');
        Some(DartEnum {
            name,
            values: Vec::new(),
            line: line_num,
            line_end: None,
            is_private,
            doc_comment: None,
        })
    }

    fn extract_enum_values(segment: &str, values: &mut Vec<String>, finished: &mut bool) {
        if *finished {
            return;
        }
        let slice = if let Some(semi_idx) = segment.find(';') {
            *finished = true;
            &segment[..semi_idx]
        } else {
            segment
        };

        for part in slice.split(',') {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            let val_name = trimmed
                .split(|c: char| c == '(' || c == '<' || c.is_whitespace())
                .next()
                .unwrap_or("")
                .trim();
            if !val_name.is_empty()
                && val_name.chars().all(|c| c.is_alphanumeric() || c == '_')
                && !values.contains(&val_name.to_string())
            {
                values.push(val_name.to_string());
            }
        }
    }

    fn try_parse_method(line: &str, line_num: usize, parent_class: Option<&str>) -> Option<DartMethod> {
        const IGNORED_PREFIXES: &[&str] = &[
            "class ", "enum ", "mixin ", "extension ", "typedef ", "import ", "export ",
            "part ", "library ", "if ", "if(", "else ", "else{", "for ", "for(", "while ",
            "while(", "switch ", "switch(", "case ", "default:", "return ", "return;",
            "throw ", "rethrow;", "assert(", "super.", "super(", "this.", "var ", "final ",
            "const ", "late ",
        ];
        for prefix in IGNORED_PREFIXES {
            if line.starts_with(prefix) {
                return None;
            }
        }

        if !line.contains('(') && (line.contains(" get ") || line.starts_with("get ")) {
            if line.contains('{') || line.contains("=>") {
                let before_body = line
                    .split(|c| c == '{' || c == '=')
                    .next()
                    .unwrap_or(line)
                    .trim();
                let tokens: Vec<&str> = before_body.split_whitespace().collect();
                if let Some(get_pos) = tokens.iter().position(|&t| t == "get") {
                    if let Some(&name_tok) = tokens.get(get_pos + 1) {
                        if name_tok.chars().all(|c| c.is_alphanumeric() || c == '_') {
                            let return_type = if get_pos > 0 && tokens[get_pos - 1] != "static" {
                                tokens[get_pos - 1].to_string()
                            } else {
                                "dynamic".to_string()
                            };
                            return Some(DartMethod {
                                name: name_tok.to_string(),
                                return_type,
                                params: String::new(),
                                line: line_num,
                                line_end: None,
                                is_private: name_tok.starts_with('_'),
                                is_async: false,
                                is_static: tokens.contains(&"static"),
                                parent_class: parent_class.map(|s| s.to_string()),
                                doc_comment: None,
                            });
                        }
                    }
                }
            }
        }

        let paren_idx = line.find('(')?;
        if paren_idx == 0 {
            return None;
        }

        let before_paren = line[..paren_idx].trim();
        if before_paren.contains('=') || before_paren.contains(':') {
            return None;
        }

        let close_paren_idx = line.rfind(')')?;
        if close_paren_idx <= paren_idx {
            return None;
        }

        let after_paren = line[close_paren_idx + 1..].trim();
        let has_body_marker = after_paren.contains('{')
            || after_paren.contains("=>")
            || after_paren.starts_with(':')
            || after_paren.starts_with("async")
            || (parent_class.is_some() && after_paren.ends_with(';'));
        if !has_body_marker {
            return None;
        }

        let tokens: Vec<&str> = before_paren.split_whitespace().collect();
        if tokens.is_empty() {
            return None;
        }

        let raw_name = *tokens.last()?;
        let clean_name = raw_name.split('<').next().unwrap_or(raw_name).trim();
        if clean_name.is_empty()
            || !clean_name
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '.')
        {
            return None;
        }

        if matches!(
            clean_name,
            "if" | "for" | "while" | "switch" | "catch" | "assert" | "return" | "super" | "this"
        ) {
            return None;
        }

        let is_static = tokens.contains(&"static") || tokens.contains(&"factory");
        let is_async = after_paren.contains("async");
        let is_private = clean_name.starts_with('_');

        let return_type = if tokens.contains(&"factory") {
            parent_class.unwrap_or("factory").to_string()
        } else if tokens.len() > 1 {
            let prev = tokens[tokens.len() - 2];
            if matches!(prev, "static" | "Future" | "set" | "get" | "external") && tokens.len() > 2 {
                tokens[tokens.len() - 2].to_string()
            } else if prev == "static" {
                "void".to_string()
            } else {
                prev.to_string()
            }
        } else {
            "void".to_string()
        };

        let params = line[paren_idx + 1..close_paren_idx].trim().to_string();

        Some(DartMethod {
            name: clean_name.to_string(),
            return_type,
            params,
            line: line_num,
            line_end: None,
            is_private,
            is_async,
            is_static,
            parent_class: parent_class.map(|s| s.to_string()),
            doc_comment: None,
        })
    }

    // =========================================================================
    // Multi-Language Rust Core: Dispatcher & Native Parsers for
    // Kotlin/Java/Jetpack Compose, Android XML, Gradle, TypeScript/React/JSX,
    // Markdown, CSS/SCSS, and JSON.
    // =========================================================================

    /// Parse any supported project file into the unified `DartParsedAst` structure
    /// based on its file path / extension.
    pub fn parse_by_extension(file_path: &str, source: &str) -> DartParsedAst {
        let lower = file_path.trim().to_ascii_lowercase();
        if lower.ends_with(".dart") {
            Self::parse(source)
        } else if lower.ends_with(".kt") || lower.ends_with(".java") {
            Self::parse_kotlin_java(file_path, source)
        } else if lower.ends_with(".xml") || lower.ends_with(".html") || lower.ends_with(".htm") {
            Self::parse_xml(file_path, source)
        } else if lower.ends_with(".gradle") || lower.ends_with(".kts") {
            Self::parse_gradle(file_path, source)
        } else if lower.ends_with(".ts")
            || lower.ends_with(".tsx")
            || lower.ends_with(".js")
            || lower.ends_with(".jsx")
            || lower.ends_with(".mjs")
            || lower.ends_with(".cjs")
        {
            Self::parse_js_ts(file_path, source)
        } else if lower.ends_with(".md")
            || lower.ends_with(".css")
            || lower.ends_with(".scss")
            || lower.ends_with(".json")
        {
            Self::parse_auxiliary(file_path, source)
        } else {
            Self::parse(source)
        }
    }

    /// Native Rust parser for Kotlin (`.kt`) and Java (`.java`), including Jetpack Compose `@Composable` UI trees
    pub fn parse_kotlin_java(file_path: &str, source: &str) -> DartParsedAst {
        let is_kotlin = file_path.to_ascii_lowercase().ends_with(".kt");
        let raw_lines: Vec<&str> = source.lines().collect();
        let total_lines = raw_lines.len();

        let mut classes = Vec::new();
        let mut functions = Vec::new();
        let mut enums = Vec::new();
        let mut widgets = Vec::new();
        let mut mixins = Vec::new();
        let mut extensions = Vec::new();
        let mut typedefs = Vec::new();
        let mut variables = Vec::new();
        let mut constructors = Vec::new();
        let mut properties = Vec::new();
        let mut annotations = Vec::new();
        let mut function_calls = Vec::new();
        let mut imports = Vec::new();
        let mut import_details = Vec::new();

        let mut in_block_comment = false;
        let mut masked_lines: Vec<String> = Vec::with_capacity(total_lines);
        for &l in &raw_lines {
            masked_lines.push(Self::sanitize_line(l, &mut in_block_comment));
        }

        let mut brace_depth: usize = 0;
        let mut active_class: Option<DartClass> = None;
        let mut class_brace_depth: usize = 0;
        let mut active_enum: Option<DartEnum> = None;
        let mut enum_brace_depth: usize = 0;
        let mut enum_values_finished = false;
        let mut active_method: Option<ActiveMethodState> = None;
        let mut compose_ranges: Vec<(usize, usize)> = Vec::new();
        let mut pending_composable = false;

        let re_import = Regex::new(r"^import\s+(?:static\s+)?([a-zA-Z0-9_.*]+)(?:\s+as\s+([a-zA-Z0-9_]+))?").unwrap();
        let re_anno = Regex::new(r"^@([A-Za-z_][A-Za-z0-9_.]*)").unwrap();
        let re_kt_enum = Regex::new(r"^(?:(?:public|private|internal|protected)\s+)?enum\s+class\s+([A-Za-z_][A-Za-z0-9_]*)").unwrap();
        let re_java_enum = Regex::new(r"^(?:(?:public|private|protected|static|final)\s+)*enum\s+([A-Za-z_][A-Za-z0-9_]*)").unwrap();
        let re_iface = Regex::new(r"^(?:(?:public|private|internal|protected|sealed|fun)\s+)*interface\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)?(?:\s*(?::|extends)\s*([^{]+))?").unwrap();
        let re_kt_class = Regex::new(r"^(?:(?:public|private|internal|protected|open|abstract|sealed|data|value|inner|annotation)\s+)*(class|object)\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)?(?:\s*(?:(?:private|internal|protected|public)\s+)?(?:constructor\s*)?\([^)]*\))?(?:\s*:\s*([^{]+))?").unwrap();
        let re_java_class = Regex::new(r"^(?:(?:public|private|protected|abstract|final|static)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)?(?:\s+extends\s+([A-Za-z0-9_.<>]+))?(?:\s+implements\s+([^{]+))?").unwrap();
        let re_kt_typealias = Regex::new(r"^(?:(?:public|private|internal)\s+)?typealias\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)?\s*=\s*(.+)$").unwrap();
        let re_kt_fun = Regex::new(r"^(?:(?:public|private|protected|internal|override|open|abstract|inline|suspend|operator|infix|tailrec|external)\s+)*fun\s+(?:<[^>]+>\s*)?(?:([A-Za-z_][A-Za-z0-9_<>?.*]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*:\s*([A-Za-z0-9_<>?.,\s]+))?").unwrap();
        let re_java_method = Regex::new(r"^(?:(?:public|protected|private|static|final|synchronized|abstract|native|default)\s+)+(?:<[^>]+>\s+)?([A-Za-z_][A-Za-z0-9_<>?\[\].]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)").unwrap();
        let re_kt_prop = Regex::new(r"^(?:(?:public|private|protected|internal|override|open|abstract|const|lateinit)\s+)*(val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^={;]+))?(?:\s*=\s*(.+))?").unwrap();

        for i in 0..total_lines {
            let line_num = i + 1;
            let raw_line = raw_lines[i];
            let raw_trimmed = raw_line.trim();
            let sanitized = &masked_lines[i];
            let trimmed = sanitized.trim();

            if trimmed.is_empty() {
                continue;
            }

            if brace_depth == 0 && (trimmed.starts_with("import ") || raw_trimmed.starts_with("import ")) {
                if let Some(cap) = re_import.captures(raw_trimmed) {
                    let path = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let alias = cap.get(2).map(|m| m.as_str().to_string());
                    if !path.is_empty() {
                        if !imports.contains(&path) {
                            imports.push(path.clone());
                        }
                        import_details.push(DartImportInfo {
                            path,
                            alias,
                            show_names: Vec::new(),
                            hide_names: Vec::new(),
                            line: line_num,
                        });
                    }
                }
            }

            if raw_trimmed.starts_with('@') {
                if let Some(cap) = re_anno.captures(raw_trimmed) {
                    let anno_name = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                    if anno_name == "Composable" || anno_name.ends_with(".Composable") {
                        pending_composable = true;
                    }
                    let next_line = masked_lines.get(i + 1).map(|s| s.trim()).unwrap_or("");
                    let (target, target_name) = Self::infer_annotation_target(next_line);
                    annotations.push(DartAnnotationInfo {
                        name: anno_name.to_string(),
                        target,
                        target_name,
                        line: line_num,
                    });
                }
            }

            if active_class.is_none() && active_enum.is_none() && brace_depth == 0 {
                if is_kotlin {
                    if let Some(cap) = re_kt_typealias.captures(trimmed) {
                        let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let sig = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                        typedefs.push(DartTypedefInfo {
                            is_private: trimmed.starts_with("private "),
                            name,
                            signature: sig,
                            line: line_num,
                        });
                    }
                }

                let enum_match = if is_kotlin {
                    re_kt_enum.captures(trimmed)
                } else {
                    re_java_enum.captures(trimmed)
                };
                if let Some(cap) = enum_match {
                    let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let mut enm = DartEnum {
                        is_private: trimmed.starts_with("private "),
                        name,
                        values: Vec::new(),
                        line: line_num,
                        line_end: None,
                        doc_comment: None,
                    };
                    enum_brace_depth = brace_depth;
                    enum_values_finished = false;
                    if let Some(brace_pos) = trimmed.find('{') {
                        let after_brace = &trimmed[brace_pos + 1..];
                        let inside = after_brace.split('}').next().unwrap_or(after_brace);
                        Self::extract_enum_values(inside, &mut enm.values, &mut enum_values_finished);
                    }
                    active_enum = Some(enm);
                } else if let Some(cap) = re_iface.captures(trimmed) {
                    let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let on = cap.get(2).map(|m| Self::strip_generics(m.as_str()));
                    mixins.push(DartMixinInfo {
                        is_private: trimmed.starts_with("private "),
                        name,
                        on,
                        line: line_num,
                        line_end: None,
                    });
                } else if is_kotlin {
                    if let Some(cap) = re_kt_class.captures(trimmed) {
                        let kind_kw = cap.get(1).map(|m| m.as_str()).unwrap_or("class");
                        let name = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let supertypes_raw = cap.get(3).map(|m| m.as_str()).unwrap_or("");
                        let mut extends_class = None;
                        let mut implements = Vec::new();
                        for part in Self::split_top_level_commas(supertypes_raw) {
                            let clean_part = part.trim();
                            if clean_part.is_empty() {
                                continue;
                            }
                            if let Some(p_idx) = clean_part.find('(') {
                                let sup = clean_part[..p_idx].trim();
                                if !sup.is_empty() && extends_class.is_none() {
                                    extends_class = Some(sup.to_string());
                                }
                            } else if extends_class.is_none() && (clean_part.ends_with("Activity") || clean_part.ends_with("Fragment") || clean_part.ends_with("ViewModel") || clean_part.ends_with("Application") || clean_part.ends_with("Service")) {
                                extends_class = Some(clean_part.to_string());
                            } else {
                                implements.push(clean_part.to_string());
                            }
                        }
                        let is_widget = extends_class.as_ref().map_or(false, |ext| {
                            ext.ends_with("Activity") || ext.ends_with("Fragment") || ext.ends_with("View") || ext.ends_with("Dialog")
                        });
                        let is_abstract = trimmed.contains("abstract ") || trimmed.contains("sealed ");
                        let is_private = trimmed.starts_with("private ");
                        class_brace_depth = brace_depth;
                        active_class = Some(DartClass {
                            name,
                            r#type: if is_widget { "widget".to_string() } else if kind_kw == "object" { "class".to_string() } else { "class".to_string() },
                            line: line_num,
                            line_end: None,
                            extends_class,
                            mixins: Vec::new(),
                            implements,
                            is_abstract,
                            is_private,
                            methods: Vec::new(),
                            properties: Vec::new(),
                            doc_comment: None,
                        });
                    }
                } else if let Some(cap) = re_java_class.captures(trimmed) {
                    let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let extends_class = cap.get(2).map(|m| Self::strip_generics(m.as_str()));
                    let implements = cap
                        .get(3)
                        .map(|m| Self::split_top_level_commas(m.as_str()))
                        .unwrap_or_default();
                    let is_widget = extends_class.as_ref().map_or(false, |ext| {
                        ext.ends_with("Activity") || ext.ends_with("Fragment") || ext.ends_with("View")
                    });
                    class_brace_depth = brace_depth;
                    active_class = Some(DartClass {
                        name,
                        r#type: if is_widget { "widget".to_string() } else { "class".to_string() },
                        line: line_num,
                        line_end: None,
                        extends_class,
                        mixins: Vec::new(),
                        implements,
                        is_abstract: trimmed.contains("abstract "),
                        is_private: trimmed.starts_with("private "),
                        methods: Vec::new(),
                        properties: Vec::new(),
                        doc_comment: None,
                    });
                }
            } else if let Some(ref mut enm) = active_enum {
                if brace_depth == enum_brace_depth + 1 && !enum_values_finished {
                    let segment = trimmed.split('}').next().unwrap_or(trimmed);
                    Self::extract_enum_values(segment, &mut enm.values, &mut enum_values_finished);
                }
            }

            // Member or top-level declarations
            if active_method.is_none() {
                let in_class = active_class.is_some() && brace_depth == class_brace_depth + 1;
                let top_level = active_class.is_none() && active_enum.is_none() && brace_depth == 0;

                if in_class || top_level {
                    // Check Kotlin `fun` or Java method
                    let mut matched_method: Option<(Option<String>, DartMethod, bool)> = None;
                    if is_kotlin {
                        if let Some(cap) = re_kt_fun.captures(trimmed) {
                            let receiver_ext = cap.get(1).map(|m| m.as_str().trim().to_string());
                            let fn_name = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                            let params = cap.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                            let ret_type = cap.get(4).map(|m| m.as_str().trim().to_string()).unwrap_or_else(|| "Unit".to_string());
                            let is_Composable = pending_composable || raw_trimmed.contains("@Composable");
                            pending_composable = false;

                            let dm = DartMethod {
                                is_private: trimmed.starts_with("private "),
                                is_async: trimmed.contains("suspend "),
                                is_static: false,
                                name: fn_name,
                                return_type: if is_Composable { "Composable".to_string() } else { ret_type },
                                params,
                                line: line_num,
                                line_end: None,
                                parent_class: active_class.as_ref().map(|c| c.name.clone()),
                                doc_comment: None,
                            };
                            matched_method = Some((receiver_ext, dm, is_Composable));
                        }
                    } else if let Some(cap) = re_java_method.captures(trimmed) {
                        let ret_type = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                        let fn_name = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let params = cap.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                        if !matches!(fn_name.as_str(), "if" | "for" | "while" | "switch" | "catch") {
                            let dm = DartMethod {
                                is_private: trimmed.starts_with("private "),
                                is_async: false,
                                is_static: trimmed.contains("static "),
                                name: fn_name,
                                return_type: ret_type,
                                params,
                                line: line_num,
                                line_end: None,
                                parent_class: active_class.as_ref().map(|c| c.name.clone()),
                                doc_comment: None,
                            };
                            matched_method = Some((None, dm, false));
                        }
                    }

                    if let Some((receiver_ext, mut m, is_composable)) = matched_method {
                        if let Some(ext_type) = receiver_ext {
                            extensions.push(DartExtensionInfo {
                                name: format!("{}.{}", ext_type, m.name),
                                on_type: ext_type,
                                methods: vec![m.clone()],
                                properties: Vec::new(),
                                line: line_num,
                                line_end: Some(line_num),
                                is_private: m.is_private,
                            });
                        }
                        if is_composable && top_level {
                            classes.push(DartClass {
                                name: m.name.clone(),
                                r#type: "widget".to_string(),
                                line: line_num,
                                line_end: None,
                                extends_class: Some("Composable".to_string()),
                                mixins: Vec::new(),
                                implements: Vec::new(),
                                is_abstract: false,
                                is_private: m.is_private,
                                methods: Vec::new(),
                                properties: Vec::new(),
                                doc_comment: None,
                            });
                        }
                        let opens_brace = trimmed.contains('{');
                        let closes_same_line = opens_brace && {
                            let o = trimmed.chars().filter(|&c| c == '{').count();
                            let c = trimmed.chars().filter(|&c| c == '}').count();
                            o > 0 && o == c
                        };
                        if closes_same_line || trimmed.ends_with(';') {
                            m.line_end = Some(line_num);
                            if is_composable {
                                compose_ranges.push((line_num, line_num));
                            }
                            if in_class {
                                if let Some(ref mut cls) = active_class {
                                    cls.methods.push(m);
                                }
                            } else {
                                functions.push(m);
                            }
                        } else {
                            // Store whether this method is a Composable via doc_comment marker if needed
                            if is_composable {
                                m.doc_comment = Some("@Composable".to_string());
                            }
                            active_method = Some(ActiveMethodState {
                                method: m,
                                is_class_member: in_class,
                                is_extension_member: false,
                                base_brace_depth: brace_depth,
                                has_opened_brace: opens_brace,
                                is_arrow_expr: !opens_brace && trimmed.contains('='),
                            });
                        }
                    } else if is_kotlin {
                        if let Some(cap) = re_kt_prop.captures(trimmed) {
                            let kw = cap.get(1).map(|m| m.as_str()).unwrap_or("val");
                            let prop_name = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                            let prop_type = cap.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_else(|| "Any".to_string());
                            let prop_val = cap.get(4).map(|m| m.as_str().trim().to_string());
                            let is_const = trimmed.contains("const ");
                            let is_final = kw == "val" || is_const;
                            let is_private = trimmed.starts_with("private ");
                            if in_class {
                                let prop = DartPropertyInfo {
                                    name: prop_name,
                                    r#type: prop_type,
                                    class_name: active_class.as_ref().map(|c| c.name.clone()),
                                    is_final,
                                    is_const,
                                    is_static: false,
                                    is_private,
                                    is_getter: false,
                                    is_setter: false,
                                    line: line_num,
                                };
                                if let Some(ref mut cls) = active_class {
                                    cls.properties.push(prop.clone());
                                }
                                properties.push(prop);
                            } else if top_level {
                                variables.push(DartVariableInfo {
                                    name: prop_name,
                                    r#type: prop_type,
                                    value: prop_val,
                                    line: line_num,
                                    is_const,
                                    is_final,
                                    is_private,
                                    is_top_level: true,
                                });
                            }
                        }
                    }
                }
            }

            if brace_depth >= 1 {
                let caller_cls = active_class.as_ref().map(|c| c.name.as_str());
                let caller_fn = active_method.as_ref().map(|m| m.method.name.as_str());
                Self::extract_line_function_calls(
                    trimmed,
                    raw_trimmed,
                    line_num,
                    caller_cls,
                    caller_fn,
                    &mut function_calls,
                );
            }

            let open_braces = trimmed.chars().filter(|&c| c == '{').count();
            let close_braces = trimmed.chars().filter(|&c| c == '}').count();

            if let Some(ref mut m_state) = active_method {
                if open_braces > 0 {
                    m_state.has_opened_brace = true;
                }
            }

            brace_depth = (brace_depth + open_braces).saturating_sub(close_braces);

            if let Some(m_state) = active_method.take() {
                let finished = if m_state.is_arrow_expr {
                    !trimmed.ends_with('=') && !trimmed.ends_with(',')
                } else {
                    m_state.has_opened_brace && brace_depth <= m_state.base_brace_depth
                };

                if finished {
                    let mut m = m_state.method;
                    m.line_end = Some(line_num);
                    if m.doc_comment.as_deref() == Some("@Composable") || m.return_type == "Composable" {
                        compose_ranges.push((m.line, line_num));
                    }
                    if m_state.is_class_member {
                        if let Some(ref mut cls) = active_class {
                            cls.methods.push(m);
                        }
                    } else {
                        functions.push(m);
                    }
                } else {
                    active_method = Some(m_state);
                }
            }

            if let Some(mut cls) = active_class.take() {
                if brace_depth <= class_brace_depth && (open_braces > 0 || close_braces > 0) {
                    cls.line_end = Some(line_num);
                    classes.push(cls);
                } else {
                    active_class = Some(cls);
                }
            }

            if let Some(mut enm) = active_enum.take() {
                if brace_depth <= enum_brace_depth && (open_braces > 0 || close_braces > 0) {
                    enm.line_end = Some(line_num);
                    enums.push(enm);
                } else {
                    active_enum = Some(enm);
                }
            }
        }

        if let Some(mut cls) = active_class {
            cls.line_end = Some(total_lines);
            classes.push(cls);
        }
        if let Some(mut enm) = active_enum {
            enm.line_end = Some(total_lines);
            enums.push(enm);
        }

        // Extract Jetpack Compose UI widget trees from @Composable functions
        for (start_l, end_l) in compose_ranges {
            let start_idx = start_l.saturating_sub(1);
            let end_idx = end_l.min(total_lines);
            if start_idx < end_idx {
                let mut tree = Self::parse_widget_tree_slice(
                    &raw_lines[start_idx..end_idx],
                    &masked_lines[start_idx..end_idx],
                    start_l,
                );
                widgets.append(&mut tree);
            }
        }

        DartParsedAst {
            classes,
            functions,
            enums,
            widgets,
            mixins,
            extensions,
            typedefs,
            variables,
            constructors,
            properties,
            annotations,
            function_calls,
            imports,
            import_details,
            exports: Vec::new(),
            total_lines,
        }
    }

    /// Native Rust parser for Android XML (Manifest, Layouts, Resources) and HTML
    pub fn parse_xml(file_path: &str, source: &str) -> DartParsedAst {
        let lower_path = file_path.replace('\\', "/").to_ascii_lowercase();
        let raw_lines: Vec<&str> = source.lines().collect();
        let total_lines = raw_lines.len();

        let mut classes = Vec::new();
        let mut widgets = Vec::new();
        let mut variables = Vec::new();
        let mut imports = Vec::new();
        let mut import_details = Vec::new();

        // 1. AndroidManifest.xml
        if lower_path.ends_with("androidmanifest.xml") {
            let re_perm = Regex::new(r#"<uses-permission[^>]*android:name\s*=\s*["']([^"']+)["']"#).unwrap();
            let re_comp = Regex::new(r#"<(activity|service|receiver|provider|application)[^>]*android:name\s*=\s*["']([^"']+)["']"#).unwrap();
            for (idx, line) in raw_lines.iter().enumerate() {
                let line_num = idx + 1;
                for cap in re_perm.captures_iter(line) {
                    if let Some(m) = cap.get(1) {
                        let perm = m.as_str().to_string();
                        imports.push(perm.clone());
                        import_details.push(DartImportInfo {
                            path: perm,
                            alias: None,
                            show_names: Vec::new(),
                            hide_names: Vec::new(),
                            line: line_num,
                        });
                    }
                }
                for cap in re_comp.captures_iter(line) {
                    let kind = cap.get(1).map(|m| m.as_str()).unwrap_or("component");
                    let name = cap.get(2).map(|m| m.as_str()).unwrap_or("");
                    if !name.is_empty() {
                        classes.push(DartClass {
                            name: name.to_string(),
                            r#type: if kind == "activity" { "widget".to_string() } else { "class".to_string() },
                            line: line_num,
                            line_end: Some(line_num),
                            extends_class: Some(kind.to_string()),
                            mixins: Vec::new(),
                            implements: Vec::new(),
                            is_abstract: false,
                            is_private: false,
                            methods: Vec::new(),
                            properties: Vec::new(),
                            doc_comment: None,
                        });
                    }
                }
            }
        } else if lower_path.contains("/values") || source.contains("<resources") {
            // 2. Android Resource XML (strings.xml, colors.xml, dimens.xml, styles.xml)
            let re_res = Regex::new(r#"<(string|color|dimen|style|bool|integer|plurals|string-array)\s+[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([^<]*)"#).unwrap();
            for (idx, line) in raw_lines.iter().enumerate() {
                let line_num = idx + 1;
                for cap in re_res.captures_iter(line) {
                    let rtype = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let rname = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let rval = cap.get(3).map(|m| m.as_str().trim().to_string()).filter(|s| !s.is_empty());
                    variables.push(DartVariableInfo {
                        name: rname,
                        r#type: rtype,
                        value: rval,
                        line: line_num,
                        is_const: true,
                        is_final: true,
                        is_private: false,
                        is_top_level: true,
                    });
                }
            }
        } else {
            // 3. Android Layout XML or HTML hierarchy -> nested `DartWidgetInfo`
            let re_tag = Regex::new(r#"(?s)<(/?)([a-zA-Z0-9_.:-]+)([^>]*?)(/?)>"#).unwrap();
            let re_attr = Regex::new(r#"([a-zA-Z0-9_:-]+)\s*=\s*["']([^"']*)["']"#).unwrap();
            let mut stack: Vec<DartWidgetInfo> = Vec::new();

            for cap in re_tag.captures_iter(source) {
                let full_match = match cap.get(0) {
                    Some(m) => m,
                    None => continue,
                };
                let is_closing = cap.get(1).map_or(false, |m| m.as_str() == "/");
                let raw_tag = cap.get(2).map(|m| m.as_str()).unwrap_or("");
                let attrs_str = cap.get(3).map(|m| m.as_str()).unwrap_or("");
                let is_self_closing = cap.get(4).map_or(false, |m| m.as_str() == "/")
                    || matches!(raw_tag.to_ascii_lowercase().as_str(), "br" | "hr" | "img" | "input" | "meta" | "link");

                if raw_tag.starts_with('?') || raw_tag.starts_with('!') {
                    continue;
                }

                let line_num = source[..full_match.start()].bytes().filter(|&b| b == b'\n').count() + 1;
                let short_name = raw_tag.rsplit('.').next().unwrap_or(raw_tag).to_string();

                if is_closing {
                    if let Some(finished) = stack.pop() {
                        if let Some(parent) = stack.last_mut() {
                            parent.children.push(finished);
                        } else {
                            widgets.push(finished);
                        }
                    }
                    continue;
                }

                let mut props = Vec::new();
                for acap in re_attr.captures_iter(attrs_str) {
                    let aname = acap.get(1).map(|m| m.as_str()).unwrap_or("");
                    let aval = acap.get(2).map(|m| m.as_str()).unwrap_or("");
                    if !aname.starts_with("xmlns") {
                        props.push(DartWidgetProperty {
                            name: aname.to_string(),
                            value: aval.to_string(),
                        });
                    }
                }

                let node = DartWidgetInfo {
                    name: short_name.clone(),
                    line: line_num,
                    children: Vec::new(),
                    properties: props,
                };

                if is_self_closing {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        widgets.push(node);
                    }
                } else {
                    stack.push(node);
                }
            }

            while let Some(finished) = stack.pop() {
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(finished);
                } else {
                    widgets.push(finished);
                }
            }
        }

        DartParsedAst {
            classes,
            functions: Vec::new(),
            enums: Vec::new(),
            widgets,
            mixins: Vec::new(),
            extensions: Vec::new(),
            typedefs: Vec::new(),
            variables,
            constructors: Vec::new(),
            properties: Vec::new(),
            annotations: Vec::new(),
            function_calls: Vec::new(),
            imports,
            import_details,
            exports: Vec::new(),
            total_lines,
        }
    }

    /// Native Rust parser for Gradle build scripts (`.gradle`, `.gradle.kts`)
    pub fn parse_gradle(_file_path: &str, source: &str) -> DartParsedAst {
        let raw_lines: Vec<&str> = source.lines().collect();
        let total_lines = raw_lines.len();
        let mut imports = Vec::new();
        let mut import_details = Vec::new();
        let mut variables = Vec::new();

        let re_dep = Regex::new(
            r#"\b(?:implementation|api|kapt|ksp|compileOnly|runtimeOnly|testImplementation|androidTestImplementation|debugImplementation)\s*\(?\s*["']([^"']+)["']"#,
        ).unwrap();
        let re_catalog = Regex::new(
            r#"\b(?:implementation|api|kapt|ksp|compileOnly|runtimeOnly|testImplementation|androidTestImplementation)\s*\(\s*(libs\.[a-zA-Z0-9_.]+)\s*\)"#,
        ).unwrap();
        let re_sdk = Regex::new(
            r#"\b(namespace|applicationId|compileSdk|minSdk|targetSdk|versionCode|versionName)\s*(?:=|\s)\s*([^\s/]+)"#,
        ).unwrap();

        for (idx, line) in raw_lines.iter().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            for cap in re_dep.captures_iter(trimmed) {
                if let Some(m) = cap.get(1) {
                    let dep = m.as_str().to_string();
                    imports.push(dep.clone());
                    import_details.push(DartImportInfo {
                        path: dep,
                        alias: None,
                        show_names: Vec::new(),
                        hide_names: Vec::new(),
                        line: line_num,
                    });
                }
            }
            for cap in re_catalog.captures_iter(trimmed) {
                if let Some(m) = cap.get(1) {
                    let dep = m.as_str().to_string();
                    imports.push(dep.clone());
                    import_details.push(DartImportInfo {
                        path: dep,
                        alias: None,
                        show_names: Vec::new(),
                        hide_names: Vec::new(),
                        line: line_num,
                    });
                }
            }
            if let Some(cap) = re_sdk.captures(trimmed) {
                let key = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                let val = cap
                    .get(2)
                    .map(|m| m.as_str().trim_matches(|c| c == '"' || c == '\'').to_string());
                variables.push(DartVariableInfo {
                    name: key,
                    r#type: "GradleConfig".to_string(),
                    value: val,
                    line: line_num,
                    is_const: true,
                    is_final: true,
                    is_private: false,
                    is_top_level: true,
                });
            }
        }

        DartParsedAst {
            total_lines,
            imports,
            import_details,
            variables,
            ..Default::default()
        }
    }

    /// Native Rust parser for TypeScript, JavaScript, and React (`.ts`, `.tsx`, `.js`, `.jsx`)
    pub fn parse_js_ts(file_path: &str, source: &str) -> DartParsedAst {
        let lower_path = file_path.to_ascii_lowercase();
        let is_jsx_ext = lower_path.ends_with(".tsx") || lower_path.ends_with(".jsx");
        let raw_lines: Vec<&str> = source.lines().collect();
        let total_lines = raw_lines.len();

        let mut classes = Vec::new();
        let mut functions = Vec::new();
        let mut enums = Vec::new();
        let mut widgets = Vec::new();
        let mut mixins = Vec::new();
        let mut typedefs = Vec::new();
        let mut variables = Vec::new();
        let mut constructors = Vec::new();
        let mut properties = Vec::new();
        let mut annotations = Vec::new();
        let mut function_calls = Vec::new();
        let mut imports = Vec::new();
        let mut import_details = Vec::new();
        let mut exports = Vec::new();

        let mut in_block_comment = false;
        let mut masked_lines: Vec<String> = Vec::with_capacity(total_lines);
        for &l in &raw_lines {
            masked_lines.push(Self::sanitize_line(l, &mut in_block_comment));
        }

        let re_import_from = Regex::new(r#"^import\s+(?:type\s+)?(.+?)\s+from\s+['"]([^'"]+)['"]"#).unwrap();
        let re_import_side = Regex::new(r#"^import\s+['"]([^'"]+)['"]"#).unwrap();
        let re_require = Regex::new(r#"\brequire\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap();
        let re_export_from = Regex::new(r#"^export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]"#).unwrap();
        let re_iface = Regex::new(r#"^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:<[^>]+>)?(?:\s+extends\s+([^{]+))?"#).unwrap();
        let re_type = Regex::new(r#"^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:<[^>]+>)?\s*=\s*(.+)$"#).unwrap();
        let re_enum = Regex::new(r#"^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)"#).unwrap();
        let re_class = Regex::new(r#"^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:<[^>]+>)?(?:\s+extends\s+([A-Za-z0-9_$.<>]+))?(?:\s+implements\s+([^{]+))?"#).unwrap();
        let re_func = Regex::new(r#"^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^{;]+))?"#).unwrap();
        let re_arrow_fn = Regex::new(r#"^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:React\.(?:memo|forwardRef)\s*\(\s*)?(?:async\s+)?(?:\(([^)]*)\)|([A-Za-z_$][A-Za-z0-9_$]*))\s*(?::\s*[^=]+)?\s*=>"#).unwrap();
        let re_var = Regex::new(r#"^(?:export\s+)?(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*([^=;]+))?\s*=\s*(.+)$"#).unwrap();
        let re_cls_method = Regex::new(r#"^(?:(?:public|private|protected|static|readonly|abstract|async|override|get|set)\s+)*([A-Za-z_$#][A-Za-z0-9_$]*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^{;]+))?\s*\{"#).unwrap();
        let re_cls_prop = Regex::new(r#"^(?:(public|private|protected|static|readonly)\s+)*([A-Za-z_$#][A-Za-z0-9_$]*)\??\s*(?::\s*([^=;]+))?(?:\s*=\s*[^;]+)?;"#).unwrap();

        let mut brace_depth: usize = 0;
        let mut active_class: Option<DartClass> = None;
        let mut class_brace_depth: usize = 0;
        let mut active_enum: Option<DartEnum> = None;
        let mut enum_brace_depth: usize = 0;
        let mut enum_values_finished = false;
        let mut active_method: Option<ActiveMethodState> = None;

        for i in 0..total_lines {
            let line_num = i + 1;
            let raw_line = raw_lines[i];
            let raw_trimmed = raw_line.trim();
            let sanitized = &masked_lines[i];
            let trimmed = sanitized.trim();

            if trimmed.is_empty() {
                continue;
            }

            // Imports & Exports
            if raw_trimmed.starts_with("import ") {
                if let Some(cap) = re_import_from.captures(raw_trimmed) {
                    let clause = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
                    let path = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let mut alias = None;
                    let mut show_names = Vec::new();
                    if let Some(as_idx) = clause.find("* as ") {
                        alias = Some(clause[as_idx + 5..].trim().to_string());
                    } else if let Some(open_b) = clause.find('{') {
                        if let Some(close_b) = clause.find('}') {
                            for item in clause[open_b + 1..close_b].split(',') {
                                let clean = item.split(" as ").next().unwrap_or(item).trim();
                                if !clean.is_empty() {
                                    show_names.push(clean.to_string());
                                }
                            }
                        }
                    } else if !clause.is_empty() {
                        alias = Some(clause.trim().to_string());
                    }
                    if !path.is_empty() {
                        if !imports.contains(&path) {
                            imports.push(path.clone());
                        }
                        import_details.push(DartImportInfo {
                            path,
                            alias,
                            show_names,
                            hide_names: Vec::new(),
                            line: line_num,
                        });
                    }
                } else if let Some(cap) = re_import_side.captures(raw_trimmed) {
                    if let Some(m) = cap.get(1) {
                        let path = m.as_str().to_string();
                        if !imports.contains(&path) {
                            imports.push(path.clone());
                        }
                        import_details.push(DartImportInfo {
                            path,
                            alias: None,
                            show_names: Vec::new(),
                            hide_names: Vec::new(),
                            line: line_num,
                        });
                    }
                }
            } else if let Some(cap) = re_require.captures(raw_trimmed) {
                if let Some(m) = cap.get(1) {
                    let path = m.as_str().to_string();
                    if !imports.contains(&path) {
                        imports.push(path.clone());
                        import_details.push(DartImportInfo {
                            path,
                            alias: None,
                            show_names: Vec::new(),
                            hide_names: Vec::new(),
                            line: line_num,
                        });
                    }
                }
            }

            if raw_trimmed.starts_with("export ") {
                if let Some(cap) = re_export_from.captures(raw_trimmed) {
                    if let Some(m) = cap.get(1) {
                        exports.push(m.as_str().to_string());
                    }
                }
            }

            if raw_trimmed.starts_with('@') {
                let anno_name: String = raw_trimmed[1..]
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '.')
                    .collect();
                if !anno_name.is_empty() {
                    let next_line = masked_lines.get(i + 1).map(|s| s.trim()).unwrap_or("");
                    let (target, target_name) = Self::infer_annotation_target(next_line);
                    annotations.push(DartAnnotationInfo {
                        name: anno_name,
                        target,
                        target_name,
                        line: line_num,
                    });
                }
            }

            if active_class.is_none() && active_enum.is_none() && brace_depth == 0 {
                if let Some(cap) = re_iface.captures(trimmed) {
                    let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let on = cap.get(2).map(|m| Self::strip_generics(m.as_str()));
                    mixins.push(DartMixinInfo {
                        is_private: !raw_trimmed.starts_with("export "),
                        name,
                        on,
                        line: line_num,
                        line_end: None,
                    });
                } else if let Some(cap) = re_type.captures(trimmed) {
                    let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let sig = cap
                        .get(2)
                        .map(|m| m.as_str().trim_end_matches(';').trim().to_string())
                        .unwrap_or_default();
                    typedefs.push(DartTypedefInfo {
                        is_private: !raw_trimmed.starts_with("export "),
                        name,
                        signature: sig,
                        line: line_num,
                    });
                } else if let Some(cap) = re_enum.captures(trimmed) {
                    let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let mut enm = DartEnum {
                        is_private: !raw_trimmed.starts_with("export "),
                        name,
                        values: Vec::new(),
                        line: line_num,
                        line_end: None,
                        doc_comment: None,
                    };
                    enum_brace_depth = brace_depth;
                    enum_values_finished = false;
                    if let Some(brace_pos) = trimmed.find('{') {
                        let after_brace = &trimmed[brace_pos + 1..];
                        let inside = after_brace.split('}').next().unwrap_or(after_brace);
                        Self::extract_enum_values(inside, &mut enm.values, &mut enum_values_finished);
                    }
                    active_enum = Some(enm);
                } else if let Some(cap) = re_class.captures(trimmed) {
                    let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let extends_class = cap.get(2).map(|m| Self::strip_generics(m.as_str()));
                    let implements = cap
                        .get(3)
                        .map(|m| Self::split_top_level_commas(m.as_str()))
                        .unwrap_or_default();
                    let is_react_comp = extends_class.as_ref().map_or(false, |ext| {
                        ext.contains("Component") || ext.contains("PureComponent") || ext.contains("HTMLElement")
                    });
                    class_brace_depth = brace_depth;
                    active_class = Some(DartClass {
                        name,
                        r#type: if is_react_comp { "widget".to_string() } else { "class".to_string() },
                        line: line_num,
                        line_end: None,
                        extends_class,
                        mixins: Vec::new(),
                        implements,
                        is_abstract: trimmed.contains("abstract "),
                        is_private: !raw_trimmed.starts_with("export "),
                        methods: Vec::new(),
                        properties: Vec::new(),
                        doc_comment: None,
                    });
                }
            } else if let Some(ref mut enm) = active_enum {
                if brace_depth == enum_brace_depth + 1 && !enum_values_finished {
                    let clean_seg = trimmed.split('=').next().unwrap_or(trimmed);
                    Self::extract_enum_values(clean_seg, &mut enm.values, &mut enum_values_finished);
                }
            }

            if active_method.is_none() {
                let in_class = active_class.is_some() && brace_depth == class_brace_depth + 1;
                let top_level = active_class.is_none() && active_enum.is_none() && brace_depth == 0;

                if top_level {
                    if let Some(cap) = re_func.captures(trimmed) {
                        let fn_name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let params = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                        let ret_type = cap
                            .get(3)
                            .map(|m| m.as_str().trim().to_string())
                            .unwrap_or_else(|| "any".to_string());
                        let is_pascal = fn_name.chars().next().map_or(false, |c| c.is_ascii_uppercase());
                        if is_pascal && is_jsx_ext {
                            classes.push(DartClass {
                                name: fn_name.clone(),
                                r#type: "widget".to_string(),
                                line: line_num,
                                line_end: None,
                                extends_class: Some("React.FC".to_string()),
                                mixins: Vec::new(),
                                implements: Vec::new(),
                                is_abstract: false,
                                is_private: !raw_trimmed.starts_with("export "),
                                methods: Vec::new(),
                                properties: Vec::new(),
                                doc_comment: None,
                            });
                        }
                        let m = DartMethod {
                            name: fn_name,
                            return_type: ret_type,
                            params,
                            line: line_num,
                            line_end: None,
                            is_private: !raw_trimmed.starts_with("export "),
                            is_async: trimmed.contains("async "),
                            is_static: false,
                            parent_class: None,
                            doc_comment: None,
                        };
                        let opens_brace = trimmed.contains('{');
                        active_method = Some(ActiveMethodState {
                            method: m,
                            is_class_member: false,
                            is_extension_member: false,
                            base_brace_depth: brace_depth,
                            has_opened_brace: opens_brace,
                            is_arrow_expr: false,
                        });
                    } else if let Some(cap) = re_arrow_fn.captures(trimmed) {
                        let fn_name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let params = cap
                            .get(2)
                            .or_else(|| cap.get(3))
                            .map(|m| m.as_str().trim().to_string())
                            .unwrap_or_default();
                        let is_pascal = fn_name.chars().next().map_or(false, |c| c.is_ascii_uppercase());
                        if is_pascal && (is_jsx_ext || raw_trimmed.contains("React.memo") || raw_trimmed.contains("forwardRef")) {
                            classes.push(DartClass {
                                name: fn_name.clone(),
                                r#type: "widget".to_string(),
                                line: line_num,
                                line_end: None,
                                extends_class: Some("React.FC".to_string()),
                                mixins: Vec::new(),
                                implements: Vec::new(),
                                is_abstract: false,
                                is_private: !raw_trimmed.starts_with("export "),
                                methods: Vec::new(),
                                properties: Vec::new(),
                                doc_comment: None,
                            });
                        }
                        let opens_brace = trimmed.contains('{');
                        let m = DartMethod {
                            name: fn_name,
                            return_type: if is_pascal && is_jsx_ext { "JSX.Element".to_string() } else { "any".to_string() },
                            params,
                            line: line_num,
                            line_end: if !opens_brace { Some(line_num) } else { None },
                            is_private: !raw_trimmed.starts_with("export "),
                            is_async: trimmed.contains("async "),
                            is_static: false,
                            parent_class: None,
                            doc_comment: None,
                        };
                        if opens_brace {
                            active_method = Some(ActiveMethodState {
                                method: m,
                                is_class_member: false,
                                is_extension_member: false,
                                base_brace_depth: brace_depth,
                                has_opened_brace: true,
                                is_arrow_expr: false,
                            });
                        } else {
                            functions.push(m);
                        }
                    } else if let Some(cap) = re_var.captures(trimmed) {
                        let kw = cap.get(1).map(|m| m.as_str()).unwrap_or("const");
                        let vname = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let vtype = cap.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_else(|| "any".to_string());
                        let vval = cap.get(4).map(|m| m.as_str().trim_end_matches(';').trim().to_string());
                        variables.push(DartVariableInfo {
                            name: vname,
                            r#type: vtype,
                            value: vval,
                            line: line_num,
                            is_const: kw == "const",
                            is_final: kw == "const",
                            is_private: !raw_trimmed.starts_with("export "),
                            is_top_level: true,
                        });
                    }
                } else if in_class {
                    let cls_name = active_class.as_ref().map(|c| c.name.clone()).unwrap_or_default();
                    if let Some(cap) = re_cls_method.captures(trimmed) {
                        let m_name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let params = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                        let ret_type = cap.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_else(|| "any".to_string());
                        if !matches!(m_name.as_str(), "if" | "for" | "while" | "switch" | "catch") {
                            if m_name == "constructor" {
                                constructors.push(DartConstructorInfo {
                                    name: cls_name.clone(),
                                    class_name: cls_name.clone(),
                                    is_factory: false,
                                    is_const: false,
                                    params: params.clone(),
                                    line: line_num,
                                });
                            }
                            let m = DartMethod {
                                is_private: m_name.starts_with('#') || m_name.starts_with('_') || trimmed.starts_with("private "),
                                is_async: trimmed.contains("async "),
                                is_static: trimmed.contains("static "),
                                name: m_name,
                                return_type: ret_type,
                                params,
                                line: line_num,
                                line_end: None,
                                parent_class: Some(cls_name),
                                doc_comment: None,
                            };
                            active_method = Some(ActiveMethodState {
                                method: m,
                                is_class_member: true,
                                is_extension_member: false,
                                base_brace_depth: brace_depth,
                                has_opened_brace: true,
                                is_arrow_expr: false,
                            });
                        }
                    } else if let Some(cap) = re_cls_prop.captures(trimmed) {
                        let pname = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let ptype = cap.get(3).map(|m| m.as_str().trim().to_string()).unwrap_or_else(|| "any".to_string());
                        if !pname.is_empty() {
                            let prop = DartPropertyInfo {
                                is_private: pname.starts_with('#') || pname.starts_with('_') || trimmed.starts_with("private "),
                                name: pname,
                                r#type: ptype,
                                class_name: Some(cls_name),
                                is_final: trimmed.contains("readonly "),
                                is_const: false,
                                is_static: trimmed.contains("static "),
                                is_getter: false,
                                is_setter: false,
                                line: line_num,
                            };
                            if let Some(ref mut cls) = active_class {
                                cls.properties.push(prop.clone());
                            }
                            properties.push(prop);
                        }
                    }
                }
            }

            if brace_depth >= 1 {
                let caller_cls = active_class.as_ref().map(|c| c.name.as_str());
                let caller_fn = active_method.as_ref().map(|m| m.method.name.as_str());
                Self::extract_line_function_calls(
                    trimmed,
                    raw_trimmed,
                    line_num,
                    caller_cls,
                    caller_fn,
                    &mut function_calls,
                );
            }

            let open_braces = trimmed.chars().filter(|&c| c == '{').count();
            let close_braces = trimmed.chars().filter(|&c| c == '}').count();

            if let Some(ref mut m_state) = active_method {
                if open_braces > 0 {
                    m_state.has_opened_brace = true;
                }
            }

            brace_depth = (brace_depth + open_braces).saturating_sub(close_braces);

            if let Some(m_state) = active_method.take() {
                if m_state.has_opened_brace && brace_depth <= m_state.base_brace_depth {
                    let mut m = m_state.method;
                    m.line_end = Some(line_num);
                    if m_state.is_class_member {
                        if let Some(ref mut cls) = active_class {
                            cls.methods.push(m);
                        }
                    } else {
                        functions.push(m);
                    }
                } else {
                    active_method = Some(m_state);
                }
            }

            if let Some(mut cls) = active_class.take() {
                if brace_depth <= class_brace_depth && (open_braces > 0 || close_braces > 0) {
                    cls.line_end = Some(line_num);
                    classes.push(cls);
                } else {
                    active_class = Some(cls);
                }
            }

            if let Some(mut enm) = active_enum.take() {
                if brace_depth <= enum_brace_depth && (open_braces > 0 || close_braces > 0) {
                    enm.line_end = Some(line_num);
                    enums.push(enm);
                } else {
                    active_enum = Some(enm);
                }
            }
        }

        if let Some(mut cls) = active_class {
            cls.line_end = Some(total_lines);
            classes.push(cls);
        }
        if let Some(mut enm) = active_enum {
            enm.line_end = Some(total_lines);
            enums.push(enm);
        }

        // Extract JSX/TSX component tree in .tsx / .jsx files
        if is_jsx_ext {
            widgets = Self::parse_jsx_widget_tree(&raw_lines);
        }

        DartParsedAst {
            classes,
            functions,
            enums,
            widgets,
            mixins,
            extensions: Vec::new(),
            typedefs,
            variables,
            constructors,
            properties,
            annotations,
            function_calls,
            imports,
            import_details,
            exports,
            total_lines,
        }
    }

    /// Builds a nested `Vec<DartWidgetInfo>` tree from JSX/TSX elements in `.tsx` / `.jsx` files
    pub fn parse_jsx_widget_tree(raw_lines: &[&str]) -> Vec<DartWidgetInfo> {
        let mut root_widgets: Vec<DartWidgetInfo> = Vec::new();
        let mut stack: Vec<DartWidgetInfo> = Vec::new();
        let re_jsx = Regex::new(r#"<(/?)([A-Za-z][A-Za-z0-9_.]*)([^>]*?)(/?)>"#).unwrap();
        let re_prop = Regex::new(r#"([a-zA-Z0-9_-]+)\s*=\s*(?:["']([^"']*)["']|\{([^}]*)\})"#).unwrap();

        const TS_GENERICS_BLACKLIST: &[&str] = &[
            "Array", "Promise", "Record", "Partial", "Required", "Readonly", "Pick", "Omit",
            "Exclude", "Extract", "Map", "Set", "WeakMap", "WeakSet", "React", "FC",
            "Component", "RefObject", "MutableRefObject", "Dispatch", "SetStateAction",
            "HTMLInputElement", "HTMLDivElement", "HTMLButtonElement", "HTMLElement",
            "MouseEvent", "ChangeEvent", "FormEvent", "KeyboardEvent", "string", "number",
            "boolean", "any", "void", "unknown", "never",
        ];

        for (idx, &line) in raw_lines.iter().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();
            if trimmed.starts_with("//") || trimmed.starts_with("import ") || trimmed.starts_with("export type ") || trimmed.starts_with("interface ") || trimmed.starts_with("type ") {
                continue;
            }

            for cap in re_jsx.captures_iter(trimmed) {
                let is_closing = cap.get(1).map_or(false, |m| m.as_str() == "/");
                let tag_name = cap.get(2).map(|m| m.as_str()).unwrap_or("");
                let attrs_str = cap.get(3).map(|m| m.as_str()).unwrap_or("");
                let is_self_closing = cap.get(4).map_or(false, |m| m.as_str() == "/")
                    || matches!(tag_name, "img" | "input" | "br" | "hr" | "meta" | "link");

                if TS_GENERICS_BLACKLIST.contains(&tag_name) || attrs_str.contains(',') {
                    continue;
                }

                if is_closing {
                    if let Some(top) = stack.last() {
                        if top.name == tag_name {
                            let finished = stack.pop().unwrap();
                            if let Some(parent) = stack.last_mut() {
                                parent.children.push(finished);
                            } else {
                                root_widgets.push(finished);
                            }
                        }
                    }
                    continue;
                }

                let mut props = Vec::new();
                for pcap in re_prop.captures_iter(attrs_str) {
                    let pname = pcap.get(1).map(|m| m.as_str()).unwrap_or("");
                    let pval = pcap
                        .get(2)
                        .or_else(|| pcap.get(3))
                        .map(|m| m.as_str().trim())
                        .unwrap_or("");
                    if !pname.is_empty() {
                        props.push(DartWidgetProperty {
                            name: pname.to_string(),
                            value: pval.to_string(),
                        });
                    }
                }

                let node = DartWidgetInfo {
                    name: tag_name.to_string(),
                    line: line_num,
                    children: Vec::new(),
                    properties: props,
                };

                if is_self_closing {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        root_widgets.push(node);
                    }
                } else {
                    stack.push(node);
                }
            }
        }

        while let Some(finished) = stack.pop() {
            if let Some(parent) = stack.last_mut() {
                parent.children.push(finished);
            } else {
                root_widgets.push(finished);
            }
        }

        root_widgets
    }

    /// Outline parser for Markdown (`.md`), CSS/SCSS (`.css`, `.scss`), and JSON (`.json`)
    pub fn parse_auxiliary(file_path: &str, source: &str) -> DartParsedAst {
        let lower = file_path.to_ascii_lowercase();
        let raw_lines: Vec<&str> = source.lines().collect();
        let total_lines = raw_lines.len();
        let mut classes = Vec::new();
        let mut variables = Vec::new();

        if lower.ends_with(".md") {
            let re_heading = Regex::new(r"^(#{1,6})\s+(.+)$").unwrap();
            for (idx, line) in raw_lines.iter().enumerate() {
                if let Some(cap) = re_heading.captures(line.trim()) {
                    let level = cap.get(1).map_or(1, |m| m.as_str().len());
                    let title = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                    classes.push(DartClass {
                        name: title,
                        r#type: format!("H{}", level),
                        line: idx + 1,
                        line_end: Some(idx + 1),
                        ..Default::default()
                    });
                }
            }
        } else if lower.ends_with(".css") || lower.ends_with(".scss") {
            let re_sel = Regex::new(r"^([.#a-zA-Z][^{]+)\{").unwrap();
            let re_var = Regex::new(r"^(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);").unwrap();
            for (idx, line) in raw_lines.iter().enumerate() {
                let t = line.trim();
                if let Some(cap) = re_var.captures(t) {
                    variables.push(DartVariableInfo {
                        name: cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                        r#type: "css-var".to_string(),
                        value: cap.get(2).map(|m| m.as_str().trim().to_string()),
                        line: idx + 1,
                        is_const: true,
                        is_final: true,
                        is_private: false,
                        is_top_level: true,
                    });
                } else if let Some(cap) = re_sel.captures(t) {
                    let sel = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                    if !sel.starts_with('@') {
                        classes.push(DartClass {
                            name: sel,
                            r#type: "selector".to_string(),
                            line: idx + 1,
                            line_end: Some(idx + 1),
                            ..Default::default()
                        });
                    }
                }
            }
        } else if lower.ends_with(".json") {
            let re_key = Regex::new(r#"^\s{1,4}"([^"]+)"\s*:"#).unwrap();
            for (idx, line) in raw_lines.iter().enumerate() {
                if let Some(cap) = re_key.captures(line) {
                    let k = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    classes.push(DartClass {
                        name: k,
                        r#type: "property".to_string(),
                        line: idx + 1,
                        line_end: Some(idx + 1),
                        ..Default::default()
                    });
                }
            }
        }

        DartParsedAst {
            classes,
            variables,
            total_lines,
            ..Default::default()
        }
    }
}
