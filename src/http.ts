import type { ToolDef } from "./types.js";
import { filterFields } from "./filter.js";
import { checkRequest, type Policy } from "./policy.js";
import { recordToolCall } from "./telemetry.js";
import { redact } from "./redact.js";
import { summarizeJson, type SummarizeOptions } from "./summarize.js";
import { cacheKey, type DiskCache } from "./cache.js";
import type { RateLimiter, CircuitBreaker } from "./ratelimit.js";
import type { AuditLog } from "./audit.js";

export interface RequestOptions {
  /** Base URL override. When omitted, each tool uses its own spec's base URL. */
  baseUrl?: string;
  /** Extra headers sent with every request (auth, etc.). */
  headers: Record<string, string>;
  timeoutMs: number;
  /** Maximum number of response characters returned to the model. */
  maxBytes: number;
  /** Optional response field allowlist (dotted paths allowed). */
  fields?: string[];
  /** Number of retries for network errors and 429/5xx responses. Default 0. */
  retries?: number;
  /** Base backoff delay in milliseconds. Default 300. */
  retryDelayMs?: number;
  /** Cache GET/HEAD responses for this many milliseconds (in-memory). Default 0 (off). */
  cacheTtlMs?: number;
  /** Optional persistent cache used instead of (and before) the in-memory cache. */
  diskCache?: DiskCache;
  /** Follow pagination links and merge pages. Default false. */
  paginate?: boolean;
  /** Maximum pages to fetch when paginating. Default 5. */
  maxPages?: number;
  /** Policy enforced at call time (method + outbound host allowlists). */
  policy?: Policy;
  /** Redact secrets/PII from responses. */
  redact?: boolean;
  /** Summarize large responses (array/depth/string/keys caps). */
  summarize?: SummarizeOptions;
  /** Client-side rate limiter (token bucket). */
  rateLimiter?: RateLimiter;
  /** Circuit breaker for the upstream API. */
  breaker?: CircuitBreaker;
  /** Audit log sink. */
  audit?: AuditLog;
}

export interface ApiResult {
  text: string;
  isError: boolean;
}

interface CacheEntry {
  expires: number;
  raw: string;
  status: number;
  statusText: string;
  link: string | null;
}

const cache = new Map<string, CacheEntry>();

export function clearCache(): void {
  cache.clear();
}

export function callApi(tool: ToolDef, args: Record<string, any>, opts: RequestOptions): Promise<ApiResult> {
  return recordToolCall(tool.name, tool.method.toUpperCase(), () => callApiInner(tool, args, opts));
}

async function callApiInner(tool: ToolDef, args: Record<string, any>, opts: RequestOptions): Promise<ApiResult> {
  const started = Date.now();
  const base = (opts.baseUrl || tool.baseUrl || "").replace(/\/+$/, "");
  const method = tool.method.toUpperCase();
  const isSafe = method === "GET" || method === "HEAD";

  let path = tool.path;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(tool.security.query)) query.append(key, value);

  const headers: Record<string, string> = { accept: "application/json", ...tool.security.headers, ...opts.headers };
  const body: Record<string, any> = {};
  let bodyValue: any;
  let hasBody = false;

  for (const param of tool.params) {
    const value = args[param.argName];
    if (value === undefined || value === null) continue;

    if (param.location === "path") {
      path = path.replace(`{${param.origName}}`, encodeURIComponent(String(value)));
    } else if (param.location === "query") {
      if (Array.isArray(value)) for (const item of value) query.append(param.origName!, String(item));
      else query.append(param.origName!, String(value));
    } else {
      hasBody = true;
      if (tool.bodyObject) body[param.origName!] = value;
      else bodyValue = value;
    }
  }

  const qs = query.toString();
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;

  const finish = (result: ApiResult, status?: number, reason?: string): ApiResult => {
    opts.audit?.write({
      time: new Date().toISOString(),
      tool: tool.name,
      method,
      url,
      status,
      ok: !result.isError,
      durationMs: Date.now() - started,
      reason
    });
    return result;
  };

  if (opts.policy) {
    const reason = checkRequest(opts.policy, tool, url);
    if (reason) return finish({ text: `Blocked by policy: ${reason}`, isError: true }, undefined, reason);
  }

  if (hasBody) headers["content-type"] = headers["content-type"] ?? "application/json";
  const payload = hasBody ? JSON.stringify(tool.bodyObject ? body : bodyValue) : undefined;
  const memKey = `${method} ${url} ${payload ?? ""}`;
  const diskKey = cacheKey(method, url, payload);
  const useCache = isSafe && (opts.cacheTtlMs ?? 0) > 0;

  const maxPages = opts.paginate ? Math.max(1, opts.maxPages ?? 5) : 1;
  const bodies: string[] = [];
  const parsed: any[] = [];
  let currentUrl = url;
  let lastStatus = 0;
  let lastStatusText = "";

  for (let page = 0; page < maxPages; page++) {
    const canCache = useCache && page === 0;
    let raw: string;
    let link: string | null;

    const memHit = canCache ? cache.get(memKey) : undefined;
    const diskHit = canCache && !memHit && opts.diskCache ? opts.diskCache.get(diskKey) : undefined;

    if (memHit && memHit.expires > Date.now()) {
      raw = memHit.raw;
      lastStatus = memHit.status;
      lastStatusText = memHit.statusText;
      link = memHit.link;
    } else if (diskHit) {
      const entry = JSON.parse(diskHit.value) as CacheEntry;
      raw = entry.raw;
      lastStatus = entry.status;
      lastStatusText = entry.statusText;
      link = entry.link;
    } else {
      if (opts.breaker && !opts.breaker.canRequest()) {
        return finish({ text: "Blocked by circuit breaker: upstream marked unhealthy", isError: true }, undefined, "circuit-open");
      }
      if (opts.rateLimiter) await opts.rateLimiter.acquire();

      const res = await fetchWithRetry(currentUrl, { method, headers, body: payload }, opts);
      raw = await res.text();
      lastStatus = res.status;
      lastStatusText = res.statusText;
      link = res.headers.get("link");

      if (res.status >= 500 || res.status === 429) opts.breaker?.onFailure();
      else opts.breaker?.onSuccess();

      if (canCache && res.ok) {
        const entry: CacheEntry = { expires: Date.now() + (opts.cacheTtlMs ?? 0), raw, status: res.status, statusText: res.statusText, link };
        cache.set(memKey, entry);
        opts.diskCache?.set(diskKey, JSON.stringify(entry), opts.cacheTtlMs ?? 0);
      }
    }

    bodies.push(raw);
    if (opts.paginate && lastStatus < 400) {
      try {
        parsed.push(JSON.parse(raw));
      } catch {
        parsed.push(undefined);
      }
    }

    const next = opts.paginate && lastStatus < 400 ? findNext(currentUrl, raw, link) : null;
    if (!next) break;
    currentUrl = next;
  }

  let rendered: string;
  if (opts.paginate && parsed.some((p) => p !== undefined)) {
    let data = collectPages(parsed.filter((p) => p !== undefined));
    if (opts.fields && opts.fields.length) data = filterFields(data, opts.fields);
    rendered = JSON.stringify(data, null, 2);
  } else {
    rendered = renderBody(bodies[0] ?? "", opts.fields);
  }

  if (opts.summarize || opts.redact) {
    try {
      let data: any = JSON.parse(rendered);
      if (opts.summarize) data = summarizeJson(data, opts.summarize);
      if (opts.redact) data = redact(data);
      rendered = JSON.stringify(data, null, 2);
    } catch {
      /* non-JSON body: leave as-is */
    }
  }

  rendered = truncate(rendered, opts.maxBytes);

  const pageNote = bodies.length > 1 ? `  (${bodies.length} pages)` : "";
  const text = [`${method} ${url}`, `HTTP ${lastStatus} ${lastStatusText}`.trimEnd() + pageNote, "", rendered].join("\n");

  return finish({ text, isError: lastStatus >= 400 }, lastStatus);
}

async function fetchWithRetry(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  opts: RequestOptions
): Promise<Response> {
  const retries = Math.max(0, opts.retries ?? 0);
  const baseDelay = opts.retryDelayMs ?? 300;
  let attempt = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelay * 2 ** attempt);
        attempt++;
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(baseDelay * 2 ** attempt);
      attempt++;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Find a next-page URL from a Link header or common pagination fields. Best-effort. */
function findNext(currentUrl: string, raw: string, link: string | null): string | null {
  if (link) {
    const match = link.match(/<([^>]+)>\s*;\s*[^,]*rel\s*=\s*"?next"?/i);
    if (match) return absolute(match[1], currentUrl);
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const candidates = [
    data?.next,
    data?.nextPage,
    data?.next_page,
    data?.nextLink,
    data?.next_link,
    data?.links?.next,
    data?.paging?.next,
    data?.meta?.next,
    data?.meta?.next_page,
    data?.pagination?.next
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && looksLikeUrl(candidate)) {
      const next = absolute(candidate, currentUrl);
      if (next !== currentUrl) return next;
    }
  }
  return null;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("?");
}

function absolute(value: string, base: string): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function collectPages(pages: any[]): any {
  if (pages.length === 0) return null;
  if (pages.every(Array.isArray)) return pages.flat();
  const first = pages[0];
  if (first && typeof first === "object") {
    const out: Record<string, any> = { ...first };
    for (const key of ["data", "items", "results", "value", "records", "rows"]) {
      if (Array.isArray(first[key])) out[key] = pages.flatMap((page) => (Array.isArray(page?.[key]) ? page[key] : []));
    }
    return out;
  }
  return first;
}

/** Parse JSON, apply the field allowlist, and pretty-print. Non-JSON is returned as-is. */
export function renderBody(raw: string, fields?: string[]): string {
  if (!raw) return "(empty body)";
  try {
    let data: any = JSON.parse(raw);
    if (fields && fields.length) data = filterFields(data, fields);
    return JSON.stringify(data, null, 2);
  } catch {
    return raw;
  }
}

function truncate(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  return `${value.slice(0, maxBytes)}\n... [truncated, ${value.length} bytes total]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
