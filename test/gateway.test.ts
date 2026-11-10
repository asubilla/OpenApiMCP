import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../src/openapi.js";
import { buildServer } from "../src/server.js";
import { startGateway } from "../src/gateway.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(readFileSync(path.join(root, "test", "fixtures", "demo-api.json"), "utf8"));

async function withGateway(fn: (base: string) => Promise<void>): Promise<void> {
  const api = parseDocument(doc);
  const server: Server = await startGateway({
    port: 0,
    host: "127.0.0.1",
    path: "/mcp",
    createServer: () =>
      buildServer(api, { serverName: "demo", version: "1.0.0", headers: {}, timeoutMs: 5000, maxBytes: 10000 })
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function initialize() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } }
  };
}

test("gateway answers initialize over Streamable HTTP", async () => {
  await withGateway(async (base) => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(initialize())
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /result|serverInfo|protocolVersion/);
  });
});

test("gateway returns 404 on unknown path", async () => {
  await withGateway(async (base) => {
    const res = await fetch(`${base}/nope`, { method: "POST", body: "{}" });
    assert.equal(res.status, 404);
  });
});
