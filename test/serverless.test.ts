import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetchHandler } from "../src/serverless.js";

function createServer() {
  return { name: "test", version: "1.0.0" };
}

test("createFetchHandler returns a function", () => {
  const handler = createFetchHandler(createServer);
  assert.equal(typeof handler, "function");
});

test("GET /mcp returns 405", async () => {
  const handler = createFetchHandler(createServer);
  const res = await handler(new Request("http://localhost/mcp", { method: "GET" }));
  assert.equal(res.status, 405);
});

test("POST /mcp initialize returns 200 with JSON-RPC result", async () => {
  const handler = createFetchHandler(createServer);
  const res = await handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" }
        }
      })
    })
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /result/);
  assert.match(text, /serverInfo/);
});