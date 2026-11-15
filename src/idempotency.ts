import { randomBytes } from "node:crypto";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export function generateIdempotencyKey(prefix?: string): string {
  const key = randomBytes(16).toString("hex");
  return prefix ? `${prefix}-${key}` : key;
}

export function isIdempotencyHeader(name: string): boolean {
  return name.trim().toLowerCase() === "idempotency-key";
}

const IDEMPOTENT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function withIdempotency(
  headers: Record<string, string>,
  key?: string,
  opts?: { onlySafe?: boolean; method?: string }
): Record<string, string> {
  const next = { ...headers };
  if (opts?.onlySafe) {
    const method = opts.method?.trim().toUpperCase();
    if (!method || !IDEMPOTENT_METHODS.has(method)) {
      return next;
    }
  }
  next[IDEMPOTENCY_HEADER] = key ?? generateIdempotencyKey();
  return next;
}

export function resolveIdempotencyKey(
  args: Record<string, unknown>,
  explicitKey?: string
): string | undefined {
  const fromArgs = args["_idempotencyKey"];
  if (typeof fromArgs === "string") return fromArgs;
  if (explicitKey) return explicitKey;
  return generateIdempotencyKey();
}

export function stripIdempotencyArg(
  args: Record<string, unknown>
): Record<string, unknown> {
  const { _idempotencyKey: _ignored, ...rest } = args;
  return rest;
}
