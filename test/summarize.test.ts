import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeJson } from "../src/summarize.js";

test("summarizeJson truncates long arrays with a sentinel", () => {
  const input = Array.from({ length: 30 }, (_, i) => i);
  const out = summarizeJson(input, { maxArrayItems: 5 });
  assert.equal(out.length, 6);
  assert.deepEqual(out.slice(0, 5), [0, 1, 2, 3, 4]);
  assert.equal(out[5], "…(25 more)");
});

test("summarizeJson uses the default array cap", () => {
  const input = Array.from({ length: 30 }, (_, i) => i);
  const out = summarizeJson(input);
  assert.equal(out.length, 26);
  assert.equal(out[25], "…(5 more)");
});

test("summarizeJson truncates long strings", () => {
  const out = summarizeJson({ s: "x".repeat(50) }, { maxStringLength: 10 });
  assert.equal(out.s, `${"x".repeat(10)}…`);
  assert.equal(out.s.length, 11);
});

test("summarizeJson caps object keys with a marker key", () => {
  const input: Record<string, number> = {};
  for (let i = 0; i < 10; i += 1) input[`k${i}`] = i;
  const out = summarizeJson(input, { maxObjectKeys: 3 });
  const keys = Object.keys(out);
  assert.equal(keys.length, 4);
  assert.deepEqual(keys.slice(0, 3), ["k0", "k1", "k2"]);
  assert.ok(keys.includes("…(7 more keys)"));
});

test("summarizeJson limits recursion depth", () => {
  const deep = { a: { b: { c: { d: "x" } } } };
  const out = summarizeJson(deep, { maxDepth: 2 });
  assert.equal(out.a.b, "[object]");
});

test("summarizeJson keeps primitives and handles nesting", () => {
  assert.equal(summarizeJson(42), 42);
  assert.equal(summarizeJson(true), true);
  assert.equal(summarizeJson(null), null);
  assert.deepEqual(summarizeJson({ a: 1, b: [2, 3] }, { maxArrayItems: 5 }), { a: 1, b: [2, 3] });
});

test("summarizeJson tolerates cycles", () => {
  const node: { name: string; self?: unknown } = { name: "n" };
  node.self = node;
  const out = summarizeJson(node);
  assert.equal(out.name, "n");
  assert.equal(out.self, "[Circular]");
});
