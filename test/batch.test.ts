import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runBatch,
  formatBatchSummary,
  formatBatchResults
} from "../src/batch.js";
import type { BatchCall, BatchResult } from "../src/batch.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("runBatch preserves input order in results", async () => {
  const calls: BatchCall[] = [
    { tool: "slow", args: { n: 1 } },
    { tool: "fast", args: { n: 2 } },
    { tool: "medium", args: { n: 3 } }
  ];
  const call = async (tool: string, args: Record<string, unknown>): Promise<BatchResult> => {
    const wait = tool === "slow" ? 30 : tool === "medium" ? 15 : 1;
    await delay(wait);
    return { tool, ok: true, status: 200, body: { n: args.n } };
  };
  const results = await runBatch(calls, { concurrency: 3 }, call);
  assert.deepEqual(results.map((r) => r.tool), ["slow", "fast", "medium"]);
  assert.deepEqual(results.map((r) => r.body), [{ n: 1 }, { n: 2 }, { n: 3 }]);
});

test("runBatch respects concurrency limit (max in-flight <= concurrency)", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: BatchCall[] = Array.from({ length: 12 }, (_, i) => ({ tool: `t${i}` }));
  const call = async (tool: string): Promise<BatchResult> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(10);
    inFlight -= 1;
    return { tool, ok: true, status: 200 };
  };
  const results = await runBatch(calls, { concurrency: 3 }, call);
  assert.equal(results.length, 12);
  assert.ok(maxInFlight <= 3, `max in-flight was ${maxInFlight}`);
  assert.ok(maxInFlight >= 2, "expected some parallelism");
});

test("runBatch defaults concurrency to 5", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: BatchCall[] = Array.from({ length: 20 }, (_, i) => ({ tool: `t${i}` }));
  const call = async (tool: string): Promise<BatchResult> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(5);
    inFlight -= 1;
    return { tool, ok: true };
  };
  await runBatch(calls, {}, call);
  assert.ok(maxInFlight <= 5, `max in-flight was ${maxInFlight}`);
});

test("runBatch captures thrown exceptions as error results and continues", async () => {
  const calls: BatchCall[] = [{ tool: "boom" }, { tool: "fine" }, { tool: "boom2" }];
  const call = async (tool: string): Promise<BatchResult> => {
    if (tool.startsWith("boom")) throw new Error(`kaboom:${tool}`);
    return { tool, ok: true, status: 200 };
  };
  const results = await runBatch(calls, { concurrency: 2 }, call);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, "kaboom:boom");
  assert.equal(results[0].tool, "boom");
  assert.equal(results[1].ok, true);
  assert.equal(results[2].ok, false);
  assert.equal(results[2].error, "kaboom:boom2");
});

test("runBatch captures non-Error throws as string messages", async () => {
  const call = async (tool: string): Promise<BatchResult> => {
    throw "string failure";
  };
  const results = await runBatch([{ tool: "x" }], {}, call);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, "string failure");
});

test("runBatch passes empty object when args are omitted", async () => {
  let seenArgs: Record<string, unknown> | undefined;
  const call = async (tool: string, args: Record<string, unknown>): Promise<BatchResult> => {
    seenArgs = args;
    return { tool, ok: true };
  };
  await runBatch([{ tool: "noargs" }], {}, call);
  assert.deepEqual(seenArgs, {});
});

test("runBatch applies timeoutMs and reports timeout as error", async () => {
  const call = async (tool: string): Promise<BatchResult> => {
    await delay(50);
    return { tool, ok: true };
  };
  const results = await runBatch([{ tool: "slowcall" }], { timeoutMs: 10 }, call);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error ?? "", /Timed out/);
});

test("runBatch returns empty array for empty input", async () => {
  const results = await runBatch([], {}, async (tool) => ({ tool, ok: true }));
  assert.deepEqual(results, []);
});

test("formatBatchSummary counts ok, failed and total", () => {
  const results: BatchResult[] = [
    { tool: "a", ok: true },
    { tool: "b", ok: false, error: "x" },
    { tool: "c", ok: true, status: 200 },
    { tool: "d", ok: false, status: 500 }
  ];
  assert.deepEqual(formatBatchSummary(results), { ok: 2, failed: 2, total: 4 });
  assert.deepEqual(formatBatchSummary([]), { ok: 0, failed: 0, total: 0 });
});

test("formatBatchResults renders one line per call", () => {
  const results: BatchResult[] = [
    { tool: "a", ok: true },
    { tool: "b", ok: false, error: "nope" }
  ];
  const text = formatBatchResults(results);
  assert.equal(text, "✓ a\n✗ b: nope");
});
