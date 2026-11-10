import { test } from "node:test";
import assert from "node:assert/strict";
import { filterFields } from "../src/filter.js";

test("no fields returns input unchanged", () => {
  const data = { a: 1, b: 2 };
  assert.deepEqual(filterFields(data, undefined), data);
});

test("top-level allowlist", () => {
  assert.deepEqual(filterFields({ a: 1, b: 2, c: 3 }, ["a", "c"]), { a: 1, c: 3 });
});

test("nested dotted paths", () => {
  const data = { id: 1, category: { id: 4, name: "Lions", extra: true } };
  assert.deepEqual(filterFields(data, ["id", "category.name"]), { id: 1, category: { name: "Lions" } });
});

test("applies to array items", () => {
  const data = [
    { id: 1, x: 9 },
    { id: 2, x: 8 }
  ];
  assert.deepEqual(filterFields(data, ["id"]), [{ id: 1 }, { id: 2 }]);
});

test("keeps whole subtree at a leaf path", () => {
  const data = { meta: { a: 1, b: 2 }, keep: 0 };
  assert.deepEqual(filterFields(data, ["meta"]), { meta: { a: 1, b: 2 } });
});
