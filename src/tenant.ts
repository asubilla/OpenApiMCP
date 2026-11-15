/**
 * Multi-tenant configuration: dependency-free helpers to parse a tenants
 * JSON document, resolve a named tenant with optional user credentials and
 * explicit overrides, and render a human-readable summary.
 */

export interface UserCreds {
  headers?: Record<string, string>;
  policy?: string;
  readOnly?: boolean;
}

export interface TenantConfig {
  name: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  policy?: string;
  readOnly?: boolean;
  users?: Record<string, UserCreds>;
}

export interface TenantsFile {
  tenants: Record<string, Omit<TenantConfig, "name">>;
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

function coerceUserCreds(value: unknown): UserCreds | undefined {
  if (!isPlainObject(value)) return undefined;
  const creds: UserCreds = {};
  const headers = coerceHeaders(value.headers);
  if (headers !== undefined) creds.headers = headers;
  const policy = coerceNonEmptyString(value.policy);
  if (policy !== undefined) creds.policy = policy;
  const readOnly = coerceBoolean(value.readOnly);
  if (readOnly !== undefined) creds.readOnly = readOnly;
  return creds;
}

function coerceUsers(value: unknown): Record<string, UserCreds> | undefined {
  if (!isPlainObject(value)) return undefined;
  const out: Record<string, UserCreds> = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = key.trim();
    if (!name) continue;
    const creds = coerceUserCreds(raw);
    if (creds === undefined) continue;
    out[name] = creds;
  }
  return out;
}

/**
 * Validate an unknown JSON value as a tenants file. The root must be an
 * object with a `tenants` object; entries that are not plain objects are
 * dropped, and individual fields are coerced (headers values are stringified,
 * `readOnly` accepts booleans/numbers/"true"-ish strings, missing or invalid
 * optional fields are omitted). Throws if the root shape is invalid.
 */
export function parseTenantsFile(json: unknown): Record<string, Omit<TenantConfig, "name">> {
  if (!isPlainObject(json)) {
    throw new TypeError("tenants file must be a JSON object");
  }
  if (!isPlainObject(json.tenants)) {
    throw new TypeError('tenants file must contain a "tenants" object');
  }

  const out: Record<string, Omit<TenantConfig, "name">> = {};
  for (const [name, rawEntry] of Object.entries(json.tenants)) {
    const key = name.trim();
    if (!key) continue;
    if (!isPlainObject(rawEntry)) continue;

    const entry: Omit<TenantConfig, "name"> = {};
    const baseUrl = coerceNonEmptyString(rawEntry.baseUrl);
    if (baseUrl !== undefined) entry.baseUrl = baseUrl;
    const headers = coerceHeaders(rawEntry.headers);
    if (headers !== undefined) entry.headers = headers;
    const policy = coerceNonEmptyString(rawEntry.policy);
    if (policy !== undefined) entry.policy = policy;
    const readOnly = coerceBoolean(rawEntry.readOnly);
    if (readOnly !== undefined) entry.readOnly = readOnly;
    const users = coerceUsers(rawEntry.users);
    if (users !== undefined) entry.users = users;

    out[key] = entry;
  }
  return out;
}

/**
 * Resolve a named tenant into a full `TenantConfig`. Starts from the tenant
 * definition, applies `overrides` (baseUrl/headers/policy/readOnly; headers
 * merge key-by-key with overrides winning), then — when `userKey` is given
 * and the tenant defines that user — merges the user's credentials on top
 * (user headers win over tenant headers, user policy wins, user readOnly
 * wins). Returns `undefined` when `name` is not present in `tenants`.
 */
export function resolveTenant(
  tenants: Record<string, Omit<TenantConfig, "name">>,
  name: string,
  userKey?: string,
  overrides?: Partial<TenantConfig>
): TenantConfig | undefined {
  const base = tenants[name];
  if (!base) return undefined;

  const resolved: TenantConfig = { name };
  if (base.baseUrl !== undefined) resolved.baseUrl = base.baseUrl;
  if (base.policy !== undefined) resolved.policy = base.policy;
  if (base.readOnly !== undefined) resolved.readOnly = base.readOnly;
  if (base.headers) resolved.headers = { ...base.headers };
  if (base.users) {
    resolved.users = {};
    for (const [key, creds] of Object.entries(base.users)) {
      resolved.users[key] = { ...creds, ...(creds.headers ? { headers: { ...creds.headers } } : {}) };
    }
  }

  if (overrides) {
    if (overrides.baseUrl !== undefined) resolved.baseUrl = overrides.baseUrl;
    if (overrides.policy !== undefined) resolved.policy = overrides.policy;
    if (overrides.readOnly !== undefined) resolved.readOnly = overrides.readOnly;
    if (overrides.headers) {
      resolved.headers = { ...resolved.headers, ...overrides.headers };
    }
  }

  if (userKey !== undefined && resolved.users && Object.prototype.hasOwnProperty.call(resolved.users, userKey)) {
    const creds = resolved.users[userKey];
    if (creds.headers) {
      resolved.headers = { ...resolved.headers, ...creds.headers };
    }
    if (creds.policy !== undefined) resolved.policy = creds.policy;
    if (creds.readOnly !== undefined) resolved.readOnly = creds.readOnly;
  }

  return resolved;
}

/** Sorted list of tenant names defined in the map. */
export function tenantNames(tenants: Record<string, Omit<TenantConfig, "name">>): string[] {
  return Object.keys(tenants).sort();
}

/** Render a readable multi-line summary of a tenant. */
export function formatTenant(t: TenantConfig): string {
  const lines: string[] = [`Tenant "${t.name}"`];
  lines.push(`  baseUrl: ${t.baseUrl ?? "(not set)"}`);
  lines.push(`  readOnly: ${t.readOnly === undefined ? "(not set)" : String(t.readOnly)}`);
  lines.push(`  policy: ${t.policy ?? "(not set)"}`);
  const headers = t.headers ?? {};
  const keys = Object.keys(headers);
  if (keys.length === 0) {
    lines.push("  headers: (none)");
  } else {
    lines.push(`  headers (${keys.length}):`);
    for (const key of keys.sort()) {
      lines.push(`    ${key}: ${headers[key]}`);
    }
  }
  const users = t.users ?? {};
  const userKeys = Object.keys(users);
  if (userKeys.length === 0) {
    lines.push("  users: (none)");
  } else {
    lines.push(`  users (${userKeys.length}): ${userKeys.sort().join(", ")}`);
  }
  return lines.join("\n");
}
