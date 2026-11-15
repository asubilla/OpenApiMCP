import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookConfig {
  url: string;
  events: string[];
  secret?: string;
  headers?: Record<string, string>;
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: unknown;
}

export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (typeof payload !== "string" || typeof signature !== "string" || typeof secret !== "string") {
    return false;
  }
  const expected = signPayload(payload, secret);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

export function buildWebhookRequest(
  config: WebhookConfig,
  payload: WebhookPayload
): { url: string; headers: Record<string, string>; body: string } {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": payload.event,
    ...(config.headers ?? {})
  };
  if (config.secret) {
    headers["X-Webhook-Signature"] = signPayload(body, config.secret);
  }
  return { url: config.url, headers, body };
}

function matchEvent(pattern: string, event: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === event;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`).test(event);
  } catch {
    return false;
  }
}

export function shouldTrigger(config: WebhookConfig, event: string): boolean {
  return (config.events ?? []).some((pattern) => matchEvent(pattern, event));
}