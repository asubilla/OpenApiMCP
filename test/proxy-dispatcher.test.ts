import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDispatcher, formatDispatcherPlan } from "../src/proxy-dispatcher.js";

const tempCa = join(tmpdir(), `openapimcp-test-ca-${process.pid}.pem`);

test("returns undefined when neither --ca nor --proxy is set", async () => {
  assert.equal(await createDispatcher({}), undefined);
});

test("creates an Agent when only --ca is set", async () => {
  writeFileSync(tempCa, "---PLACEHOLDER CA BUNDLE---\n");
  try {
    const d: any = await createDispatcher({ ca: tempCa });
    assert.ok(d, "dispatcher should be created");
    assert.equal(d.constructor.name, "Agent");
  } finally {
    rmSync(tempCa, { force: true });
  }
});

test("creates a ProxyAgent when --proxy is set", async () => {
  const d: any = await createDispatcher({ proxy: "http://127.0.0.1:3128" });
  assert.equal(d.constructor.name, "ProxyAgent");
});

test("creates a ProxyAgent when --proxy and --ca are both set", async () => {
  writeFileSync(tempCa, "---PLACEHOLDER CA BUNDLE---\n");
  try {
    const d: any = await createDispatcher({ proxy: "http://127.0.0.1:3128", ca: tempCa });
    assert.equal(d.constructor.name, "ProxyAgent");
  } finally {
    rmSync(tempCa, { force: true });
  }
});

test("unreadable --ca file throws a clear error", async () => {
  await assert.rejects(() => createDispatcher({ ca: join(tmpdir(), "definitely-not-here.pem") }), /could not be read/);
});

test("formatDispatcherPlan masks credentials in proxy URLs", () => {
  const s = formatDispatcherPlan({ proxy: "http://user:hunter2@corp.example.com:3128", ca: "ca.pem" });
  assert.doesNotMatch(s, /hunter2/);
  assert.match(s, /\*\*\*\*\*\*/);
  assert.match(s, /ca\.pem/);
});

test("formatDispatcherPlan without options reports not configured", () => {
  assert.match(formatDispatcherPlan({}), /not configured/);
});
