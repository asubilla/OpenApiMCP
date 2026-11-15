import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMapping, parseMapping, formatMapping } from "../src/response-map.js";

test("pick keeps only the listed keys on a flat object", () => {
  assert.deepEqual(applyMapping({ a: 1, b: 2, c: 3 }, { pick: ["a", "c"] }), { a: 1, c: 3 });
});

test("drop removes the listed keys on a flat object", () => {
  assert.deepEqual(applyMapping({ a: 1, b: 2, c: 3 }, { drop: ["b"] }), { a: 1, c: 3 });
});

test("rename maps old keys to new keys on a flat object", () => {
  assert.deepEqual(applyMapping({ id: 1, secret: "x" }, { rename: { id: "userId" } }), {
    userId: 1,
    secret: "x"
  });
});

test("pick wins over drop when a key is in both", () => {
  assert.deepEqual(applyMapping({ a: 1, b: 2 }, { pick: ["a", "b"], drop: ["a"] }), { a: 1, b: 2 });
});

test("rename is applied after pick/drop", () => {
  // "a" is kept then renamed to "z"; "b" is dropped so renaming "b" has no effect.
  assert.deepEqual(
    applyMapping({ a: 1, b: 2, c: 3 }, { drop: ["b"], rename: { a: "z", b: "y" } }),
    { z: 1, c: 3 }
  );
});

test("applyMapping maps arrays element-wise", () => {
  const input = [
    { id: 1, x: 9 },
    { id: 2, x: 8 }
  ];
  assert.deepEqual(applyMapping(input, { pick: ["id"] }), [{ id: 1 }, { id: 2 }]);
});

test("applyMapping maps array elements and leaves non-object elements alone", () => {
  assert.deepEqual(applyMapping([{ id: 1, x: 9 }, "raw", 7, null], { drop: ["x"] }), [
    { id: 1 },
    "raw",
    7,
    null
  ]);
});

test("applyMapping does not recurse into nested objects", () => {
  const nested = { keep: { dropMe: 1, inner: 2 }, dropMe: "top" };
  assert.deepEqual(applyMapping(nested, { drop: ["dropMe"] }), { keep: { dropMe: 1, inner: 2 } });
});

test("non-object values pass through unchanged", () => {
  for (const value of ["text", 42, true, null, undefined]) {
    assert.equal(applyMapping(value, { pick: ["a"], drop: ["b"], rename: { a: "b" } }), value);
  }
});

test("applyMapping does not mutate the input object", () => {
  const input = { a: 1, b: 2 };
  applyMapping(input, { drop: ["a"], rename: { b: "c" } });
  assert.deepEqual(input, { a: 1, b: 2 });
});

test("parseMapping parses a full valid mapping", () => {
  const parsed = parseMapping(JSON.parse('{"pick":["id"],"drop":["secret"],"rename":{"id":"userId"}}'));
  assert.deepEqual(parsed, { pick: ["id"], drop: ["secret"], rename: { id: "userId" } });
});

test("parseMapping accepts a partial mapping (rename only)", () => {
  assert.deepEqual(parseMapping({ rename: { a: "b" } }), { rename: { a: "b" } });
});

test("parseMapping normalizes by copying arrays and objects", () => {
  const pick = ["id"];
  const rename = { id: "userId" };
  const parsed = parseMapping({ pick, rename });
  assert.deepEqual(parsed, { pick: ["id"], rename: { id: "userId" } });
  assert.notEqual(parsed?.pick, pick);
  assert.notEqual(parsed?.rename, rename);
});

test("parseMapping ignores unknown keys but keeps known ones", () => {
  assert.deepEqual(parseMapping({ pick: ["a"], extra: "ignored" }), { pick: ["a"] });
});

test("parseMapping rejects invalid inputs", () => {
  const invalid: unknown[] = [
    null,
    undefined,
    "pick",
    7,
    true,
    [],
    [{ pick: ["a"] }],
    {},
    { pick: "a" },
    { pick: [1, 2] },
    { pick: ["a", 3] },
    { drop: "a" },
    { drop: [false] },
    { rename: [] },
    { rename: { a: 1 } },
    { rename: { a: "b", c: null } }
  ];
  for (const input of invalid) {
    assert.equal(parseMapping(input), undefined, `expected undefined for ${JSON.stringify(input)}`);
  }
});

test("formatMapping summarizes a full mapping", () => {
  assert.equal(
    formatMapping({ pick: ["id", "name"], drop: ["secret"], rename: { id: "userId" } }),
    "pick(id, name); drop(secret); rename(id->userId)"
  );
});

test("formatMapping summarizes a partial mapping", () => {
  assert.equal(formatMapping({ rename: { a: "b", c: "d" } }), "rename(a->b, c->d)");
});

test("formatMapping reports an empty mapping", () => {
  assert.equal(formatMapping({}), "(empty mapping)");
});
