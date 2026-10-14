use serde::{Deserialize, Serialize};

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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DartParsedAst {
    #[serde(default)]
    pub classes: Vec<DartClass>,
    #[serde(default)]
    pub functions: Vec<DartMethod>,
    #[serde(default)]
    pub enums: Vec<DartEnum>,
    #[serde(default, alias = "linesCount")]
    pub total_lines: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub imports: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exports: Vec<String>,
}

struct ActiveMethodState {
    method: DartMethod,
    is_class_member: bool,
    base_brace_depth: usize,
    has_opened_brace: bool,
    is_arrow_expr: bool,
}

pub struct PureDartParser;

impl PureDartParser {
    pub fn parse(source: &str) -> DartParsedAst {
        let lines: Vec<&str> = source.lines().collect();
        let total_lines = lines.len();

        let mut classes = Vec::new();
        let mut functions = Vec::new();
        let mut enums = Vec::new();
        let mut imports = Vec::new();
        let mut exports = Vec::new();

        let mut current_class: Option<DartClass> = None;
        let mut class_brace_depth: usize = 0;
        let mut class_has_opened = false;

        let mut current_enum: Option<DartEnum> = None;
        let mut enum_brace_depth: usize = 0;
        let mut enum_has_opened = false;
        let mut enum_values_finished = false;

        let mut current_method: Option<ActiveMethodState> = None;

        let mut brace_level: usize = 0;
        let mut in_block_comment = false;
        let mut pending_doc_lines: Vec<String> = Vec::new();

        for (idx, raw_line) in lines.iter().enumerate() {
            let line_num = idx + 1;
            let trimmed_raw = raw_line.trim();

            // Collect documentation comments (`/// ...`)
            if !in_block_comment && trimmed_raw.starts_with("///") {
                let doc_text = trimmed_raw.trim_start_matches("///").trim().to_string();
                if !doc_text.is_empty() {
                    pending_doc_lines.push(doc_text);
                }
                continue;
            }

            // Skip standard single-line comments
            if !in_block_comment && trimmed_raw.starts_with("//") {
                continue;
            }

            // Extract import/export paths from raw line before string contents are stripped
            if !in_block_comment && brace_level == 0 {
                if trimmed_raw.starts_with("import ") {
                    if let Some(path_str) = Self::extract_quoted_uri(trimmed_raw) {
                        imports.push(path_str);
                    }
                } else if trimmed_raw.starts_with("export ") {
                    if let Some(path_str) = Self::extract_quoted_uri(trimmed_raw) {
                        exports.push(path_str);
                    }
                }
            }

            // Strip strings and comments so braces inside literals or comments don't corrupt nesting
            let clean_line = Self::sanitize_line(trimmed_raw, &mut in_block_comment);
            let line = clean_line.trim();
            if line.is_empty() {
                continue;
            }

            // Preserve annotations (`@override`, `@immutable`) without clearing doc comments
            if line.starts_with('@') && !line.contains('{') && !line.contains(';') {
                continue;
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

            // 1. Detect Class / Mixin declarations at top-level
            if current_class.is_none() && current_enum.is_none() && brace_level == 0 {
                if let Some(mut cls) = Self::try_parse_class(line, line_num) {
                    cls.doc_comment = take_doc_comment(&mut pending_doc_lines);
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

            // 2. Detect Methods (only at class member level) or Top-level Functions (at brace_level == 0)
            let at_class_member_level = current_class.is_some()
                && class_has_opened
                && brace_level == class_brace_depth + 1
                && current_method.is_none();
            let at_top_function_level = current_class.is_none()
                && current_enum.is_none()
                && brace_level == 0
                && current_method.is_none();

            if at_class_member_level || at_top_function_level {
                let parent_cls_name = current_class.as_ref().map(|c| c.name.clone());
                if let Some(mut method) = Self::try_parse_method(line, line_num, parent_cls_name.as_deref()) {
                    method.doc_comment = take_doc_comment(&mut pending_doc_lines);
                    method.parent_class = parent_cls_name;

                    let is_single_line_complete = (open_braces > 0 && open_braces == close_braces)
                        || (open_braces == 0 && line.ends_with(';'));

                    if is_single_line_complete {
                        method.line_end = Some(line_num);
                        if at_class_member_level {
                            if let Some(ref mut cls) = current_class {
                                cls.methods.push(method);
                            }
                        } else {
                            functions.push(method);
                        }
                    } else {
                        current_method = Some(ActiveMethodState {
                            method,
                            is_class_member: at_class_member_level,
                            base_brace_depth: brace_level,
                            has_opened_brace: open_braces > 0,
                            is_arrow_expr: line.contains("=>") && open_braces == 0,
                        });
                    }
                }
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
                if current_enum.is_some() {
                    enum_has_opened = true;
                }
                if let Some(ref mut m_state) = current_method {
                    m_state.has_opened_brace = true;
                }
            }

            // 3. Check if active method / function ended on this line
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
                    } else {
                        functions.push(finished.method);
                    }
                }
            }

            // 4. Check if current enum ended
            if let Some(ref mut enm) = current_enum {
                if enum_has_opened && close_braces > 0 && brace_level <= enum_brace_depth {
                    enm.line_end = Some(line_num);
                    enums.push(enm.clone());
                    current_enum = None;
                    enum_has_opened = false;
                }
            }

            // 5. Check if current class ended
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
            } else {
                functions.push(unclosed_method.method);
            }
        }
        if let Some(mut cls) = current_class {
            cls.line_end = Some(total_lines);
            classes.push(cls);
        }
        if let Some(mut enm) = current_enum {
            enm.line_end = Some(total_lines);
            enums.push(enm);
        }

        DartParsedAst {
            classes,
            functions,
            enums,
            total_lines,
            imports,
            exports,
        }
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
                    i += 2;
                } else {
                    i += 1;
                }
                continue;
            }

            if in_single_quote {
                if c == '\\' {
                    i += 2;
                    continue;
                }
                if c == '\'' {
                    in_single_quote = false;
                    out.push('\'');
                }
                i += 1;
                continue;
            }

            if in_double_quote {
                if c == '\\' {
                    i += 2;
                    continue;
                }
                if c == '"' {
                    in_double_quote = false;
                    out.push('"');
                }
                i += 1;
                continue;
            }

            if c == '/' && next == Some('/') {
                break;
            }
            if c == '/' && next == Some('*') {
                *in_block_comment = true;
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
