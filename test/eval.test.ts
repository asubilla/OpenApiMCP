import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolDef } from "../src/types.js";
import { evaluateToolSelection, formatEvalReport } from "../src/eval.js";

function tool(name: string, description = "", tags: string[] = []): ToolDef {
  return {
    name,
    description,
    method: "GET",
    path: "/",
    params: [],
    bodyObject: false,
    tags,
    annotations: {},
    security: { headers: {}, query: {} },
  };
}

test("matching queries pass", () => {
  const tools = [tool("getPet", "get a pet", ["pet"]), tool("createOrder", "create order", ["order"])];
  const report = evaluateToolSelection(tools, [
    { query: "pet", expectedTool: "getPet" },
    { query: "order", expectedTool: "createOrder" },
  ]);
  assert.equal(report.total, 2);
  assert.equal(report.passed, 2);
  assert.equal(report.accuracy, 1);
  assert.ok(report.results.every((r) => r.passed));
  assert.ok(report.results.every((r) => r.score === 1));
});

test("mismatched queries fail", () => {
  const tools = [tool("getPet", "get a pet", ["pet"]), tool("createOrder", "create order", ["order"])];
  const report = evaluateToolSelection(tools, [
    { query: "pet", expectedTool: "createOrder" },
  ]);
  assert.equal(report.passed, 0);
  assert.equal(report.accuracy, 0);
  assert.equal(report.results[0].actual, "getPet");
  assert.equal(report.results[0].score, 0);
  assert.ok(!report.results[0].passed);
});

test("accuracy computed", () => {
  const tools = [tool("getPet", "get a pet", ["pet"]), tool("createOrder", "create order", ["order"])];
  const report = evaluateToolSelection(tools, [
    { query: "pet", expectedTool: "getPet" },
    { query: "order", expectedTool: "getPet" },
  ]);
  assert.equal(report.total, 2);
  assert.equal(report.passed, 1);
  assert.equal(report.accuracy, 0.5);
});

test("format contains accuracy and tool names", () => {
  const tools = [tool("getPet", "get a pet", ["pet"])];
  const report = evaluateToolSelection(tools, [{ query: "pet", expectedTool: "getPet" }]);
  const text = formatEvalReport(report);
  assert.match(text, /accuracy/i);
  assert.match(text, /getPet/);
  assert.match(text, /%/);
});