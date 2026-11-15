import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProgressTracker,
  createProgressTracker,
  formatProgress,
} from "../src/progress.js";

test("update sets progress", () => {
  const tracker = new ProgressTracker(10);
  const event = tracker.update(3, "step");
  assert.equal(event.progress, 3);
  assert.equal(tracker.getProgress(), 3);
  assert.equal(event.total, 10);
  assert.equal(event.message, "step");
  assert.equal(typeof event.timestamp, "string");
});

test("increment accumulates", () => {
  const tracker = createProgressTracker(10);
  tracker.update(2);
  const event = tracker.increment(3, "more");
  assert.equal(event.progress, 5);
  assert.equal(tracker.getProgress(), 5);
});

test("increment defaults to one", () => {
  const tracker = new ProgressTracker(5);
  tracker.increment();
  assert.equal(tracker.getProgress(), 1);
});

test("complete sets progress=total", () => {
  const tracker = new ProgressTracker(10);
  tracker.update(4);
  const event = tracker.complete("done");
  assert.equal(event.progress, 10);
  assert.equal(tracker.getProgress(), 10);
  assert.equal(tracker.getTotal(), 10);
});

test("isComplete", () => {
  const tracker = new ProgressTracker(4);
  assert.equal(tracker.isComplete(), false);
  tracker.update(4);
  assert.equal(tracker.isComplete(), true);
  tracker.update(2);
  // completed flag not set but progress dropped; still? progress < total now
  assert.equal(tracker.isComplete(), false);
});

test("complete marks complete without total", () => {
  const tracker = new ProgressTracker();
  assert.equal(tracker.getTotal(), undefined);
  tracker.complete();
  assert.equal(tracker.isComplete(), true);
});

test("onProgress callback fires", () => {
  const tracker = new ProgressTracker(10);
  const events: number[] = [];
  tracker.onProgress((e) => events.push(e.progress));
  tracker.update(1);
  tracker.increment(2);
  tracker.complete();
  assert.deepEqual(events, [1, 3, 10]);
});

test("getProgress/getTotal", () => {
  const tracker = createProgressTracker(7);
  assert.equal(tracker.getProgress(), 0);
  assert.equal(tracker.getTotal(), 7);
  tracker.update(3);
  assert.equal(tracker.getProgress(), 3);
});

test("formatProgress with total", () => {
  const event = {
    progress: 3,
    total: 10,
    message: "Processing...",
    timestamp: new Date().toISOString(),
  };
  assert.equal(formatProgress(event), "[3/10] Processing...");
});

test("formatProgress without total", () => {
  const event = {
    progress: 50,
    message: "Fetching page 2 of 4",
    timestamp: new Date().toISOString(),
  };
  assert.equal(formatProgress(event), "[50%] Fetching page 2 of 4");
});

test("formatProgress no message", () => {
  assert.equal(
    formatProgress({ progress: 5, total: 10, timestamp: "t" }),
    "[5/10]"
  );
  assert.equal(formatProgress({ progress: 25, timestamp: "t" }), "[25%]");
});