import type { ToolSecurity } from "./types.js";

export type Env = Record<string, string | undefined>;

/** Build the conventional environment variable name for a security scheme. */
export function envKey(...parts: string[]): string {
  return (
    "OPENAPIMCP_" +
    parts
      .join("_")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase()
  );
}

/** Replace `{env:NAME}` references in a string with environment values. */
export function substituteEnv(value: string, env: Env = process.env): string {
  return value.replace(/\{env:([A-Za-z0-9_]+)\}/g, (_match, name: string) => env[name] ?? "");
}

/**
 * Resolve credentials for a single security scheme from the environment:
 * `OPENAPIMCP_<SCHEME>` (plus `_USERNAME`/`_PASSWORD` for basic).
 */
export function schemeAuth(name: string, scheme: any, env: Env = process.env): ToolSecurity | null {
  if (!scheme) return null;
  const type = String(scheme.type || "").toLowerCase();
  const key = envKey(name);

  if (type === "http") {
    const httpScheme = String(scheme.scheme || "").toLowerCase();
    if (httpScheme === "bearer") {
      const token = env[key] || env[envKey("TOKEN")] || env[envKey("API_KEY")];
      return token ? { headers: { authorization: `Bearer ${token}` }, query: {} } : null;
    }
    if (httpScheme === "basic") {
      const user = env[envKey(name, "USERNAME")] ?? env[envKey("USERNAME")];
      const pass = env[envKey(name, "PASSWORD")] ?? env[envKey("PASSWORD")];
      if (user != null && pass != null) {
        return { headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` }, query: {} };
      }
      const raw = env[key];
      return raw ? { headers: { authorization: `Basic ${Buffer.from(raw).toString("base64")}` }, query: {} } : null;
    }
    const raw = env[key];
    return raw ? { headers: { authorization: raw }, query: {} } : null;
  }

  if (type === "apikey") {
    const token = env[key];
    if (!token) return null;
    const where = String(scheme.in || "header").toLowerCase();
    const field = String(scheme.name || "X-API-Key");
    if (where === "header") return { headers: { [field.toLowerCase()]: token }, query: {} };
    if (where === "query") return { headers: {}, query: { [field]: token } };
    if (where === "cookie") return { headers: { cookie: `${field}=${token}` }, query: {} };
    return null;
  }

  if (type === "oauth2" || type === "openidconnect") {
    const token = env[key] || env[envKey("TOKEN")];
    return token ? { headers: { authorization: `Bearer ${token}` }, query: {} } : null;
  }

  return null;
}

/**
 * Given the spec's security requirements (global or per-operation), return the
 * auth for the first requirement the environment can satisfy. An explicitly
 * empty requirements array means "no auth".
 */
export function resolveToolSecurity(
  schemes: Record<string, any> | undefined,
  requirements: any,
  env: Env = process.env
): ToolSecurity {
  const none: ToolSecurity = { headers: {}, query: {} };
  if (!Array.isArray(requirements) || requirements.length === 0) return none;

  for (const requirement of requirements) {
    const combined: ToolSecurity = { headers: {}, query: {} };
    let satisfied = true;
    for (const schemeName of Object.keys(requirement ?? {})) {
      const auth = schemeAuth(schemeName, schemes?.[schemeName], env);
      if (!auth) {
        satisfied = false;
        break;
      }
      Object.assign(combined.headers, auth.headers);
      Object.assign(combined.query, auth.query);
    }
    if (satisfied) return combined;
  }
  return none;
}
