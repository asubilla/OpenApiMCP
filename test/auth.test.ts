import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveToolSecurity, schemeAuth, substituteEnv } from "../src/auth.js";

test("apiKey header resolved from env", () => {
  const auth = schemeAuth("ApiKeyAuth", { type: "apiKey", in: "header", name: "X-API-Key" }, { OPENAPIMCP_APIKEYAUTH: "secret" });
  assert.deepEqual(auth, { headers: { "x-api-key": "secret" }, query: {} });
});

test("apiKey in query resolved from env", () => {
  const auth = schemeAuth("Q", { type: "apiKey", in: "query", name: "key" }, { OPENAPIMCP_Q: "abc" });
  assert.deepEqual(auth, { headers: {}, query: { key: "abc" } });
});

test("bearer token resolved from env", () => {
  const auth = schemeAuth("BearerAuth", { type: "http", scheme: "bearer" }, { OPENAPIMCP_BEARERAUTH: "tok" });
  assert.equal(auth?.headers.authorization, "Bearer tok");
});

test("basic auth from username/password", () => {
  const auth = schemeAuth("B", { type: "http", scheme: "basic" }, { OPENAPIMCP_B_USERNAME: "u", OPENAPIMCP_B_PASSWORD: "p" });
  assert.equal(auth?.headers.authorization, `Basic ${Buffer.from("u:p").toString("base64")}`);
});

test("missing credentials return null", () => {
  assert.equal(schemeAuth("X", { type: "apiKey", in: "header", name: "K" }, {}), null);
});

test("resolveToolSecurity picks the first satisfiable requirement", () => {
  const schemes = {
    A: { type: "apiKey", in: "header", name: "A" },
    B: { type: "apiKey", in: "header", name: "B" }
  };
  const auth = resolveToolSecurity(schemes, [{ A: [] }, { B: [] }], { OPENAPIMCP_B: "b" });
  assert.deepEqual(auth.headers, { b: "b" });
});

test("explicit empty security means no auth", () => {
  const auth = resolveToolSecurity({ A: { type: "apiKey", in: "header", name: "A" } }, [], { OPENAPIMCP_A: "a" });
  assert.deepEqual(auth, { headers: {}, query: {} });
});

test("substituteEnv replaces {env:VAR}", () => {
  assert.equal(substituteEnv("Bearer {env:TOKEN}", { TOKEN: "abc" }), "Bearer abc");
});
