import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_PRICING,
  CostTracker,
  estimateTokens,
  lookupPrice,
  computeCost,
  formatCost,
} from "../src/cost.js";
import type { CostEntry } from "../src/cost.js";

test("estimateTokens uses ~4 chars per token with min 1", () => {
  assert.equal(estimateTokens(""), 1);
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("a".repeat(8)), 2);
});

test("lookupPrice known and unknown, case-insensitive", () => {
  assert.ok(lookupPrice("gpt-4o"));
  assert.equal(lookupPrice("GPT-4O")?.inputPer1k, lookupPrice("gpt-4o")?.inputPer1k);
  assert.equal(lookupPrice("nope"), undefined);
});

test("computeCost returns 0 for unknown model", () => {
  assert.equal(computeCost("nope", 1000, 1000), 0);
});

test("computeCost computes USD from pricing", () => {
  const p = lookupPrice("gpt-4o")!;
  const expected = (1000 / 1000) * p.inputPer1k + (500 / 1000) * p.outputPer1k;
  assert.equal(computeCost("gpt-4o", 1000, 500), expected);
});

test("CostTracker record auto-computes cost and time", () => {
  const t = new CostTracker();
  t.record({ tool: "getUser", model: "gpt-4o", inputTokens: 100, outputTokens: 50 });
  const s = t.summary();
  assert.equal(s.totalCalls, 1);
  assert.equal(s.byTool.getUser.calls, 1);
  assert.ok(s.totalCostUsd > 0);
});

test("CostTracker record uses provided costUsd and time", () => {
  const t = new CostTracker();
  t.record({ tool: "x", model: "gpt-4o", inputTokens: 1, outputTokens: 1, costUsd: 0.42, time: "T" });
  const s = t.summary();
  assert.equal(s.totalCostUsd, 0.42);
});

test("CostTracker summary aggregates by tool and model", () => {
  const t = new CostTracker();
  t.record({ tool: "a", model: "gpt-4o", inputTokens: 10, outputTokens: 10, costUsd: 0.1 });
  t.record({ tool: "a", model: "gpt-4o-mini", inputTokens: 10, outputTokens: 10, costUsd: 0.2 });
  t.record({ tool: "b", model: "gpt-4o", inputTokens: 10, outputTokens: 10, costUsd: 0.3 });
  const s = t.summary();
  assert.equal(s.totalCalls, 3);
  assert.equal(s.totalCostUsd, 0.6);
  assert.equal(s.byTool.a.calls, 2);
  assert.equal(s.byTool.a.costUsd, 0.3);
  assert.equal(s.byTool.b.calls, 1);
  assert.equal(s.byModel["gpt-4o"].calls, 2);
});

test("CostTracker render returns readable table", () => {
  const t = new CostTracker();
  t.record({ tool: "getUser", model: "gpt-4o", inputTokens: 10, outputTokens: 10, costUsd: 0.0034 });
  const r = t.render();
  assert.match(r, /getUser/);
  assert.match(r, /\$0\.0034/);
  assert.match(r, /Total/);
});

test("formatCost formats to 4 decimals", () => {
  assert.equal(formatCost(0.0034), "$0.0034");
  assert.equal(formatCost(0), "$0.0000");
});

test("MODEL_PRICING has required models", () => {
  for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus", "gemini-1.5-pro", "gemini-1.5-flash"]) {
    assert.ok(MODEL_PRICING[m]);
  }
});

test("CostEntry type usable", () => {
  const e: CostEntry = { tool: "t", model: "gpt-4o", inputTokens: 1, outputTokens: 1, costUsd: 0, time: "x" };
  assert.equal(e.tool, "t");
});
