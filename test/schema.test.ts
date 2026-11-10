import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonSchemaToZod } from "../src/schema.js";

test("string with enum", () => {
  const s = jsonSchemaToZod({ type: "string", enum: ["a", "b"] });
  assert.equal(s.safeParse("a").success, true);
  assert.equal(s.safeParse("z").success, false);
});

test("integer rejects floats", () => {
  const s = jsonSchemaToZod({ type: "integer" });
  assert.equal(s.safeParse(3).success, true);
  assert.equal(s.safeParse(3.5).success, false);
});

test("object required vs optional", () => {
  const s = jsonSchemaToZod({
    type: "object",
    required: ["a"],
    properties: { a: { type: "string" }, b: { type: "number" } }
  });
  assert.equal(s.safeParse({ a: "x" }).success, true);
  assert.equal(s.safeParse({ b: 1 }).success, false);
});

test("nullable type array", () => {
  const s = jsonSchemaToZod({ type: ["string", "null"] });
  assert.equal(s.safeParse(null).success, true);
  assert.equal(s.safeParse("x").success, true);
});

test("array of items", () => {
  const s = jsonSchemaToZod({ type: "array", items: { type: "string" } });
  assert.equal(s.safeParse(["a", "b"]).success, true);
  assert.equal(s.safeParse([1]).success, false);
});

test("anyOf with null becomes nullable", () => {
  const s = jsonSchemaToZod({ anyOf: [{ type: "number" }, { type: "null" }] });
  assert.equal(s.safeParse(5).success, true);
  assert.equal(s.safeParse(null).success, true);
  assert.equal(s.safeParse("x").success, false);
});

test("unknown schema accepts anything", () => {
  const s = jsonSchemaToZod({});
  assert.equal(s.safeParse({ anything: true }).success, true);
});
