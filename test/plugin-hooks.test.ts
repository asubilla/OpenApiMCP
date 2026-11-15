import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runBeforeRequest,
  runAfterResponse,
  validatePlugin,
  loadPlugin
} from "../src/plugin-hooks.js";
import type { HookRequest, HookResponse, PluginHook } from "../src/plugin-hooks.js";

function makeReq(overrides: Partial<HookRequest> = {}): HookRequest {
  return {
    method: "GET",
    url: "https://api.example.com/pets",
    headers: { accept: "application/json" },
    ...overrides
  };
}

function makeRes(overrides: Partial<HookResponse> = {}): HookResponse {
  return {
    status: 200,
    body: "{}",
    headers: { "content-type": "application/json" },
    ...overrides
  };
}

test("runBeforeRequest merges headers from hooks in order", () => {
  const hooks: PluginHook[] = [
    { name: "one", beforeRequest: () => ({ "x-one": "1", "x-shared": "first" }) },
    { name: "two", beforeRequest: () => ({ "x-two": "2", "x-shared": "second" }) }
  ];
  const out = runBeforeRequest(hooks, makeReq());
  assert.equal(out.headers["x-one"], "1");
  assert.equal(out.headers["x-two"], "2");
  assert.equal(out.headers["x-shared"], "second");
  assert.equal(out.headers.accept, "application/json");
});

test("runBeforeRequest does not mutate the input request", () => {
  const req = makeReq();
  const out = runBeforeRequest([{ name: "h", beforeRequest: () => ({ "x-new": "yes" }) }], req);
  assert.equal(req.headers["x-new"], undefined);
  assert.equal(out.headers["x-new"], "yes");
  assert.notEqual(out, req);
  assert.notEqual(out.headers, req.headers);
});

test("runBeforeRequest leaves request unchanged when hook returns void", () => {
  const hooks: PluginHook[] = [
    { name: "noop", beforeRequest: () => undefined },
    { name: "noooo", beforeRequest: () => {} }
  ];
  const out = runBeforeRequest(hooks, makeReq({ body: "payload" }));
  assert.deepEqual(out.headers, { accept: "application/json" });
  assert.equal(out.body, "payload");
});

test("runBeforeRequest works when hook has no beforeRequest", () => {
  const out = runBeforeRequest([{ name: "after-only", afterResponse: () => {} }], makeReq());
  assert.deepEqual(out.headers, { accept: "application/json" });
});

test("runBeforeRequest passes the accumulated request to later hooks", () => {
  const seen: string[] = [];
  const hooks: PluginHook[] = [
    { name: "one", beforeRequest: (req) => { seen.push(req.headers["x-first"] ?? "none"); return { "x-first": "set" }; } },
    { name: "two", beforeRequest: (req) => { seen.push(req.headers["x-first"] ?? "none"); } }
  ];
  runBeforeRequest(hooks, makeReq());
  assert.deepEqual(seen, ["none", "set"]);
});

test("runAfterResponse calls each hook's afterResponse in order", () => {
  const calls: string[] = [];
  const req = makeReq();
  const res = makeRes({ status: 201 });
  const hooks: PluginHook[] = [
    { name: "one", afterResponse: (r, s) => { calls.push(`one:${s.status}:${r.method}`); } },
    { name: "two", afterResponse: (r, s) => { calls.push(`two:${r.url}`); } },
    { name: "no-after" }
  ];
  runAfterResponse(hooks, req, res);
  assert.deepEqual(calls, ["one:201:GET", "two:https://api.example.com/pets"]);
});

test("validatePlugin accepts a valid plugin with all fields", () => {
  const result = validatePlugin({
    name: "my-plugin",
    beforeRequest: () => undefined,
    afterResponse: () => undefined
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validatePlugin accepts a valid plugin with only a name", () => {
  const result = validatePlugin({ name: "minimal" });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validatePlugin rejects non-object plugins", () => {
  for (const bad of [null, undefined, 42, "nope", true, []]) {
    const result = validatePlugin(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  }
});

test("validatePlugin rejects missing or invalid name", () => {
  for (const bad of [{}, { name: 123 }, { name: "" }, { name: "   " }]) {
    const result = validatePlugin(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("name")));
  }
});

test("validatePlugin rejects non-function beforeRequest and afterResponse", () => {
  const result = validatePlugin({ name: "p", beforeRequest: "yes", afterResponse: 1 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("beforeRequest")));
  assert.ok(result.errors.some((e) => e.includes("afterResponse")));
});

test("loadPlugin loads a module exporting a hooks array", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-plugin-"));
  try {
    const file = join(dir, "hooks-plugin.mjs");
    writeFileSync(
      file,
      `export const hooks = [
        { name: "a", beforeRequest: () => ({ "x-from-a": "A" }) },
        { name: "b" }
      ];\n`
    );
    const hooks = await loadPlugin(file);
    assert.equal(hooks.length, 2);
    assert.equal(hooks[0].name, "a");
    assert.equal(hooks[1].name, "b");
    const out = runBeforeRequest(hooks, makeReq());
    assert.equal(out.headers["x-from-a"], "A");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPlugin wraps a default-exported single hook into an array", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-plugin-"));
  try {
    const file = join(dir, "default-plugin.mjs");
    writeFileSync(
      file,
      `export default { name: "solo", beforeRequest: () => ({ "x-solo": "yes" }) };\n`
    );
    const hooks = await loadPlugin(file);
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].name, "solo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPlugin throws a clear error when the module does not exist", async () => {
  await assert.rejects(
    () => loadPlugin(join(tmpdir(), "openapimcp-does-not-exist-12345.mjs")),
    /failed to load plugin/i
  );
});

test("loadPlugin throws a clear error when the module exports neither hooks nor default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-plugin-"));
  try {
    const file = join(dir, "empty-plugin.mjs");
    writeFileSync(file, "export const somethingElse = 1;\n");
    await assert.rejects(() => loadPlugin(file), /must export "hooks"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadPlugin throws a clear error when hooks contains an invalid plugin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-plugin-"));
  try {
    const file = join(dir, "invalid-plugin.mjs");
    writeFileSync(file, "export const hooks = [{ beforeRequest: () => undefined }];\n");
    await assert.rejects(() => loadPlugin(file), /invalid hook at index 0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
