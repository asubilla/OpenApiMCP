import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgainstSchema } from "../src/validate.js";

test("accepts a valid object", () => {
  const schema = {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "integer" },
      name: { type: "string", minLength: 1 },
      tags: { type: "array", items: { type: "string" } },
      status: { type: "string", enum: ["available", "sold"] },
    },
  };
  const result = validateAgainstSchema(
    { id: 3, name: "Rex", tags: ["dog"], status: "available" },
    schema,
  );
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("reports type errors with a nested path", () => {
  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
    },
  };
  const result = validateAgainstSchema({ items: [{ name: 5 }] }, schema);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["$.items[0].name: expected string"]);
});

test("reports a missing required property", () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } } };
  const result = validateAgainstSchema({}, schema);
  assert.deepEqual(result.errors, ['$: missing required property "a"']);
});

test("reports enum violations", () => {
  const result = validateAgainstSchema("c", { enum: ["a", "b"] });
  assert.deepEqual(result.errors, ['$: expected one of "a", "b"']);
});

test("supports union types", () => {
  const nullable = { type: ["string", "null"] };
  assert.equal(validateAgainstSchema(null, nullable).valid, true);
  assert.equal(validateAgainstSchema("x", nullable).valid, true);
  assert.deepEqual(validateAgainstSchema(5, nullable).errors, ["$: expected string or null"]);
});

test("distinguishes integer from number", () => {
  assert.equal(validateAgainstSchema(3, { type: "integer" }).valid, true);
  assert.equal(validateAgainstSchema(3, { type: "number" }).valid, true);
  assert.deepEqual(validateAgainstSchema(3.5, { type: "integer" }).errors, ["$: expected integer"]);
});

test("enforces numeric bounds", () => {
  const schema = { type: "number", minimum: 0, maximum: 10 };
  assert.deepEqual(validateAgainstSchema(11, schema).errors, ["$: must be <= 10"]);
  assert.deepEqual(validateAgainstSchema(-1, schema).errors, ["$: must be >= 0"]);
});

test("enforces string length bounds", () => {
  const schema = { type: "string", minLength: 3, maxLength: 5 };
  assert.deepEqual(validateAgainstSchema("hi", schema).errors, ["$: length must be >= 3"]);
  assert.deepEqual(validateAgainstSchema("toolong", schema).errors, ["$: length must be <= 5"]);
});

test("enforces array size bounds", () => {
  const schema = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 3 };
  assert.deepEqual(validateAgainstSchema([1], schema).errors, ["$: must have at least 2 items"]);
  assert.deepEqual(validateAgainstSchema([1, 2, 3, 4], schema).errors, ["$: must have at most 3 items"]);
});

test("rejects additional properties when disabled", () => {
  const schema = { type: "object", properties: { a: { type: "string" } }, additionalProperties: false };
  assert.deepEqual(validateAgainstSchema({ a: "x", b: 1 }, schema).errors, [
    '$: additional property "b" is not allowed',
  ]);
});

test("collects multiple errors", () => {
  const schema = {
    type: "object",
    required: ["a"],
    properties: { a: { type: "string" }, b: { type: "number", minimum: 5 } },
  };
  const result = validateAgainstSchema({ b: 1 }, schema);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.sort(), [
    "$.b: must be >= 5",
    '$: missing required property "a"',
  ]);
});
