use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const K1: f64 = 1.5;
const B: f64 = 0.75;
const IDF_FLOOR: f64 = 0.1;

const WEIGHT_NAME: f64 = 4.0;
const WEIGHT_PATH: f64 = 1.5;
const WEIGHT_SUPERCLASS: f64 = 2.0;
const WEIGHT_COMMENTS: f64 = 0.3;

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

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub score: f64,
}

pub struct BM25Engine {
    docs: Vec<BM25Document>,
    doc_lengths: Vec<f64>,
    avg_doc_len: f64,
    // term -> doc_index -> term_frequency_in_doc
    inverted_index: HashMap<String, HashMap<usize, f64>>,
    // term -> idf
    idf_cache: HashMap<String, f64>,
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for c in text.chars() {
        if c.is_alphanumeric() || c == '_' {
            current.push(c.to_ascii_lowercase());
        } else {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

impl BM25Engine {
    pub fn new(docs: Vec<BM25Document>) -> Self {
        let n = docs.len();
        if n == 0 {
            return Self {
                docs,
                doc_lengths: Vec::new(),
                avg_doc_len: 0.0,
                inverted_index: HashMap::new(),
                idf_cache: HashMap::new(),
            };
        }

        let mut doc_lengths = Vec::with_capacity(n);
        let mut total_len = 0.0;
        let mut inverted_index: HashMap<String, HashMap<usize, f64>> = HashMap::new();

        for (idx, doc) in docs.iter().enumerate() {
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

            doc_lengths.push(weighted_len);
            total_len += weighted_len;

            for (term, weight) in doc_terms {
                inverted_index.entry(term).or_default().insert(idx, weight);
            }
        }

        let avg_doc_len = if n > 0 { total_len / n as f64 } else { 0.0 };

        // Compute IDF
        let mut idf_cache = HashMap::new();
        let total_docs = n as f64;
        for (term, postings) in &inverted_index {
            let df = postings.len() as f64;
            let raw_idf = ((total_docs - df + 0.5) / (df + 0.5) + 1.0).ln();
            let idf = if raw_idf < IDF_FLOOR { IDF_FLOOR } else { raw_idf };
            idf_cache.insert(term.clone(), idf);
        }

        Self {
            docs,
            doc_lengths,
            avg_doc_len,
            inverted_index,
            idf_cache,
        }
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchResult> {
        let query_tokens = tokenize(query);
        if query_tokens.is_empty() || self.docs.is_empty() {
            return Vec::new();
        }

        let mut candidate_docs: HashSet<usize> = HashSet::new();
        for t in &query_tokens {
            if let Some(postings) = self.inverted_index.get(t) {
                for &doc_idx in postings.keys() {
                    candidate_docs.insert(doc_idx);
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

            if score > 0.0 {
                scores.push((doc_idx, score));
            }
        }

        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        scores
            .into_iter()
            .take(limit)
            .map(|(doc_idx, score)| SearchResult {
                id: self.docs[doc_idx].id.clone(),
                score,
            })
            .collect()
    }
}
