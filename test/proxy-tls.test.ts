import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProxyEnv, formatProxyTls, planProxyTls } from "../src/proxy-tls.js";

test("buildProxyEnv sets HTTP_PROXY and HTTPS_PROXY from opts.proxy", () => {
  const env = buildProxyEnv({ proxy: "http://proxy.local:3128" }, {});
  assert.equal(env.HTTP_PROXY, "http://proxy.local:3128");
  assert.equal(env.HTTPS_PROXY, "http://proxy.local:3128");
});

test("buildProxyEnv sets NODE_EXTRA_CA_CERTS from opts.ca", () => {
  const env = buildProxyEnv({ ca: "/etc/ssl/corp-ca.pem" }, {});
  assert.equal(env.NODE_EXTRA_CA_CERTS, "/etc/ssl/corp-ca.pem");
});

test("buildProxyEnv sets NODE_TLS_REJECT_UNAUTHORIZED=0 only when false", () => {
  assert.equal(buildProxyEnv({ rejectUnauthorized: false }, {}).NODE_TLS_REJECT_UNAUTHORIZED, "0");
  assert.equal(buildProxyEnv({ rejectUnauthorized: true }, {}).NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  assert.equal(buildProxyEnv({}, {}).NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});

test("buildProxyEnv returns no vars when nothing applies", () => {
  assert.deepEqual(buildProxyEnv({}, {}), {});
});

test("buildProxyEnv preserves existing env when opts absent", () => {
  const source = { HTTP_PROXY: "http://env-proxy:8080", HTTPS_PROXY: "http://env-proxy:8443" };
  const env = buildProxyEnv({}, source);
  assert.equal(env.HTTP_PROXY, "http://env-proxy:8080");
  assert.equal(env.HTTPS_PROXY, "http://env-proxy:8443");
  assert.equal(env.NODE_EXTRA_CA_CERTS, undefined);
});

test("buildProxyEnv does not mutate the passed env object", () => {
  const source: Record<string, string | undefined> = { HTTP_PROXY: "http://env-proxy:8080" };
  buildProxyEnv({ proxy: "http://opts-proxy:3128", ca: "/ca.pem" }, source);
  assert.deepEqual(source, { HTTP_PROXY: "http://env-proxy:8080" });
});

test("buildProxyEnv prefers opts over env", () => {
  const source = { HTTP_PROXY: "http://env-proxy:8080", HTTPS_PROXY: "http://env-secure:8443" };
  const env = buildProxyEnv({ proxy: "http://opts-proxy:3128" }, source);
  assert.equal(env.HTTP_PROXY, "http://opts-proxy:3128");
  assert.equal(env.HTTPS_PROXY, "http://opts-proxy:3128");
});

test("buildProxyEnv treats blank opts values as unset", () => {
  const env = buildProxyEnv({ proxy: "   ", ca: "" }, {});
  assert.deepEqual(env, {});
});

test("buildProxyEnv combines proxy, ca and rejectUnauthorized", () => {
  const env = buildProxyEnv(
    { proxy: "http://proxy.local:3128", ca: "/ca.pem", rejectUnauthorized: false },
    {}
  );
  assert.deepEqual(env, {
    HTTP_PROXY: "http://proxy.local:3128",
    HTTPS_PROXY: "http://proxy.local:3128",
    NODE_EXTRA_CA_CERTS: "/ca.pem",
    NODE_TLS_REJECT_UNAUTHORIZED: "0"
  });
});

test("planProxyTls normalizes opts into a plan", () => {
  const plan = planProxyTls({ proxy: "  http://proxy.local:3128  ", ca: " /ca.pem " }, {});
  assert.equal(plan.proxy, "http://proxy.local:3128");
  assert.equal(plan.ca, "/ca.pem");
  assert.equal(plan.rejectUnauthorized, undefined);
  assert.equal(plan.env.HTTP_PROXY, "http://proxy.local:3128");
});

test("planProxyTls resolves proxy from env when opts absent", () => {
  const plan = planProxyTls({}, { HTTP_PROXY: "http://env-proxy:8080" });
  assert.equal(plan.proxy, "http://env-proxy:8080");
  assert.equal(plan.env.HTTP_PROXY, "http://env-proxy:8080");
});

test("planProxyTls falls back to HTTPS_PROXY from env", () => {
  const plan = planProxyTls({}, { HTTPS_PROXY: "http://env-secure:8443" });
  assert.equal(plan.proxy, "http://env-secure:8443");
});

test("planProxyTls keeps rejectUnauthorized false and drops empty values", () => {
  const plan = planProxyTls({ rejectUnauthorized: false, proxy: "", ca: "  " }, {});
  assert.equal(plan.rejectUnauthorized, false);
  assert.equal(plan.proxy, undefined);
  assert.equal(plan.ca, undefined);
  assert.equal(plan.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
});

test("planProxyTls with no input produces an empty-ish plan", () => {
  const plan = planProxyTls({}, {});
  assert.deepEqual(plan, { env: {} });
});

test("formatProxyTls masks passwords in the proxy URL", () => {
  const plan = planProxyTls({ proxy: "http://alice:s3cret@proxy.local:3128" }, {});
  const out = formatProxyTls(plan);
  assert.ok(!out.includes("s3cret"), "password must not appear in output");
  assert.ok(!out.includes("alice"), "username must not appear in output");
  assert.ok(out.includes("******:"), "masked placeholder should appear");
  // The plan itself keeps the original value; masking is output-only.
  assert.equal(plan.proxy, "http://alice:s3cret@proxy.local:3128");
});

test("formatProxyTls renders a multi-line summary with env vars", () => {
  const plan = planProxyTls({ proxy: "http://proxy.local:3128", ca: "/ca.pem", rejectUnauthorized: false }, {});
  const out = formatProxyTls(plan);
  assert.match(out, /proxy: http:\/\/proxy\.local:3128/);
  assert.match(out, /ca: \/ca\.pem/);
  assert.match(out, /rejectUnauthorized: false/);
  assert.match(out, /HTTP_PROXY=http:\/\/proxy\.local:3128/);
  assert.match(out, /NODE_TLS_REJECT_UNAUTHORIZED=0/);
  assert.ok(out.includes("\n"));
});

test("formatProxyTls shows (not set) placeholders for empty plans", () => {
  const out = formatProxyTls({ env: {} });
  assert.match(out, /proxy: \(not set\)/);
  assert.match(out, /ca: \(not set\)/);
  assert.match(out, /env: \(none\)/);
});
