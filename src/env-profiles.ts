/**
 * Named environment profiles: small, dependency-free helpers to parse a
 * profiles JSON document, resolve a named profile with optional overrides,
 * and render a human-readable summary.
 */

export interface Profile {
  name: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  readOnly?: boolean;
  policy?: string;
}

export interface ProfilesFile {
  profiles: Record<string, Omit<Profile, "name">>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceHeaders(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = key.trim();
    if (!name) continue;
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "object") continue;
    out[name] = String(raw);
  }
  return out;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1" || text === "yes") return true;
    if (text === "false" || text === "0" || text === "no") return false;
    return undefined;
  }
  if (typeof value === "number") return value !== 0;
  return undefined;
}

function coerceNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

/**
 * Validate an unknown JSON value as a profiles file. The root must be an
 * object with a `profiles` object; entries that are not plain objects are
 * dropped, and individual fields are coerced (headers values are stringified,
 * `readOnly` accepts booleans/numbers/"true"-ish strings, missing or invalid
 * optional fields are omitted). Throws if the root shape is invalid.
 */
export function parseProfilesFile(json: unknown): Record<string, Omit<Profile, "name">> {
  if (!isPlainObject(json)) {
    throw new TypeError("profiles file must be a JSON object");
  }
  if (!isPlainObject(json.profiles)) {
    throw new TypeError('profiles file must contain a "profiles" object');
  }

  const out: Record<string, Omit<Profile, "name">> = {};
  for (const [name, rawEntry] of Object.entries(json.profiles)) {
    const key = name.trim();
    if (!key) continue;
    if (!isPlainObject(rawEntry)) continue;

    const entry: Omit<Profile, "name"> = {};
    const baseUrl = coerceNonEmptyString(rawEntry.baseUrl);
    if (baseUrl !== undefined) entry.baseUrl = baseUrl;
    const headers = coerceHeaders(rawEntry.headers);
    if (headers !== undefined) entry.headers = headers;
    const readOnly = coerceBoolean(rawEntry.readOnly);
    if (readOnly !== undefined) entry.readOnly = readOnly;
    const policy = coerceNonEmptyString(rawEntry.policy);
    if (policy !== undefined) entry.policy = policy;

    out[key] = entry;
  }
  return out;
}

/**
 * Resolve a named profile into a full `Profile`, applying `overrides` on top.
 * `headers` are merged key-by-key with overrides winning; `baseUrl`,
 * `readOnly` and `policy` are replaced when present in `overrides`.
 * Returns `undefined` when `name` is not present in `profiles`.
 */
export function resolveProfile(
  profiles: Record<string, Omit<Profile, "name">>,
  name: string,
  overrides?: Partial<Profile>
): Profile | undefined {
  const base = profiles[name];
  if (!base) return undefined;

  const resolved: Profile = { name };
  if (base.baseUrl !== undefined) resolved.baseUrl = base.baseUrl;
  if (base.readOnly !== undefined) resolved.readOnly = base.readOnly;
  if (base.policy !== undefined) resolved.policy = base.policy;
  if (base.headers) resolved.headers = { ...base.headers };

  if (overrides) {
    if (overrides.baseUrl !== undefined) resolved.baseUrl = overrides.baseUrl;
    if (overrides.readOnly !== undefined) resolved.readOnly = overrides.readOnly;
    if (overrides.policy !== undefined) resolved.policy = overrides.policy;
    if (overrides.headers) {
      resolved.headers = { ...resolved.headers, ...overrides.headers };
    }
  }

  return resolved;
}

/** Sorted list of profile names defined in the map. */
export function profileNames(profiles: Record<string, Omit<Profile, "name">>): string[] {
  return Object.keys(profiles).sort();
}

/** Render a readable multi-line summary of a profile. */
export function formatProfile(p: Profile): string {
  const lines: string[] = [`Profile "${p.name}"`];
  lines.push(`  baseUrl: ${p.baseUrl ?? "(not set)"}`);
  lines.push(`  readOnly: ${p.readOnly === undefined ? "(not set)" : String(p.readOnly)}`);
  lines.push(`  policy: ${p.policy ?? "(not set)"}`);
  const headers = p.headers ?? {};
  const keys = Object.keys(headers);
  if (keys.length === 0) {
    lines.push("  headers: (none)");
  } else {
    lines.push(`  headers (${keys.length}):`);
    for (const key of keys.sort()) {
      lines.push(`    ${key}: ${headers[key]}`);
    }
  }
  return lines.join("\n");
}
