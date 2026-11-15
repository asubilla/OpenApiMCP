import { test } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, textToVector, SemanticCache } from "../src/semantic-cache.js";

test("cosineSimilarity identical vectors is 1", () => {
  const v = [1, 2, 3, 4];
  assert.equal(cosineSimilarity(v, v), 1);
});

test("cosineSimilarity orthogonal vectors is 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("textToVector is deterministic", () => {
  const a = textToVector("hello world");
  const b = textToVector("hello world");
  assert.deepEqual(a, b);
  assert.equal(a.length, 64);
});

test("textToVector respects dimensions", () => {
  assert.equal(textToVector("hello", 16).length, 16);
});

test("SemanticCache set/get exact match", () => {
  const cache = new SemanticCache();
  cache.set("hello", "world");
  const hit = cache.get("hello");
  assert.ok(hit);
  assert.equal(hit?.key, "hello");
  assert.equal(hit?.value, "world");
  assert.ok((hit?.similarity ?? 0) >= 0.99);
});

test("SemanticCache get similar match above threshold", () => {
  const cache = new SemanticCache();
  cache.set("the quick brown fox jumps over the lazy dog", "v");
  const hit = cache.get("the quick brown fox jumps over a lazy dog");
  assert.ok(hit);
  assert.ok((hit?.similarity ?? 0) >= 0.8);
});

test("SemanticCache get below threshold returns undefined", () => {
  const cache = new SemanticCache();
  cache.set("alpha beta gamma", "v");
  const hit = cache.get("completely unrelated zzzzzzzz qqqqqqqq");
  assert.equal(hit, undefined);
});

test("SemanticCache expiry", () => {
  const cache = new SemanticCache({ ttlMs: 0 });
  cache.set("k", "v");
  assert.equal(cache.get("k"), undefined);
});

test("SemanticCache clear empties cache", () => {
  const cache = new SemanticCache();
  cache.set("a", "1");
  cache.set("b", "2");
  cache.clear();
  assert.equal(cache.size(), 0);
  assert.equal(cache.get("a"), undefined);
});

test("SemanticCache size counts entries", () => {
  const cache = new SemanticCache();
  assert.equal(cache.size(), 0);
  cache.set("a", "1");
  cache.set("b", "2");
  assert.equal(cache.size(), 2);
});
