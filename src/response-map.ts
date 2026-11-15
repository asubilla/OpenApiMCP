/**
 * Response mapping utilities: reshape JSON-ish API responses before they are
 * returned to a model. A mapping can keep a subset of top-level keys (`pick`),
 * remove keys (`drop`) and rename keys (`rename`).
 *
 * `applyMapping` is intentionally "deep-ish": arrays are mapped element-wise,
 * but plain objects are only transformed at the top level (no recursion into
 * nested values). The input value is never mutated.
 */

export interface ResponseMapping {
  /** Keep only these top-level keys. */
  pick?: string[];
  /** Rename top-level keys (oldKey -> newKey). Applied after pick/drop. */
  rename?: Record<string, string>;
  /** Remove these top-level keys. */
  drop?: string[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Apply a response mapping to a value.
 *
 * - Arrays are mapped element-wise (elements that are objects get mapped,
 *   anything else passes through).
 * - Plain objects get pick/drop applied first (a key listed in both `pick`
 *   and `drop` is kept: pick wins over drop), then `rename` is applied to the
 *   surviving keys.
 * - Non-objects (including null) pass through unchanged.
 */
export function applyMapping(value: any, map: ResponseMapping): any {
  if (Array.isArray(value)) {
    return value.map((item) => applyMapping(item, map));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const pickSet = map.pick ? new Set(map.pick) : undefined;
  const dropSet = map.drop ? new Set(map.drop) : undefined;

  let entries = Object.entries(value);
  if (pickSet) {
    entries = entries.filter(([key]) => pickSet.has(key));
  }
  if (dropSet) {
    entries = entries.filter(([key]) => !dropSet.has(key) || (pickSet?.has(key) ?? false));
  }

  if (map.rename) {
    const rename = map.rename;
    entries = entries.map(([key, item]) => [rename[key] ?? key, item] as [string, unknown]);
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    out[key] = item;
  }
  return out;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isPlainObject(value) &&
  Object.values(value).every((item) => typeof item === "string");

/**
 * Validate an unknown value (e.g. parsed JSON) as a {@link ResponseMapping}.
 *
 * Returns a normalized mapping (only the known keys, copied) when the input is
 * a plain object with at least one of `pick`/`rename`/`drop`, where each
 * present key is well-formed:
 * - `pick` and `drop` must be arrays of strings,
 * - `rename` must be an object with string values (oldKey -> newKey).
 *
 * Returns `undefined` for anything else.
 */
export function parseMapping(json: unknown): ResponseMapping | undefined {
  if (!isPlainObject(json)) {
    return undefined;
  }

  const { pick, rename, drop } = json as Record<string, unknown>;
  const hasAny = pick !== undefined || rename !== undefined || drop !== undefined;
  if (!hasAny) {
    return undefined;
  }

  const out: ResponseMapping = {};

  if (pick !== undefined) {
    if (!isStringArray(pick)) return undefined;
    out.pick = [...pick];
  }
  if (drop !== undefined) {
    if (!isStringArray(drop)) return undefined;
    out.drop = [...drop];
  }
  if (rename !== undefined) {
    if (!isStringRecord(rename)) return undefined;
    out.rename = { ...rename };
  }

  return out;
}

/**
 * Compact human-readable summary of a mapping, e.g.
 * `pick(id, name); drop(secret); rename(id->userId)`.
 * Returns `(empty mapping)` when the mapping has no effect keys set.
 */
export function formatMapping(map: ResponseMapping): string {
  const parts: string[] = [];
  if (map.pick && map.pick.length > 0) {
    parts.push(`pick(${map.pick.join(", ")})`);
  }
  if (map.drop && map.drop.length > 0) {
    parts.push(`drop(${map.drop.join(", ")})`);
  }
  if (map.rename && Object.keys(map.rename).length > 0) {
    const pairs = Object.entries(map.rename).map(([from, to]) => `${from}->${to}`);
    parts.push(`rename(${pairs.join(", ")})`);
  }
  return parts.length > 0 ? parts.join("; ") : "(empty mapping)";
}
