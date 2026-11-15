/**
 * Call/byte budget tracking for MCP tool invocations.
 *
 * A budget caps how many calls a tracker may make and/or how many bytes
 * may flow through it. Everything here is dependency-free.
 */

export interface BudgetConfig {
  maxCalls?: number;
  maxBytes?: number;
}

function isValidLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Validate unknown (e.g. parsed JSON) input as a BudgetConfig.
 * Returns a normalized config containing only the known keys, or
 * undefined when the input is not an object or a present limit is
 * not a finite, non-negative number.
 */
export function parseBudget(json: unknown): BudgetConfig | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return undefined;
  }
  const input = json as Record<string, unknown>;
  const out: BudgetConfig = {};
  if (input.maxCalls !== undefined) {
    if (!isValidLimit(input.maxCalls)) return undefined;
    out.maxCalls = input.maxCalls;
  }
  if (input.maxBytes !== undefined) {
    if (!isValidLimit(input.maxBytes)) return undefined;
    out.maxBytes = input.maxBytes;
  }
  return out;
}

export class BudgetTracker {
  private readonly cfg: BudgetConfig;
  private _calls = 0;
  private _bytes = 0;

  constructor(cfg?: BudgetConfig) {
    this.cfg = cfg ?? {};
  }

  canCall(): boolean {
    if (this.cfg.maxCalls !== undefined && this._calls >= this.cfg.maxCalls) {
      return false;
    }
    if (this.cfg.maxBytes !== undefined && this._bytes >= this.cfg.maxBytes) {
      return false;
    }
    return true;
  }

  recordCall(bytes?: number): void {
    this._calls += 1;
    this._bytes += bytes ?? 0;
  }

  remaining(): {
    maxCalls: number | undefined;
    calls: number;
    bytes: number;
    maxBytes: number | undefined;
  } {
    return {
      maxCalls: this.cfg.maxCalls,
      calls: this._calls,
      bytes: this._bytes,
      maxBytes: this.cfg.maxBytes,
    };
  }

  get exhausted(): boolean {
    return !this.canCall();
  }
}

export function formatBudget(t: BudgetTracker): string {
  const { maxCalls, calls, bytes, maxBytes } = t.remaining();
  const callLimit = maxCalls === undefined ? "unlimited" : String(maxCalls);
  const byteLimit = maxBytes === undefined ? "unlimited" : String(maxBytes);
  return `Budget: calls ${calls}/${callLimit}, bytes ${bytes}/${byteLimit}`;
}
