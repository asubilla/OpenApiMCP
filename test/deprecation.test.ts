import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDeprecated,
  extractDeprecation,
  warnInactive,
  annotateTools,
  filterDeprecated,
  formatDeprecationWarnings,
} from "../src/deprecation.js";
import type { ToolDef } from "../src/types.js";

function makeTool(
  name: string,
  method = "get",
  path = "/thing",
  description = "does a thing"
): ToolDef {
  return {
    name,
    description,
    method,
    path,
    params: [],
    bodyObject: false,
    tags: [],
    annotations: {},
    security: { headers: {}, query: {} },
  };
}

const spec = {
  paths: {
    "/old": {
      get: {
        operationId: "oldOp",
        deprecated: true,
        sunset: "2027-06-01",
        "x-message": "use newOp instead",
        "x-replacement": "newOp",
      },
    },
    "/sunset-only": {
      post: {
        operationId: "sunsetOp",
        sunset: "2028-01-01T00:00:00Z",
      },
    },
    "/xdep": {
      delete: {
        operationId: "xDepOp",
        "x-deprecated": true,
      },
    },
    "/fresh": {
      get: {
        operationId: "newOp",
        summary: "fresh operation",
      },
    },
  },
};

test("isDeprecated detects deprecated flag", () => {
  assert.equal(isDeprecated({ deprecated: true }), true);
  assert.equal(isDeprecated({ deprecated: false }), false);
  assert.equal(isDeprecated({}), false);
  assert.equal(isDeprecated(undefined), false);
  assert.equal(isDeprecated(null), false);
});

test("isDeprecated detects x-deprecated flag", () => {
  assert.equal(isDeprecated({ "x-deprecated": true }), true);
  assert.equal(isDeprecated({ "x-deprecated": false }), false);
});

test("isDeprecated detects sunset and expires dates", () => {
  assert.equal(isDeprecated({ sunset: "2027-06-01" }), true);
  assert.equal(isDeprecated({ expires: "2027-06-01" }), true);
  assert.equal(isDeprecated({ "x-sunset": "2027-06-01" }), true);
  assert.equal(isDeprecated({ "x-expires": "2027-06-01" }), true);
  assert.equal(isDeprecated({ sunset: "" }), false);
});

test("extractDeprecation pulls operationId, dates, message and replacement", () => {
  const info = extractDeprecation(spec.paths["/old"].get);
  assert.equal(info.operationId, "oldOp");
  assert.equal(info.sunset, "2027-06-01");
  assert.equal(info.message, "use newOp instead");
  assert.equal(info.replacement, "newOp");
});

test("extractDeprecation maps expires and x-sunset onto sunset", () => {
  assert.equal(extractDeprecation({ expires: "2029-01-01" }).sunset, "2029-01-01");
  assert.equal(extractDeprecation({ "x-sunset": "2029-02-02" }).sunset, "2029-02-02");
});

test("extractDeprecation handles x-deprecated string dates and non-objects", () => {
  assert.equal(extractDeprecation({ "x-deprecated": "2026-01-01" }).deprecatedAt, "2026-01-01");
  assert.deepEqual(extractDeprecation(undefined), {});
  assert.deepEqual(extractDeprecation(null), {});
});

test("warnInactive reports deprecated tools matched by operationId", () => {
  const tools = [
    makeTool("oldOp", "get", "/old"),
    makeTool("sunsetOp", "post", "/sunset-only"),
    makeTool("newOp", "get", "/fresh"),
  ];
  const warnings = warnInactive(tools, spec);
  assert.deepEqual(warnings, [
    { tool: "oldOp", reason: "sunset: 2027-06-01" },
    { tool: "sunsetOp", reason: "sunset: 2028-01-01T00:00:00Z" },
  ]);
});

test("warnInactive matches sanitized operationIds and reports plain deprecated", () => {
  const sanitizedSpec = {
    paths: {
      "/legacy": {
        get: { operationId: "legacy.op v2", deprecated: true },
      },
    },
  };
  const tools = [makeTool("legacy_op_v2", "get", "/legacy")];
  assert.deepEqual(warnInactive(tools, sanitizedSpec), [
    { tool: "legacy_op_v2", reason: "deprecated" },
  ]);
});

test("warnInactive falls back to tool markers without a spec", () => {
  const tool = makeTool("marked", "get", "/m");
  (tool.annotations as any).titlePrefix = "[DEPRECATED] ";
  assert.deepEqual(warnInactive([tool]), [{ tool: "marked", reason: "deprecated" }]);
});

test("annotateTools marks deprecated tools and leaves others unchanged", () => {
  const tools = [
    makeTool("oldOp", "get", "/old", "legacy endpoint"),
    makeTool("newOp", "get", "/fresh", "fresh endpoint"),
  ];
  const annotated = annotateTools(tools, spec);
  const oldTool = annotated.find((t) => t.name === "oldOp")!;
  const freshTool = annotated.find((t) => t.name === "newOp")!;
  assert.equal((oldTool.annotations as any).titlePrefix, "[DEPRECATED] ");
  assert.equal(oldTool.description, "legacy endpoint (deprecated)");
  assert.equal((freshTool.annotations as any).titlePrefix, undefined);
  assert.equal(freshTool.description, "fresh endpoint");
});

test("filterDeprecated excludes deprecated tools", () => {
  const tools = [
    makeTool("oldOp", "get", "/old"),
    makeTool("sunsetOp", "post", "/sunset-only"),
    makeTool("xDepOp", "delete", "/xdep"),
    makeTool("newOp", "get", "/fresh"),
  ];
  const kept = filterDeprecated(tools, spec);
  assert.deepEqual(kept.map((t) => t.name), ["newOp"]);
});

test("formatDeprecationWarnings renders one line per entry", () => {
  const out = formatDeprecationWarnings([
    { tool: "oldOp", reason: "deprecated" },
    { tool: "sunsetOp", reason: "sunset: 2028-01-01" },
  ]);
  assert.equal(out, "oldOp: deprecated\nsunsetOp: sunset: 2028-01-01");
});

test("formatDeprecationWarnings handles an empty list", () => {
  assert.equal(formatDeprecationWarnings([]), "No deprecated operations.");
});
