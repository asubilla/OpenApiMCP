/**
 * Per-user token bucket rate limiting.
 *
 * Dependency-free. Each user (keyed by an opaque string) gets their own
 * token bucket refilling at their configured per-minute limit. Users not
 * present in `perUser` fall back to `defaultPerMinute`, which itself
 * falls back to 60 requests per minute.
 */

export interface UserRateLimitConfig {
  defaultPerMinute?: number;
  perUser?: Record<string, number>;
}

function isValidLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Validate unknown (e.g. parsed JSON) input as a UserRateLimitConfig.
 * Unknown top-level keys are dropped. `defaultPerMinute` must be a finite
 * positive number; `perUser` must be an object whose values are all finite
 * positive numbers. Returns undefined when the input is not an object or a
 * present value is invalid.
 */
export function parseUserRateLimit(
  json: unknown,
): UserRateLimitConfig | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return undefined;
  }
  const input = json as Record<string, unknown>;
  const out: UserRateLimitConfig = {};
  if (input.defaultPerMinute !== undefined) {
    if (!isValidLimit(input.defaultPerMinute)) return undefined;
    out.defaultPerMinute = input.defaultPerMinute;
  }
  if (input.perUser !== undefined) {
    if (
      typeof input.perUser !== "object" ||
      input.perUser === null ||
      Array.isArray(input.perUser)
    ) {
      return undefined;
    }
    const perUser: Record<string, number> = {};
    for (const [key, value] of Object.entries(
      input.perUser as Record<string, unknown>,
    )) {
      if (!isValidLimit(value)) return undefined;
      perUser[key] = value;
    }
    out.perUser = perUser;
  }
  return out;
}

const DEFAULT_LIMIT = 60;
const WINDOW_MS = 60_000;

interface Bucket {
  tokens: number;
  last: number;
}

export class UserRateLimiter {
  readonly config: UserRateLimitConfig;
  private readonly buckets = new Map<string | undefined, Bucket>();

  constructor(cfg?: UserRateLimitConfig) {
    const out: UserRateLimitConfig = {};
    if (cfg?.defaultPerMinute !== undefined) {
      out.defaultPerMinute = cfg.defaultPerMinute;
    }
    if (cfg?.perUser !== undefined) {
      out.perUser = { ...cfg.perUser };
    }
    this.config = out;
  }

  /** Limit (requests per minute) for a given user key. */
  private limitFor(userKey?: string): number {
    const configured =
      userKey !== undefined ? this.config.perUser?.[userKey] : undefined;
    const candidate = configured ?? this.config.defaultPerMinute;
    return isValidLimit(candidate) ? candidate : DEFAULT_LIMIT;
  }

  private bucketFor(userKey: string | undefined, now: number): Bucket {
    let bucket = this.buckets.get(userKey);
    if (bucket === undefined) {
      bucket = { tokens: this.limitFor(userKey), last: now };
      this.buckets.set(userKey, bucket);
      return bucket;
    }
    const limit = this.limitFor(userKey);
    const elapsed = now - bucket.last;
    if (elapsed > 0) {
      bucket.tokens = Math.min(
        limit,
        bucket.tokens + (elapsed / WINDOW_MS) * limit,
      );
      bucket.last = now;
    }
    // Clamp in case the configured limit shrank since the bucket was created.
    if (bucket.tokens > limit) bucket.tokens = limit;
    return bucket;
  }

  /** Consume a token if one is available for this user; returns success. */
  check(userKey?: string): boolean {
    const now = Date.now();
    const bucket = this.bucketFor(userKey, now);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Tokens remaining in this user's bucket right now (floored, >= 0). */
  remaining(userKey?: string): number {
    const now = Date.now();
    const bucket = this.bucketFor(userKey, now);
    return Math.max(0, Math.floor(bucket.tokens));
  }

  /** Drop all bucket state; every user starts fresh with a full bucket. */
  reset(): void {
    this.buckets.clear();
  }
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | string[] | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/**
 * Derive a user key from HTTP headers. Prefers `x-user-key`, then
 * `x-api-key`, then the last 20 characters of `authorization`.
 * Array-valued headers use their first entry. Returns undefined when no
 * usable header is present.
 */
export function userKeyFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const userKey = firstHeaderValue(getHeader(headers, "x-user-key"));
  if (userKey !== undefined) return userKey;
  const apiKey = firstHeaderValue(getHeader(headers, "x-api-key"));
  if (apiKey !== undefined) return apiKey;
  const authorization = firstHeaderValue(getHeader(headers, "authorization"));
  if (authorization !== undefined) {
    return authorization.slice(-20);
  }
  return undefined;
}

/** Human-readable summary, e.g. `user: alice — 47/60 remaining (this minute)`. */
export function formatUserRateLimit(
  l: UserRateLimiter,
  userKey?: string,
): string {
  const limit =
    (userKey !== undefined ? l.config.perUser?.[userKey] : undefined) ??
    l.config.defaultPerMinute ??
    DEFAULT_LIMIT;
  const label = userKey ?? "default";
  return `user: ${label} — ${l.remaining(userKey)}/${limit} remaining (this minute)`;
}
