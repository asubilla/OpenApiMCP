import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateIdempotencyKey,
  IDEMPOTENCY_HEADER,
  isIdempotencyHeader,
  withIdempotency,
  resolveIdempotencyKey,
  stripIdempotencyArg,
} from "../src/idempotency.js";

test("generateIdempotencyKey returns a 32-char hex string", () => {
  const key = generateIdempotencyKey();
  assert.match(key, /^[0-9a-f]{32}$/);
});

test("generateIdempotencyKey applies prefix with dash", () => {
  const key = generateIdempotencyKey("req");
  assert.match(key, /^req-[0-9a-f]{32}$/);
});

test("generateIdempotencyKey produces unique keys", () => {
  const keys = new Set(Array.from({ length: 100 }, () => generateIdempotencyKey()));
  assert.equal(keys.size, 100);
});

test("IDEMPOTENCY_HEADER is Idempotency-Key", () => {
  assert.equal(IDEMPOTENCY_HEADER, "Idempotency-Key");
});

test("isIdempotencyHeader is case-insensitive", () => {
  assert.equal(isIdempotencyHeader("Idempotency-Key"), true);
  assert.equal(isIdempotencyHeader("idempotency-key"), true);
  assert.equal(isIdempotencyHeader("IDEMPOTENCY-KEY"), true);
  assert.equal(isIdempotencyHeader("iDeMpOtEnCy-KeY"), true);
  assert.equal(isIdempotencyHeader("Idempotency-Key2"), false);
  assert.equal(isIdempotencyHeader("X-Idempotency-Key"), false);
  assert.equal(isIdempotencyHeader(""), false);
});

test("withIdempotency always adds the key by default", () => {
  const out = withIdempotency({ Accept: "application/json" });
  assert.equal(typeof out[IDEMPOTENCY_HEADER], "string");
  assert.match(out[IDEMPOTENCY_HEADER], /^[0-9a-f]{32}$/);
  assert.equal(out["Accept"], "application/json");
});

test("withIdempotency uses the provided key", () => {
  const out = withIdempotency({}, "my-key");
  assert.equal(out[IDEMPOTENCY_HEADER], "my-key");
});

test("withIdempotency does not mutate the input headers", () => {
  const input = { Accept: "application/json" };
  const out = withIdempotency(input, "k");
  assert.deepEqual(input, { Accept: "application/json" });
  assert.notEqual(out, input);
});

test("withIdempotency onlySafe adds key for POST/PUT/PATCH/DELETE", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post", "put", "patch", "delete"]) {
    const out = withIdempotency({}, "k", { onlySafe: true, method });
    assert.equal(out[IDEMPOTENCY_HEADER], "k", `method ${method} should get key`);
  }
});

test("withIdempotency onlySafe skips key for other/missing methods", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "TRACE", "get"]) {
    const out = withIdempotency({}, "k", { onlySafe: true, method });
    assert.equal(out[IDEMPOTENCY_HEADER], undefined, `method ${method} should not get key`);
  }
  const noMethod = withIdempotency({}, "k", { onlySafe: true });
  assert.equal(noMethod[IDEMPOTENCY_HEADER], undefined);
});

test("resolveIdempotencyKey prefers _idempotencyKey arg", () => {
  const key = resolveIdempotencyKey({ _idempotencyKey: "arg-key" }, "explicit-key");
  assert.equal(key, "arg-key");
});

test("resolveIdempotencyKey falls back to explicitKey", () => {
  const key = resolveIdempotencyKey({}, "explicit-key");
  assert.equal(key, "explicit-key");
});

test("resolveIdempotencyKey ignores non-string _idempotencyKey", () => {
  const key = resolveIdempotencyKey({ _idempotencyKey: 123 }, "explicit-key");
  assert.equal(key, "explicit-key");
});

test("resolveIdempotencyKey generates a key when nothing provided", () => {
  const key = resolveIdempotencyKey({});
  assert.ok(key);
  assert.match(key, /^[0-9a-f]{32}$/);
});

test("stripIdempotencyArg removes _idempotencyKey", () => {
  const out = stripIdempotencyArg({ _idempotencyKey: "k", foo: "bar", n: 1 });
  assert.deepEqual(out, { foo: "bar", n: 1 });
  assert.equal("_idempotencyKey" in out, false);
});

test("stripIdempotencyArg is a no-op when arg absent and does not mutate", () => {
  const input = { foo: "bar" };
  const out = stripIdempotencyArg(input);
  assert.deepEqual(out, { foo: "bar" });
  assert.notEqual(out, input);
});
