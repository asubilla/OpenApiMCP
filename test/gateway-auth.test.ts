import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateApiKey,
  createJwt,
  verifyJwt,
  authenticateRequest,
  authMiddleware,
  type GatewayAuthConfig
} from "../src/gateway-auth.js";

test("validateApiKey returns true when expected unset", () => {
  assert.equal(validateApiKey("anything", undefined), true);
  assert.equal(validateApiKey(undefined, undefined), true);
});

test("validateApiKey valid key", () => {
  assert.equal(validateApiKey("secret", "secret"), true);
});

test("validateApiKey invalid key", () => {
  assert.equal(validateApiKey("wrong", "secret"), false);
});

test("validateApiKey missing provided key", () => {
  assert.equal(validateApiKey(undefined, "secret"), false);
});

test("validateApiKey differs in length", () => {
  assert.equal(validateApiKey("short", "much-longer-secret"), false);
});

test("createJwt + verifyJwt round trip", () => {
  const token = createJwt("secret", { sub: "alice", role: "admin" }, 60);
  const result = verifyJwt(token, "secret");
  assert.equal(result.ok, true);
  assert.equal(result.payload?.sub, "alice");
  assert.equal(result.payload?.role, "admin");
  assert.equal(typeof result.payload?.iat, "number");
  assert.equal(typeof result.payload?.exp, "number");
});

test("verifyJwt expired token", () => {
  const token = createJwt("secret", { sub: "alice" }, -1);
  const result = verifyJwt(token, "secret");
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /expired/i);
});

test("verifyJwt wrong secret", () => {
  const token = createJwt("secret", { sub: "alice" }, 60);
  const result = verifyJwt(token, "other");
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /signature/i);
});

test("verifyJwt issuer mismatch", () => {
  const token = createJwt("secret", { sub: "alice", iss: "expected" }, 60);
  const result = verifyJwt(token, "secret", { issuer: "other" });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /issuer/i);
});

test("verifyJwt audience mismatch", () => {
  const token = createJwt("secret", { sub: "alice", aud: "expected" }, 60);
  const result = verifyJwt(token, "secret", { audience: "other" });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /audience/i);
});

test("verifyJwt issuer/audience match", () => {
  const token = createJwt("secret", { sub: "alice", iss: "iss", aud: "aud" }, 60);
  const result = verifyJwt(token, "secret", { issuer: "iss", audience: "aud" });
  assert.equal(result.ok, true);
});

test("verifyJwt malformed token", () => {
  assert.equal(verifyJwt("not-a-token", "secret").ok, false);
  assert.equal(verifyJwt("", "secret").ok, false);
});

test("authenticateRequest api key valid", () => {
  const config: GatewayAuthConfig = { apiKey: "secret" };
  const res = authenticateRequest({ "x-api-key": "secret" }, config);
  assert.equal(res.ok, true);
  assert.equal(res.identity, "api-key");
});

test("authenticateRequest api key via Authorization: ApiKey", () => {
  const config: GatewayAuthConfig = { apiKey: "secret" };
  const res = authenticateRequest({ authorization: "ApiKey secret" }, config);
  assert.equal(res.ok, true);
});

test("authenticateRequest api key invalid", () => {
  const config: GatewayAuthConfig = { apiKey: "secret" };
  const res = authenticateRequest({ "x-api-key": "wrong" }, config);
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /api key/i);
});

test("authenticateRequest api key missing", () => {
  const config: GatewayAuthConfig = { apiKey: "secret" };
  const res = authenticateRequest({}, config);
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /missing/i);
});

test("authenticateRequest jwt valid", () => {
  const token = createJwt("secret", { sub: "alice" }, 60);
  const config: GatewayAuthConfig = { jwtSecret: "secret" };
  const res = authenticateRequest({ authorization: `Bearer ${token}` }, config);
  assert.equal(res.ok, true);
  assert.equal(res.identity, "alice");
});

test("authenticateRequest jwt invalid", () => {
  const config: GatewayAuthConfig = { jwtSecret: "secret" };
  const res = authenticateRequest({ authorization: "Bearer nope" }, config);
  assert.equal(res.ok, false);
});

test("authenticateRequest jwt expired", () => {
  const token = createJwt("secret", { sub: "alice" }, -1);
  const config: GatewayAuthConfig = { jwtSecret: "secret" };
  const res = authenticateRequest({ authorization: `Bearer ${token}` }, config);
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /expired/i);
});

test("authenticateRequest disabled auth", () => {
  const res = authenticateRequest({}, {});
  assert.deepEqual(res, { ok: true, identity: "anonymous" });
});

test("authenticateRequest both modes accepts either", () => {
  const token = createJwt("jsecret", { sub: "jwt-user" }, 60);
  const config: GatewayAuthConfig = { apiKey: "apikey", jwtSecret: "jsecret" };
  const r1 = authenticateRequest({ "x-api-key": "apikey" }, config);
  const r2 = authenticateRequest({ authorization: `Bearer ${token}` }, config);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
});

test("authMiddleware writes 401 on failure and returns false", () => {
  const config: GatewayAuthConfig = { apiKey: "secret" };
  const mw = authMiddleware(config);
  let statusCode = 0;
  let body = "";
  const res: any = {
    headersSent: false,
    writeHead(code: number) { statusCode = code; },
    end(data: string) { body = data; }
  };
  const ok = mw({ headers: {} }, res);
  assert.equal(ok, false);
  assert.equal(statusCode, 401);
  const parsed = JSON.parse(body);
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /missing/i);
});

test("authMiddleware returns true on success", () => {
  const config: GatewayAuthConfig = { apiKey: "secret" };
  const mw = authMiddleware(config);
  const res: any = { headersSent: false, writeHead() {}, end() {} };
  const ok = mw({ headers: { "x-api-key": "secret" } }, res);
  assert.equal(ok, true);
});

test("constant-time compare does not throw on differing lengths", () => {
  assert.doesNotThrow(() => validateApiKey("a".repeat(1000), "b"));
  assert.equal(validateApiKey("a".repeat(1000), "b"), false);
});