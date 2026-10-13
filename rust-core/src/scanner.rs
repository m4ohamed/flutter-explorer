use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CodeWarning {
    pub r#type: String,
    pub message: String,
    pub line: usize,
    pub code_snippet: Option<String>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuickSymbol {
    pub name: String,
    pub kind: String, // "class", "function", "widget"
    pub line: usize,
    pub line_end: Option<usize>,
}

pub struct CodeScanner {
    re_class: Regex,
    re_color: Regex,
    re_hardcoded_text: Regex,
}

impl CodeScanner {
    pub fn new() -> Self {
        Self {
            // Matches class definitions
            re_class: Regex::new(r#"(?m)^\s*class\s+([A-Za-z0-9_]+)(?:\s+extends\s+([A-Za-z0-9_]+))?"#)
                .unwrap(),
            // Matches Color(0x...) or Colors.red
            re_color: Regex::new(r#"Color\(0x[0-9a-fA-F]+\)|Colors\.[a-zA-Z]+"#).unwrap(),
            // Matches Text('...') or Text("...")
            re_hardcoded_text: Regex::new(r#"Text\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap(),
        }
    }

    /// Fast scan for hardcoded values and common warnings
    pub fn scan_warnings(&self, source: &str) -> Vec<CodeWarning> {
        let mut warnings = Vec::new();

        for (idx, line) in source.lines().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();

            // Skip comments
            if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with("*") {
                continue;
            }

            // Check hardcoded colors
            if let Some(mat) = self.re_color.find(line) {
                warnings.push(CodeWarning {
                    r#type: "hardcoded_color".to_string(),
                    message: format!("Hardcoded color detected: '{}'", mat.as_str()),
                    line: line_num,
                    code_snippet: Some(trimmed.to_string()),
                    suggestion: Some("Extract color to AppColors or ThemeData".to_string()),
                });
            }

            // Check hardcoded text in Text widget
            if let Some(caps) = self.re_hardcoded_text.captures(line) {
                if let Some(text_val) = caps.get(1) {
                    warnings.push(CodeWarning {
                        r#type: "hardcoded_text".to_string(),
                        message: format!("Hardcoded string in Text widget: \"{}\"", text_val.as_str()),
                        line: line_num,
                        code_snippet: Some(trimmed.to_string()),
                        suggestion: Some("Use AppLocalizations / ARB translation".to_string()),
                    });
                }
            }
        }

        warnings
    }

    /// Fast outline symbols extraction
    pub fn scan_symbols(&self, source: &str) -> Vec<QuickSymbol> {
        let mut symbols = Vec::new();

        for (idx, line) in source.lines().enumerate() {
            let line_num = idx + 1;

            if let Some(caps) = self.re_class.captures(line) {
                if let Some(class_name) = caps.get(1) {
                    let extends_str = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                    let is_widget = extends_str.contains("StatelessWidget")
                        || extends_str.contains("StatefulWidget")
                        || extends_str.contains("ConsumerWidget");

                    symbols.push(QuickSymbol {
                        name: class_name.as_str().to_string(),
                        kind: if is_widget { "widget".to_string() } else { "class".to_string() },
                        line: line_num,
                        line_end: None,
                    });
                }
            }
        }

        symbols
    }
}
