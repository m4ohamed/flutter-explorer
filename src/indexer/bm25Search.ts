/**
 * BM25 Search - Relevance ranking without AI
 * Okapi BM25 algorithm (1994) used by Elasticsearch, SQLite FTS5, and early Google.
 *
 * Improvements over v1:
 *   1. Inverted index        — candidate prefiltering, O(K·Q) instead of O(N·Q)
 *   2. O(1) avgDocLen        — running totalDocLength instead of O(N) loop
 *   3. built flag fix        — tied to totalDocs > 0, not just a boolean flip
 *   4. Naming fix            — termFreq → docTermFreqs (docId → term → freq)
 *   5. IDF floor             — common Flutter words stay useful (min 0.1)
 *   6. Field weighting       — name/path/superclass/comments weighted differently
 */
 
// ── Document shape ────────────────────────────────────────────────────────────
 
export interface BM25Document {
  /** Unique identifier: "lib/screens/login.dart:45:LoginScreen" */
  id: string;
 
  /**
   * Weighted fields — scored independently with different multipliers.
   *
   * name        × 4.0  — class / function / variable identifier
   * path        × 1.5  — file path tokens
   * superclass  × 2.0  — extends / implements (important in Flutter)
   * comments    × 0.3  — dartdoc / inline comments
   */
  fields: {
    name: string;
    path?: string;
    superclass?: string;
    comments?: string;
  };
}
 
// ── Internal stored doc ───────────────────────────────────────────────────────
 
interface IndexedDoc {
  original: BM25Document;
  /** Combined token count across all weighted fields */
  length: number;
}
 
// ── Field weights ─────────────────────────────────────────────────────────────
 
const FIELD_WEIGHTS: Record<keyof BM25Document['fields'], number> = {
  name:       4.0,
  path:       1.5,
  superclass: 2.0,
  comments:   0.3,
};
 
// ── BM25Search ────────────────────────────────────────────────────────────────
 
export class BM25Search {
  // BM25 tuning constants (standard values)
  private readonly K1 = 1.5;  // term frequency saturation (1.2–2.0)
  private readonly B  = 0.75; // length normalization (0 = none, 1 = full)
 
  /** Minimum IDF score — prevents common Flutter words from becoming worthless */
  private readonly IDF_FLOOR = 0.1;
 
  private avgDocLen      = 0;
  private totalDocs      = 0;
  private totalDocLength = 0; // FIX: running sum → O(1) avgDocLen updates
 
  /**
   * FIX (naming): was `termFreq` with misleading comment "term → {docId → freq}".
   * Actual structure is docId → term → freq, so renamed to docTermFreqs.
   */
  private docTermFreqs = new Map<string, Map<string, number>>();
 
  /** term → Set<docId> — INVERTED INDEX for O(K·Q) candidate prefiltering */
  private invertedIndex = new Map<string, Set<string>>();
 
  /** term → number of docs containing it */
  private docFreq = new Map<string, number>();
 
  /** docId → IndexedDoc */
  private docs = new Map<string, IndexedDoc>();
 
  // ── Index lifecycle ─────────────────────────────────────────────────────────
 
  /** Build the index from a list of documents. Call after full re-index. */
  buildIndex(documents: BM25Document[]): void {
    this.docTermFreqs.clear();
    this.invertedIndex.clear();
    this.docFreq.clear();
    this.docs.clear();
    this.totalDocs      = 0;
    this.totalDocLength = 0;
 
    for (const doc of documents) {
      this._addToIndex(doc);
    }
 
    // FIX (built flag): derived from actual state, not a hardcoded flip
    this._recalcAvg();
  }
 
  /** Add or update a single document (incremental update — filesystem watcher). */
  upsertDocument(doc: BM25Document): void {
    if (this.docs.has(doc.id)) {
      this._removeFromIndex(doc.id);
    }
    this._addToIndex(doc);
    this._recalcAvg();
  }
 
  /** Remove a document from the index (called on file delete). */
  removeDocument(id: string): void {
    if (!this.docs.has(id)) return;
    this._removeFromIndex(id);
    this._recalcAvg();
  }
 
  // ── Search ──────────────────────────────────────────────────────────────────
 
  /**
   * Full corpus search — returns top-K results sorted by score.
   *
   * Uses the inverted index to prefilter candidates, so only documents
   * that share at least one query term are scored.
   * Complexity: O(K·Q) where K << N.
   */
  search(query: string, topK = 50): Array<{ id: string; score: number }> {
    if (!this.isBuilt) return [];
 
    const queryTerms = [...new Set(this.tokenize(query))];
    if (queryTerms.length === 0) return [];
 
    // INVERTED INDEX: gather candidates with AND threshold
    // queries > 2 terms: doc must match at least 2 terms (precision)
    // queries ≤ 2 terms: OR union (recall)
    const minOverlap = queryTerms.length > 2 ? 2 : 1;
    const overlapCount = new Map<string, number>();
 
    for (const term of queryTerms) {
      const posting = this.invertedIndex.get(term);
      if (!posting) continue;
      for (const id of posting) {
        overlapCount.set(id, (overlapCount.get(id) ?? 0) + 1);
      }
    }
 
    const candidateIds = [...overlapCount.entries()]
      .filter(([, count]) => count >= minOverlap)
      .map(([id]) => id);
 
    if (candidateIds.length === 0) return [];
 
    const scores = this.scoreMany([...candidateIds], query);
 
    return [...scores.entries()]
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => ({ id, score }));
  }
 
  /**
   * Score a specific set of candidate IDs against a query.
   * Useful when you have a pre-filtered candidate list (e.g. from a prefix map).
   * Returns a Map of id → combined BM25 + boost score.
   */
  scoreMany(candidateIds: string[], query: string): Map<string, number> {
    const scores = new Map<string, number>();
    if (!this.isBuilt) return scores;
 
    const queryTerms = [...new Set(this.tokenize(query))];
    if (queryTerms.length === 0) return scores;
 
    for (const docId of candidateIds) {
      const indexed = this.docs.get(docId);
      if (!indexed) { scores.set(docId, 0); continue; }
 
      const termFreqs = this.docTermFreqs.get(docId);
      if (!termFreqs) { scores.set(docId, 0); continue; }
 
      const docLen = indexed.length;
      let score = 0;
 
      for (const term of queryTerms) {
        const tf = termFreqs.get(term) ?? 0;
        const df = this.docFreq.get(term) ?? 0;
        if (df === 0 || tf === 0) continue;
 
        // IDF: rarer terms are more valuable
        // FIX (IDF floor): clamp to IDF_FLOOR so common Flutter words
        // ("service", "controller", "screen") stay useful
        const rawIdf = Math.log(
          (this.totalDocs - df + 0.5) / (df + 0.5) + 1
        );
        const idf = Math.max(rawIdf, this.IDF_FLOOR);
 
        // TF with BM25 length normalization
        const norm   = 1 - this.B + this.B * (docLen / this.avgDocLen);
        const tfNorm = (tf * (this.K1 + 1)) / (tf + this.K1 * norm);
 
        score += idf * tfNorm;
      }
 
      // Exact / prefix / contains boost on the name field only
      // (keeps IDE-style "LoginScreen before AppLoginScreenControllerFactory" behavior)
      const nameLower  = indexed.original.fields.name.toLowerCase();
      const queryLower = query.toLowerCase();
      if (nameLower === queryLower)                score += 10;
      else if (nameLower.startsWith(queryLower))   score += 5;
      else if (nameLower.includes(queryLower))     score += 2;
 
      scores.set(docId, score);
    }
 
    return scores;
  }
 
  // ── State accessors ─────────────────────────────────────────────────────────
 
  /** FIX (built flag): reflects real index state, not a stale boolean */
  get isBuilt(): boolean { return this.totalDocs > 0; }
 
  get documentCount(): number { return this.totalDocs; }
 
  // ── Tokenizer ───────────────────────────────────────────────────────────────
 
  /**
   * Split camelCase / PascalCase / snake_case / UPPER_CASE into tokens.
   *
   * "LoginScreenController" → ["login", "screen", "controller"]
   * "getUserProfile"        → ["get", "user", "profile"]
   * "HTTP_CLIENT"           → ["http", "client"]
   * "XMLParser"             → ["xml", "parser"]
   */
  tokenize(text: string): string[] {
    return text
      .replace(/([a-z])([A-Z])/g, '$1 $2')         // loginScreen → login Screen
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')   // XMLParser  → XML Parser
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .toLowerCase()
      .split(' ')
      .filter(t => t.length > 1);
  }
 
  // ── Private helpers ─────────────────────────────────────────────────────────
 
  /**
   * Tokenize all weighted fields and merge into a single frequency map.
   * Each field's token frequencies are multiplied by that field's weight.
   *
   * FIELD WEIGHTING: name × 4 | superclass × 2 | path × 1.5 | comments × 0.3
   *
   * This means a match in the class name scores ~13× higher than the same
   * match buried in a dartdoc comment, which mirrors real IDE search intent.
   */
  private _buildWeightedFreq(
    doc: BM25Document
  ): { freq: Map<string, number>; length: number } {
    const freq = new Map<string, number>();
    let totalWeight = 0;
 
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS) as Array<[keyof BM25Document['fields'], number]>) {
      const text = doc.fields[field];
      if (!text) continue;
 
      const tokens = this.tokenize(text);
      // Use weighted length as a proxy for "document length" in BM25
      totalWeight += tokens.length * weight;
 
      for (const t of tokens) {
        freq.set(t, (freq.get(t) ?? 0) + weight);
      }
    }
 
    return { freq, length: totalWeight };
  }
 
  private _addToIndex(doc: BM25Document): void {
    const { freq, length } = this._buildWeightedFreq(doc);
 
    this.docs.set(doc.id, { original: doc, length });
    this.docTermFreqs.set(doc.id, freq);
    this.totalDocs++;
 
    // FIX (O(1) avgDocLen): accumulate running total
    this.totalDocLength += length;
 
    // Update inverted index + global doc-frequency
    for (const t of freq.keys()) {
      // Inverted index
      if (!this.invertedIndex.has(t)) {
        this.invertedIndex.set(t, new Set());
      }
      this.invertedIndex.get(t)!.add(doc.id);
 
      // Global doc-frequency (binary: does this doc contain the term?)
      this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
    }
  }
 
  private _removeFromIndex(id: string): void {
    const indexed = this.docs.get(id);
    if (!indexed) return;
 
    const freq = this.docTermFreqs.get(id);
    if (freq) {
      for (const t of freq.keys()) {
        // Remove from inverted index
        const posting = this.invertedIndex.get(t);
        if (posting) {
          posting.delete(id);
          if (posting.size === 0) this.invertedIndex.delete(t);
        }
 
        // Update global doc-frequency
        const df = (this.docFreq.get(t) ?? 1) - 1;
        if (df <= 0) this.docFreq.delete(t);
        else this.docFreq.set(t, df);
      }
    }
 
    // FIX (O(1) avgDocLen): subtract from running total
    this.totalDocLength -= indexed.length;
    this.totalDocs = Math.max(0, this.totalDocs - 1);
 
    this.docTermFreqs.delete(id);
    this.docs.delete(id);
  }
 
  private _recalcAvg(): void {
    this.avgDocLen = this.totalDocs > 0
      ? this.totalDocLength / this.totalDocs
      : 1;
  }
}
