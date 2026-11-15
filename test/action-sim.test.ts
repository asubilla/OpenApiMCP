import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli.js");
const base = path.join(root, "test", "fixtures", "action-base.json");
const breaking = path.join(root, "test", "fixtures", "action-breaking.json");
const ok = path.join(root, "test", "fixtures", "action-ok.json");
const actionYml = path.join(root, "action.yml");
const exampleWorkflow = path.join(root, "docs", "example-spec-review.yml");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): RunResult {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.error, undefined, `spawn failed: ${result.error?.message}`);
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function breakingCount(stdout: string): number {
  const match = stdout.match(/breaking:\s+(\d+)/);
  assert.ok(match, `stdout did not contain a "breaking: N" line:\n${stdout}`);
  return Number(match[1]);
}

test("diff on identical specs exits 0", () => {
  const result = runCli(["diff", base, base]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
  assert.equal(breakingCount(result.stdout), 0);
});

test("breaking changes exit 1 (as the Action's fail gate expects)", () => {
  const result = runCli(["diff", base, breaking]);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.ok(result.stdout.includes("breaking:"), `stdout missing "breaking:":\n${result.stdout}`);
  assert.ok(breakingCount(result.stdout) >= 1, `expected >= 1 breaking change:\n${result.stdout}`);
});

test("additive-only changes exit 0", () => {
  const result = runCli(["diff", base, ok]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
  assert.equal(breakingCount(result.stdout), 0);
});

test("base spec is parseable by the CLI (list shows > 0 tools)", () => {
  const result = runCli(["list", base, "--json"]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
  const tools = JSON.parse(result.stdout) as unknown[];
  assert.ok(Array.isArray(tools), "list --json did not produce a JSON array");
  assert.ok(tools.length > 0, "expected the base spec to yield at least one tool");
});

test("action.yml references the diff command and passes spec path + args", () => {
  const text = readFileSync(actionYml, "utf8");
  assert.ok(text.includes("diff"), "action.yml does not mention the diff command");
  assert.ok(text.includes("${{ inputs.spec }}"), "action.yml does not pass the spec input to the CLI");
  assert.ok(text.includes("args"), "action.yml does not define/pass the args input");
});

test("example workflow uses the composite action and runs on pull_request with openapi paths", () => {
  const text = readFileSync(exampleWorkflow, "utf8");
  assert.ok(text.includes("uses: asubilla/OpenApiMCP@main"), "example workflow does not use asubilla/OpenApiMCP@main");
  assert.ok(text.includes("pull_request"), "example workflow does not run on pull_request");
  assert.ok(text.includes("diff"), "example workflow does not run the diff command");
  assert.ok(/paths:[\s\S]*openapi\.(json|yaml)/.test(text), "example workflow does not trigger on openapi paths");
});
