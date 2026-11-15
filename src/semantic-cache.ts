export interface SemanticEntry {
  key: string;
  value: string;
  vector: number[];
  expires: number;
}

/** Cosine similarity between two vectors. Returns 0 for zero vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) na += a[i] * a[i];
  for (let i = 0; i < b.length; i++) nb += b[i] * b[i];
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Deterministic string hash (FNV-1a) producing a non-negative integer. */
function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tokenize free text into lowercase alphanumeric tokens. */
function tokenize(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Simple bag-of-words hash vector. Tokenize, hash each token to a dimension, increment. */
export function textToVector(text: string, dimensions: number = 64): number[] {
  const dims = Number.isFinite(dimensions) && dimensions > 0 ? Math.trunc(dimensions) : 64;
  const vec = new Array<number>(dims).fill(0);
  for (const token of tokenize(text)) {
    const idx = hashToken(token) % dims;
    vec[idx] += 1;
  }
  return vec;
}

export class SemanticCache {
  private readonly threshold: number;
  private readonly ttlMs: number;
  private readonly dimensions: number;
  private entries: SemanticEntry[] = [];

  constructor(opts?: { threshold?: number; ttlMs?: number; dimensions?: number }) {
    this.threshold = typeof opts?.threshold === "number" ? opts.threshold : 0.8;
    this.ttlMs = typeof opts?.ttlMs === "number" ? opts.ttlMs : 60000;
    this.dimensions = typeof opts?.dimensions === "number" && opts.dimensions > 0 ? Math.trunc(opts.dimensions) : 64;
  }

  set(key: string, value: string): void {
    const entry: SemanticEntry = {
      key,
      value,
      vector: textToVector(key, this.dimensions),
      expires: Date.now() + this.ttlMs,
    };
    this.entries.push(entry);
  }

  get(query: string): { key: string; value: string; similarity: number } | undefined {
    const now = Date.now();
    const qv = textToVector(query, this.dimensions);
    let best: { entry: SemanticEntry; similarity: number } | undefined;
    for (const entry of this.entries) {
      if (entry.expires <= now) continue;
      const sim = cosineSimilarity(qv, entry.vector);
      if (sim >= this.threshold && (!best || sim > best.similarity)) {
        best = { entry, similarity: sim };
      }
    }
    if (!best) return undefined;
    return { key: best.entry.key, value: best.entry.value, similarity: best.similarity };
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }
}
