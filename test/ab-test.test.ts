import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AbTestStore, createAbTestStore, selectVariant } from "../src/ab-test.js";

function tempFile(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-abtest-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "ab.json");
}

test("createTest creates test with zeroed counts", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  const testObj = store.createTest("tool", [
    { id: "a", description: "variant a" },
    { id: "b", description: "variant b" },
  ]);
  assert.equal(testObj.tool, "tool");
  assert.equal(testObj.variants.length, 2);
  assert.equal(testObj.variants[0].impressions, 0);
  assert.equal(testObj.variants[0].selections, 0);
  assert.equal(store.getTest("tool")?.variants.length, 2);
  assert.equal(store.allTests().length, 1);
});

test("createAbTestStore factory works", (t) => {
  const file = tempFile(t);
  const store = createAbTestStore(file);
  store.createTest("t", [{ id: "x", description: "d" }]);
  assert.ok(store.getTest("t"));
});

test("recordImpression and recordSelection increment", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  store.createTest("tool", [{ id: "a", description: "a" }]);
  store.recordImpression("tool", "a");
  store.recordImpression("tool", "a");
  store.recordSelection("tool", "a");
  const v = store.getTest("tool")!.variants[0];
  assert.equal(v.impressions, 2);
  assert.equal(v.selections, 1);
});

test("getWinner returns undefined when none qualify", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  store.createTest("tool", [
    { id: "a", description: "a" },
    { id: "b", description: "b" },
  ]);
  for (let i = 0; i < 4; i++) store.recordImpression("tool", "a");
  store.recordSelection("tool", "a");
  assert.equal(store.getWinner("tool"), undefined);
});

test("getWinner picks highest selection/impression ratio with min 5 impressions", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  store.createTest("tool", [
    { id: "a", description: "a" },
    { id: "b", description: "b" },
  ]);
  // a: 5 impressions, 4 selections => 0.8
  for (let i = 0; i < 5; i++) store.recordImpression("tool", "a");
  for (let i = 0; i < 4; i++) store.recordSelection("tool", "a");
  // b: 10 impressions, 5 selections => 0.5
  for (let i = 0; i < 10; i++) store.recordImpression("tool", "b");
  for (let i = 0; i < 5; i++) store.recordSelection("tool", "b");
  assert.equal(store.getWinner("tool"), "a");
  assert.equal(store.getTest("tool")?.winner, "a");
});

test("getWinner returns undefined for unknown tool", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  assert.equal(store.getWinner("nope"), undefined);
});

test("selectVariant round-robins by fewest impressions, tie-break by id", (t) => {
  const testObj = {
    tool: "t",
    variants: [
      { id: "b", description: "b", impressions: 3, selections: 0 },
      { id: "a", description: "a", impressions: 3, selections: 0 },
      { id: "c", description: "c", impressions: 1, selections: 0 },
    ],
  };
  assert.equal(selectVariant(testObj), "c");
  const testObj2 = {
    tool: "t2",
    variants: [
      { id: "b", description: "b", impressions: 2, selections: 0 },
      { id: "a", description: "a", impressions: 2, selections: 0 },
    ],
  };
  assert.equal(selectVariant(testObj2), "a");
});

test("selectVariant empty returns empty string", (t) => {
  assert.equal(selectVariant({ tool: "t", variants: [] }), "");
});

test("persists to disk and reads back", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  store.createTest("tool", [{ id: "a", description: "a" }]);
  store.recordImpression("tool", "a");
  assert.ok(existsSync(file));
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed));

  const store2 = new AbTestStore(file);
  assert.equal(store2.getTest("tool")?.variants[0].impressions, 1);
});

test("mutations persist across instances", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  store.createTest("tool", [
    { id: "a", description: "a" },
    { id: "b", description: "b" },
  ]);
  for (let i = 0; i < 5; i++) store.recordImpression("tool", "a");
  for (let i = 0; i < 5; i++) store.recordSelection("tool", "a");
  store.getWinner("tool");

  const store2 = new AbTestStore(file);
  assert.equal(store2.getTest("tool")?.winner, "a");
  assert.equal(store2.getTest("tool")?.variants[0].impressions, 5);
  assert.equal(store2.getTest("tool")?.variants[0].selections, 5);
});

test("creates parent directories", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-abtest-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "nested", "deeper", "ab.json");
  const store = new AbTestStore(file);
  store.createTest("t", [{ id: "x", description: "d" }]);
  assert.ok(existsSync(file));
});

test("allTests returns clones", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  store.createTest("tool", [{ id: "a", description: "a" }]);
  const all = store.allTests();
  all[0].variants.push({ id: "z", description: "z", impressions: 0, selections: 0 });
  assert.equal(store.getTest("tool")?.variants.length, 1);
});

test("recordImpression no-op for unknown variant", (t) => {
  const file = tempFile(t);
  const store = new AbTestStore(file);
  store.createTest("tool", [{ id: "a", description: "a" }]);
  store.recordImpression("tool", "nope");
  store.recordSelection("missing", "a");
  assert.equal(store.getTest("tool")?.variants[0].impressions, 0);
});
