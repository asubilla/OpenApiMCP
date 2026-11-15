import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, formatSSE, parseSSE, mergeChunks } from "../src/streaming.js";

test("chunkText splits text into fixed-size chunks", () => {
  const text = "a".repeat(2500);
  const chunks = chunkText(text, 1000);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].data.length, 1000);
  assert.equal(chunks[1].data.length, 1000);
  assert.equal(chunks[2].data.length, 500);
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[1].index, 1);
  assert.equal(chunks[2].index, 2);
  assert.equal(chunks[0].total, 3);
});

test("chunkText marks only the last chunk as done", () => {
  const chunks = chunkText("hello world", 3);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].done, false);
  assert.equal(chunks[1].done, false);
  assert.equal(chunks[2].done, false);
  assert.equal(chunks[3].done, true);
  assert.equal(chunks[3].data, "ld");
});

test("chunkText uses default chunk size", () => {
  const text = "x".repeat(1000);
  const chunks = chunkText(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].done, true);
});

test("formatSSE and parseSSE round-trip", () => {
  const chunks = chunkText("abcdefghijklmnopqrstuvwxyz", 5);
  const sse = formatSSE(chunks);
  const parsed = parseSSE(sse);
  assert.deepEqual(parsed, chunks);
});

test("mergeChunks reconstructs original text", () => {
  const text = "The quick brown fox jumps over the lazy dog.";
  const chunks = chunkText(text, 7);
  assert.equal(mergeChunks(chunks), text);
});

test("empty input handling", () => {
  const chunks = chunkText("");
  assert.deepEqual(chunks, []);
  assert.equal(formatSSE(chunks), "");
  assert.deepEqual(parseSSE(""), []);
  assert.equal(mergeChunks(chunks), "");
});

test("formatSSE includes event and double newline", () => {
  const sse = formatSSE([{ index: 0, total: 1, data: "hi", done: true }]);
  assert.ok(sse.includes("event: message"));
  assert.ok(sse.includes('data: {"index":0,"total":1,"data":"hi","done":true}'));
  assert.ok(sse.endsWith("\n\n"));
});