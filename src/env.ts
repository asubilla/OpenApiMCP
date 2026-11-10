/**
 * Tiny `.env` helpers: parse KEY=VALUE text and apply it to a target
 * environment object, matching the hand-rolled, dependency-free style used
 * elsewhere in this project.
 */

/**
 * Parse `.env` text into a key/value map. Blank lines and `#` comments are
 * ignored, an optional `export ` prefix is stripped, surrounding single or
 * double quotes are removed, and trailing comments on unquoted values are
 * dropped.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof text !== "string") return out;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const body = line.replace(/^export\s+/, "");
    const eq = body.indexOf("=");
    if (eq === -1) continue;

    const key = body.slice(0, eq).trim();
    if (!key) continue;

    out[key] = parseValue(body.slice(eq + 1));
  }

  return out;
}

/**
 * Apply parsed `.env` values into `env`. Keys already present are skipped
 * unless `override` is true. Returns the number of values applied.
 */
export function applyDotenv(env: Record<string, string | undefined>, text: string, override = false): number {
  const parsed = parseDotenv(text);
  let applied = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (!override && env[key] !== undefined) continue;
    env[key] = value;
    applied++;
  }
  return applied;
}

function parseValue(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') return unescapeDouble(value.slice(1, -1));
    if (first === "'" && last === "'") return value.slice(1, -1);
  }
  const comment = value.search(/(^|\s)#/);
  return comment === -1 ? value : value.slice(0, comment).trim();
}

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

function unescapeDouble(value: string): string {
  return value.replace(/\\(.)/g, (_, char: string) => ESCAPES[char] ?? `\\${char}`);
}
