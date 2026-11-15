import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDryRun, formatDryRun, redactHeaderValue } from "../src/dry-run.js";
import type { ToolDef } from "../src/types.js";

function makeTool(overrides: Partial<ToolDef> = {}): ToolDef {
  return {
    name: "test_tool",
    description: "test tool",
    method: "get",
    path: "/pets/{petId}",
    params: [
      { argName: "petId", location: "path", origName: "petId", required: true, schema: { type: "string" } },
      { argName: "limit", location: "query", origName: "limit", required: false, schema: { type: "integer" } }
    ],
    bodyObject: false,
    tags: [],
    annotations: {},
    security: { headers: {}, query: {} },
    baseUrl: "https://api.example.com",
    ...overrides
  };
}

test("buildDryRun substitutes path params with encodeURIComponent", () => {
  const tool = makeTool();
  const out = buildDryRun(tool, { petId: "a b/c" });
  assert.equal(out.method, "GET");
  assert.equal(out.url, "https://api.example.com/pets/a%20b%2Fc");
  assert.equal(out.body, undefined);
});

test("buildDryRun appends query params and repeats arrays", () => {
  const tool = makeTool({
    path: "/pets",
    params: [
      { argName: "tag", location: "query", origName: "tag", required: false, schema: { type: "array" } },
      { argName: "limit", location: "query", origName: "limit", required: false, schema: { type: "integer" } }
    ]
  });
  const out = buildDryRun(tool, { tag: ["a", "b"], limit: 5 });
  assert.equal(out.url, "https://api.example.com/pets?tag=a&tag=b&limit=5");
});

test("buildDryRun includes security query params", () => {
  const tool = makeTool({ path: "/pets", params: [], security: { headers: {}, query: { api_key: "abc123" } } });
  const out = buildDryRun(tool, {});
  assert.equal(out.url, "https://api.example.com/pets?api_key=abc123");
});

test("buildDryRun builds JSON body from bodyObject args", () => {
  const tool = makeTool({
    method: "post",
    path: "/pets",
    bodyObject: true,
    params: [
      { argName: "name", location: "body", origName: "name", required: true, schema: { type: "string" } },
      { argName: "age", location: "body", origName: "age", required: false, schema: { type: "integer" } }
    ]
  });
  const out = buildDryRun(tool, { name: "rex", age: 3 });
  assert.equal(out.method, "POST");
  assert.equal(out.body, JSON.stringify({ name: "rex", age: 3 }));
  assert.equal(out.headers["content-type"], "application/json");
});

test("buildDryRun uses whole body arg when bodyObject is false", () => {
  const tool = makeTool({
    method: "post",
    path: "/pets",
    bodyObject: false,
    params: [
      { argName: "body", location: "body", origName: null, required: true, schema: { type: "object" } }
    ]
  });
  const payload = { name: "rex", tags: ["a"] };
  const out = buildDryRun(tool, { body: payload });
  assert.equal(out.body, JSON.stringify(payload));
});

test("buildDryRun masks authorization and x-api-key headers by default", () => {
  const tool = makeTool({
    security: { headers: { authorization: "Bearer secret-token", "x-api-key": "key-123" }, query: {} }
  });
  const out = buildDryRun(tool, { petId: "1" });
  assert.equal(out.headers.authorization, "***");
  assert.equal(out.headers["x-api-key"], "***");
});

test("buildDryRun preserves random non-sensitive headers", () => {
  const tool = makeTool();
  const out = buildDryRun(tool, { petId: "1" }, { headers: { "x-request-id": "req-42" } });
  assert.equal(out.headers["x-request-id"], "req-42");
  assert.equal(out.headers.accept, "application/json");
});

test("buildDryRun maskSecrets=false keeps sensitive values", () => {
  const tool = makeTool({ security: { headers: { authorization: "Bearer abc" }, query: {} } });
  const out = buildDryRun(tool, { petId: "1" }, { maskSecrets: false });
  assert.equal(out.headers.authorization, "Bearer abc");
});

test("buildDryRun opts.headers override tool security headers", () => {
  const tool = makeTool({ security: { headers: { "x-custom": "from-spec" }, query: {} } });
  const out = buildDryRun(tool, { petId: "1" }, { headers: { "x-custom": "from-opts" }, maskSecrets: false });
  assert.equal(out.headers["x-custom"], "from-opts");
});

test("buildDryRun strips trailing slashes from baseUrl and opts.baseUrl wins", () => {
  const tool = makeTool({ baseUrl: "https://api.example.com///" });
  const out = buildDryRun(tool, { petId: "1" });
  assert.equal(out.url, "https://api.example.com/pets/1");
  const out2 = buildDryRun(tool, { petId: "1" }, { baseUrl: "https://override.example.com/" });
  assert.equal(out2.url, "https://override.example.com/pets/1");
});

test("formatDryRun contains method, url, headers and body", () => {
  const tool = makeTool({
    method: "post",
    bodyObject: true,
    params: [{ argName: "name", location: "body", origName: "name", required: true, schema: { type: "string" } }]
  });
  const out = buildDryRun(tool, { name: "rex" });
  const text = formatDryRun(out);
  assert.match(text, /POST/);
  assert.match(text, /https:\/\/api\.example\.com\/pets\/\{petId\}/);
  assert.match(text, /accept: application\/json/);
  assert.match(text, /content-type: application\/json/);
  assert.match(text, /Body:/);
  assert.match(text, /"name":"rex"/);
});

test("formatDryRun omits body section when no body", () => {
  const out = buildDryRun(makeTool(), { petId: "9" });
  const text = formatDryRun(out);
  assert.match(text, /GET/);
  assert.doesNotMatch(text, /Body:/);
});

test("redactHeaderValue masks sensitive header names", () => {
  assert.equal(redactHeaderValue("Authorization", "Bearer x"), "***");
  assert.equal(redactHeaderValue("X-API-KEY", "k"), "***");
  assert.equal(redactHeaderValue("api-key", "k"), "***");
  assert.equal(redactHeaderValue("api_key", "k"), "***");
  assert.equal(redactHeaderValue("X-Auth-Token", "t"), "***");
  assert.equal(redactHeaderValue("client-secret", "s"), "***");
  assert.equal(redactHeaderValue("x-request-id", "req-1"), "req-1");
  assert.equal(redactHeaderValue("accept", "application/json"), "application/json");
});
