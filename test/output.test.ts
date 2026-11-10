import { test } from "node:test";
import assert from "node:assert/strict";
import { toOutputSchema, structuredContent } from "../src/output.js";

test("keeps only supported keywords for an object schema", () => {
  const input = {
    type: "object",
    title: "Pet",
    "x-extra": true,
    properties: {
      id: { type: "integer", format: "int64", "x-note": "internal" },
      name: { type: "string", description: "the pet name" },
    },
    required: ["id"],
    additionalProperties: true,
  };
  assert.deepEqual(toOutputSchema(input), {
    type: "object",
    properties: {
      id: { type: "integer" },
      name: { type: "string", description: "the pet name" },
    },
    required: ["id"],
  });
});

test("treats a schema with properties but no explicit object type as an object", () => {
  assert.deepEqual(toOutputSchema({ properties: { id: { type: "integer" } } }), {
    properties: { id: { type: "integer" } },
  });
});

test("keeps additionalProperties only when false", () => {
  assert.deepEqual(toOutputSchema({ type: "object", properties: {}, additionalProperties: false }), {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
});

test("recurses into array items", () => {
  const input = {
    type: "object",
    properties: {
      list: { type: "array", items: { type: "string", description: "a tag" } },
    },
  };
  assert.deepEqual(toOutputSchema(input), input);
});

test("keeps enum values", () => {
  const input = { type: "object", properties: { status: { type: "string", enum: ["a", "b"] } } };
  assert.deepEqual(toOutputSchema(input), input);
});

test("returns undefined for non-object schemas", () => {
  assert.equal(toOutputSchema({ type: "string" }), undefined);
  assert.equal(toOutputSchema({ type: "array", items: { type: "string" } }), undefined);
  assert.equal(toOutputSchema({ type: "integer" }), undefined);
});

test("returns undefined when a top-level $ref remains", () => {
  assert.equal(toOutputSchema({ $ref: "#/components/schemas/Pet" }), undefined);
});

test("returns undefined when a nested $ref remains", () => {
  const input = { type: "object", properties: { owner: { $ref: "#/components/schemas/Owner" } } };
  assert.equal(toOutputSchema(input), undefined);
});

test("returns undefined for null or primitive inputs", () => {
  assert.equal(toOutputSchema(null), undefined);
  assert.equal(toOutputSchema(undefined), undefined);
  assert.equal(toOutputSchema("object"), undefined);
});

test("structuredContent wraps objects", () => {
  const value = { id: 1, name: "Rex" };
  assert.deepEqual(structuredContent(value), { structuredContent: value });
});

test("structuredContent returns undefined for primitives and null", () => {
  assert.equal(structuredContent("hello"), undefined);
  assert.equal(structuredContent(42), undefined);
  assert.equal(structuredContent(true), undefined);
  assert.equal(structuredContent(null), undefined);
  assert.equal(structuredContent(undefined), undefined);
});
