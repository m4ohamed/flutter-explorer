use crate::parser::PureDartParser;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodeWarning {
    pub r#type: String,
    pub message: String,
    pub line: usize,
    pub code_snippet: Option<String>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuickSymbol {
    pub name: String,
    pub kind: String, // "class", "function", "widget", "enum", "mixin"
    pub line: usize,
    pub line_end: Option<usize>,
}

fn color_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"Color\(0x[0-9a-fA-F]{6,8}\)|Colors\.[a-zA-Z0-9_]+|Color\.parseColor\(\s*['"]#[0-9a-fA-F]{6,8}['"]\s*\)"#).unwrap()
    })
}

fn hardcoded_text_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Matches Text('...', ...) or Text("...", ...) in Dart & Jetpack Compose
        Regex::new(r#"\bText\(\s*(?:text\s*=\s*)?['"]([^'"$\\]+)['"]\s*(?:,|\))"#).unwrap()
    })
}

fn xml_hardcoded_text_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"android:(?:text|hint|contentDescription)\s*=\s*["']([^"'@?{]+)["']"#).unwrap()
    })
}

fn xml_hardcoded_color_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"android:(?:background|textColor|tint| backgroundTint)\s*=\s*["'](#[0-9a-fA-F]{6,8})["']"#).unwrap()
    })
}

fn jsx_hardcoded_color_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?:color|backgroundColor|borderColor|fill|stroke)\s*:\s*['"]( serialize|#[0-9a-fA-F]{6,8})['"]"#).unwrap()
    })
}

pub struct CodeScanner;

impl Default for CodeScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl CodeScanner {
    pub fn new() -> Self {
        let _ = color_regex();
        let _ = hardcoded_text_regex();
        Self
    }

    /// File-extension-aware warning scanner supporting Dart, Kotlin/Java, Android XML, and TypeScript/React
    pub fn scan_warnings_for_file(&self, file_path: &str, source: &str) -> Vec<CodeWarning> {
        let lower = file_path.to_ascii_lowercase();
        if lower.ends_with(".xml") {
            return self.scan_xml_warnings(source);
        }
        if lower.ends_with(".ts")
            || lower.ends_with(".tsx")
            || lower.ends_with(".js")
            || lower.ends_with(".jsx")
        {
            return self.scan_js_ts_warnings(source);
        }
        if lower.ends_with(".kt") || lower.ends_with(".java") {
            return self.scan_kotlin_java_warnings(source);
        }
        self.scan_warnings(source)
    }

    fn scan_xml_warnings(&self, source: &str) -> Vec<CodeWarning> {
        let mut warnings = Vec::new();
        let re_text = xml_hardcoded_text_regex();
        let re_color = xml_hardcoded_color_regex();

        for (idx, line) in source.lines().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();
            if trimmed.starts_with("<!--") {
                continue;
            }
            if let Some(cap) = re_text.captures(trimmed) {
                if let Some(m) = cap.get(1) {
                    let s = m.as_str().trim();
                    if s.len() > 1 && s.chars().any(|c| c.is_alphabetic()) {
                        warnings.push(CodeWarning {
                            r#type: "hardcoded_text".to_string(),
                            message: format!("Hardcoded Android XML text: \"{}\"", s),
                            line: line_num,
                            code_snippet: Some(trimmed.to_string()),
                            suggestion: Some("Extract string to res/values/strings.xml (@string/...)".to_string()),
                        });
                    }
                }
            }
            if let Some(cap) = re_color.captures(trimmed) {
                if let Some(m) = cap.get(1) {
                    warnings.push(CodeWarning {
                        r#type: "hardcoded_color".to_string(),
                        message: format!("Hardcoded Android XML color: '{}'", m.as_str()),
                        line: line_num,
                        code_snippet: Some(trimmed.to_string()),
                        suggestion: Some("Extract color to res/values/colors.xml (@color/...)".to_string()),
                    });
                }
            }
        }
        warnings
    }

    fn scan_kotlin_java_warnings(&self, source: &str) -> Vec<CodeWarning> {
        let mut warnings = self.scan_warnings(source);
        for w in &mut warnings {
            if w.r#type == "hardcoded_text" {
                w.suggestion = Some("Use stringResource(R.string.*) or context.getString(R.string.*)".to_string());
            } else if w.r#type == "hardcoded_color" {
                w.suggestion = Some("Use MaterialTheme.colorScheme or colorResource(R.color.*)".to_string());
            }
        }
        warnings
    }

    fn scan_js_ts_warnings(&self, source: &str) -> Vec<CodeWarning> {
        let mut warnings = Vec::new();
        let re_color = jsx_hardcoded_color_regex();
        for (idx, line) in source.lines().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();
            if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
                continue;
            }
            if let Some(cap) = re_color.captures(trimmed) {
                if let Some(m) = cap.get(1) {
                    warnings.push(CodeWarning {
                        r#type: "hardcoded_color".to_string(),
                        message: format!("Hardcoded inline style color: '{}'", m.as_str()),
                        line: line_num,
                        code_snippet: Some(trimmed.to_string()),
                        suggestion: Some("Use CSS variables (--var) or theme tokens".to_string()),
                    });
                }
            }
        }
        warnings
    }

    /// Fast scan for hardcoded values and common warnings in Dart/Compose
    pub fn scan_warnings(&self, source: &str) -> Vec<CodeWarning> {
        let mut warnings = Vec::new();
        let re_color = color_regex();
        let re_text = hardcoded_text_regex();
        let mut in_block_comment = false;

        for (idx, line) in source.lines().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();

            if in_block_comment {
                if let Some(end_idx) = trimmed.find("*/") {
                    in_block_comment = false;
                    let rest = trimmed[end_idx + 2..].trim();
                    if rest.is_empty() {
                        continue;
                    }
                } else {
                    continue;
                }
            }

            if trimmed.starts_with("/*") {
                if !trimmed.contains("*/") {
                    in_block_comment = true;
                }
                continue;
            }

            if trimmed.starts_with("//")
                || trimmed.starts_with('*')
                || trimmed.starts_with("import ")
                || trimmed.starts_with("export ")
                || trimmed.starts_with("part ")
            {
                continue;
            }

            let code_only = trimmed.split("//").next().unwrap_or(trimmed);

            for mat in re_color.find_iter(code_only) {
                let matched_color = mat.as_str();
                if matched_color == "Colors.transparent" {
                    continue;
                }
                warnings.push(CodeWarning {
                    r#type: "hardcoded_color".to_string(),
                    message: format!("Hardcoded color detected: '{}'", matched_color),
                    line: line_num,
                    code_snippet: Some(trimmed.to_string()),
                    suggestion: Some("Extract color to AppColors or Theme.of(context).colorScheme".to_string()),
                });
            }

            if let Some(caps) = re_text.captures(code_only) {
                if let Some(text_val) = caps.get(1) {
                    let s = text_val.as_str().trim();
                    let has_letters = s.chars().any(|c| c.is_alphabetic());
                    if has_letters && s.len() > 1 {
                        warnings.push(CodeWarning {
                            r#type: "hardcoded_text".to_string(),
                            message: format!("Hardcoded string in Text widget: \"{}\"", s),
                            line: line_num,
                            code_snippet: Some(trimmed.to_string()),
                            suggestion: Some("Use AppLocalizations / ARB translation".to_string()),
                        });
                    }
                }
            }
        }

        warnings
    }

    /// Fast outline symbols extraction backed by PureDartParser (Dart default)
    pub fn scan_symbols(&self, source: &str) -> Vec<QuickSymbol> {
        self.scan_symbols_for_file("file.dart", source)
    }

    /// Multi-language outline symbols extraction backed by `PureDartParser::parse_by_extension`
    pub fn scan_symbols_for_file(&self, file_path: &str, source: &str) -> Vec<QuickSymbol> {
        let ast = PureDartParser::parse_by_extension(file_path, source);
        let mut symbols = Vec::new();

        for cls in ast.classes {
            symbols.push(QuickSymbol {
                name: cls.name,
                kind: cls.r#type,
                line: cls.line,
                line_end: cls.line_end,
            });
        }

        for func in ast.functions {
            symbols.push(QuickSymbol {
                name: func.name,
                kind: "function".to_string(),
                line: func.line,
                line_end: func.line_end,
            });
        }

        for enm in ast.enums {
            symbols.push(QuickSymbol {
                name: enm.name,
                kind: "enum".to_string(),
                line: enm.line,
                line_end: enm.line_end,
            });
        }

        for mx in ast.mixins {
            symbols.push(QuickSymbol {
                name: mx.name,
                kind: "mixin".to_string(),
                line: mx.line,
                line_end: mx.line_end,
            });
        }

        symbols.sort_by_key(|s| s.line);
        symbols
    }
}
