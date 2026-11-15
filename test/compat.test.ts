import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSpecCompat, formatCompatReport } from "../src/compat.js";

const spec = {
  openapi: "3.0.3",
  info: { title: "t", version: "1" },
  servers: [{ url: "https://x" }],
  paths: {
    "/ok": { get: { operationId: "ok", responses: { "200": { description: "ok" } } } },
    "/partial": {
      post: { operationId: "partial", requestBody: { content: { "application/json": { schema: { oneOf: [{ type: "string" }] } } } }, responses: { "200": { description: "ok" } } }
    },
    "/multipart": {
      post: { operationId: "multipart", requestBody: { content: { "multipart/form-data": { schema: { type: "object" } } } }, responses: { "200": { description: "ok" } } }
    },
    "/callbacks": {
      post: { operationId: "cb", callbacks: { onSomething: {} }, responses: { "200": { description: "ok" } } }
    },
    "/header": {
      get: { operationId: "hdr", parameters: [{ name: "X-Key", in: "header", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } }
    },
    "/deprecated": {
      get: { operationId: "dep", deprecated: true, responses: { "200": { description: "ok" } } }
    }
  }
};

test("analyzeSpecCompat categorizes operations", () => {
  const r = analyzeSpecCompat(spec);
  const byId = new Map(r.entries.map((e) => [e.operationId, e]));
  assert.equal(byId.get("ok")?.status, "supported");
  assert.equal(byId.get("partial")?.status, "partial");
  assert.equal(byId.get("multipart")?.status, "unsupported");
  assert.equal(byId.get("cb")?.status, "partial");
  assert.equal(byId.get("hdr")?.status, "partial");
  assert.equal(byId.get("dep")?.status, "partial");
  const s = r.summary;
  assert.equal(s.supported, 1);
  assert.ok(s.unsupported >= 1);
  assert.ok(s.partial >= 4);
});

test("formatCompatReport includes counts and entries", () => {
  const out = formatCompatReport(analyzeSpecCompat(spec));
  assert.match(out, /supported:\s+1/);
  assert.match(out, /unsupported:\s+1/);
  assert.match(out, /multipart/);
  assert.match(out, /✓/);
});
