import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseOpConfig,
  opConfigFor,
  resolveRetries,
  resolveTimeoutMs,
  formatOpConfig,
} from "../src/op-config.js";
import type { OpConfig } from "../src/op-config.js";

test("parseOpConfig parses timeout as seconds string and ms number", () => {
  assert.deepEqual(parseOpConfig({ "x-timeout": "5s" }), { timeoutMs: 5000 });
  assert.deepEqual(parseOpConfig({ "x-timeout": "10s" }), { timeoutMs: 10000 });
  assert.deepEqual(parseOpConfig({ "x-timeout": 5000 }), { timeoutMs: 5000 });
  assert.deepEqual(parseOpConfig({ "x-timeoutMs": "250ms" }), { timeoutMs: 250 });
  assert.deepEqual(parseOpConfig({ "x-timeoutMs": 1500 }), { timeoutMs: 1500 });
  assert.deepEqual(parseOpConfig({ "x-timeout": "1500" }), { timeoutMs: 1500 });
});

test("parseOpConfig ignores invalid timeout values", () => {
  assert.deepEqual(parseOpConfig({ "x-timeout": "soon" }), {});
  assert.deepEqual(parseOpConfig({ "x-timeout": "-5s" }), {});
  assert.deepEqual(parseOpConfig({ "x-timeout": Number.NaN }), {});
  assert.deepEqual(parseOpConfig({ "x-timeout": Number.POSITIVE_INFINITY }), {});
  assert.deepEqual(parseOpConfig({ "x-timeout": true }), {});
  assert.deepEqual(parseOpConfig({ "x-timeout": null }), {});
});

test("parseOpConfig parses retries from x-retries and x-maxRetries", () => {
  assert.deepEqual(parseOpConfig({ "x-retries": 3 }), { retries: 3 });
  assert.deepEqual(parseOpConfig({ "x-maxRetries": 2 }), { retries: 2 });
  assert.deepEqual(parseOpConfig({ "x-retries": "4" }), { retries: 4 });
  assert.deepEqual(parseOpConfig({ "x-retries": 0 }), { retries: 0 });
});

test("parseOpConfig ignores invalid retries values", () => {
  assert.deepEqual(parseOpConfig({ "x-retries": -1 }), {});
  assert.deepEqual(parseOpConfig({ "x-retries": "many" }), {});
  assert.deepEqual(parseOpConfig({ "x-retries": Number.NaN }), {});
  assert.deepEqual(parseOpConfig({ "x-maxRetries": undefined }), {});
});

test("parseOpConfig parses maxResponseBytes and x-budget", () => {
  assert.deepEqual(parseOpConfig({ "x-maxResponseBytes": 1024 }), {
    maxResponseBytes: 1024,
  });
  assert.deepEqual(parseOpConfig({ "x-maxResponseBytes": "2048" }), {
    maxResponseBytes: 2048,
  });
  assert.deepEqual(parseOpConfig({ "x-budget": 4096 }), { budgetBytes: 4096 });
  assert.deepEqual(parseOpConfig({ "x-budget": "8192" }), { budgetBytes: 8192 });
});

test("parseOpConfig ignores invalid byte limits", () => {
  assert.deepEqual(parseOpConfig({ "x-maxResponseBytes": -1 }), {});
  assert.deepEqual(parseOpConfig({ "x-maxResponseBytes": "lots" }), {});
  assert.deepEqual(parseOpConfig({ "x-budget": Number.NaN }), {});
  assert.deepEqual(parseOpConfig({ "x-budget": -100 }), {});
});

test("parseOpConfig combines multiple keys and drops unknown keys", () => {
  assert.deepEqual(
    parseOpConfig({
      "x-timeout": "2s",
      "x-retries": 1,
      "x-maxResponseBytes": 100,
      "x-budget": 200,
      somethingElse: "drop-me",
    }),
    { timeoutMs: 2000, retries: 1, maxResponseBytes: 100, budgetBytes: 200 },
  );
});

test("parseOpConfig handles non-object input gracefully", () => {
  assert.deepEqual(parseOpConfig(undefined as any), {});
  assert.deepEqual(parseOpConfig(null as any), {});
  assert.deepEqual(parseOpConfig("nope" as any), {});
});

test("opConfigFor reads x-openapimcp extension from op", () => {
  const op = {
    "x-openapimcp": { "x-timeout": "3s", "x-retries": 2, "x-budget": 500 },
  };
  assert.deepEqual(opConfigFor(op, "get", "/things"), {
    timeoutMs: 3000,
    retries: 2,
    budgetBytes: 500,
  });
});

test("opConfigFor returns empty config when extension missing or invalid", () => {
  assert.deepEqual(opConfigFor({}, "get", "/things"), {});
  assert.deepEqual(opConfigFor({ "x-openapimcp": "nope" }, "get", "/things"), {});
  assert.deepEqual(opConfigFor({ "x-openapimcp": [1, 2] }, "get", "/things"), {});
  assert.deepEqual(opConfigFor(null, "get", "/things"), {});
  assert.deepEqual(opConfigFor(undefined, "get", "/things"), {});
});

test("resolveRetries defaults to global for idempotent methods", () => {
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "get", "delete"]) {
    assert.equal(resolveRetries(undefined, method, 3), 3);
    assert.equal(resolveRetries({}, method, 3), 3);
  }
});

test("resolveRetries defaults to 0 for POST and PATCH", () => {
  for (const method of ["POST", "PATCH", "post", "patch"]) {
    assert.equal(resolveRetries(undefined, method, 3), 0);
    assert.equal(resolveRetries({}, method, 3), 0);
  }
});

test("resolveRetries explicit config wins over method default and global", () => {
  assert.equal(resolveRetries({ retries: 5 }, "POST", 3), 5);
  assert.equal(resolveRetries({ retries: 0 }, "GET", 3), 0);
  assert.equal(resolveRetries({ retries: 2 }, "PATCH", 0), 2);
});

test("resolveTimeoutMs prefers config, falls back to global", () => {
  assert.equal(resolveTimeoutMs({ timeoutMs: 1234 }, 5000), 1234);
  assert.equal(resolveTimeoutMs({}, 5000), 5000);
  assert.equal(resolveTimeoutMs(undefined, 5000), 5000);
});

test("formatOpConfig renders all fields and defaults", () => {
  assert.equal(
    formatOpConfig({ timeoutMs: 1000, retries: 2, maxResponseBytes: 100, budgetBytes: 200 }),
    "OpConfig: timeout=1000ms, retries=2, maxResponseBytes=100, budgetBytes=200",
  );
  assert.equal(formatOpConfig({}), "OpConfig: timeout=default, retries=default");
  assert.equal(formatOpConfig({ retries: 0 }), "OpConfig: timeout=default, retries=0");
});

test("OpConfig type usable", () => {
  const cfg: OpConfig = { timeoutMs: 1, retries: 1, maxResponseBytes: 1, budgetBytes: 1 };
  assert.ok(cfg);
});
