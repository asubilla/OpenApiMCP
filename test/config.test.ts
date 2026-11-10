import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, mergeConfig } from "../src/config.js";

let counter = 0;
function writeTemp(contents: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openapimcp-config-"));
  const file = path.join(dir, `config-${counter++}.json`);
  writeFileSync(file, contents, "utf8");
  return file;
}

test("loadConfig parses a JSON object", () => {
  const file = writeTemp(JSON.stringify({ baseUrl: "https://api.test", timeout: 5000 }));
  assert.deepEqual(loadConfig(file), { baseUrl: "https://api.test", timeout: 5000 });
});

test("loadConfig throws a clear error on invalid JSON", () => {
  const file = writeTemp("{ not json");
  assert.throws(() => loadConfig(file), /invalid JSON in config file/);
});

test("loadConfig rejects non-object JSON", () => {
  assert.throws(() => loadConfig(writeTemp("[1,2,3]")), /must contain a JSON object/);
  assert.throws(() => loadConfig(writeTemp("null")), /must contain a JSON object/);
  assert.throws(() => loadConfig(writeTemp("\"str\"")), /must contain a JSON object/);
});

test("loadConfig throws a clear error for a missing file", () => {
  assert.throws(() => loadConfig(path.join(os.tmpdir(), "openapimcp-does-not-exist.json")), /could not read config file/);
});

test("mergeConfig lets CLI values win", () => {
  const config = { baseUrl: "https://config", timeout: 1000, name: "cfg" };
  const cli = { baseUrl: "https://cli", timeout: 2000 };
  assert.deepEqual(mergeConfig(config, cli), { baseUrl: "https://cli", timeout: 2000, name: "cfg" });
});

test("mergeConfig treats undefined CLI values as not set", () => {
  const config = { baseUrl: "https://config", name: "cfg" };
  const cli = { baseUrl: undefined, name: "cli" };
  assert.deepEqual(mergeConfig(config, cli), { baseUrl: "https://config", name: "cli" });
});

test("mergeConfig returns a new object and does not mutate inputs", () => {
  const config = { baseUrl: "https://config" };
  const cli = { timeout: 1 };
  const merged = mergeConfig(config, cli);
  assert.notEqual(merged, config);
  assert.notEqual(merged, cli);
  assert.deepEqual(config, { baseUrl: "https://config" });
  assert.deepEqual(cli, { timeout: 1 });
});

test("mergeConfig adds CLI-only keys", () => {
  assert.deepEqual(mergeConfig({}, { retries: 3 }), { retries: 3 });
  assert.deepEqual(mergeConfig({ a: 1 }, {}), { a: 1 });
});
