import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  isAsyncAccepted,
  findStatusUrl,
  parseJobResult,
  pollUntilDone,
  buildAsyncConfig,
} from "../src/async-jobs.js";

const BASE = "http://api.test";

test("isAsyncAccepted: true only for 202", () => {
  assert.equal(isAsyncAccepted(202), true);
  assert.equal(isAsyncAccepted(200), false);
  assert.equal(isAsyncAccepted(201), false);
  assert.equal(isAsyncAccepted(204), false);
  assert.equal(isAsyncAccepted(400), false);
  assert.equal(isAsyncAccepted(500), false);
});

test("findStatusUrl: Location header wins, absolute kept as-is", () => {
  const url = findStatusUrl({}, { Location: "http://api.test/jobs/1" }, BASE);
  assert.equal(url, "http://api.test/jobs/1");
});

test("findStatusUrl: X-Location header used when Location absent", () => {
  const url = findStatusUrl({}, { "X-Location": "/status/42" }, BASE);
  assert.equal(url, "http://api.test/status/42");
});

test("findStatusUrl: header names are case-insensitive", () => {
  const url = findStatusUrl({}, { location: "http://api.test/jobs/9" }, BASE);
  assert.equal(url, "http://api.test/jobs/9");
});

test("findStatusUrl: relative Location resolved against baseUrl", () => {
  const url = findStatusUrl({}, { Location: "/jobs/7" }, "http://api.test/base/path");
  assert.equal(url, "http://api.test/jobs/7");
});

test("findStatusUrl: body.location", () => {
  const url = findStatusUrl({ location: "http://api.test/jobs/2" }, {}, BASE);
  assert.equal(url, "http://api.test/jobs/2");
});

test("findStatusUrl: body.statusUrl", () => {
  const url = findStatusUrl({ statusUrl: "/poll/3" }, {}, BASE);
  assert.equal(url, "http://api.test/poll/3");
});

test("findStatusUrl: body.jobId maps to /jobs/<id>", () => {
  const url = findStatusUrl({ jobId: "abc123" }, {}, BASE);
  assert.equal(url, "http://api.test/jobs/abc123");
});

test("findStatusUrl: body.jobId ignored when location present", () => {
  const url = findStatusUrl({ jobId: "abc123", location: "/actual/1" }, {}, BASE);
  assert.equal(url, "http://api.test/actual/1");
});

test("findStatusUrl: body.links.status", () => {
  const url = findStatusUrl({ links: { status: "http://api.test/links/5" } }, {}, BASE);
  assert.equal(url, "http://api.test/links/5");
});

test("findStatusUrl: body.status as URL string", () => {
  const url = findStatusUrl({ status: "http://api.test/status/done" }, {}, BASE);
  assert.equal(url, "http://api.test/status/done");
});

test("findStatusUrl: body.status as state word is not treated as URL", () => {
  const url = findStatusUrl({ status: "pending" }, {}, BASE);
  assert.equal(url, undefined);
});

test("findStatusUrl: returns undefined when nothing usable", () => {
  assert.equal(findStatusUrl({}, {}, BASE), undefined);
  assert.equal(findStatusUrl(null, {}, BASE), undefined);
  assert.equal(findStatusUrl("nope", {}, BASE), undefined);
});

test("parseJobResult: succeeded state is done with result payload", () => {
  const r = parseJobResult({ state: "succeeded", result: { rows: 3 } });
  assert.equal(r.done, true);
  assert.deepEqual(r.result, { rows: 3 });
  assert.equal(r.error, undefined);
  assert.equal(r.state, "succeeded");
});

test("parseJobResult: completed via status field, body itself is result when no payload", () => {
  const body = { status: "completed", value: 42 };
  const r = parseJobResult(body);
  assert.equal(r.done, true);
  assert.equal(r.result, body);
  assert.equal(r.state, "completed");
});

test("parseJobResult: failed state surfaces error.message", () => {
  const r = parseJobResult({ state: "failed", error: { message: "boom" } });
  assert.equal(r.done, true);
  assert.equal(r.error, "boom");
  assert.equal(r.state, "failed");
});

test("parseJobResult: error state surfaces string error", () => {
  const r = parseJobResult({ state: "error", error: "kaput" });
  assert.equal(r.done, true);
  assert.equal(r.error, "kaput");
});

test("parseJobResult: failed state falls back to body.message", () => {
  const r = parseJobResult({ state: "failed", message: "msg fallback" });
  assert.equal(r.done, true);
  assert.equal(r.error, "msg fallback");
});

test("parseJobResult: pending state is not done", () => {
  const r = parseJobResult({ state: "pending" });
  assert.equal(r.done, false);
  assert.equal(r.state, "pending");
  assert.equal(r.result, undefined);
});

test("parseJobResult: no status/state and no jobId is treated as final", () => {
  const body = { answer: "42" };
  const r = parseJobResult(body);
  assert.equal(r.done, true);
  assert.equal(r.result, body);
});

test("parseJobResult: no status/state but jobId present is not done", () => {
  const r = parseJobResult({ jobId: "j-1" });
  assert.equal(r.done, false);
});

test("buildAsyncConfig: defaults applied and overridable", () => {
  assert.deepEqual(buildAsyncConfig({}), { pollIntervalMs: 1000, maxWaitMs: 60000 });
  assert.deepEqual(buildAsyncConfig({ pollIntervalMs: 50, maxWaitMs: 500 }), {
    pollIntervalMs: 50,
    maxWaitMs: 500,
  });
});

test("pollUntilDone: immediate done on first poll", async () => {
  const r = await pollUntilDone(
    async () => ({ status: 200, body: { state: "succeeded", result: "ok" } }),
    "http://api.test/jobs/1",
    { pollIntervalMs: 1, maxWaitMs: 1000 }
  );
  assert.equal(r.done, true);
  assert.equal(r.result, "ok");
  assert.equal(r.timedOut, false);
});

test("pollUntilDone: succeeds on second poll after a pending poll", async () => {
  let calls = 0;
  const r = await pollUntilDone(
    async () => {
      calls += 1;
      return calls === 1
        ? { status: 200, body: { state: "pending" } }
        : { status: 200, body: { state: "completed", result: "done-payload" } };
    },
    "http://api.test/jobs/2",
    { pollIntervalMs: 5, maxWaitMs: 5000 }
  );
  assert.equal(calls, 2);
  assert.equal(r.done, true);
  assert.equal(r.result, "done-payload");
  assert.equal(r.timedOut, false);
});

test("pollUntilDone: times out when job never completes", async () => {
  const r = await pollUntilDone(
    async () => ({ status: 200, body: { state: "running" } }),
    "http://api.test/jobs/3",
    { pollIntervalMs: 10, maxWaitMs: 60 }
  );
  assert.equal(r.done, false);
  assert.equal(r.timedOut, true);
});

test("pollUntilDone: error state returns done with error set", async () => {
  const r = await pollUntilDone(
    async () => ({ status: 200, body: { state: "failed", error: { message: "nope" } } }),
    "http://api.test/jobs/4",
    { pollIntervalMs: 1, maxWaitMs: 1000 }
  );
  assert.equal(r.done, true);
  assert.equal(r.error, "nope");
  assert.equal(r.timedOut, false);
});

test("pollUntilDone: works against a local node:http server", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(hits >= 2 ? { state: "success", result: "via-http" } : { state: "pending" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const r = await pollUntilDone(
      async (url) => {
        const res = await fetch(url);
        return { status: res.status, body: (await res.json()) as any };
      },
      `http://127.0.0.1:${port}/jobs/5`,
      { pollIntervalMs: 10, maxWaitMs: 5000 }
    );
    assert.equal(r.done, true);
    assert.equal(r.result, "via-http");
    assert.equal(r.timedOut, false);
    assert.ok(hits >= 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
