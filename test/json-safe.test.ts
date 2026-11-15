import { test } from "node:test";
import assert from "node:assert/strict";
import { stringifyCycles, stableStringifyCycles } from "../src/json-safe.js";

const cyclic = () => {
  const a: any = { name: "a" };
  a.self = a;
  return a;
};

test("stringifyCycles replaces cycles with [circular]", () => {
  const out = stringifyCycles(cyclic());
  assert.match(out, /\[circular\]/);
  assert.doesNotThrow(() => JSON.parse(out));
});

test("stableStringifyCycles is key-order independent", () => {
  const a = { b: 2, a: 1, nested: { d: 4, c: 3 } };
  const b = { nested: { c: 3, d: 4 }, a: 1, b: 2 };
  assert.equal(stableStringifyCycles(a), stableStringifyCycles(b));
});

test("stableStringifyCycles survives cycles", () => {
  const out = stableStringifyCycles(cyclic());
  assert.match(out, /\[circular\]/);
});

test("stableStringifyCycles handles undefined and null", () => {
  assert.equal(stableStringifyCycles(undefined), "null");
  assert.equal(stableStringifyCycles(null), "null");
});

test("stableStringifyCycles handles BigInt", () => {
  assert.doesNotThrow(() => stableStringifyCycles({ n: 1n }));
});
