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
        Regex::new(r#"Color\(0x[0-9a-fA-F]{6,8}\)|Colors\.[a-zA-Z0-9_]+"#).unwrap()
    })
}

fn hardcoded_text_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Matches Text('...', ...) or Text("...", ...) even when extra args like style: follow
        Regex::new(r#"\bText\(\s*['"]([^'"$\\]+)['"]\s*(?:,|\))"#).unwrap()
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
        // Pre-warm static regexes once per process
        let _ = color_regex();
        let _ = hardcoded_text_regex();
        Self
    }

    /// Fast scan for hardcoded values and common warnings
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

            // Skip single-line comments and import/part directives
            if trimmed.starts_with("//")
                || trimmed.starts_with('*')
                || trimmed.starts_with("import ")
                || trimmed.starts_with("export ")
                || trimmed.starts_with("part ")
            {
                continue;
            }

            // Strip trailing inline comment before scanning
            let code_only = trimmed.split("//").next().unwrap_or(trimmed);

            // Check hardcoded colors (ignore Colors.transparent which is standard)
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

            // Check hardcoded text in Text widget (only warn when alphabetic/localizable characters exist)
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

    /// Fast outline symbols extraction backed by PureDartParser (includes classes, widgets, functions, enums)
    pub fn scan_symbols(&self, source: &str) -> Vec<QuickSymbol> {
        let ast = PureDartParser::parse(source);
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

        symbols.sort_by_key(|s| s.line);
        symbols
    }
}
