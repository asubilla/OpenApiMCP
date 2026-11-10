import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleFromSchema, mockResponse } from "../src/mock.js";

test("exampleFromSchema handles primitives", () => {
  assert.equal(exampleFromSchema({ type: "string" }), "string");
  assert.equal(exampleFromSchema({ type: "number" }), 0);
  assert.equal(exampleFromSchema({ type: "integer" }), 0);
  assert.equal(exampleFromSchema({ type: "boolean" }), false);
});

test("exampleFromSchema is format aware for strings", () => {
  assert.equal(exampleFromSchema({ type: "string", format: "date-time" }), "2020-01-01T00:00:00Z");
  assert.equal(exampleFromSchema({ type: "string", format: "email" }), "user@example.com");
  assert.equal(exampleFromSchema({ type: "string", format: "uuid" }), "00000000-0000-0000-0000-000000000000");
});

test("exampleFromSchema prefers explicit values", () => {
  assert.equal(exampleFromSchema({ type: "string", example: "given" }), "given");
  assert.equal(exampleFromSchema({ type: "string", default: "fallback" }), "fallback");
  assert.equal(exampleFromSchema({ type: "string", enum: ["red", "green"] }), "red");
  assert.equal(exampleFromSchema({ type: "string", examples: ["ex"] }), "ex");
});

test("exampleFromSchema builds arrays with a single item", () => {
  assert.deepEqual(exampleFromSchema({ type: "array", items: { type: "integer" } }), [0]);
  assert.deepEqual(exampleFromSchema({ type: "array" }), []);
});

test("exampleFromSchema builds objects per property", () => {
  const out = exampleFromSchema({
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
      tags: { type: "array", items: { type: "string" } }
    }
  });
  assert.deepEqual(out, { name: "string", age: 0, tags: ["string"] });
});

test("exampleFromSchema returns {} for an unresolved $ref", () => {
  assert.deepEqual(exampleFromSchema({ $ref: "#/components/schemas/Pet" }), {});
});

test("exampleFromSchema survives deep recursion without throwing", () => {
  let schema: any = { type: "string" };
  for (let i = 0; i < 50; i++) schema = { type: "object", properties: { child: schema } };
  assert.doesNotThrow(() => exampleFromSchema(schema));
});

const spec = {
  openapi: "3.0.0",
  paths: {
    "/pets": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "integer" }, name: { type: "string" } }
                }
              }
            }
          }
        }
      },
      post: {
        responses: {
          "201": {
            content: {
              "application/json": {
                examples: { created: { value: { id: 1, created: true } } }
              }
            }
          }
        }
      }
    },
    "/pets/{id}": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": { example: { id: 7, name: "Rex" } }
            }
          },
          "404": { description: "not found" }
        }
      }
    }
  }
};

test("mockResponse generates from a schema", () => {
  assert.deepEqual(mockResponse(spec, "/pets", "get"), { id: 0, name: "string" });
});

test("mockResponse uses an explicit example", () => {
  assert.deepEqual(mockResponse(spec, "/pets/{id}", "get", 200), { id: 7, name: "Rex" });
});

test("mockResponse uses an examples map value", () => {
  assert.deepEqual(mockResponse(spec, "/pets", "post"), { id: 1, created: true });
});

test("mockResponse returns undefined when there is no body", () => {
  assert.equal(mockResponse(spec, "/pets/{id}", "get", 404), undefined);
  assert.equal(mockResponse(spec, "/missing", "get"), undefined);
  assert.equal(mockResponse(spec, "/pets", "delete"), undefined);
});
