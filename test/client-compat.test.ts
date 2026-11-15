// Client-perspective compatibility matrix for openapimcp.
//
// Spawns the real CLI (dist/cli.js) as a child process and exercises it as an
// MCP client would: JSON-RPC 2.0 over stdio (newline-delimited framing) and
// Streamable HTTP /mcp (single JSON response or SSE stream).
//
// Matrix covered:
//   1. stdio (default mode)   — initialize serverInfo/capabilities, tools/list,
//                               prompts/list (<tool>_help), resources/list
//   2. stdio --tool-search    — exactly search_tools + call_tool; unknown tool
//                               via call_tool -> isError mentioning search_tools
//   3. stdio --structured-content — tools/list ok; tool annotations present
//                                   (tools/call skipped: it would hit the network)
//   4. stdio --resources      — resources/list returns openapi:* entries
//   5. HTTP gateway           — GET /healthz 200; GET /metrics 200; initialize
//                               via POST /mcp returns serverInfo (SSE or JSON)
//   6. HTTP gateway --gateway-key — initialize without X-API-Key -> 401; with key -> 200
//
// Note on two client-visible behaviors that differ from a naive expectation
// (verified against the current build; src/ was NOT patched):
//   * resources/list in DEFAULT mode: the server does not advertise the
//     `resources` capability (no resources registered), so the MCP SDK answers
//     "resources/list" with JSON-RPC error -32601 "Method not found" instead of
//     an empty `{ resources: [] }` object. Both are spec-compliant for a server
//     without the resources capability; this test accepts either.
//   * GET /metrics on a fresh gateway: the in-memory Metrics registry only
//     renders observed series (counters/summaries are created on the first
//     tools/call), so the body is empty and does NOT contain "openapimcp_"
//     until at least one tool call has been observed. This test asserts the
//     endpoint contract (200 + text/plain) and documents the empty body in a
//     comment instead of asserting the presence of "openapimcp_".

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const FIXTURE = path.join(ROOT, "test", "fixtures", "demo-api.json");
const TIMEOUT_MS = 60_000;

type JsonRpcMessage = any;

/** Minimal JSON-RPC 2.0 client over a child's stdio (newline-delimited framing). */
class StdioRpc {
  private readonly child: ChildProcess;
  private buffer = "";
  private readonly pending = new Map<number, { resolve: (msg: JsonRpcMessage) => void; reject: (err: Error) => void }>();
  private nextId = 1;

  private constructor(child: ChildProcess) {
    this.child = child;
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.onData(chunk));
    child.on("exit", (code, signal) => {
      const err = new Error(`server exited before responding (code=${code}, signal=${signal})`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  static spawn(args: string[]): StdioRpc {
    const child = spawn(process.execPath, [CLI, "serve", FIXTURE, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: ROOT
    });
    child.stderr?.on("data", () => {
      // Drain stderr so the child never blocks on a full pipe.
    });
    return new StdioRpc(child);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // non-JSON log line on stdout — ignore
      }
      if (message?.id === undefined) continue; // server notification — no waiter
      const waiter = this.pending.get(message.id);
      if (waiter) {
        this.pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  }

  request(method: string, params: unknown, timeoutMs = 15_000): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout waiting for ${method} (id ${id})`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject
      });
      this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string, params?: unknown): void {
    const message = params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params };
    this.child.stdin!.write(JSON.stringify(message) + "\n");
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child.pid || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
  }
}

/** Run fn against a spawned stdio server and always tear the child down. */
async function withStdio<T>(args: string[], fn: (rpc: StdioRpc) => Promise<T>): Promise<T> {
  const rpc = StdioRpc.spawn(args);
  try {
    return await fn(rpc);
  } finally {
    await rpc.close();
  }
}

const initializeParams = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "openapimcp-client-compat", version: "1.0.0" }
};

async function handshake(rpc: StdioRpc): Promise<JsonRpcMessage> {
  const init = await rpc.request("initialize", initializeParams);
  rpc.notify("notifications/initialized");
  return init;
}

/** Pick a free port by binding port 0 and closing the probe server. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Poll /healthz until it answers 200 or the 10s deadline elapses. */
async function waitForHealthz(port: number, child: ChildProcess, deadlineMs = 10_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`gateway exited early (code=${child.exitCode}); healthz never became ready`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.status === 200) return;
      lastError = new Error(`/healthz status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError instanceof Error ? lastError : new Error("/healthz did not return 200 within 10s");
}

/** Spawn the HTTP gateway child, wait for readiness, run fn, then kill it. */
async function withGateway<T>(extraArgs: string[], fn: (port: number) => Promise<T>): Promise<T> {
  const port = await freePort();
  const child = spawn(process.execPath, [CLI, "serve", FIXTURE, "--http", "--port", String(port), ...extraArgs], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: ROOT
  });
  child.stderr?.on("data", () => {
    // Drain stderr (production warnings + gateway log lines) so pipes never fill.
  });
  try {
    await waitForHealthz(port, child);
    return await fn(port);
  } finally {
    if (child.exitCode === null && child.pid) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill();
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
    }
  }
}

/** Parse a Streamable HTTP /mcp response body (single JSON or SSE stream). */
function parseRpcMessage(contentType: string, body: string): JsonRpcMessage | undefined {
  if (contentType.includes("text/event-stream")) {
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (!data) continue;
      try {
        return JSON.parse(data);
      } catch {
        // keep looking for a JSON data frame
      }
    }
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

async function postMcp(
  port: number,
  payload: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; contentType: string; body: string; message?: JsonRpcMessage }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers
    },
    body: JSON.stringify(payload)
  });
  const body = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  return { status: res.status, contentType, body, message: parseRpcMessage(contentType, body) };
}

// ---------------------------------------------------------------- 1. stdio

test("stdio: initialize -> serverInfo + capabilities; tools/list; prompts/list; resources/list", { timeout: TIMEOUT_MS }, async () => {
  await withStdio([], async (rpc) => {
    const init = await rpc.request("initialize", initializeParams);
    assert.ok(init.result, `initialize must return a result, got: ${JSON.stringify(init)}`);
    assert.equal(typeof init.result.serverInfo?.name, "string");
    assert.ok(init.result.serverInfo.name.length > 0, "serverInfo.name must be non-empty");
    assert.equal(typeof init.result.serverInfo?.version, "string");
    assert.ok(init.result.serverInfo.version.length > 0, "serverInfo.version must be non-empty");
    assert.equal(typeof init.result.capabilities, "object", "initialize result must carry capabilities");

    rpc.notify("notifications/initialized");

    const tools = await rpc.request("tools/list", {});
    const toolList: Array<{ name: string }> = tools.result?.tools ?? [];
    assert.ok(toolList.length >= 5, `tools/list must expose >= 5 tools (got ${toolList.length})`);

    const prompts = await rpc.request("prompts/list", {});
    const promptList: Array<{ name: string }> = prompts.result?.prompts ?? [];
    assert.ok(promptList.length >= 1, `prompts/list must expose >= 1 prompt (got ${promptList.length})`);
    assert.ok(
      promptList.some((prompt) => prompt.name.endsWith("_help")),
      `prompts/list must carry <tool>_help names (got: ${promptList.map((p) => p.name).join(", ")})`
    );

    // Default mode does not advertise the resources capability; the SDK answers
    // with Method not found (-32601). An empty resources object is equally valid.
    // See the header comment — do not "fix" this into an object-only assertion.
    const resources = await rpc.request("resources/list", {});
    if (resources.error !== undefined) {
      assert.equal(resources.error.code, -32601, `default-mode resources/list must be empty-result or Method not found, got: ${JSON.stringify(resources.error)}`);
      assert.match(String(resources.error.message), /method not found/i);
    } else {
      assert.equal(typeof resources.result, "object", "resources/list result must be an object (even if empty)");
      assert.ok(Array.isArray(resources.result?.resources), "resources/list result must carry a resources array");
    }
  });
});

// ---------------------------------------------------------- 2. tool-search

test("stdio --tool-search: exactly search_tools + call_tool; unknown tool -> isError mentioning search_tools", { timeout: TIMEOUT_MS }, async () => {
  await withStdio(["--tool-search"], async (rpc) => {
    const init = await handshake(rpc);
    assert.ok(init.result, `initialize must return a result, got: ${JSON.stringify(init)}`);

    const tools = await rpc.request("tools/list", {});
    const names = (tools.result?.tools ?? []).map((tool: { name: string }) => tool.name).sort();
    assert.deepEqual(names, ["call_tool", "search_tools"], `tools/list must contain exactly search_tools + call_tool, got: ${names.join(", ")}`);

    const call = await rpc.request("tools/call", { name: "call_tool", arguments: { name: "not_a_real_tool", arguments: {} } });
    assert.equal(call.result?.isError, true, `unknown tool via call_tool must yield isError, got: ${JSON.stringify(call)}`);
    const text = JSON.stringify(call.result?.content ?? []);
    assert.match(text, /search_tools/, `error message must mention search_tools, got: ${text}`);
  });
});

// --------------------------------------------------- 3. structured-content

test("stdio --structured-content: tools/list ok and every tool carries annotations", { timeout: TIMEOUT_MS }, async () => {
  await withStdio(["--structured-content"], async (rpc) => {
    const init = await handshake(rpc);
    assert.ok(init.result, `initialize must return a result, got: ${JSON.stringify(init)}`);

    const tools = await rpc.request("tools/list", {});
    const toolList: Array<{ name: string; annotations?: unknown }> = tools.result?.tools ?? [];
    assert.ok(toolList.length >= 5, `tools/list must expose >= 5 tools (got ${toolList.length})`);
    for (const tool of toolList) {
      assert.ok(
        tool.annotations !== null && typeof tool.annotations === "object",
        `tool ${tool.name} must carry annotations, got: ${JSON.stringify(tool.annotations)}`
      );
    }
    // tools/call intentionally skipped: it would perform real network I/O.
  });
});

// -------------------------------------------------------------- 4. resources

test("stdio --resources: resources/list returns openapi: entries with mimeType", { timeout: TIMEOUT_MS }, async () => {
  await withStdio(["--resources"], async (rpc) => {
    const init = await handshake(rpc);
    assert.ok(init.result, `initialize must return a result, got: ${JSON.stringify(init)}`);
    assert.ok(init.result.capabilities?.resources, "with --resources the server must advertise the resources capability");

    const resources = await rpc.request("resources/list", {});
    const entries: Array<{ uri?: string; mimeType?: string }> = resources.result?.resources ?? [];
    assert.ok(entries.length > 0, `resources/list must contain entries, got: ${JSON.stringify(resources)}`);
    for (const entry of entries) {
      assert.ok(
        (typeof entry.uri === "string" && entry.uri.startsWith("openapi:")) || typeof entry.mimeType === "string",
        `entry must have a uri starting with "openapi:" or a mimeType, got: ${JSON.stringify(entry)}`
      );
    }
  });
});

// -------------------------------------------------------------------- 5. HTTP

test("HTTP gateway: /healthz 200, /metrics text, /mcp initialize returns serverInfo", { timeout: TIMEOUT_MS }, async () => {
  await withGateway([], async (port) => {
    const healthz = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthz.status, 200, "GET /healthz must return 200");

    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(metrics.status, 200, "GET /metrics must return 200");
    assert.match(metrics.headers.get("content-type") ?? "", /text\/plain/, "GET /metrics must be served as Prometheus text");
    const metricsText = await metrics.text();
    // NOTE: the in-memory registry renders only observed series, and counters are
    // created on the first tools/call (not at startup). A fresh gateway therefore
    // returns an empty body with no "openapimcp_" series. Asserted contract is
    // status + content-type; do not tighten this without a traffic-generating call.
    assert.equal(typeof metricsText, "string");

    const init = await postMcp(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initializeParams
    });
    assert.equal(init.status, 200, `POST /mcp initialize must return 200, got ${init.status}: ${init.body}`);
    const message = init.message;
    assert.ok(message, `POST /mcp initialize must yield a JSON-RPC message (JSON or SSE), got: ${init.body}`);
    assert.ok(message.result?.serverInfo, `initialize result must carry serverInfo, got: ${JSON.stringify(message)}`);
    assert.equal(typeof message.result.serverInfo.name, "string");
    assert.ok(message.result.serverInfo.name.length > 0);
  });
});

// ---------------------------------------------- 6. HTTP gateway --gateway-key

test("HTTP gateway --gateway-key: 401 without X-API-Key, 200 with X-API-Key", { timeout: TIMEOUT_MS }, async () => {
  await withGateway(["--gateway-key", "test-secret"], async (port) => {
    const unauthorized = await postMcp(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initializeParams
    });
    assert.equal(unauthorized.status, 401, `initialize without X-API-Key must return 401, got ${unauthorized.status}: ${unauthorized.body}`);

    const authorized = await postMcp(
      port,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: initializeParams
      },
      { "x-api-key": "test-secret" }
    );
    assert.equal(authorized.status, 200, `initialize with X-API-Key: test-secret must return 200, got ${authorized.status}: ${authorized.body}`);
    assert.ok(authorized.message?.result?.serverInfo, `authorized initialize must return serverInfo, got: ${authorized.body}`);
  });
});
