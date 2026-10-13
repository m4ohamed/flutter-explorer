use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DartMethod {
    pub name: String,
    pub return_type: String,
    pub params: String,
    pub line: usize,
    pub line_end: Option<usize>,
    pub is_private: boolean_flag,
    pub is_async: boolean_flag,
    pub is_static: boolean_flag,
    pub parent_class: Option<String>,
}

type boolean_flag = bool;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DartClass {
    pub name: String,
    pub r#type: String,
    pub line: usize,
    pub line_end: Option<usize>,
    pub extends_class: Option<String>,
    pub mixins: Vec<String>,
    pub implements: Vec<String>,
    pub is_abstract: bool,
    pub is_private: bool,
    pub methods: Vec<DartMethod>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DartEnum {
    pub name: String,
    pub values: Vec<String>,
    pub line: usize,
    pub is_private: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DartParsedAst {
    pub classes: Vec<DartClass>,
    pub functions: Vec<DartMethod>,
    pub enums: Vec<DartEnum>,
    pub total_lines: usize,
}

pub struct PureDartParser;

impl PureDartParser {
    pub fn parse(source: &str) -> DartParsedAst {
        let lines: Vec<&str> = source.lines().collect();
        let total_lines = lines.len();

        let mut classes = Vec::new();
        let mut functions = Vec::new();
        let mut enums = Vec::new();

        let mut current_class: Option<DartClass> = None;
        let mut class_brace_depth = 0;
        let mut brace_level = 0;

        for (idx, raw_line) in lines.iter().enumerate() {
            let line_num = idx + 1;
            let line = raw_line.trim();

            // Skip single-line comments
            if line.starts_with("//") {
                continue;
            }

            // Count open and close braces on this line
            let open_braces = line.chars().filter(|&c| c == '{').count();
            let close_braces = line.chars().filter(|&c| c == '}').count();

            // 1. Detect Class declarations
            if let Some(cls) = Self::try_parse_class(line, line_num) {
                if let Some(finished_class) = current_class.take() {
                    classes.push(finished_class);
                }
                current_class = Some(cls);
                class_brace_depth = brace_level;
            }

            // 2. Detect Enum declarations
            if line.starts_with("enum ") {
                if let Some(enm) = Self::try_parse_enum(line, line_num) {
                    enums.push(enm);
                }
            }

            // 3. Detect Methods & Functions
            if let Some(mut method) = Self::try_parse_method(line, line_num) {
                if let Some(ref mut cls) = current_class {
                    method.parent_class = Some(cls.name.clone());
                    cls.methods.push(method);
                } else if brace_level == 0 {
                    functions.push(method);
                }
            }

            // Update brace nesting
            brace_level += open_braces;
            if brace_level >= close_braces {
                brace_level -= close_braces;
            } else {
                brace_level = 0;
            }

            // Check if current class ended
            if let Some(ref mut cls) = current_class {
                if brace_level <= class_brace_depth && close_braces > 0 {
                    cls.line_end = Some(line_num);
                    classes.push(cls.clone());
                    current_class = None;
                }
            }
        }

        if let Some(cls) = current_class {
            classes.push(cls);
        }

        DartParsedAst {
            classes,
            functions,
            enums,
            total_lines,
        }
    }

    fn try_parse_class(line: &str, line_num: usize) -> Option<DartClass> {
        if !line.contains("class ") {
            return None;
        }

        let is_abstract = line.starts_with("abstract ");
        let class_idx = line.find("class ")?;
        let after_class = &line[class_idx + 6..].trim();

        // Extract class name
        let name_end = after_class.find(|c: char| c.is_whitespace() || c == '{' || c == '<')
            .unwrap_or(after_class.len());
        let class_name = after_class[..name_end].trim().to_string();

        if class_name.is_empty() {
            return None;
        }

        let is_private = class_name.starts_with('_');

        // Extract extends
        let mut extends_class = None;
        if let Some(ext_idx) = line.find("extends ") {
            let after_ext = &line[ext_idx + 8..].trim();
            let ext_end = after_ext.find(|c: char| c.is_whitespace() || c == '{' || c == '<' || c == '(')
                .unwrap_or(after_ext.len());
            extends_class = Some(after_ext[..ext_end].trim().to_string());
        }

        // Determine type (Widget vs Class)
        let r#type = if let Some(ref ext) = extends_class {
            if ext == "StatelessWidget" || ext == "StatefulWidget" || ext == "ConsumerWidget" || ext.ends_with("State") {
                "widget".to_string()
            } else {
                "class".to_string()
            }
        } else {
            "class".to_string()
        };

        // Extract mixins (with ...)
        let mut mixins = Vec::new();
        if let Some(with_idx) = line.find("with ") {
            let after_with = &line[with_idx + 5..].trim();
            let with_end = after_with.find(|c: char| c == '{' || c == '<' || c == '(' || c == ';')
                .unwrap_or(after_with.len());
            for m in after_with[..with_end].split(',') {
                let trimmed = m.trim();
                if !trimmed.is_empty() {
                    mixins.push(trimmed.to_string());
                }
            }
        }

        // Extract implements (implements ...)
        let mut implements = Vec::new();
        if let Some(imp_idx) = line.find("implements ") {
            let after_imp = &line[imp_idx + 11..].trim();
            let imp_end = after_imp.find(|c: char| c == '{' || c == '<' || c == '(' || c == ';')
                .unwrap_or(after_imp.len());
            for i in after_imp[..imp_end].split(',') {
                let trimmed = i.trim();
                if !trimmed.is_empty() {
                    implements.push(trimmed.to_string());
                }
            }
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
        })
    }

    fn try_parse_enum(line: &str, line_num: usize) -> Option<DartEnum> {
        let after_enum = line.strip_prefix("enum ")?.trim();
        let name_end = after_enum.find(|c: char| c.is_whitespace() || c == '{')
            .unwrap_or(after_enum.len());
        let name = after_enum[..name_end].trim().to_string();

        if name.is_empty() {
            return None;
        }

        let is_private = name.starts_with('_');
        Some(DartEnum {
            name,
            values: Vec::new(),
            line: line_num,
            is_private,
        })
    }

    fn try_parse_method(line: &str, line_num: usize) -> Option<DartMethod> {
        // Skip control structures and declarations
        if line.starts_with("class ") || line.starts_with("enum ") || line.starts_with("if ")
            || line.starts_with("for ") || line.starts_with("while ") || line.starts_with("switch ")
            || line.starts_with("return ") || line.starts_with("case ") || line.starts_with("//") {
            return None;
        }

        // Look for pattern: [type] name(params) [async] [{ | =>]
        let paren_idx = line.find('(')?;
        if paren_idx == 0 {
            return None;
        }

        let close_paren_idx = line.find(')')?;
        if close_paren_idx <= paren_idx {
            return None;
        }

        // Candidate before '('
        let before_paren = line[..paren_idx].trim();
        let tokens: Vec<&str> = before_paren.split_whitespace().collect();
        if tokens.is_empty() {
            return None;
        }

        let name = tokens.last()?.to_string();
        // Valid identifier check
        if !name.chars().all(|c| c.is_alphanumeric() || c == '_') || name.is_empty() {
            return None;
        }

        let is_static = tokens.contains(&"static");
        let is_async = line.contains("async");
        let is_private = name.starts_with('_');

        let return_type = if tokens.len() > 1 {
            tokens[tokens.len() - 2].to_string()
        } else {
            "void".to_string()
        };

        let params = line[paren_idx + 1..close_paren_idx].trim().to_string();

        Some(DartMethod {
            name,
            return_type,
            params,
            line: line_num,
            line_end: None,
            is_private,
            is_async,
            is_static,
            parent_class: None,
        })
    }
}
