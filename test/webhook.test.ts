import { test } from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifySignature, buildWebhookRequest, shouldTrigger } from "../src/webhook.js";
import type { WebhookConfig, WebhookPayload } from "../src/webhook.js";

test("signPayload/verifySignature round-trips", () => {
  const payload = JSON.stringify({ hello: "world" });
  const secret = "super-secret";
  const sig = signPayload(payload, secret);
  assert.equal(typeof sig, "string");
  assert.equal(sig.length, 64);
  assert.ok(verifySignature(payload, sig, secret));
});

test("verifySignature fails with wrong secret", () => {
  const payload = "payload-body";
  const sig = signPayload(payload, "secret-a");
  assert.equal(verifySignature(payload, sig, "secret-b"), false);
});

test("verifySignature fails on tampered payload", () => {
  const sig = signPayload("original", "secret");
  assert.equal(verifySignature("tampered", sig, "secret"), false);
});

test("buildWebhookRequest includes headers", () => {
  const config: WebhookConfig = {
    url: "https://example.com/hook",
    events: ["user.created"],
    secret: "shh",
    headers: { "X-Custom": "value", "X-Trace": "t1" }
  };
  const payload: WebhookPayload = { event: "user.created", timestamp: "2026-01-01T00:00:00Z", data: { id: 1 } };
  const req = buildWebhookRequest(config, payload);
  assert.equal(req.url, config.url);
  assert.equal(req.body, JSON.stringify(payload));
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.equal(req.headers["X-Webhook-Event"], payload.event);
  assert.equal(req.headers["X-Custom"], "value");
  assert.equal(req.headers["X-Trace"], "t1");
  assert.equal(req.headers["X-Webhook-Signature"], signPayload(req.body, config.secret!));
});

test("buildWebhookRequest omits signature without secret", () => {
  const config: WebhookConfig = { url: "https://example.com/hook", events: ["e"] };
  const payload: WebhookPayload = { event: "e", timestamp: "t", data: null };
  const req = buildWebhookRequest(config, payload);
  assert.equal(req.headers["X-Webhook-Signature"], undefined);
});

test("shouldTrigger exact match", () => {
  const config: WebhookConfig = { url: "u", events: ["user.created", "order.placed"] };
  assert.equal(shouldTrigger(config, "user.created"), true);
  assert.equal(shouldTrigger(config, "order.placed"), true);
  assert.equal(shouldTrigger(config, "nope"), false);
});

test("shouldTrigger wildcard", () => {
  const config: WebhookConfig = { url: "u", events: ["*"] };
  assert.equal(shouldTrigger(config, "anything"), true);
  assert.equal(shouldTrigger(config, "user.created"), true);
});

test("shouldTrigger unknown event with no wildcard", () => {
  const config: WebhookConfig = { url: "u", events: ["user.created"] };
  assert.equal(shouldTrigger(config, "unknown"), false);
});