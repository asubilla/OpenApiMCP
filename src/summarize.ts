/**
 * Shape very large JSON payloads into something that fits in a model context.
 *
 * Arrays and objects are truncated with explicit sentinel markers, recursion is
 * depth-limited and long strings are shortened. Nothing is mutated.
 */

export interface SummarizeOptions {
  /** Maximum array elements to keep. Defaults to 25. */
  maxArrayItems?: number;
  /** Maximum recursion depth before nodes become `"[object]"`. Defaults to 6. */
  maxDepth?: number;
  /** Maximum string length before truncation. Defaults to 2000. */
  maxStringLength?: number;
  /** Maximum object keys to keep. Defaults to 50. */
  maxObjectKeys?: number;
}

/** Recursively summarize a JSON-ish value for safe, bounded display. */
export function summarizeJson(value: any, options: SummarizeOptions = {}): any {
  const maxArrayItems = options.maxArrayItems ?? 25;
  const maxDepth = options.maxDepth ?? 6;
  const maxStringLength = options.maxStringLength ?? 2000;
  const maxObjectKeys = options.maxObjectKeys ?? 50;
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    if (typeof input === "string") {
      return input.length > maxStringLength ? `${input.slice(0, maxStringLength)}…` : input;
    }
    if (input === null || typeof input !== "object") return input;
    if (depth >= maxDepth) return "[object]";
    if (seen.has(input)) return "[Circular]";
    seen.add(input);

    if (Array.isArray(input)) {
      const limit = Math.max(0, maxArrayItems);
      const kept: unknown[] = input.slice(0, limit).map((item) => walk(item, depth + 1));
      const dropped = input.length - limit;
      if (dropped > 0) kept.push(`…(${dropped} more)`);
      return kept;
    }

    const source = input as Record<string, unknown>;
    const entries = Object.entries(source);
    const limit = Math.max(0, maxObjectKeys);
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, limit)) {
      out[key] = walk(item, depth + 1);
    }
    const dropped = entries.length - limit;
    if (dropped > 0) out[`…(${dropped} more keys)`] = "...";
    return out;
  };

  return walk(value, 0);
}
