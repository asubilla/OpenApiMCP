import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { callApi, clearCache, type RequestOptions } from "../src/http.js";
import type { ToolDef } from "../src/types.js";

function tool(overrides: Partial<ToolDef> = {}): ToolDef {
  return {
    name: "t",
    description: "t",
    method: "get",
    path: "/x",
    params: [],
    bodyObject: false,
    tags: [],
    annotations: {},
    security: { headers: {}, query: {} },
    ...overrides
  };
}

let server: Server;
let port = 0;
let base = "";
let hits = 0;
let failNext = 0;

const opts = (extra: Partial<RequestOptions> = {}): RequestOptions => ({
  baseUrl: base,
  headers: {},
  timeoutMs: 5000,
  maxBytes: 10000,
  retryDelayMs: 5,
  ...extra
});

before(async () => {
  server = createServer((req, res) => {
    hits++;
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/retry") {
      if (failNext > 0) {
        failNext--;
        res.writeHead(500);
        res.end("boom");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/cache") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hits }));
      return;
    }
    if (url.pathname === "/pages") {
      const page = Number(url.searchParams.get("page") ?? "1");
      res.writeHead(200, { "content-type": "application/json" });
      if (page < 3) res.end(JSON.stringify({ items: [{ page }], next: `http://localhost:${port}/pages?page=${page + 1}` }));
      else res.end(JSON.stringify({ items: [{ page }] }));
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

test("retries on 5xx then succeeds", async () => {
  hits = 0;
  failNext = 2;
  const result = await callApi(tool({ path: "/retry" }), {}, opts({ retries: 3 }));
  assert.equal(result.isError, false);
  assert.match(result.text, /HTTP 200/);
  assert.equal(hits, 3);
});

test("caches GET responses", async () => {
  clearCache();
  hits = 0;
  const options = opts({ cacheTtlMs: 10000 });
  const first = await callApi(tool({ path: "/cache" }), {}, options);
  const second = await callApi(tool({ path: "/cache" }), {}, options);
  assert.equal(hits, 1);
  assert.equal(first.text, second.text);
});

test("follows pagination links and merges pages", async () => {
  const result = await callApi(tool({ path: "/pages" }), {}, opts({ paginate: true, maxPages: 5 }));
  assert.match(result.text, /"page": 1/);
  assert.match(result.text, /"page": 3/);
  assert.match(result.text, /"page": 1[\s\S]*"page": 2[\s\S]*"page": 3/);
});

test("respects maxPages", async () => {
  const result = await callApi(tool({ path: "/pages" }), {}, opts({ paginate: true, maxPages: 2 }));
  assert.match(result.text, /"page": 1/);
  assert.match(result.text, /"page": 2/);
  assert.doesNotMatch(result.text, /"page": 3/);
});
