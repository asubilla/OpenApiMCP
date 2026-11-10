import { test } from "node:test";
import assert from "node:assert/strict";
import { Metrics, healthPayload } from "../src/metrics.js";

test("render emits Prometheus TYPE and counter series", () => {
  const m = new Metrics();
  m.counter("http_requests");
  const out = m.render();
  assert.match(out, /^# TYPE http_requests counter$/m);
  assert.match(out, /^http_requests 1$/m);
});

test("repeated counters with the same labels aggregate", () => {
  const m = new Metrics();
  m.counter("http_requests", { method: "GET" });
  m.counter("http_requests", { method: "GET" });
  m.counter("http_requests", { method: "GET" });
  const out = m.render();
  assert.match(out, /^http_requests\{method="GET"\} 3$/m);
  assert.equal(out.match(/http_requests\{method="GET"\}/g)?.length, 1);
});

test("label order does not affect aggregation and is rendered sorted", () => {
  const m = new Metrics();
  m.counter("calls", { b: "2", a: "1" });
  m.counter("calls", { a: "1", b: "2" });
  const out = m.render();
  assert.match(out, /^calls\{a="1",b="2"\} 2$/m);
  assert.equal(out.match(/^calls\{/gm)?.length, 1);
});

test("distinct labels produce distinct series", () => {
  const m = new Metrics();
  m.counter("http_requests", { method: "GET" });
  m.counter("http_requests", { method: "POST" });
  m.counter("http_requests", { method: "POST" });
  const out = m.render();
  assert.match(out, /^http_requests\{method="GET"\} 1$/m);
  assert.match(out, /^http_requests\{method="POST"\} 2$/m);
});

test("observations render a summary with count and sum", () => {
  const m = new Metrics();
  m.observe("request_duration_ms", 1.5, { route: "/a" });
  m.observe("request_duration_ms", 2.5, { route: "/a" });
  m.observe("request_duration_ms", 4, { route: "/b" });
  const out = m.render();
  assert.match(out, /^# TYPE request_duration_ms summary$/m);
  assert.match(out, /^request_duration_ms_count\{route="\/a"\} 2$/m);
  assert.match(out, /^request_duration_ms_sum\{route="\/a"\} 4$/m);
  assert.match(out, /^request_duration_ms_count\{route="\/b"\} 1$/m);
  assert.match(out, /^request_duration_ms_sum\{route="\/b"\} 4$/m);
});

test("render output is deterministic and sorted by name", () => {
  const m = new Metrics();
  m.counter("z_metric");
  m.counter("a_metric");
  const out = m.render();
  assert.ok(out.indexOf("# TYPE a_metric") < out.indexOf("# TYPE z_metric"));
  assert.equal(out, m.render());
});

test("empty registry renders an empty string", () => {
  assert.equal(new Metrics().render(), "");
});

test("invalid metric names are rejected", () => {
  const m = new Metrics();
  assert.throws(() => m.counter("bad-name"), /invalid metric name/);
  assert.throws(() => m.observe("1starts_with_digit", 1), /invalid metric name/);
  assert.throws(() => m.counter(""), /invalid metric name/);
});

test("invalid label names are rejected", () => {
  const m = new Metrics();
  assert.throws(() => m.counter("ok", { "bad-label": "v" }), /invalid label name/);
});

test("label values are escaped", () => {
  const m = new Metrics();
  m.counter("calls", { path: 'a"b\\c\nd' });
  const out = m.render();
  assert.match(out, /^calls\{path="a\\"b\\\\c\\nd"\} 1$/m);
});

test("healthPayload reports ok status and non-negative uptime", () => {
  const payload = healthPayload();
  assert.equal(payload.status, "ok");
  assert.equal(typeof payload.uptimeSeconds, "number");
  assert.ok(payload.uptimeSeconds >= 0);
});
