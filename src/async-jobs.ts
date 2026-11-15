// Async-job polling utilities: detect 202 Accepted responses, locate the
// status URL to poll, interpret poll responses, and wait for completion.
// Dependency-free (node builtins only).

export interface AsyncJobConfig {
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

export interface JobPollResult {
  done: boolean;
  result?: unknown;
  error?: string;
  state?: string;
}

const TERMINAL_STATES = new Set(["completed", "succeeded", "done", "success", "failed", "error"]);
const ERROR_STATES = new Set(["failed", "error"]);

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_WAIT_MS = 60000;

export function isAsyncAccepted(status: number): boolean {
  return status === 202;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function toAbsoluteUrl(candidate: unknown, baseUrl: string): string | undefined {
  if (typeof candidate !== "string" || !candidate.trim()) return undefined;
  try {
    return new URL(candidate.trim(), baseUrl).toString();
  } catch {
    return undefined;
  }
}

function looksLikeUrl(value: string): boolean {
  const v = value.trim();
  if (v.startsWith("/") || v.startsWith("./") || v.startsWith("../")) return true;
  // scheme:... (e.g. https://, http://)
  return /^[a-z][a-z0-9+.-]*:/i.test(v);
}

export function findStatusUrl(
  body: any,
  headers: Record<string, string>,
  baseUrl: string
): string | undefined {
  // 1) Headers: Location, then X-Location.
  const fromHeader = headerValue(headers, "location") ?? headerValue(headers, "x-location");
  if (fromHeader) {
    const abs = toAbsoluteUrl(fromHeader, baseUrl);
    if (abs) return abs;
  }

  const b = body && typeof body === "object" ? body : undefined;
  if (!b) return undefined;

  // 2) Body: location, then statusUrl.
  for (const key of ["location", "statusUrl"] as const) {
    const abs = toAbsoluteUrl(b[key], baseUrl);
    if (abs) return abs;
  }

  // 3) Body: jobId -> <baseUrl>/jobs/<jobId> (only when no location was found).
  if (b.jobId !== undefined && b.jobId !== null && String(b.jobId).trim() !== "") {
    const base = String(baseUrl).replace(/\/+$/, "");
    const abs = toAbsoluteUrl(`${base}/jobs/${String(b.jobId).trim()}`, baseUrl);
    if (abs) return abs;
  }

  // 4) Body: links.status.
  const links = b.links;
  if (links && typeof links === "object") {
    const abs = toAbsoluteUrl(links.status, baseUrl);
    if (abs) return abs;
  }

  // 5) Body: status — only when it looks like a URL/path, not a state word.
  if (typeof b.status === "string" && looksLikeUrl(b.status)) {
    const abs = toAbsoluteUrl(b.status, baseUrl);
    if (abs) return abs;
  }

  return undefined;
}

function extractState(body: any): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw =
    typeof body.state === "string"
      ? body.state
      : typeof body.status === "string"
        ? body.status
        : undefined;
  return raw?.trim().toLowerCase() || undefined;
}

function extractErrorMessage(body: any): string {
  if (!body || typeof body !== "object") return "Job failed";
  const e = body.error;
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object" && typeof e.message === "string" && e.message.trim()) {
    return e.message;
  }
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return "Job failed";
}

function extractResult(body: any): unknown {
  if (body && typeof body === "object") {
    if (body.result !== undefined) return body.result;
    if (body.output !== undefined) return body.output;
    if (body.data !== undefined) return body.data;
  }
  // No payload field: the body itself is the result.
  return body;
}

export function parseJobResult(body: any): JobPollResult {
  const state = extractState(body);

  if (state && TERMINAL_STATES.has(state)) {
    if (ERROR_STATES.has(state)) {
      return { done: true, error: extractErrorMessage(body), state, result: extractResult(body) };
    }
    return { done: true, result: extractResult(body), state };
  }

  if (state) {
    // Known shape, non-terminal state (e.g. "pending", "running").
    return { done: false, state };
  }

  // No status/state field: treat as a final response unless a jobId is present.
  const hasJobId =
    body && typeof body === "object" && body.jobId !== undefined && body.jobId !== null;
  if (!hasJobId) {
    return { done: true, result: extractResult(body) };
  }

  return { done: false };
}

export function buildAsyncConfig(opts: Partial<AsyncJobConfig>): Required<AsyncJobConfig> {
  return {
    pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    maxWaitMs: opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntilDone<T>(
  fetchStatus: (url: string) => Promise<{ status: number; body: T }>,
  statusUrl: string,
  opts?: AsyncJobConfig
): Promise<{ done: boolean; result?: T; error?: string; timedOut: boolean }> {
  const { pollIntervalMs, maxWaitMs } = buildAsyncConfig(opts ?? {});
  const start = Date.now();

  for (;;) {
    const { body } = await fetchStatus(statusUrl);
    const parsed = parseJobResult(body);

    if (parsed.done) {
      return {
        done: true,
        result: parsed.result as T | undefined,
        error: parsed.error,
        timedOut: false,
      };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= maxWaitMs) {
      return { done: false, timedOut: true };
    }

    await sleep(Math.min(pollIntervalMs, Math.max(0, maxWaitMs - elapsed)));
  }
}
