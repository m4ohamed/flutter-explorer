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
}
