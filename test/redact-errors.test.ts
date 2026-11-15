import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractRequestId,
  extractRetryAfter,
  redactSecrets,
  formatUpstreamError
} from "../src/redact-errors.js";

test("extractRequestId finds common request-id headers case-insensitively", () => {
  assert.equal(extractRequestId({ "x-request-id": "req-1" }), "req-1");
  assert.equal(extractRequestId({ "X-Request-Id": "req-2" }), "req-2");
  assert.equal(extractRequestId({ "X-CORRELATION-ID": "corr-1" }), "corr-1");
  assert.equal(extractRequestId({ "x-amz-request-id": "amz-1" }), "amz-1");
  assert.equal(extractRequestId({ "Request-Id": "plain-1" }), "plain-1");
  assert.equal(extractRequestId({ "CF-Ray": "ray-1" }), "ray-1");
});

test("extractRequestId prefers x-request-id over later candidates", () => {
  assert.equal(
    extractRequestId({ "cf-ray": "ray-1", "x-request-id": "req-1", "x-correlation-id": "corr-1" }),
    "req-1"
  );
});

test("extractRequestId returns undefined when no candidate header is present", () => {
  assert.equal(extractRequestId({}), undefined);
  assert.equal(extractRequestId({ "content-type": "application/json" }), undefined);
});

test("extractRetryAfter reads retry-after case-insensitively", () => {
  assert.equal(extractRetryAfter({ "retry-after": "30" }), "30");
  assert.equal(extractRetryAfter({ "Retry-After": "120" }), "120");
  assert.equal(extractRetryAfter({ "RETRY-AFTER": "Wed, 21 Oct 2015 07:28:00 GMT" }), "Wed, 21 Oct 2015 07:28:00 GMT");
  assert.equal(extractRetryAfter({}), undefined);
});

test("redactSecrets masks Bearer tokens", () => {
  const out = redactSecrets("Authorization: Bearer supersecrettoken123");
  assert.ok(!out.includes("supersecrettoken123"));
  assert.ok(out.includes("[REDACTED]"));
});

test("redactSecrets masks long hex strings (>= 24 chars) but not short ones", () => {
  const longHex = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
  const out = redactSecrets(`key=${longHex}`);
  assert.ok(!out.includes(longHex));
  assert.ok(out.includes("[REDACTED]"));
  assert.equal(redactSecrets("short a1b2c3 ok"), "short a1b2c3 ok");
});

test("redactSecrets masks JSON values for token/secret/key/authorization keys", () => {
  const out = redactSecrets('{"apiKey":"mysecretvalue","other":"keepme"}');
  assert.ok(!out.includes("mysecretvalue"));
  assert.ok(out.includes('"apiKey":"[REDACTED]"'));
  assert.ok(out.includes('"other":"keepme"'));

  const tokenOut = redactSecrets('{"access_token":"tok_abc","password":"hunter2"}');
  assert.ok(!tokenOut.includes("tok_abc"));
  assert.ok(tokenOut.includes('"access_token":"[REDACTED]"'));
});

test("redactSecrets leaves ordinary text untouched", () => {
  assert.equal(redactSecrets("hello world, status 500"), "hello world, status 500");
});

test("formatUpstreamError includes status, content-type, request id and retry-after", () => {
  const err = formatUpstreamError(
    429,
    "slow down",
    {
      "content-type": "application/json",
      "x-request-id": "req-42",
      "retry-after": "30"
    }
  );
  assert.equal(err.status, 429);
  assert.equal(err.requestId, "req-42");
  assert.equal(err.retryAfter, "30");
  assert.ok(err.text.includes("HTTP 429 Too Many Requests"));
  assert.ok(err.text.includes("Content-Type: application/json"));
  assert.ok(err.text.includes("Request-Id: req-42"));
  assert.ok(err.text.includes("Retry-After: 30"));
  assert.ok(err.text.includes("slow down"));
});

test("formatUpstreamError redacts secrets in the body by default", () => {
  const err = formatUpstreamError(
    401,
    '{"authorization":"Bearer topsecrettoken"}',
    {}
  );
  assert.ok(!err.text.includes("topsecrettoken"));
  assert.ok(err.text.includes("[REDACTED]"));
});

test("formatUpstreamError honours redact: false", () => {
  const err = formatUpstreamError(
    401,
    "Bearer topsecrettoken",
    {},
    { redact: false }
  );
  assert.ok(err.text.includes("topsecrettoken"));
});

test("formatUpstreamError truncates bodies longer than 2000 chars", () => {
  const err = formatUpstreamError(500, "x".repeat(5000), {});
  assert.ok(err.text.includes("[truncated"));
  assert.ok(err.text.length < 5000);
});

test("formatUpstreamError omits body section when body is undefined", () => {
  const err = formatUpstreamError(503, undefined, {});
  assert.ok(!err.text.includes("Body:"));
  assert.ok(err.text.includes("HTTP 503 Service Unavailable"));
});
