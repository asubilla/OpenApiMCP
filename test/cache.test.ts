import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache, cacheKey, etagOf } from "../src/cache.js";

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-cache-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("set then get round-trips a value", (t) => {
  const cache = new DiskCache(tempDir(t));
  cache.set("a", "hello", 60000);
  const hit = cache.get("a");
  assert.ok(hit);
  assert.equal(hit?.value, "hello");
  assert.ok((hit?.expires ?? 0) > Date.now());
});

test("get returns undefined for a missing key", (t) => {
  const cache = new DiskCache(tempDir(t));
  assert.equal(cache.get("nope"), undefined);
});

test("get drops and removes expired entries", (t) => {
  const dir = tempDir(t);
  const cache = new DiskCache(dir);
  cache.set("old", "value", -1);
  assert.equal(cache.get("old"), undefined);
  assert.equal(readdirSync(dir).filter((f) => f.endsWith(".json")).length, 0);
});

test("delete removes a single entry", (t) => {
  const cache = new DiskCache(tempDir(t));
  cache.set("a", "1", 60000);
  cache.set("b", "2", 60000);
  cache.delete("a");
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b")?.value, "2");
});

test("clear removes every entry", (t) => {
  const dir = tempDir(t);
  const cache = new DiskCache(dir);
  cache.set("a", "1", 60000);
  cache.set("b", "2", 60000);
  cache.clear();
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), undefined);
  assert.equal(readdirSync(dir).filter((f) => f.endsWith(".json")).length, 0);
});

test("entries persist across instances of the same directory", (t) => {
  const dir = tempDir(t);
  new DiskCache(dir).set("shared", "v", 60000);
  assert.equal(new DiskCache(dir).get("shared")?.value, "v");
});

test("cacheKey is stable and distinguishes requests", () => {
  assert.equal(cacheKey("GET", "/pets"), cacheKey("get", "/pets"));
  assert.notEqual(cacheKey("GET", "/pets"), cacheKey("GET", "/pets", "{}"));
  assert.notEqual(cacheKey("GET", "/pets"), cacheKey("POST", "/pets"));
  assert.equal(cacheKey("POST", "/pets", "{}"), cacheKey("post", "/pets", "{}"));
});

test("etagOf matches header names case-insensitively", () => {
  assert.equal(etagOf({ ETag: '"abc"' }), '"abc"');
  assert.equal(etagOf({ etag: "xyz" }), "xyz");
  assert.equal(etagOf({ "Content-Type": "application/json" }), undefined);
});
