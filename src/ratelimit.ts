/**
 * Dependency-free rate limiting and circuit breaking primitives.
 *
 * Both classes accept injectable clocks so they can be driven deterministically
 * from tests without sleeping.
 */

export interface RateLimiterOptions {
  /** Sustained refill rate in tokens per second. */
  ratePerSecond: number;
  /** Maximum tokens held (defaults to a full second's worth of tokens). */
  burst?: number;
}

/** Classic token bucket: refills continuously, rejects when empty. */
export class RateLimiter {
  private readonly ratePerSecond: number;
  private readonly burst: number;
  private tokens: number;
  private last: number | null = null;

  constructor(opts: RateLimiterOptions) {
    this.ratePerSecond = Math.max(0, opts.ratePerSecond);
    this.burst = Math.max(1, Math.floor(opts.burst ?? Math.max(1, Math.ceil(opts.ratePerSecond))));
    this.tokens = this.burst;
  }

  /** Consume a token if one is available, returning whether it succeeded. */
  tryAcquire(now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Wait until a token is available, then consume it. */
  async acquire(now?: number): Promise<void> {
    if (this.tryAcquire(now)) return;
    for (;;) {
      const t = Date.now();
      this.refill(t);
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const rate = this.ratePerSecond > 0 ? this.ratePerSecond : 1;
      const waitMs = Math.max(1, Math.ceil((deficit / rate) * 1000));
      await delay(waitMs);
    }
  }

  private refill(now: number): void {
    if (this.last === null) {
      this.last = now;
      return;
    }
    const elapsed = now - this.last;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.ratePerSecond);
    this.last = now;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures before opening (default 5). */
  threshold?: number;
  /** Time to stay open before allowing a probe (default 30000ms). */
  cooldownMs?: number;
  /** Injectable clock, defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Consecutive-failure circuit breaker.
 *
 * - `closed`: requests flow.
 * - `open`: requests are rejected for `cooldownMs`.
 * - `half-open`: exactly one probe is allowed; success closes, failure reopens.
 */
export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly clock: () => number;
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpen = false;
  private probing = false;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = Math.max(1, opts.threshold ?? 5);
    this.cooldownMs = Math.max(0, opts.cooldownMs ?? 30000);
    this.clock = opts.now ?? Date.now;
  }

  /** Whether a request may proceed right now. Allows a single half-open probe. */
  canRequest(): boolean {
    if (this.openedAt === null) return true;
    if (!this.halfOpen && this.clock() - this.openedAt >= this.cooldownMs) {
      this.halfOpen = true;
    }
    if (this.halfOpen) {
      if (this.probing) return false;
      this.probing = true;
      return true;
    }
    return false;
  }

  /** Record success: reset failures and close the breaker. */
  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpen = false;
    this.probing = false;
  }

  /** Record failure: count toward opening, or reopen from half-open. */
  onFailure(): void {
    if (this.halfOpen) {
      this.failures = this.threshold;
      this.openedAt = this.clock();
      this.halfOpen = false;
      this.probing = false;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAt = this.clock();
    }
  }

  /** Current state, computed from the injected clock without mutating it. */
  state(): CircuitState {
    if (this.openedAt === null) return "closed";
    if (this.halfOpen) return "half-open";
    if (this.clock() - this.openedAt >= this.cooldownMs) return "half-open";
    return "open";
  }
}
