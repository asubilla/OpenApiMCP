import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TamperAuditLog, createTamperAuditLog, hashEntry } from "../src/tamper-audit.js";
import type { TamperAuditEntry } from "../src/tamper-audit.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openapimcp-tamper-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("tamper audit writes entries and chain verifies valid", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "nested", "audit.log");
    const log = createTamperAuditLog(file);
    const e1 = log.write({ time: "t1", tool: "getUser", method: "GET", ok: true, durationMs: 1 });
    const e2 = log.write({ time: "t2", tool: "deleteUser", method: "DELETE", ok: false, durationMs: 2 });
    assert.equal(e1.prevHash, "GENESIS");
    assert.equal(e2.prevHash, e1.hash);
    assert.equal(log.verify().valid, true);
    assert.equal(log.verify().total, 2);
  });
});

test("tamper audit detects tampered line", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "audit.log");
    const log = new TamperAuditLog(file);
    log.write({ time: "t1", tool: "getUser", method: "GET", ok: true, durationMs: 1 });
    log.write({ time: "t2", tool: "deleteUser", method: "DELETE", ok: false, durationMs: 2 });

    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const tampered = JSON.parse(lines[1]);
    tampered.tool = "tampered";
    writeFileSync(file, `${lines[0]}\n${JSON.stringify(tampered)}\n`, "utf8");

    const result = log.verify();
    assert.equal(result.valid, false);
    assert.equal(result.brokenAt, 1);
    assert.equal(result.total, 2);
  });
});

test("readAll returns correct count", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "audit.log");
    const log = createTamperAuditLog(file);
    assert.equal(log.readAll().length, 0);
    log.write({ time: "t1", tool: "a", method: "GET", ok: true, durationMs: 1 });
    log.write({ time: "t2", tool: "b", method: "POST", ok: true, durationMs: 2 });
    log.write({ time: "t3", tool: "c", method: "PUT", ok: true, durationMs: 3 });
    const all: TamperAuditEntry[] = log.readAll();
    assert.equal(all.length, 3);
    assert.equal(all[0].tool, "a");
    assert.equal(all[2].tool, "c");
  });
});

test("hashEntry is deterministic", () => {
  const entry = { time: "t", tool: "x", method: "GET", ok: true, durationMs: 1 };
  const h1 = hashEntry("GENESIS", entry);
  const h2 = hashEntry("GENESIS", entry);
  assert.equal(h1, h2);
  assert.equal(typeof h1, "string");
  assert.equal(h1.length, 64);
});

test("first tampered entry reports brokenAt 0", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "audit.log");
    const log = new TamperAuditLog(file);
    log.write({ time: "t1", tool: "getUser", method: "GET", ok: true, durationMs: 1 });

    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const tampered = JSON.parse(lines[0]);
    tampered.ok = false;
    writeFileSync(file, `${JSON.stringify(tampered)}\n`, "utf8");

    const result = log.verify();
    assert.equal(result.valid, false);
    assert.equal(result.brokenAt, 0);
  });
});