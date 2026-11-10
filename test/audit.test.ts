import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuditLog, createAuditLog } from "../src/audit.js";
import type { AuditEntry } from "../src/audit.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openapimcp-audit-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("audit appends one parseable JSON line per entry", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "audit.log");
    const log = createAuditLog(file);

    const first: AuditEntry = {
      time: new Date().toISOString(),
      tool: "getUser",
      method: "GET",
      url: "https://api.example.com/u/1",
      status: 200,
      ok: true,
      durationMs: 12.5
    };
    const second: AuditEntry = {
      time: new Date().toISOString(),
      tool: "deleteUser",
      method: "DELETE",
      ok: false,
      durationMs: 3,
      reason: "blocked by policy"
    };

    log.write(first);
    log.write(second);

    const raw = readFileSync(file, "utf8");
    assert.ok(raw.endsWith("\n"));
    const lines = raw.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), first);
    assert.deepEqual(JSON.parse(lines[1]), second);
  });
});

test("audit creates missing parent directories", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "nested", "deeper", "audit.log");
    assert.equal(existsSync(path.dirname(file)), false);
    const log = new AuditLog(file);
    log.write({ time: new Date().toISOString(), tool: "t", method: "POST", ok: true, durationMs: 1 });
    assert.ok(existsSync(file));
  });
});

test("audit appends across instances without truncating", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "audit.log");
    createAuditLog(file).write({ time: "t1", tool: "a", method: "GET", ok: true, durationMs: 1 });
    createAuditLog(file).write({ time: "t2", tool: "b", method: "GET", ok: true, durationMs: 2 });

    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).tool, "a");
    assert.equal(JSON.parse(lines[1]).tool, "b");
  });
});
