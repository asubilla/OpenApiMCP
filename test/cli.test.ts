import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli.js");
const fixture = path.join(root, "test", "fixtures", "demo-api.json");

function run(args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("list --json returns the spec's tools", () => {
  const tools = JSON.parse(run(["list", fixture, "--json"]));
  assert.ok(tools.length >= 5, `expected >= 5 tools, got ${tools.length}`);
  assert.ok(tools.some((t: any) => t.name === "getPetById"));
});

test("--read-only drops mutating operations", () => {
  const tools = JSON.parse(run(["list", fixture, "--json", "--read-only"]));
  assert.ok(tools.length > 0);
  assert.ok(!tools.some((t: any) => !["get", "head", "options"].includes(t.method)));
  assert.ok(!tools.some((t: any) => t.name === "deletePet"));
});

test("--tag filters by operation tag", () => {
  const tools = JSON.parse(run(["list", fixture, "--json", "--tag", "store"]));
  assert.ok(tools.length >= 1);
  assert.ok(tools.every((t: any) => t.tags.includes("store")));
});

test("doctor reports tools and auth state", () => {
  const out = run(["doctor", fixture]);
  assert.match(out, /spec loaded: Demo API/);
  assert.match(out, /tools:\s+5/);
  assert.match(out, /ApiKeyAuth/);
});

test("multi-spec namespaces tool names", () => {
  const tools = JSON.parse(run(["list", fixture, fixture, "--json"]));
  assert.ok(tools.some((t: any) => t.name.startsWith("demo-api_getPetById")));
});

test("generate writes a standalone project", () => {
  const out = path.join(root, "test", ".tmp-generated");
  rmSync(out, { recursive: true, force: true });
  const log = run(["generate", fixture, "--out", out]);
  assert.match(log, /generated/);
  assert.ok(existsSync(path.join(out, "package.json")));
  assert.ok(existsSync(path.join(out, "spec.json")));
  assert.ok(existsSync(path.join(out, "src", "index.ts")));
  assert.ok(existsSync(path.join(out, "openapimcp.config.json")));
  rmSync(out, { recursive: true, force: true });
});
