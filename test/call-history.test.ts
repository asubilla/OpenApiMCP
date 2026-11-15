import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CallHistory, createCallHistory, formatCallList, replayArgs } from "../src/call-history.js";
import type { CallRecord } from "../src/call-history.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openapimcp-call-history-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sampleEntry(overrides?: Partial<Omit<CallRecord, "id" | "time">>): Omit<CallRecord, "id" | "time"> {
  return {
    tool: "getUser",
    method: "GET",
    url: "https://api.example.com/users/1",
    args: { id: "1" },
    status: 200,
    ok: true,
    durationMs: 42,
    responsePreview: "{\"id\":\"1\"}",
    ...overrides
  };
}

test("record persists a JSON line and returns a full record", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "history.log");
    const history = createCallHistory(file);

    const record = history.record(sampleEntry());
    assert.ok(record.id);
    assert.ok(record.time);
    assert.equal(record.tool, "getUser");
    assert.equal(record.ok, true);

    const raw = readFileSync(file, "utf8");
    assert.ok(raw.endsWith("\n"));
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), record);
  });
});

test("list returns records chronologically and honors limit", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "history.log");
    const history = new CallHistory(file);

    history.record(sampleEntry({ tool: "first" }));
    history.record(sampleEntry({ tool: "second" }));
    history.record(sampleEntry({ tool: "third" }));

    const all = history.list();
    assert.deepEqual(all.map((r) => r.tool), ["first", "second", "third"]);

    const limited = history.list(2);
    assert.deepEqual(limited.map((r) => r.tool), ["second", "third"]);

    assert.equal(history.list(0).length, 0);
  });
});

test("get returns a record by id and undefined for unknown ids", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "history.log");
    const history = createCallHistory(file);

    const record = history.record(sampleEntry());
    assert.deepEqual(history.get(record.id), record);
    assert.equal(history.get("nope"), undefined);
  });
});

test("clear removes all records", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "history.log");
    const history = createCallHistory(file);

    history.record(sampleEntry());
    history.clear();
    assert.deepEqual(history.list(), []);
    assert.equal(history.get("anything"), undefined);
    history.clear(); // clearing an empty/missing log is a no-op
  });
});

test("trims to maxEntries keeping the most recent", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "history.log");
    const history = createCallHistory(file, { maxEntries: 3 });

    for (let i = 1; i <= 5; i++) {
      history.record(sampleEntry({ tool: `tool-${i}` }));
    }

    const all = history.list();
    assert.equal(all.length, 3);
    assert.deepEqual(all.map((r) => r.tool), ["tool-3", "tool-4", "tool-5"]);

    const raw = readFileSync(file, "utf8").trim().split("\n");
    assert.equal(raw.length, 3);
  });
});

test("default maxEntries is 100", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "history.log");
    const history = createCallHistory(file);

    for (let i = 1; i <= 105; i++) {
      history.record(sampleEntry({ tool: `tool-${i}` }));
    }

    const all = history.list();
    assert.equal(all.length, 100);
    assert.equal(all[0].tool, "tool-6");
    assert.equal(all[all.length - 1].tool, "tool-105");
  });
});

test("constructor creates missing parent directories", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "nested", "deeper", "history.log");
    assert.equal(existsSync(path.dirname(file)), false);
    const history = new CallHistory(file);
    history.record(sampleEntry());
    assert.ok(existsSync(file));
  });
});

test("replayArgs merges record args with overrides, overrides win", () => {
  const record: CallRecord = {
    id: "abc",
    time: new Date().toISOString(),
    tool: "getUser",
    method: "GET",
    url: "https://api.example.com/users/1",
    args: { id: "1", verbose: false, nested: { a: 1 } },
    ok: true,
    durationMs: 10,
    responsePreview: "{}"
  };

  assert.deepEqual(replayArgs(record, {}), record.args);
  assert.deepEqual(replayArgs(record, { id: "2" }), { id: "2", verbose: false, nested: { a: 1 } });
  assert.deepEqual(replayArgs(record, { extra: "new", verbose: true }), {
    id: "1",
    verbose: true,
    nested: { a: 1 },
    extra: "new"
  });
});

test("formatCallList emits one line per entry in the specified shape", () => {
  const entries: CallRecord[] = [
    {
      id: "id-1",
      time: "2026-11-16T00:00:00.000Z",
      tool: "getUser",
      method: "GET",
      url: "https://api.example.com/users/1",
      args: {},
      status: 200,
      ok: true,
      durationMs: 12,
      responsePreview: "{}"
    },
    {
      id: "id-2",
      time: "2026-11-16T00:00:01.000Z",
      tool: "deleteUser",
      method: "DELETE",
      url: "https://api.example.com/users/1",
      args: {},
      ok: false,
      durationMs: 7,
      responsePreview: ""
    }
  ];

  const output = formatCallList(entries);
  const lines = output.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "id-1 2026-11-16T00:00:00.000Z GET getUser -> 200 true (12ms)");
  assert.equal(lines[1], "id-2 2026-11-16T00:00:01.000Z DELETE deleteUser -> - false (7ms)");
  assert.equal(formatCallList([]), "");
});
