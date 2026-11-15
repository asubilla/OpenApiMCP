import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, filterToolsByContext, buildConditionMap } from "../src/conditional.js";
import type { ToolCondition, ConditionContext } from "../src/conditional.js";
import type { ToolDef } from "../src/types.js";

function tool(over: Partial<ToolDef> = {}): ToolDef {
  return {
    name: "getUser",
    description: "",
    method: "get",
    path: "/u",
    params: [],
    bodyObject: false,
    tags: [],
    annotations: {},
    security: { headers: {}, query: {} },
    ...over
  };
}

test("evaluateCondition: roles match", () => {
  const cond: ToolCondition = { tool: "t", roles: ["admin", "editor"] };
  const ctx: ConditionContext = { roles: ["editor", "viewer"] };
  assert.equal(evaluateCondition(cond, ctx), true);
});

test("evaluateCondition: roles mismatch", () => {
  const cond: ToolCondition = { tool: "t", roles: ["admin"] };
  const ctx: ConditionContext = { roles: ["viewer"] };
  assert.equal(evaluateCondition(cond, ctx), false);
});

test("evaluateCondition: context match", () => {
  const cond: ToolCondition = { tool: "t", contexts: { region: "eu", count: 2 } };
  const ctx: ConditionContext = { attributes: { region: "eu", count: 2, extra: true } };
  assert.equal(evaluateCondition(cond, ctx), true);
});

test("evaluateCondition: context mismatch", () => {
  const cond: ToolCondition = { tool: "t", contexts: { region: "eu" } };
  const ctx: ConditionContext = { attributes: { region: "us" } };
  assert.equal(evaluateCondition(cond, ctx), false);
});

test("evaluateCondition: enabled false", () => {
  const cond: ToolCondition = { tool: "t", enabled: false };
  const ctx: ConditionContext = {};
  assert.equal(evaluateCondition(cond, ctx), false);
});

test("evaluateCondition: default true", () => {
  const cond: ToolCondition = { tool: "t" };
  const ctx: ConditionContext = {};
  assert.equal(evaluateCondition(cond, ctx), true);
});

test("filterToolsByContext: include/exclude", () => {
  const tools = [tool({ name: "a" }), tool({ name: "b" })];
  const conditions: ToolCondition[] = [{ tool: "b", roles: ["admin"] }];
  const ctx: ConditionContext = { roles: ["viewer"] };
  const out = filterToolsByContext(tools, conditions, ctx);
  assert.deepEqual(out.map((t) => t.name), ["a"]);
});

test("buildConditionMap: indexes by tool name", () => {
  const conditions: ToolCondition[] = [
    { tool: "x", enabled: true },
    { tool: "y", roles: ["r"] }
  ];
  const map = buildConditionMap(conditions);
  assert.equal(map.size, 2);
  assert.equal(map.get("x")?.tool, "x");
  assert.equal(map.get("y")?.roles?.[0], "r");
});
