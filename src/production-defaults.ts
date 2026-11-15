/**
 * Production-readiness checks for the openapimcp HTTP gateway.
 *
 * Dependency-free (node builtins only). Each check describes a single
 * finding with a stable `id`, a severity, a human-readable `message`
 * and an optional `fix` hint.
 */

export interface ProductionCheck {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  fix?: string;
}

export interface ProductionReport {
  ok: boolean;
  checks: ProductionCheck[];
  summary: { errors: number; warnings: number; infos: number };
}

export interface CheckGatewayOptions {
  host?: string;
  port?: number | string;
  http?: boolean;
  readOnly?: boolean;
  policy?: unknown;
  auth?: unknown;
  allowedHosts?: string[];
}

/** Normalize a host for comparison: lowercase, strip brackets and trailing dot. */
function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

/** True when the host is a loopback address (or unset, i.e. local default). */
function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return true;
  const h = normalizeHost(host);
  if (h === "") return true;
  if (h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  // 127.0.0.0/8 is the IPv4 loopback range.
  if (/^127(\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a policy object/value looks configured (truthy and non-empty). */
function hasPolicy(policy: unknown): boolean {
  if (policy === undefined || policy === null || policy === false) return false;
  if (typeof policy === "string") return policy.trim().length > 0;
  if (Array.isArray(policy)) return policy.length > 0;
  if (isPlainObject(policy)) return Object.keys(policy).length > 0;
  return Boolean(policy);
}

const AUTH_KEY_PATTERN = /api[-_]?key|jwt|oauth|openid|bearer|token|secret|issuer|client[-_]?id/i;

/** True when auth looks configured (apiKey / jwt / oauth and friends). */
function hasAuth(auth: unknown): boolean {
  if (auth === undefined || auth === null || auth === false) return false;
  if (typeof auth === "string") return auth.trim().length > 0;
  if (typeof auth === "number" || typeof auth === "boolean") return Boolean(auth);
  if (Array.isArray(auth)) return auth.length > 0;
  if (isPlainObject(auth)) {
    for (const [key, value] of Object.entries(auth)) {
      if (AUTH_KEY_PATTERN.test(key) && value !== undefined && value !== null && value !== false && value !== "") {
        return true;
      }
    }
    return false;
  }
  return true;
}

/** Parse a port option. Returns undefined when missing or unparseable. */
function parsePort(port: number | string | undefined): number | undefined {
  if (port === undefined) return undefined;
  if (typeof port === "number") {
    return Number.isFinite(port) ? port : undefined;
  }
  const trimmed = port.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Run the production-readiness checks against gateway options. */
export function checkGateway(opts: CheckGatewayOptions): ProductionReport {
  const checks: ProductionCheck[] = [];
  const host = opts.host;
  const loopback = isLoopbackHost(host);
  const allowedHosts = Array.isArray(opts.allowedHosts) ? opts.allowedHosts.filter((h) => typeof h === "string" && h.trim().length > 0) : [];
  const hasAllowedHosts = allowedHosts.length > 0;

  // 1. Non-loopback host without an explicit allow-list exposes the gateway.
  if (!loopback && !hasAllowedHosts) {
    checks.push({
      id: "gateway-host-exposed",
      severity: "error",
      message: `Gateway host "${host}" is not loopback and no allowedHosts are configured; the gateway may be exposed to the internet.`,
      fix: "Bind to 127.0.0.1/localhost, or set allowedHosts to the exact Host header values you expect."
    });
  }

  // 2. Plain HTTP on a non-loopback host sends traffic in cleartext.
  if (opts.http === true && !loopback) {
    checks.push({
      id: "gateway-http-nonloopback",
      severity: "error",
      message: `Plain HTTP is enabled on non-loopback host "${host}"; credentials and payloads travel in cleartext.`,
      fix: "Terminate TLS in front of the gateway (reverse proxy or load balancer) or bind to a loopback host."
    });
  }

  // 3. Without readOnly or an explicit policy, write operations are exposed by default.
  if (opts.readOnly !== true && !hasPolicy(opts.policy)) {
    checks.push({
      id: "gateway-write-ops-default",
      severity: "warning",
      message: "Neither readOnly mode nor a policy is configured; write operations are exposed by default.",
      fix: "Set readOnly: true, or provide an explicit policy restricting which operations may run."
    });
  }

  // 4. Without any auth (apiKey / jwt / oauth), the gateway is unauthenticated.
  if (!hasAuth(opts.auth)) {
    checks.push({
      id: "gateway-unauthenticated",
      severity: "warning",
      message: "No auth is configured (no apiKey/jwt/oauth); anyone who can reach the gateway can call it.",
      fix: "Configure gateway auth, e.g. { apiKey: \"...\" }, { jwtSecret: \"...\" } or an oauth/openid configuration."
    });
  }

  // 5. Missing port: informational only (no privileged-port or root checks).
  const port = parsePort(opts.port);
  if (port === undefined) {
    checks.push({
      id: "gateway-port-missing",
      severity: "info",
      message: "No port configured; the gateway will rely on the runtime default port.",
      fix: "Set an explicit port (e.g. 8080) so the deployment is deterministic."
    });
  }

  const errors = checks.filter((c) => c.severity === "error").length;
  const warnings = checks.filter((c) => c.severity === "warning").length;
  const infos = checks.filter((c) => c.severity === "info").length;

  return {
    ok: errors === 0,
    checks,
    summary: { errors, warnings, infos }
  };
}

/** Format a report as grouped, human-readable text (errors, warnings, infos). */
export function formatProductionReport(report: ProductionReport): string {
  const { errors, warnings, infos } = report.summary;
  const lines: string[] = [];
  lines.push(
    `Production check: ${report.ok ? "OK" : "FAILED"} (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, ${infos} info${infos === 1 ? "" : "s"})`
  );

  const groups: Array<{ label: string; severity: ProductionCheck["severity"] }> = [
    { label: "Errors", severity: "error" },
    { label: "Warnings", severity: "warning" },
    { label: "Infos", severity: "info" }
  ];

  let any = false;
  for (const group of groups) {
    const matches = report.checks.filter((c) => c.severity === group.severity);
    if (matches.length === 0) continue;
    any = true;
    lines.push("");
    lines.push(`${group.label}:`);
    for (const check of matches) {
      lines.push(`  - [${check.id}] ${check.message}`);
      if (check.fix) lines.push(`    fix: ${check.fix}`);
    }
  }

  if (!any) {
    lines.push("");
    lines.push("No issues found.");
  }

  return lines.join("\n");
}

/** True iff the report contains no error-severity checks. */
export function isProductionOk(report: ProductionReport): boolean {
  return !report.checks.some((c) => c.severity === "error");
}
