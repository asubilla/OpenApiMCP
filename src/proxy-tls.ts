/**
 * Proxy/TLS helpers for spawning child processes that must honor a corporate
 * proxy or a custom CA bundle. Hand-rolled and dependency-free, matching the
 * style used elsewhere in this project. None of these helpers mutate
 * `process.env`; callers decide when and how to apply the returned variables.
 */

export interface ProxyTlsOptions {
  ca?: string;
  proxy?: string;
  rejectUnauthorized?: boolean;
}

export interface ProxyTlsPlan {
  proxy?: string;
  ca?: string;
  rejectUnauthorized?: boolean;
  env: Record<string, string>;
}

/** Trim a value and treat blank strings as unset. */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function envValue(env: Record<string, string | undefined> | undefined, key: string): string | undefined {
  return clean(env?.[key]);
}

/**
 * Compute the environment variables that should be set for a child process,
 * without touching `process.env`:
 *
 * - `opts.proxy` sets `HTTP_PROXY` and `HTTPS_PROXY`; when the provided `env`
 *   already defines either one, `opts` wins. When `opts.proxy` is absent, any
 *   proxy variables already present in `env` are preserved.
 * - `opts.ca` sets `NODE_EXTRA_CA_CERTS`.
 * - `opts.rejectUnauthorized === false` sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.
 *
 * Returns only the variables that should be set.
 */
export function buildProxyEnv(
  opts: ProxyTlsOptions,
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const out: Record<string, string> = {};

  const proxy = clean(opts.proxy);
  if (proxy) {
    out.HTTP_PROXY = proxy;
    out.HTTPS_PROXY = proxy;
  } else {
    const envHttp = envValue(env, "HTTP_PROXY");
    const envHttps = envValue(env, "HTTPS_PROXY");
    if (envHttp) out.HTTP_PROXY = envHttp;
    if (envHttps) out.HTTPS_PROXY = envHttps;
  }

  const ca = clean(opts.ca);
  if (ca) out.NODE_EXTRA_CA_CERTS = ca;

  if (opts.rejectUnauthorized === false) out.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  return out;
}

/**
 * Normalize `opts` into a plan with all resolved values. Pure and
 * side-effect free: nothing is read from or written to `process.env` unless
 * `env` is omitted, in which case `process.env` is used as a read-only
 * fallback source. `plan.proxy` falls back to `env.HTTP_PROXY` then
 * `env.HTTPS_PROXY` when `opts.proxy` is not set.
 */
export function planProxyTls(
  opts: ProxyTlsOptions,
  env: Record<string, string | undefined> = process.env
): ProxyTlsPlan {
  const proxy = clean(opts.proxy) ?? envValue(env, "HTTP_PROXY") ?? envValue(env, "HTTPS_PROXY");
  const ca = clean(opts.ca);
  const rejectUnauthorized = opts.rejectUnauthorized;

  const plan: ProxyTlsPlan = { env: buildProxyEnv(opts, env) };
  if (proxy !== undefined) plan.proxy = proxy;
  if (ca !== undefined) plan.ca = ca;
  if (rejectUnauthorized !== undefined) plan.rejectUnauthorized = rejectUnauthorized;
  return plan;
}

/**
 * Mask credentials in a proxy URL for display: `scheme://user:pass@host`
 * renders as `scheme://******:host`. Output only; the plan itself is left
 * untouched. URLs without inline credentials are returned unchanged.
 */
function maskProxyUrl(url: string): string {
  return url.replace(/\/\/[^/?#\s@]+:[^/?#\s@]+@/g, "//******:");
}

function display(value: string | undefined): string {
  return value === undefined ? "(not set)" : value;
}

/**
 * Render a plan as a human-readable multi-line summary. Passwords embedded in
 * proxy URLs are masked; nothing else is redacted.
 */
export function formatProxyTls(plan: ProxyTlsPlan): string {
  const lines = ["Proxy/TLS plan:"];
  lines.push(`  proxy: ${plan.proxy === undefined ? "(not set)" : maskProxyUrl(plan.proxy)}`);
  lines.push(`  ca: ${display(plan.ca)}`);
  lines.push(`  rejectUnauthorized: ${plan.rejectUnauthorized === undefined ? "(not set)" : String(plan.rejectUnauthorized)}`);
  const keys = Object.keys(plan.env);
  if (keys.length === 0) {
    lines.push("  env: (none)");
  } else {
    lines.push("  env:");
    for (const key of keys) {
      const raw = plan.env[key];
      const value = key === "HTTP_PROXY" || key === "HTTPS_PROXY" ? maskProxyUrl(raw) : raw;
      lines.push(`    ${key}=${value}`);
    }
  }
  return lines.join("\n");
}
