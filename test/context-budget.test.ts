import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  fitsInBudget,
  trimToBudget,
  budgetReport,
} from "../src/context-budget.js";
import type { BudgetOptions } from "../src/context-budget.js";

test("estimateTokens ceil with min 1", () => {
  assert.equal(estimateTokens(""), 1);
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcd", 4), 1);
  assert.equal(estimateTokens("abcde", 4), 2);
  assert.equal(estimateTokens("a".repeat(8), 4), 2);
  assert.equal(estimateTokens("abc", 2), 2);
});

test("fitsInBudget short text fits", () => {
  assert.equal(fitsInBudget("hello"), true);
});

test("fitsInBudget exact boundary", () => {
  // budget default = 8000 - 1000 = 7000 tokens; 7000*4 = 28000 chars
  const text = "a".repeat(28000);
  assert.equal(estimateTokens(text), 7000);
  assert.equal(fitsInBudget(text), true);
  const over = "a".repeat(28001);
  assert.equal(fitsInBudget(over), false);
});

test("trimToBudget long text produces marker and final fits", () => {
  const text = "a".repeat(100000);
  const res = trimToBudget(text);
  assert.equal(res.truncated, true);
  assert.ok(res.text.includes("\n... [trimmed to fit context budget]"));
  assert.equal(fitsInBudget(res.text), true);
  assert.equal(res.finalTokens <= 7000, true);
  assert.ok(res.originalTokens > res.finalTokens);
});

test("trimToBudget fits returns as-is", () => {
  const text = "short";
  const res = trimToBudget(text);
  assert.equal(res.truncated, false);
  assert.equal(res.text, text);
  assert.equal(res.originalTokens, res.finalTokens);
});

test("charsPerToken option", () => {
  const text = "a".repeat(100);
  assert.equal(estimateTokens(text, 10), 10);
  assert.equal(fitsInBudget(text, { charsPerToken: 10, maxTokens: 20, reservedTokens: 0 }), true);
  // 100/10=10 tokens <= 20
  assert.equal(fitsInBudget(text, { charsPerToken: 10, maxTokens: 5, reservedTokens: 0 }), false);
});

test("budgetReport utilization", () => {
  const text = "a".repeat(40);
  const r = budgetReport(text);
  assert.equal(r.tokens, 10);
  assert.equal(r.budget, 7000);
  assert.equal(r.fits, true);
  assert.equal(r.utilization, 10 / 7000);
});

test("BudgetOptions type usable", () => {
  const o: BudgetOptions = { maxTokens: 100, reservedTokens: 10, charsPerToken: 2 };
  assert.ok(o);
});