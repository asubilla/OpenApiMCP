import { test } from "node:test";
import assert from "node:assert/strict";
import { lintSpec, formatLint } from "../src/lint.js";

function cleanSpec(): any {
  return {
    openapi: "3.0.0",
    info: { title: "T", version: "1" },
    servers: [{ url: "https://example.com" }],
    paths: {
      "/pets": {
        get: {
          summary: "list pets",
          operationId: "listPets",
          parameters: [{ name: "limit", in: "query", description: "max items", schema: { type: "integer" } }],
          responses: { "200": { description: "ok" } }
        }
      }
    },
    components: {
      schemas: {
        Pet: { type: "object", properties: { name: { type: "string" } } }
      }
    }
  };
}

test("clean spec scores 100", () => {
  const result = lintSpec(cleanSpec());
  assert.equal(result.score, 100);
  assert.equal(result.issues.length, 0);
});

test("missing title/version/paths errors", () => {
  const spec: any = { openapi: "3.0.0", info: {}, paths: {} };
  // remove paths to trigger no-paths
  delete spec.paths;
  const result = lintSpec(spec);
  const errors = result.issues.filter((i) => i.severity === "error");
  assert.ok(errors.some((i) => i.rule === "missing-info-title"));
  assert.ok(errors.some((i) => i.rule === "missing-info-version"));
  assert.ok(errors.some((i) => i.rule === "no-paths"));
});

test("missing summary warnings", () => {
  const spec = cleanSpec();
  delete spec.paths["/pets"].get.summary;
  delete spec.paths["/pets"].get.description;
  const result = lintSpec(spec);
  assert.ok(result.issues.some((i) => i.severity === "warning" && i.rule === "missing-summary-and-description"));
});

test("duplicate operationId error", () => {
  const spec = cleanSpec();
  spec.paths["/owners"] = { get: { summary: "x", operationId: "listPets", responses: { "200": { description: "ok" } } } };
  const result = lintSpec(spec);
  assert.ok(result.issues.some((i) => i.severity === "error" && i.rule === "duplicate-operation-id"));
});

test("format contains score", () => {
  const result = lintSpec(cleanSpec());
  const text = formatLint(result);
  assert.match(text, /score/i);
  assert.match(text, /100/);
});
