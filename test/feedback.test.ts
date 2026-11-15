import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeedbackStore, createFeedbackStore } from "../src/feedback.js";
import type { FeedbackEntry } from "../src/feedback.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openapimcp-feedback-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("add/list/filter by tool", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "feedback.jsonl");
    const store = createFeedbackStore(file);
    store.add({ tool: "getUser", rating: "up", query: "q1" });
    store.add({ tool: "deleteUser", rating: "down", comment: "bad" });
    store.add({ tool: "getUser", rating: "down" });

    const all = store.list();
    assert.equal(all.length, 3);

    const getUser = store.list("getUser");
    assert.equal(getUser.length, 2);
    assert.ok(getUser.every((e) => e.tool === "getUser"));

    const deleteUser = store.list("deleteUser");
    assert.equal(deleteUser.length, 1);
    assert.equal(deleteUser[0].rating, "down");
  });
});

test("score counts", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "feedback.jsonl");
    const store = new FeedbackStore(file);
    store.add({ tool: "t", rating: "up" });
    store.add({ tool: "t", rating: "up" });
    store.add({ tool: "t", rating: "down" });

    const s = store.score("t");
    assert.deepEqual(s, { up: 2, down: 1, total: 3 });
    assert.deepEqual(store.score("missing"), { up: 0, down: 0, total: 0 });
  });
});

test("suggestImprovements returns hints for low-rated tools", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "feedback.jsonl");
    const store = createFeedbackStore(file);
    store.add({ tool: "good", rating: "up" });
    store.add({ tool: "good", rating: "up" });
    store.add({ tool: "bad", rating: "down" });
    store.add({ tool: "bad", rating: "down" });
    store.add({ tool: "bad", rating: "up" });

    const tools = [
      { name: "good", description: "good tool" },
      { name: "bad", description: "bad tool" },
      { name: "neutral", description: "neutral tool" }
    ];
    const hints = store.suggestImprovements(tools);
    assert.equal(hints.length, 1);
    assert.equal(hints[0].tool, "bad");
    assert.match(hints[0].hint, /clarifying the description or adding examples/);
  });
});

test("persistence reads back from disk", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "nested", "feedback.jsonl");
    const store1 = createFeedbackStore(file);
    store1.add({ tool: "t", rating: "up", timestamp: "2020-01-01T00:00:00.000Z" });

    assert.ok(existsSync(file));
    const raw = readFileSync(file, "utf8");
    assert.ok(raw.endsWith("\n"));

    const store2 = new FeedbackStore(file);
    const list = store2.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].tool, "t");
    assert.equal(list[0].timestamp, "2020-01-01T00:00:00.000Z");

    const entry: FeedbackEntry = list[0];
    assert.equal(entry.rating, "up");
  });
});

test("creates missing parent directories", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "a", "b", "feedback.jsonl");
    const store = new FeedbackStore(file);
    store.add({ tool: "t", rating: "down" });
    assert.ok(existsSync(file));
  });
});
