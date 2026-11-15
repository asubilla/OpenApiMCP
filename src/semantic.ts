import type { ToolDef } from "./types.js";

export type EmbeddingFn = (text: string) => number[] | Promise<number[]>;

export interface SemanticRouter {
  index(tools: ToolDef[]): void;
  route(query: string, topK?: number): { tool: ToolDef; score: number }[];
  isIndexed(): boolean;
  size(): number;
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

/** Tokenize free text into lowercase alphanumeric tokens, splitting camelCase. */
function tokenize(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Simple hash-based bag-of-words embedding (deterministic, no external API). */
export function defaultEmbedding(text: string, dimensions?: number): number[] {
  const dims =
    typeof dimensions === "number" && Number.isFinite(dimensions) && dimensions > 0
      ? Math.trunc(dimensions)
      : 64;
  const vec = new Array<number>(dims).fill(0);
  for (const token of tokenize(text)) {
    const idx = hashToken(token) % dims;
    vec[idx] += 1;
  }
  return vec;
}

interface IndexedTool {
  tool: ToolDef;
  vector: number[];
  index: number;
}

export function createSemanticRouter(embeddingFn: EmbeddingFn): SemanticRouter {
  let entries: IndexedTool[] = [];
  let indexed = false;

  function embedText(text: string): number[] | null {
    const result = embeddingFn(text);
    if (result && typeof (result as { then?: unknown }).then === "function") {
      return null;
    }
    return result as number[];
  }

  return {
    index(tools: ToolDef[]): void {
      const list = Array.isArray(tools) ? tools : [];
      entries = list.map((tool, i) => {
        const text = [tool?.name ?? "", tool?.description ?? "", ...(tool?.tags ?? [])]
          .map((v) => String(v))
          .join(" ");
        const v = embedText(text);
        return { tool, vector: v ?? [], index: i };
      });
      // Handle async embedding functions by resolving vectors in the background.
      list.forEach((tool, i) => {
        const text = [tool?.name ?? "", tool?.description ?? "", ...(tool?.tags ?? [])]
          .map((v) => String(v))
          .join(" ");
        const result = embeddingFn(text);
        if (result && typeof (result as { then?: unknown }).then === "function") {
          (result as Promise<number[]>).then((vec) => {
            if (entries[i]) entries[i].vector = Array.isArray(vec) ? vec : [];
          });
        }
      });
      indexed = true;
    },
    route(query: string, topK?: number): { tool: ToolDef; score: number }[] {
      if (!indexed || entries.length === 0) return [];
      const k =
        topK === undefined
          ? 5
          : Number.isFinite(topK)
          ? Math.max(0, Math.trunc(topK as number))
          : 5;
      const qResult = embeddingFn(query);
      if (qResult && typeof (qResult as { then?: unknown }).then === "function") {
        return [];
      }
      const qv = qResult as number[];
      const scored = entries.map((e) => ({
        tool: e.tool,
        score: cosineSimilarity(qv, e.vector),
        index: e.index,
      }));
      scored.sort((a, b) => b.score - a.score || a.index - b.index);
      return scored.slice(0, k).map(({ tool, score }) => ({ tool, score }));
    },
    isIndexed(): boolean {
      return indexed;
    },
    size(): number {
      return entries.length;
    },
  };
}
