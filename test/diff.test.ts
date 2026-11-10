import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSpecs } from "../src/diff.js";

function spec(paths: Record<string, any>): any {
  return { openapi: "3.0.0", info: { title: "T", version: "1" }, paths };
}

const base = spec({
  "/pets": {
    get: {
      description: "list pets",
      parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
      responses: { "200": {}, "404": {} }
    },
    post: { responses: { "201": {} } }
  },
  "/pets/{id}": {
    get: {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": {} }
    }
  }
});

test("identical specs produce no changes", () => {
  const result = diffSpecs(structuredClone(base), structuredClone(base));
  assert.deepEqual(result, { breaking: [], nonBreaking: [] });
});

test("removed path is breaking", () => {
  const b = structuredClone(base);
  delete b.paths["/pets/{id}"];
  const { breaking, nonBreaking } = diffSpecs(base, b);
  assert.equal(breaking.length, 1);
  assert.equal(breaking[0].kind, "path-removed");
  assert.equal(breaking[0].path, "/pets/{id}");
  assert.deepEqual(nonBreaking, []);
});

test("added path is non-breaking", () => {
  const b = structuredClone(base);
  b.paths["/owners"] = { get: { responses: { "200": {} } } };
  const { breaking, nonBreaking } = diffSpecs(base, b);
  assert.equal(breaking.length, 0);
  assert.equal(nonBreaking.length, 1);
  assert.equal(nonBreaking[0].kind, "path-added");
  assert.equal(nonBreaking[0].path, "/owners");
});

test("removed operation is breaking, added operation is non-breaking", () => {
  const b = structuredClone(base);
  delete b.paths["/pets"].post;
  b.paths["/pets"].delete = { responses: { "204": {} } };
  const { breaking, nonBreaking } = diffSpecs(base, b);
  assert.ok(breaking.some((c) => c.kind === "operation-removed" && c.method === "post"));
  assert.ok(nonBreaking.some((c) => c.kind === "operation-added" && c.method === "delete"));
});

test("added required parameter is breaking", () => {
  const b = structuredClone(base);
  b.paths["/pets/{id}"].get.parameters.push({ name: "expand", in: "query", required: true, schema: { type: "boolean" } });
  const { breaking } = diffSpecs(base, b);
  assert.ok(breaking.some((c) => c.kind === "parameter-added-required" && c.detail.includes("expand")));
});

test("path parameters are implicitly required", () => {
  const a = spec({ "/x": { get: { parameters: [], responses: {} } } });
  const b = spec({ "/x": { get: { parameters: [{ name: "id", in: "path", schema: { type: "string" } }], responses: {} } } });
  const { breaking } = diffSpecs(a, b);
  assert.ok(breaking.some((c) => c.kind === "parameter-added-required"));
});

test("added optional parameter is non-breaking", () => {
  const b = structuredClone(base);
  b.paths["/pets"].get.parameters.push({ name: "page", in: "query", schema: { type: "integer" } });
  const { breaking, nonBreaking } = diffSpecs(base, b);
  assert.equal(breaking.length, 0);
  assert.ok(nonBreaking.some((c) => c.kind === "parameter-added-optional"));
});

test("parameter type change is breaking", () => {
  const b = structuredClone(base);
  b.paths["/pets"].get.parameters[0].schema.type = "string";
  const { breaking } = diffSpecs(base, b);
  assert.ok(breaking.some((c) => c.kind === "parameter-type-changed" && c.detail.includes("query:limit")));
});

test("narrowed enum is breaking", () => {
  const a = spec({
    "/x": { get: { parameters: [{ name: "sort", in: "query", schema: { type: "string", enum: ["asc", "desc"] } }], responses: {} } }
  });
  const b = spec({
    "/x": { get: { parameters: [{ name: "sort", in: "query", schema: { type: "string", enum: ["asc"] } }], responses: {} } }
  });
  const { breaking } = diffSpecs(a, b);
  assert.ok(breaking.some((c) => c.kind === "parameter-enum-narrowed"));
});

test("widened enum is not breaking", () => {
  const a = spec({
    "/x": { get: { parameters: [{ name: "sort", in: "query", schema: { type: "string", enum: ["asc"] } }], responses: {} } }
  });
  const b = spec({
    "/x": { get: { parameters: [{ name: "sort", in: "query", schema: { type: "string", enum: ["asc", "desc"] } }], responses: {} } }
  });
  const { breaking } = diffSpecs(a, b);
  assert.equal(breaking.length, 0);
});

test("removed response code is breaking, added one is non-breaking", () => {
  const b = structuredClone(base);
  delete b.paths["/pets"].get.responses["404"];
  b.paths["/pets"].get.responses["429"] = {};
  const { breaking, nonBreaking } = diffSpecs(base, b);
  assert.ok(breaking.some((c) => c.kind === "response-removed" && c.detail.includes("404")));
  assert.ok(nonBreaking.some((c) => c.kind === "response-added" && c.detail.includes("429")));
});

test("description-only change is non-breaking", () => {
  const b = structuredClone(base);
  b.paths["/pets"].get.description = "list all pets";
  const { breaking, nonBreaking } = diffSpecs(base, b);
  assert.equal(breaking.length, 0);
  assert.ok(nonBreaking.some((c) => c.kind === "description-changed"));
});

test("output order is deterministic", () => {
  const b = structuredClone(base);
  delete b.paths["/pets/{id}"];
  delete b.paths["/pets"].post;
  b.paths["/owners"] = { get: { responses: {} } };
  const first = diffSpecs(base, b);
  const second = diffSpecs(structuredClone(base), structuredClone(b));
  assert.deepEqual(first, second);
  const keys = first.breaking.map((c) => `${c.path} ${c.method ?? ""} ${c.kind}`);
  assert.deepEqual(keys, [...keys].sort());
});
