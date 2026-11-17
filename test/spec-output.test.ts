import { test } from "node:test";
import assert from "node:assert/strict";
import {
  responseSchemaForOperation,
  toolOutputSchema,
  collectResponseSchemas,
  formatOutputSchemaSummary,
} from "../src/spec-output.js";

const petSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
  },
  required: ["id"],
};

const jsonContent = (schema: any) => ({
  "application/json": { schema },
});

const opWith = (responses: any) => ({ responses });

test("prefers 200 over 201 and default", () => {
  const op = opWith({
    default: { content: jsonContent({ type: "object", properties: { source: { type: "string" } } }) },
    "201": { content: jsonContent({ type: "object", properties: { from201: { type: "integer" } } }) },
    "200": { content: jsonContent(petSchema) },
  });
  assert.deepEqual(responseSchemaForOperation(op), petSchema);
});

test("prefers 201 over default when 200 is absent", () => {
  const created = { type: "object", properties: { created: { type: "boolean" } } };
  const op = opWith({
    default: { content: jsonContent({ type: "object", properties: {} }) },
    "201": { content: jsonContent(created) },
  });
  assert.deepEqual(responseSchemaForOperation(op), created);
});

test("falls back to default when no 2xx key is present", () => {
  const fallback = { type: "object", properties: { fallback: { type: "string" } } };
  const op = opWith({
    "400": { content: jsonContent({ type: "object", properties: {} }) },
    default: { content: jsonContent(fallback) },
  });
  assert.deepEqual(responseSchemaForOperation(op), fallback);
});

test("defaultViaDefault: false excludes the default response", () => {
  const op = opWith({
    default: { content: jsonContent(petSchema) },
  });
  assert.equal(responseSchemaForOperation(op, false), undefined);
  assert.deepEqual(responseSchemaForOperation(op, true), petSchema);
  assert.deepEqual(responseSchemaForOperation(op), petSchema);
});

test("falls back to the first other 2xx key in ascending order", () => {
  const schema202 = { type: "object", properties: { accepted: { type: "boolean" } } };
  const op = opWith({
    "206": { content: jsonContent({ type: "object", properties: { partial: { type: "boolean" } } }) },
    "202": { content: jsonContent(schema202) },
    "400": { content: jsonContent({ type: "object", properties: {} }) },
  });
  assert.deepEqual(responseSchemaForOperation(op), schema202);
});

test("returns undefined for an op with no 200/201/default/2xx response", () => {
  assert.equal(responseSchemaForOperation(opWith({})), undefined);
  assert.equal(responseSchemaForOperation(opWith({ "400": { content: jsonContent(petSchema) } })), undefined);
  assert.equal(responseSchemaForOperation({}), undefined);
  assert.equal(responseSchemaForOperation(undefined), undefined);
  assert.equal(responseSchemaForOperation(null), undefined);
  assert.equal(responseSchemaForOperation(opWith("nope")), undefined);
});

test("picks application/json among other content types", () => {
  const op = opWith({
    "200": {
      content: {
        "text/plain": { schema: { type: "string" } },
        "application/xml": { schema: { type: "object", properties: { xml: { type: "string" } } } },
        "application/json": { schema: petSchema },
      },
    },
  });
  assert.deepEqual(responseSchemaForOperation(op), petSchema);
});

test("matches application/json with parameters via substring", () => {
  const op = opWith({
    "200": {
      content: {
        "application/json; charset=utf-8": { schema: petSchema },
      },
    },
  });
  assert.deepEqual(responseSchemaForOperation(op), petSchema);
});

test("matches application/problem+json and */*+json media types", () => {
  const problem = { type: "object", properties: { title: { type: "string" } } };
  const vnd = { type: "object", properties: { vendor: { type: "string" } } };
  const problemOp = opWith({
    "200": { content: { "application/problem+json": { schema: problem } } },
  });
  const vndOp = opWith({
    "200": { content: { "application/vnd.example+json": { schema: vnd } } },
  });
  assert.deepEqual(responseSchemaForOperation(problemOp), problem);
  assert.deepEqual(responseSchemaForOperation(vndOp), vnd);
});

test("returns undefined when 200 has no JSON content", () => {
  const op = opWith({
    "200": {
      content: {
        "text/plain": { schema: { type: "string" } },
      },
    },
  });
  assert.equal(responseSchemaForOperation(op), undefined);
  assert.equal(responseSchemaForOperation(opWith({ "200": {} })), undefined);
  assert.equal(responseSchemaForOperation(opWith({ "200": { content: "nope" } })), undefined);
});

test("toolOutputSchema collapses a plain object response schema", () => {
  const op = opWith({ "200": { content: jsonContent(petSchema) } });
  assert.deepEqual(toolOutputSchema(op), petSchema);
});

test("toolOutputSchema returns undefined when the response schema contains a $ref", () => {
  const op = opWith({
    "200": {
      content: jsonContent({
        type: "object",
        properties: { owner: { $ref: "#/components/schemas/Owner" } },
      }),
    },
  });
  // Raw responseSchemaForOperation still surfaces the schema (with the $ref)...
  assert.deepEqual(responseSchemaForOperation(op), {
    type: "object",
    properties: { owner: { $ref: "#/components/schemas/Owner" } },
  });
  // ...but the MCP output schema refuses it.
  assert.equal(toolOutputSchema(op), undefined);
});

test("toolOutputSchema returns undefined for a top-level $ref response schema", () => {
  const op = opWith({
    "200": { content: jsonContent({ $ref: "#/components/schemas/Pet" }) },
  });
  assert.equal(toolOutputSchema(op), undefined);
});

test("toolOutputSchema returns undefined for non-object response schemas", () => {
  const op = opWith({
    "200": { content: jsonContent({ type: "array", items: { type: "string" } }) },
  });
  assert.equal(toolOutputSchema(op), undefined);
});

test("collectResponseSchemas aggregates a flat method+path map", () => {
  const doc = {
    openapi: "3.0.0",
    paths: {
      "/pets": {
        parameters: [{ name: "x", in: "query" }], // ignored: not a method
        GET: opWith({ "200": { content: jsonContent(petSchema) } }), // mixed-case method
        post: opWith({ "201": { content: jsonContent(petSchema) } }),
      },
      "/broken": {
        get: opWith({
          "200": {
            content: jsonContent({
              type: "object",
              properties: { bad: { $ref: "#/components/schemas/Nope" } },
            }),
          },
        }),
      },
      "/empty": {
        delete: opWith({ "400": { content: jsonContent(petSchema) } }),
      },
      "/not-an-object": "ignore me",
    },
  };
  const map = collectResponseSchemas(doc);
  assert.deepEqual(map["get /pets"], petSchema);
  assert.deepEqual(map["post /pets"], petSchema);
  assert.equal(map["get /broken"], undefined);
  assert.equal(map["delete /empty"], undefined);
  assert.equal(Object.keys(map).length, 4);
  assert.ok(!("parameters /pets" in map));
});

test("collectResponseSchemas tolerates missing or malformed docs", () => {
  assert.deepEqual(collectResponseSchemas(undefined), {});
  assert.deepEqual(collectResponseSchemas(null), {});
  assert.deepEqual(collectResponseSchemas({}), {});
  assert.deepEqual(collectResponseSchemas({ paths: "nope" }), {});
  assert.deepEqual(collectResponseSchemas({ paths: ["/pets"] }), {});
});

test("formatOutputSchemaSummary renders one line per op", () => {
  const summary = formatOutputSchemaSummary({
    "get /pets": { type: "object", properties: {} },
    "delete /pets/{id}": undefined,
  });
  assert.equal(summary, "get /pets: schema ✓\ndelete /pets/{id}: schema —");
  assert.equal(formatOutputSchemaSummary({}), "");
});

test("collectResponseSchemas + formatOutputSchemaSummary end-to-end on a fake doc", () => {
  const doc = {
    paths: {
      "/pets": {
        get: opWith({ "200": { content: jsonContent(petSchema) } }),
        post: opWith({ "201": { content: jsonContent({ $ref: "#/components/schemas/Pet" }) } }),
      },
    },
  };
  const summary = formatOutputSchemaSummary(collectResponseSchemas(doc));
  assert.equal(summary, "get /pets: schema ✓\npost /pets: schema —");
});
