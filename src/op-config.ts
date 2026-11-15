/**
 * Per-operation runtime configuration, sourced from OpenAPI
 * `x-openapimcp` extension values on an operation object.
 *
 * Everything here is dependency-free. Invalid values are ignored so a
 * malformed extension can never break spec loading.
 */

export interface OpConfig {
  timeoutMs?: number;
  retries?: number;
  maxResponseBytes?: number;
  budgetBytes?: number;
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseByteCount(value: unknown): number | undefined {
  if (isNonNegativeFiniteNumber(value)) return Math.floor(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
  }
  return undefined;
}

function parseRetries(value: unknown): number | undefined {
  const n = parseByteCount(value);
  if (n === undefined) return undefined;
  return Math.floor(n);
}

/**
 * Parse a timeout value into milliseconds.
 * Numbers are treated as milliseconds. Strings accept a "ms" or "s"
 * suffix ("500ms", "10s"); a bare numeric string is treated as
 * milliseconds, matching the numeric form. Invalid values return
 * undefined.
 */
function parseTimeoutMs(value: unknown): number | undefined {
  if (isNonNegativeFiniteNumber(value)) return Math.floor(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(trimmed);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const unit = match[2] ?? "ms";
  return Math.floor(unit === "s" ? n * 1000 : n);
}

function firstDefined(
  source: Record<string, any>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

/**
 * Normalize raw x-openapimcp extension overrides into an OpConfig.
 * Recognized keys (first one wins):
 *   timeout:         x-timeout / x-timeoutMs / timeoutMs
 *   retries:         x-retries / x-maxRetries / retries / maxRetries
 *   maxResponseBytes: x-maxResponseBytes / maxResponseBytes
 *   budgetBytes:     x-budget / x-budgetBytes / budgetBytes
 * Unrecognized keys are dropped and invalid values are ignored.
 */
export function parseOpConfig(overrides: Record<string, any>): OpConfig {
  const out: OpConfig = {};
  if (!isRecord(overrides)) return out;

  const timeout = parseTimeoutMs(
    firstDefined(overrides, ["x-timeout", "x-timeoutMs", "timeoutMs", "x-timeout-ms"]),
  );
  if (timeout !== undefined) out.timeoutMs = timeout;

  const retries = parseRetries(
    firstDefined(overrides, ["x-retries", "x-maxRetries", "retries", "maxRetries"]),
  );
  if (retries !== undefined) out.retries = retries;

  const maxResponseBytes = parseByteCount(
    firstDefined(overrides, ["x-maxResponseBytes", "maxResponseBytes"]),
  );
  if (maxResponseBytes !== undefined) out.maxResponseBytes = maxResponseBytes;

  const budgetBytes = parseByteCount(
    firstDefined(overrides, ["x-budget", "x-budgetBytes", "budgetBytes", "x-budget-bytes"]),
  );
  if (budgetBytes !== undefined) out.budgetBytes = budgetBytes;

  return out;
}

/**
 * Build the OpConfig for an operation from its `x-openapimcp` extension.
 * `method` and `path` are accepted for call-site context and future
 * path-scoped defaults; the config itself is op-level only.
 */
export function opConfigFor(op: any, method: string, path: string): OpConfig {
  void method;
  void path;
  if (!isRecord(op)) return {};
  const ext = op["x-openapimcp"];
  if (!isRecord(ext)) return {};
  return parseOpConfig(ext);
}

/**
 * Retries for this operation. An explicit config value always wins.
 * Idempotent methods (GET/HEAD/PUT/DELETE) fall back to the global
 * default; other methods (POST/PATCH/...) default to 0 to avoid
 * duplicating non-idempotent requests.
 */
export function resolveRetries(
  config: OpConfig | undefined,
  method: string,
  globalRetries: number,
): number {
  if (config?.retries !== undefined && Number.isFinite(config.retries)) {
    return Math.max(0, Math.floor(config.retries));
  }
  return IDEMPOTENT_METHODS.has(method.toUpperCase()) ? globalRetries : 0;
}

/** Timeout in milliseconds for this operation: config wins, then global. */
export function resolveTimeoutMs(
  config: OpConfig | undefined,
  globalTimeoutMs: number,
): number {
  if (config?.timeoutMs !== undefined && Number.isFinite(config.timeoutMs) && config.timeoutMs >= 0) {
    return config.timeoutMs;
  }
  return globalTimeoutMs;
}

/** Human-readable one-line summary of an OpConfig. */
export function formatOpConfig(config: OpConfig): string {
  const parts: string[] = [];
  parts.push(
    config.timeoutMs === undefined ? "timeout=default" : `timeout=${config.timeoutMs}ms`,
  );
  parts.push(config.retries === undefined ? "retries=default" : `retries=${config.retries}`);
  if (config.maxResponseBytes !== undefined) {
    parts.push(`maxResponseBytes=${config.maxResponseBytes}`);
  }
  if (config.budgetBytes !== undefined) {
    parts.push(`budgetBytes=${config.budgetBytes}`);
  }
  return `OpConfig: ${parts.join(", ")}`;
}
