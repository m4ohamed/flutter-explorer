use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const K1: f64 = 1.5;
const B: f64 = 0.75;
const IDF_FLOOR: f64 = 0.1;

const WEIGHT_NAME: f64 = 4.0;
const WEIGHT_PATH: f64 = 1.5;
const WEIGHT_SUPERCLASS: f64 = 2.0;
const WEIGHT_COMMENTS: f64 = 0.5;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BM25DocumentFields {
    pub name: String,
    pub path: Option<String>,
    pub superclass: Option<String>,
    pub comments: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BM25Document {
    pub id: String,
    pub fields: BM25DocumentFields,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub id: String,
    pub score: f64,
}

pub struct BM25Engine {
    docs: Vec<BM25Document>,
    doc_lengths: Vec<f64>,
    avg_doc_len: f64,
    // term -> doc_index -> weighted_term_frequency_in_doc
    inverted_index: HashMap<String, HashMap<usize, f64>>,
    // term -> idf
    idf_cache: HashMap<String, f64>,
}

/// Splits an alphanumeric/underscore identifier into CamelCase, PascalCase, and snake_case sub-tokens
fn split_identifier_subtokens(word: &str, out: &mut Vec<String>) {
    let lower_full = word.to_ascii_lowercase();
    if !lower_full.is_empty() {
        out.push(lower_full.clone());
    }

    // Split by underscore first (snake_case)
    let parts: Vec<&str> = word.split('_').filter(|s| !s.is_empty()).collect();
    if parts.len() > 1 {
        for p in &parts {
            let lp = p.to_ascii_lowercase();
            if !lp.is_empty() && lp != lower_full {
                out.push(lp);
            }
        }
    }

    // Split CamelCase / PascalCase within each part (e.g., "UserProfileWidget" -> "user", "profile", "widget")
    for part in parts {
        let chars: Vec<char> = part.chars().collect();
        if chars.len() <= 1 {
            continue;
        }

        let mut sub_tokens: Vec<String> = Vec::new();
        let mut current = String::new();

        for i in 0..chars.len() {
            let c = chars[i];
            if i > 0 {
                let prev = chars[i - 1];
                let next_is_lower = chars.get(i + 1).map_or(false, |nc| nc.is_ascii_lowercase());

                // Boundary 1: lower/digit -> Upper (e.g. "userProfile" or "v2Widget")
                let lower_to_upper = (prev.is_ascii_lowercase() || prev.is_ascii_digit()) && c.is_ascii_uppercase();
                // Boundary 2: Upper -> Upper followed by lower (e.g. "HTMLParser" -> "HTML" + "Parser")
                let acronym_to_word = prev.is_ascii_uppercase() && c.is_ascii_uppercase() && next_is_lower;
                // Boundary 3: letter -> digit or digit -> letter
                let digit_boundary = prev.is_ascii_alphabetic() != c.is_ascii_alphabetic();

                if (lower_to_upper || acronym_to_word || digit_boundary) && !current.is_empty() {
                    sub_tokens.push(current.to_ascii_lowercase());
                    current.clear();
                }
            }
            current.push(c);
        }

        if !current.is_empty() {
            sub_tokens.push(current.to_ascii_lowercase());
        }

        if sub_tokens.len() > 1 {
            for st in sub_tokens {
                if !st.is_empty() && st != lower_full {
                    out.push(st);
                }
            }
        }
    }
}

/// Tokenizes text into normalized search terms, expanding CamelCase and snake_case identifiers.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for c in text.chars() {
        if c.is_alphanumeric() || c == '_' {
            current.push(c);
        } else if !current.is_empty() {
            split_identifier_subtokens(&current, &mut tokens);
            current.clear();
        }
    }
    if !current.is_empty() {
        split_identifier_subtokens(&current, &mut tokens);
    }
    tokens
}

impl BM25Engine {
    pub fn new(docs: Vec<BM25Document>) -> Self {
        let mut engine = Self {
            docs,
            doc_lengths: Vec::new(),
            avg_doc_len: 0.0,
            inverted_index: HashMap::new(),
            idf_cache: HashMap::new(),
        };
        engine.rebuild_index();
        engine
    }

    pub fn doc_count(&self) -> usize {
        self.docs.len()
    }

    pub fn upsert_document(&mut self, doc: BM25Document) {
        if let Some(existing) = self.docs.iter_mut().find(|d| d.id == doc.id) {
            *existing = doc;
        } else {
            self.docs.push(doc);
        }
        self.rebuild_index();
    }

    pub fn remove_document(&mut self, id: &str) -> bool {
        let before = self.docs.len();
        self.docs.retain(|d| d.id != id);
        if self.docs.len() != before {
            self.rebuild_index();
            true
        } else {
            false
        }
    }

    fn rebuild_index(&mut self) {
        let n = self.docs.len();
        self.doc_lengths.clear();
        self.inverted_index.clear();
        self.idf_cache.clear();

        if n == 0 {
            self.avg_doc_len = 0.0;
            return;
        }

        self.doc_lengths.reserve(n);
        let mut total_len = 0.0;

        for (idx, doc) in self.docs.iter().enumerate() {
            let mut weighted_len = 0.0;
            let mut doc_terms: HashMap<String, f64> = HashMap::new();

            // Name
            let name_tokens = tokenize(&doc.fields.name);
            weighted_len += name_tokens.len() as f64 * WEIGHT_NAME;
            for t in name_tokens {
                *doc_terms.entry(t).or_insert(0.0) += WEIGHT_NAME;
            }

            // Path
            if let Some(ref path) = doc.fields.path {
                let path_tokens = tokenize(path);
                weighted_len += path_tokens.len() as f64 * WEIGHT_PATH;
                for t in path_tokens {
                    *doc_terms.entry(t).or_insert(0.0) += WEIGHT_PATH;
                }
            }

            // Superclass
            if let Some(ref sc) = doc.fields.superclass {
                let sc_tokens = tokenize(sc);
                weighted_len += sc_tokens.len() as f64 * WEIGHT_SUPERCLASS;
                for t in sc_tokens {
                    *doc_terms.entry(t).or_insert(0.0) += WEIGHT_SUPERCLASS;
                }
            }

            // Comments
            if let Some(ref comments) = doc.fields.comments {
                let com_tokens = tokenize(comments);
                weighted_len += com_tokens.len() as f64 * WEIGHT_COMMENTS;
                for t in com_tokens {
                    *doc_terms.entry(t).or_insert(0.0) += WEIGHT_COMMENTS;
                }
            }

            self.doc_lengths.push(weighted_len);
            total_len += weighted_len;

            for (term, weight) in doc_terms {
                self.inverted_index.entry(term).or_default().insert(idx, weight);
            }
        }

        self.avg_doc_len = total_len / n as f64;

        // Compute IDF
        let total_docs = n as f64;
        for (term, postings) in &self.inverted_index {
            let df = postings.len() as f64;
            let raw_idf = ((total_docs - df + 0.5) / (df + 0.5) + 1.0).ln();
            let idf = if raw_idf < IDF_FLOOR { IDF_FLOOR } else { raw_idf };
            self.idf_cache.insert(term.clone(), idf);
        }
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchResult> {
        if self.docs.is_empty() || limit == 0 {
            return Vec::new();
        }

        let raw_tokens = tokenize(query);
        if raw_tokens.is_empty() {
            return Vec::new();
        }

        // Deduplicate query tokens while preserving order
        let mut seen = HashSet::new();
        let query_tokens: Vec<String> = raw_tokens
            .into_iter()
            .filter(|t| seen.insert(t.clone()))
            .collect();

        let normalized_query = query.trim().to_ascii_lowercase();

        let mut candidate_docs: HashSet<usize> = HashSet::new();
        for t in &query_tokens {
            if let Some(postings) = self.inverted_index.get(t) {
                for &doc_idx in postings.keys() {
                    candidate_docs.insert(doc_idx);
                }
            }
        }

        // Also include substring matches on symbol name so partial prefix/infix queries always work
        if !normalized_query.is_empty() {
            for (idx, doc) in self.docs.iter().enumerate() {
                if doc.fields.name.to_ascii_lowercase().contains(&normalized_query) {
                    candidate_docs.insert(idx);
                }
            }
        }

        let mut scores: Vec<(usize, f64)> = Vec::with_capacity(candidate_docs.len());

        for &doc_idx in &candidate_docs {
            let doc_len = self.doc_lengths[doc_idx];
            let len_norm = 1.0 - B + B * (doc_len / (self.avg_doc_len + 1e-9));

            let mut score = 0.0;
            for t in &query_tokens {
                if let Some(postings) = self.inverted_index.get(t) {
                    if let Some(&tf) = postings.get(&doc_idx) {
                        let idf = self.idf_cache.get(t).copied().unwrap_or(IDF_FLOOR);
                        let tf_component = (tf * (K1 + 1.0)) / (tf + K1 * len_norm);
                        score += idf * tf_component;
                    }
                }
            }

            // Apply exact / prefix / substring name match boosts for developer ergonomics
            let doc_name_lower = self.docs[doc_idx].fields.name.to_ascii_lowercase();
            if doc_name_lower == normalized_query {
                score += 10.0;
            } else if doc_name_lower.starts_with(&normalized_query) {
                score += 4.0;
            } else if doc_name_lower.contains(&normalized_query) {
                score += 1.5;
            }

            if score > 0.0 {
                scores.push((doc_idx, score));
            }
        }

        scores.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| self.docs[a.0].id.cmp(&self.docs[b.0].id))
        });

        scores
            .into_iter()
            .take(limit)
            .map(|(doc_idx, score)| SearchResult {
                id: self.docs[doc_idx].id.clone(),
                score: (score * 1000.0).round() / 1000.0,
            })
            .collect()
    }
}
