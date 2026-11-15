/**
 * Cycle-safe JSON helpers.
 *
 * `loadDocument()` fully dereferences `$ref`s, which turns self-referencing
 * schemas (e.g. Pokémon evolution chains: Ability -> Ability) into circular
 * object graphs in memory. Plain `JSON.stringify` throws on those; res┴ursive
 * walkers can overflow the stack. These helpers tolerate that reality.
 */

/** JSON.stringify with cycles replaced by "[circular]". Never throws. */
export function stringifyCycles(value: unknown, space?: string | number): string {
  const seen = new Set<object>();
  return JSON.stringify(
    value,
    (_key, v) => {
      if (v && typeof v === "object") {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      return v;
    },
    space
  );
}

/** Stable (key-sorted, recursive) stringify with cycles replaced by "[circular]". Never throws. */
export function stableStringifyCycles(value: unknown): string {
  const normalize = (node: any, seen: Set<object>): any => {
    if (node === undefined) return null;
    if (node === null || typeof node !== "object") return typeof node === "bigint" || typeof node === "function" || typeof node === "symbol" ? String(node) : node;
    if (seen.has(node)) return "[circular]";
    seen.add(node);
    if (Array.isArray(node)) return node.map((v) => normalize(v, seen));
    const out: Record<string, any> = {};
    for (const key of Object.keys(node).sort()) out[key] = normalize(node[key], seen);
    return out;
  };
  return JSON.stringify(normalize(value, new Set()));
}
