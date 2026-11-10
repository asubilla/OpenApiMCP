/**
 * Redaction utilities: remove secrets from arbitrary JSON-ish values and from
 * free-form text before logging, tracing or returning them to a model.
 *
 * The functions here never mutate their input; nested objects are deep-cloned
 * and cycles are preserved.
 */

export interface RedactOptions {
  /** Extra key names (matched case-insensitively as substrings) to redact. */
  keys?: string[];
  /** Extra regular expressions to redact inside string values. */
  patterns?: RegExp[];
  /** Replacement string. Defaults to `"***"`. */
  mask?: string;
}

/** Key names whose values are always replaced by the mask. */
const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "auth",
  "credit_card",
  "card_number",
  "cvv",
  "ssn",
  "private_key"
];

/**
 * Default string patterns:
 *  - JWTs (three base64url segments separated by dots)
 *  - `Bearer <token>`
 *  - 13-19 digit card-like sequences (optionally space/dash separated)
 */
const DEFAULT_TEXT_PATTERNS: readonly RegExp[] = [
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?![A-Za-z0-9_-])/,
  /(?<![A-Za-z0-9])Bearer[ \t]+[A-Za-z0-9._~+/=-]+/i,
  /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/
];

/** Return a fresh global copy of a regular expression. */
function globalize(pattern: RegExp): RegExp {
  return pattern.flags.includes("g")
    ? new RegExp(pattern.source, pattern.flags)
    : new RegExp(pattern.source, `${pattern.flags}g`);
}

function maskOf(options: RedactOptions): string {
  return options.mask ?? "***";
}

/** Replace secrets found inside plain text with the mask. */
export function redactText(text: string, options: RedactOptions = {}): string {
  const mask = maskOf(options);
  const patterns = [...DEFAULT_TEXT_PATTERNS, ...(options.patterns ?? [])];
  let out = text;
  for (const pattern of patterns) {
    out = out.replace(globalize(pattern), mask);
  }
  return out;
}

/** Deep-clone a value, masking sensitive keys and secret-looking strings. */
export function redact(value: any, options: RedactOptions = {}): any {
  const mask = maskOf(options);
  const sensitive = [...DEFAULT_SENSITIVE_KEYS, ...(options.keys ?? [])].map((key) =>
    key.toLowerCase()
  );
  const seen = new WeakMap<object, unknown>();

  const isSensitiveKey = (key: string): boolean => {
    const lower = key.toLowerCase();
    return sensitive.some((needle) => needle.length > 0 && lower.includes(needle));
  };

  const walk = (input: unknown): unknown => {
    if (typeof input === "string") return redactText(input, options);
    if (input === null || typeof input !== "object") return input;
    if (input instanceof Date) return new Date(input.getTime());
    if (input instanceof RegExp) return new RegExp(input.source, input.flags);
    if (seen.has(input)) return seen.get(input);
    if (Array.isArray(input)) {
      const clone: unknown[] = [];
      seen.set(input, clone);
      for (const item of input) clone.push(walk(item));
      return clone;
    }
    const clone: Record<string, unknown> = {};
    seen.set(input, clone);
    for (const [key, item] of Object.entries(input)) {
      clone[key] = isSensitiveKey(key) ? mask : walk(item);
    }
    return clone;
  };

  return walk(value);
}
