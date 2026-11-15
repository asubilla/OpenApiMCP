import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkGateway,
  formatProductionReport,
  isProductionOk,
  type ProductionReport
} from "../src/production-defaults.js";

test("loopback gateway with readOnly and auth passes with no errors", () => {
  const report = checkGateway({
    host: "127.0.0.1",
    port: 8080,
    readOnly: true,
    auth: { apiKey: "secret" }
  });
  assert.equal(report.summary.errors, 0);
  assert.equal(report.ok, true);
  assert.equal(isProductionOk(report), true);
  assert.deepEqual(
    report.checks.filter((c) => c.severity === "error"),
    []
  );
});

test("localhost and ::1 are treated as loopback", () => {
  for (const host of ["localhost", "::1", "[::1]", "127.0.0.2"]) {
    const report = checkGateway({
      host,
      port: 8080,
      readOnly: true,
      auth: { jwtSecret: "secret" }
    });
    assert.equal(report.summary.errors, 0, `host ${host} should be loopback`);
    assert.equal(report.ok, true);
  }
});

test("non-loopback host without allowedHosts raises an error", () => {
  const report = checkGateway({
    host: "0.0.0.0",
    port: 8080,
    readOnly: true,
    auth: { apiKey: "secret" }
  });
  const exposed = report.checks.find((c) => c.id === "gateway-host-exposed");
  assert.ok(exposed, "expected gateway-host-exposed check");
  assert.equal(exposed.severity, "error");
  assert.equal(report.ok, false);
  assert.equal(isProductionOk(report), false);
  assert.equal(report.summary.errors, 1);
});

test("non-loopback host with allowedHosts does not raise the exposure error", () => {
  const report = checkGateway({
    host: "0.0.0.0",
    port: 8080,
    readOnly: true,
    auth: { apiKey: "secret" },
    allowedHosts: ["mcp.example.com"]
  });
  assert.equal(report.checks.some((c) => c.id === "gateway-host-exposed"), false);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.ok, true);
});

test("http true on a non-loopback host raises an error", () => {
  const report = checkGateway({
    host: "192.168.1.10",
    port: 8080,
    http: true,
    readOnly: true,
    auth: { apiKey: "secret" },
    allowedHosts: ["192.168.1.10"]
  });
  const httpCheck = report.checks.find((c) => c.id === "gateway-http-nonloopback");
  assert.ok(httpCheck, "expected gateway-http-nonloopback check");
  assert.equal(httpCheck.severity, "error");
  assert.equal(report.ok, false);
});

test("http true on a loopback host does not raise the http error", () => {
  const report = checkGateway({
    host: "127.0.0.1",
    port: 8080,
    http: true,
    readOnly: true,
    auth: { apiKey: "secret" }
  });
  assert.equal(report.checks.some((c) => c.id === "gateway-http-nonloopback"), false);
  assert.equal(report.summary.errors, 0);
});

test("missing auth warns (gateway unauthenticated)", () => {
  const report = checkGateway({ host: "127.0.0.1", port: 8080, readOnly: true });
  const authCheck = report.checks.find((c) => c.id === "gateway-unauthenticated");
  assert.ok(authCheck, "expected gateway-unauthenticated check");
  assert.equal(authCheck.severity, "warning");
  assert.equal(report.summary.warnings >= 1, true);
});

test("empty auth object still warns; apiKey/jwt/oauth do not", () => {
  const empty = checkGateway({ host: "127.0.0.1", port: 8080, readOnly: true, auth: {} });
  assert.equal(empty.checks.some((c) => c.id === "gateway-unauthenticated"), true);

  for (const auth of [{ apiKey: "k" }, { jwtSecret: "s" }, { oauth: { clientId: "id" } }, { token: "t" }]) {
    const report = checkGateway({ host: "127.0.0.1", port: 8080, readOnly: true, auth });
    assert.equal(
      report.checks.some((c) => c.id === "gateway-unauthenticated"),
      false,
      `auth ${JSON.stringify(auth)} should count as configured`
    );
  }
});

test("missing readOnly and missing policy warns (write ops exposed)", () => {
  const report = checkGateway({
    host: "127.0.0.1",
    port: 8080,
    auth: { apiKey: "secret" }
  });
  const writeCheck = report.checks.find((c) => c.id === "gateway-write-ops-default");
  assert.ok(writeCheck, "expected gateway-write-ops-default check");
  assert.equal(writeCheck.severity, "warning");
});

test("policy configured suppresses the write-ops warning", () => {
  const report = checkGateway({
    host: "127.0.0.1",
    port: 8080,
    auth: { apiKey: "secret" },
    policy: { allow: ["tools/list"] }
  });
  assert.equal(report.checks.some((c) => c.id === "gateway-write-ops-default"), false);
});

test("missing port yields an info check", () => {
  const report = checkGateway({
    host: "127.0.0.1",
    readOnly: true,
    auth: { apiKey: "secret" }
  });
  const portCheck = report.checks.find((c) => c.id === "gateway-port-missing");
  assert.ok(portCheck, "expected gateway-port-missing check");
  assert.equal(portCheck.severity, "info");
  assert.equal(report.summary.infos, 1);
});

test("string port is accepted and does not yield the port info check", () => {
  const report = checkGateway({
    host: "127.0.0.1",
    port: "8080",
    readOnly: true,
    auth: { apiKey: "secret" }
  });
  assert.equal(report.checks.some((c) => c.id === "gateway-port-missing"), false);
});

test("formatProductionReport groups errors, warnings and infos in order", () => {
  const report = checkGateway({
    host: "0.0.0.0",
    http: true,
    // no port -> info, no readOnly/policy -> warning, no auth -> warning
    allowedHosts: undefined
  });
  const out = formatProductionReport(report);

  assert.match(out, /FAILED/);
  const errorsIdx = out.indexOf("Errors:");
  const warningsIdx = out.indexOf("Warnings:");
  const infosIdx = out.indexOf("Infos:");
  assert.notEqual(errorsIdx, -1);
  assert.notEqual(warningsIdx, -1);
  assert.notEqual(infosIdx, -1);
  assert.ok(errorsIdx < warningsIdx, "errors group should come before warnings");
  assert.ok(warningsIdx < infosIdx, "warnings group should come before infos");

  assert.match(out, /gateway-host-exposed/);
  assert.match(out, /gateway-http-nonloopback/);
  assert.match(out, /gateway-unauthenticated/);
  assert.match(out, /gateway-write-ops-default/);
  assert.match(out, /gateway-port-missing/);
  assert.match(out, /fix: /);
});

test("formatProductionReport renders OK header and no-issues line for a clean report", () => {
  const report: ProductionReport = {
    ok: true,
    checks: [],
    summary: { errors: 0, warnings: 0, infos: 0 }
  };
  const out = formatProductionReport(report);
  assert.match(out, /OK/);
  assert.match(out, /No issues found\./);
  assert.equal(out.includes("Errors:"), false);
});

test("isProductionOk is true iff there are no error-severity checks", () => {
  const clean = checkGateway({
    host: "127.0.0.1",
    port: 8080,
    readOnly: true,
    auth: { apiKey: "secret" }
  });
  assert.equal(isProductionOk(clean), true);

  const broken = checkGateway({ host: "0.0.0.0", port: 8080, readOnly: true, auth: { apiKey: "secret" } });
  assert.equal(isProductionOk(broken), false);

  // Warnings only -> still ok.
  const warnOnly: ProductionReport = {
    ok: true,
    checks: [{ id: "x", severity: "warning", message: "w" }],
    summary: { errors: 0, warnings: 1, infos: 0 }
  };
  assert.equal(isProductionOk(warnOnly), true);
});
