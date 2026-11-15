import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSamplingRequest,
  validateSamplingRequest,
  formatSamplingRequest,
} from "../src/sampling.js";

test("buildSamplingRequest produces a valid request", () => {
  const req = buildSamplingRequest({ prompt: "hello", systemPrompt: "sys", maxTokens: 10, temperature: 0.5, model: "gpt-4" });
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, "user");
  assert.equal(req.messages[0].content.type, "text");
  assert.equal(req.messages[0].content.text, "hello");
  assert.equal(req.systemPrompt, "sys");
  assert.equal(req.maxTokens, 10);
  assert.equal(req.temperature, 0.5);
  assert.deepEqual(req.modelPreferences, { hints: [{ name: "gpt-4" }] });
  const v = validateSamplingRequest(req);
  assert.equal(v.valid, true);
  assert.deepEqual(v.errors, []);
});

test("validateSamplingRequest success for minimal request", () => {
  const req = buildSamplingRequest({ prompt: "p" });
  const v = validateSamplingRequest(req);
  assert.equal(v.valid, true);
});

test("validateSamplingRequest failures", () => {
  const empty = validateSamplingRequest({ messages: [] } as any);
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.length > 0);

  const badRole = validateSamplingRequest({ messages: [{ role: "x", content: { type: "text", text: "t" } }] } as any);
  assert.equal(badRole.valid, false);

  const missingContent = validateSamplingRequest({ messages: [{ role: "user" }] } as any);
  assert.equal(missingContent.valid, false);

  const badTokens = validateSamplingRequest({ messages: [{ role: "user", content: { type: "text", text: "t" } }], maxTokens: 0 } as any);
  assert.equal(badTokens.valid, false);

  const negTokens = validateSamplingRequest({ messages: [{ role: "user", content: { type: "text", text: "t" } }], maxTokens: -5 } as any);
  assert.equal(negTokens.valid, false);
});

test("formatSamplingRequest contains prompt text", () => {
  const req = buildSamplingRequest({ prompt: "the prompt text" });
  const out = formatSamplingRequest(req);
  assert.ok(out.includes("the prompt text"));
  assert.ok(out.includes("\n"));
});
