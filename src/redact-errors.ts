/**
 * Helpers for turning upstream HTTP failures into readable, secret-safe error
 * blocks. Dependency-free (node builtins only).
 */

import { STATUS_CODES } from "node:http";

export interface EnrichedError {
  text: string;
  status?: number;
  requestId?: string;
  retryAfter?: string;
}

/** Candidate request-id header names, in priority order. */
const REQUEST_ID_HEADERS: readonly string[] = [
  "x-request-id",
  "x-correlation-id",
  "x-amz-request-id",
  "request-id",
  "cf-ray"
];

const RETRY_AFTER_HEADER = "retry-after";

/** Case-insensitive header lookup; returns the first match. */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue;
    if (key.toLowerCase() === target) {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }
  return undefined;
}

/** Extract a request/correlation id from common upstream headers. */
export function extractRequestId(headers: Record<string, string>): string | undefined {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headerValue(headers, name);
    if (value) return value;
  }
  return undefined;
}

/** Extract the Retry-After header value, if present. */
export function extractRetryAfter(headers: Record<string, string>): string | undefined {
  return headerValue(headers, RETRY_AFTER_HEADER);
}

// Bearer token: "Bearer" followed by a non-space token.
const BEARER_RE = /Bearer[ \t]+[^\s"',;]+/gi;
// Long hex strings (>= 24 chars), e.g. API keys and hashes.
const HEX_RE = /(?<![A-Za-z0-9_])[A-Fa-f0-9]{24,}(?![A-Za-z0-9_])/g;
// Common API-key-ish prefixes (sk-..., pk-..., xoxb-..., ghp_..., etc.).
const API_KEY_RE = /(?<![A-Za-z0-9_-])(?:sk|pk|rk|ak|xox[abprs]|gh[pousr])[-_][A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g;
// JSON values whose key contains token/secret/key/authorization: "key":"value"
const JSON_SECRET_RE = /("(?:[^"\\]|\\.)*(?:token|secret|key|authorization)(?:[^"\\]|\\.)*"\s*:\s*")[^"]*(")/gi;

/**
 * Replace secrets in free-form text with "[REDACTED]".
 *
 * Covers:
 *  - `Bearer <token>` authorization headers
 *  - strings that look like API keys (common prefixes) or long hex (>= 24 chars)
 *  - JSON string values whose key contains token/secret/key/authorization
 */
export function redactSecrets(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  out = out.replace(JSON_SECRET_RE, "$1[REDACTED]$2");
  out = out.replace(BEARER_RE, "[REDACTED]");
  out = out.replace(API_KEY_RE, "[REDACTED]");
  out = out.replace(HEX_RE, "[REDACTED]");
  return out;
}

const MAX_BODY_CHARS = 2000;

/**
 * Build a readable, secret-safe error block for an upstream HTTP failure.
 * Redaction is applied by default; pass `{ redact: false }` to disable it.
 */
export function formatUpstreamError(
  status: number,
  body: string | undefined,
  headers: Record<string, string>,
  opts?: { redact?: boolean }
): EnrichedError {
  const shouldRedact = opts?.redact !== false;
  const safeHeaders = headers ?? {};
  const statusText = STATUS_CODES[status] ?? "Unknown Status";
  const contentType = headerValue(safeHeaders, "content-type");
  const requestId = extractRequestId(safeHeaders);
  const retryAfter = extractRetryAfter(safeHeaders);

  const lines: string[] = [`HTTP ${status} ${statusText}`];
  if (contentType) lines.push(`Content-Type: ${contentType}`);
  if (requestId) lines.push(`Request-Id: ${requestId}`);
  if (retryAfter) lines.push(`Retry-After: ${retryAfter}`);

  if (body !== undefined) {
    // Redact before truncating so a secret cannot leak across the cut point.
    let rendered = shouldRedact ? redactSecrets(body) : body;
    if (rendered.length > MAX_BODY_CHARS) {
      rendered = `${rendered.slice(0, MAX_BODY_CHARS)}\n...[truncated ${rendered.length - MAX_BODY_CHARS} chars]`;
    }
    lines.push("Body:", rendered);
  }

  const error: EnrichedError = { text: lines.join("\n"), status };
  if (requestId) error.requestId = requestId;
  if (retryAfter) error.retryAfter = retryAfter;
  return error;
}
