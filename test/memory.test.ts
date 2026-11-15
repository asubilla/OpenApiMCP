import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentMemory, createMemory } from "../src/memory.js";

function tempFile(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-memory-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "memory.jsonl");
}

test("add returns id and get retrieves entry", (t) => {
  const file = tempFile(t);
  const mem = new AgentMemory(file);
  const id = mem.add("greeting", "hello world", ["intro"]);
  assert.equal(typeof id, "string");
  const entry = mem.get("greeting");
  assert.ok(entry);
  assert.equal(entry?.id, id);
  assert.equal(entry?.key, "greeting");
  assert.equal(entry?.value, "hello world");
  assert.deepEqual(entry?.tags, ["intro"]);
  assert.equal(typeof entry?.time, "string");
});

test("get returns undefined for missing key", (t) => {
  const file = tempFile(t);
  const mem = createMemory(file);
  assert.equal(mem.get("nope"), undefined);
});

test("search finds entries by token overlap", (t) => {
  const file = tempFile(t);
  const mem = new AgentMemory(file);
  mem.add("lang", "TypeScript is great", ["dev", "js"]);
  mem.add("food", "pizza for dinner", ["meal"]);
  const hits = mem.search("typescript dev");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].key, "lang");
  const foodHits = mem.search("pizza");
  assert.equal(foodHits.length, 1);
  assert.equal(foodHits[0].key, "food");
  assert.equal(mem.search("nothinghere").length, 0);
});

test("search respects limit", (t) => {
  const file = tempFile(t);
  const mem = new AgentMemory(file);
  mem.add("a", "match word");
  mem.add("b", "match word");
  mem.add("c", "match word");
  const hits = mem.search("match", 2);
  assert.equal(hits.length, 2);
});

test("tags are searchable", (t) => {
  const file = tempFile(t);
  const mem = new AgentMemory(file);
  mem.add("x", "value", ["specialtag"]);
  const hits = mem.search("specialtag");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].key, "x");
});

test("delete removes entry and returns boolean", (t) => {
  const file = tempFile(t);
  const mem = new AgentMemory(file);
  mem.add("k", "v");
  assert.equal(mem.delete("k"), true);
  assert.equal(mem.get("k"), undefined);
  assert.equal(mem.delete("k"), false);
});

test("clear empties memory", (t) => {
  const file = tempFile(t);
  const mem = new AgentMemory(file);
  mem.add("a", "1");
  mem.add("b", "2");
  mem.clear();
  assert.equal(mem.list().length, 0);
});

test("persists to disk and reads back", (t) => {
  const file = tempFile(t);
  const mem = new AgentMemory(file);
  const id = mem.add("persisted", "value", ["tag"]);
  // read raw
  const raw = readFileSync(file, "utf8");
  assert.ok(raw.includes(id));
  // new instance reads back
  const mem2 = new AgentMemory(file);
  assert.equal(mem2.list().length, 1);
  const entry = mem2.get("persisted");
  assert.ok(entry);
  assert.equal(entry?.value, "value");
  assert.deepEqual(entry?.tags, ["tag"]);
});

test("delete and clear persist to disk", (t) => {
  const file = tempFile(t);
  const mem = new AgentMemory(file);
  mem.add("k", "v");
  mem.delete("k");
  const mem2 = new AgentMemory(file);
  assert.equal(mem2.get("k"), undefined);

  mem2.add("a", "1");
  mem2.add("b", "2");
  mem2.clear();
  const mem3 = new AgentMemory(file);
  assert.equal(mem3.list().length, 0);
});

test("creates parent directories", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-memory-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "nested", "deeper", "memory.jsonl");
  assert.equal(existsSync(join(dir, "nested")), false);
  const mem = new AgentMemory(file);
  mem.add("k", "v");
  assert.ok(existsSync(file));
});
