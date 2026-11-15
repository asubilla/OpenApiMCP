import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { OAuth2TokenProvider, parseOAuth2Config, buildTokenRequest } from "../src/oauth.js";

let server: Server;
let port = 0;
let base = "";
let hits = 0;
let statusToReturn = 200;
let expiresIn = 3600;

before(async () => {
  server = createServer(async (req, res) => {
    hits++;
    if (req.url === "/token" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (statusToReturn !== 200) {
        res.writeHead(statusToReturn, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: "tok-123", token_type: "Bearer", expires_in: expiresIn, scope: "read" }));
      return;
    }
    res.writeHead(404);
    res.end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as any).port;
  base = `http://localhost:${port}`;
});

after(() => server.close());

test("buildTokenRequest shape", () => {
  const req = buildTokenRequest({ tokenUrl: "http://example.com/token", clientId: "id", clientSecret: "secret", scope: "read write", audience: "aud" });
  assert.equal(req.url, "http://example.com/token");
  assert.equal(req.headers["content-type"], "application/x-www-form-urlencoded");
  const params = new URLSearchParams(req.body);
  assert.equal(params.get("grant_type"), "client_credentials");
  assert.equal(params.get("client_id"), "id");
  assert.equal(params.get("client_secret"), "secret");
  assert.equal(params.get("scope"), "read write");
  assert.equal(params.get("audience"), "aud");
});

test("successful token fetch", async () => {
  hits = 0;
  statusToReturn = 200;
  expiresIn = 3600;
  const provider = new OAuth2TokenProvider({ tokenUrl: `${base}/token`, clientId: "id", clientSecret: "secret" });
  const token = await provider.getToken();
  assert.equal(token, "tok-123");
  assert.equal(hits, 1);
});

test("caching: second call does not hit server", async () => {
  hits = 0;
  statusToReturn = 200;
  expiresIn = 3600;
  const provider = new OAuth2TokenProvider({ tokenUrl: `${base}/token`, clientId: "id", clientSecret: "secret" });
  const first = await provider.getToken();
  const second = await provider.getToken();
  assert.equal(first, "tok-123");
  assert.equal(second, "tok-123");
  assert.equal(hits, 1);
});

test("expiry refresh hits server again", async () => {
  hits = 0;
  statusToReturn = 200;
  expiresIn = 0;
  const provider = new OAuth2TokenProvider({ tokenUrl: `${base}/token`, clientId: "id", clientSecret: "secret" });
  await provider.getToken();
  const second = await provider.getToken();
  assert.equal(second, "tok-123");
  assert.equal(hits, 2);
});

test("invalidate forces refresh", async () => {
  hits = 0;
  statusToReturn = 200;
  expiresIn = 3600;
  const provider = new OAuth2TokenProvider({ tokenUrl: `${base}/token`, clientId: "id", clientSecret: "secret" });
  await provider.getToken();
  provider.invalidate();
  await provider.getToken();
  assert.equal(hits, 2);
});

test("throws on non-2xx", async () => {
  hits = 0;
  statusToReturn = 401;
  expiresIn = 3600;
  const provider = new OAuth2TokenProvider({ tokenUrl: `${base}/token`, clientId: "id", clientSecret: "secret" });
  await assert.rejects(() => provider.getToken(), /401/);
});

test("parseOAuth2Config returns null when env missing", () => {
  const saved = { ...process.env };
  delete process.env.OPENAPIMCP_CLIENT_ID;
  delete process.env.OPENAPIMCP_CLIENT_SECRET;
  delete process.env.OPENAPIMCP_FOO_CLIENT_ID;
  delete process.env.OPENAPIMCP_FOO_CLIENT_SECRET;
  const scheme = { type: "oauth2", flows: { clientCredentials: { tokenUrl: `${base}/token`, scopes: {} } } };
  assert.equal(parseOAuth2Config(scheme), null);
  Object.assign(process.env, saved);
});

test("parseOAuth2Config reads named env", () => {
  process.env.OPENAPIMCP_FOO_CLIENT_ID = "named-id";
  process.env.OPENAPIMCP_FOO_CLIENT_SECRET = "named-secret";
  const scheme = { name: "foo", type: "oauth2", flows: { clientCredentials: { tokenUrl: `${base}/token`, scopes: { read: "read" } } } };
  const cfg = parseOAuth2Config(scheme);
  assert.ok(cfg);
  assert.equal(cfg!.tokenUrl, `${base}/token`);
  assert.equal(cfg!.clientId, "named-id");
  assert.equal(cfg!.clientSecret, "named-secret");
  assert.equal(cfg!.scope, "read");
  delete process.env.OPENAPIMCP_FOO_CLIENT_ID;
  delete process.env.OPENAPIMCP_FOO_CLIENT_SECRET;
});

test("parseOAuth2Config reads global env", () => {
  process.env.OPENAPIMCP_CLIENT_ID = "global-id";
  process.env.OPENAPIMCP_CLIENT_SECRET = "global-secret";
  const scheme = { type: "oauth2", flows: { clientCredentials: { tokenUrl: `${base}/token`, scopes: {} } } };
  const cfg = parseOAuth2Config(scheme);
  assert.ok(cfg);
  assert.equal(cfg!.clientId, "global-id");
  delete process.env.OPENAPIMCP_CLIENT_ID;
  delete process.env.OPENAPIMCP_CLIENT_SECRET;
});

test("parseOAuth2Config returns null for non-oauth2", () => {
  assert.equal(parseOAuth2Config({ type: "http", scheme: "bearer" }), null);
  assert.equal(parseOAuth2Config(null), null);
});
