import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBudget,
  BudgetTracker,
  formatBudget,
} from "../src/budget.js";
import type { BudgetConfig } from "../src/budget.js";

test("canCall under limit returns true", () => {
  const t = new BudgetTracker({ maxCalls: 2 });
  assert.equal(t.canCall(), true);
  t.recordCall();
  assert.equal(t.canCall(), true);
});

test("canCall over maxCalls limit returns false", () => {
  const t = new BudgetTracker({ maxCalls: 2 });
  t.recordCall();
  t.recordCall();
  assert.equal(t.canCall(), false);
});

test("canCall over maxBytes limit returns false", () => {
  const t = new BudgetTracker({ maxBytes: 100 });
  assert.equal(t.canCall(), true);
  t.recordCall(60);
  assert.equal(t.canCall(), true);
  t.recordCall(40);
  assert.equal(t.canCall(), false);
});

test("recordCall increments calls and bytes", () => {
  const t = new BudgetTracker();
  t.recordCall();
  t.recordCall(50);
  t.recordCall(25);
  const r = t.remaining();
  assert.equal(r.calls, 3);
  assert.equal(r.bytes, 75);
});

test("remaining returns maxCalls/maxBytes from config and undefined when unset", () => {
  const t = new BudgetTracker({ maxCalls: 5, maxBytes: 1000 });
  const r = t.remaining();
  assert.equal(r.maxCalls, 5);
  assert.equal(r.maxBytes, 1000);
  assert.equal(r.calls, 0);
  assert.equal(r.bytes, 0);

  const open = new BudgetTracker();
  const ro = open.remaining();
  assert.equal(ro.maxCalls, undefined);
  assert.equal(ro.maxBytes, undefined);
});

test("exhausted flag flips at maxCalls limit", () => {
  const t = new BudgetTracker({ maxCalls: 1 });
  assert.equal(t.exhausted, false);
  t.recordCall();
  assert.equal(t.exhausted, true);
});

test("exhausted flag flips at maxBytes limit", () => {
  const t = new BudgetTracker({ maxBytes: 10 });
  assert.equal(t.exhausted, false);
  t.recordCall(10);
  assert.equal(t.exhausted, true);
});

test("tracker without config never exhausts", () => {
  const t = new BudgetTracker();
  for (let i = 0; i < 100; i++) t.recordCall(1000);
  assert.equal(t.canCall(), true);
  assert.equal(t.exhausted, false);
});

test("parseBudget accepts valid object", () => {
  assert.deepEqual(parseBudget({ maxCalls: 3, maxBytes: 1024 }), {
    maxCalls: 3,
    maxBytes: 1024,
  });
  assert.deepEqual(parseBudget({ maxCalls: 3 }), { maxCalls: 3 });
  assert.deepEqual(parseBudget({ maxBytes: 0 }), { maxBytes: 0 });
  assert.deepEqual(parseBudget({}), {});
});

test("parseBudget normalizes by dropping unknown keys", () => {
  assert.deepEqual(parseBudget({ maxCalls: 2, extra: "drop-me" }), {
    maxCalls: 2,
  });
});

test("parseBudget rejects invalid input", () => {
  assert.equal(parseBudget(undefined), undefined);
  assert.equal(parseBudget(null), undefined);
  assert.equal(parseBudget("budget"), undefined);
  assert.equal(parseBudget(42), undefined);
  assert.equal(parseBudget(true), undefined);
  assert.equal(parseBudget([1, 2]), undefined);
  assert.equal(parseBudget({ maxCalls: "3" }), undefined);
  assert.equal(parseBudget({ maxCalls: Number.NaN }), undefined);
  assert.equal(parseBudget({ maxCalls: Number.POSITIVE_INFINITY }), undefined);
  assert.equal(parseBudget({ maxCalls: -1 }), undefined);
  assert.equal(parseBudget({ maxBytes: "1024" }), undefined);
  assert.equal(parseBudget({ maxBytes: -5 }), undefined);
  assert.equal(parseBudget({ maxCalls: 3, maxBytes: "nope" }), undefined);
});

test("maxCalls limit enforced exactly at boundary", () => {
  const t = new BudgetTracker({ maxCalls: 3 });
  t.recordCall();
  t.recordCall();
  assert.equal(t.canCall(), true);
  t.recordCall();
  assert.equal(t.canCall(), false);
});

test("formatBudget renders limits and unlimited", () => {
  const limited = new BudgetTracker({ maxCalls: 5, maxBytes: 1000 });
  limited.recordCall(250);
  limited.recordCall(250);
  assert.equal(formatBudget(limited), "Budget: calls 2/5, bytes 500/1000");

  const open = new BudgetTracker();
  open.recordCall(10);
  assert.equal(formatBudget(open), "Budget: calls 1/unlimited, bytes 10/unlimited");
});

test("BudgetConfig type usable", () => {
  const cfg: BudgetConfig = { maxCalls: 1, maxBytes: 1 };
  assert.ok(cfg);
});
