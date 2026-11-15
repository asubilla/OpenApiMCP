// Serverless/edge adapters for turning an MCP server factory into platform handlers.
// Dependency-free: uses only Node.js builtins / web-standard APIs.

export interface ServerlessRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ServerlessResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type McpHandler = (req: ServerlessRequest) => Promise<ServerlessResponse>;

function serverMeta(server: any): { name: string; version: string } {
  const name =
    (server && typeof server === "object" && (server.name ?? server.serverName ?? server.title)) ||
    "openapimcp";
  const version =
    (server && typeof server === "object" && (server.version ?? server.serverVersion)) || "1.0.0";
  return { name: String(name), version: String(version) };
}

function serverCapabilities(server: any): Record<string, unknown> {
  if (server && typeof server === "object" && server.capabilities && typeof server.capabilities === "object") {
    return server.capabilities;
  }
  const caps: Record<string, unknown> = { tools: {} };
  if (server && typeof server === "object") {
    if (Array.isArray(server.tools) && server.tools.length) caps.tools = { listChanged: true };
    if (typeof server.listTools === "function") caps.tools = { listChanged: true };
  }
  return caps;
}

function listTools(server: any): any[] {
  if (!server || typeof server !== "object") return [];
  if (Array.isArray(server.tools)) return server.tools;
  if (typeof server.listTools === "function") {
    try {
      const r = server.listTools();
      if (Array.isArray(r)) return r;
    } catch {
      // ignore
    }
  }
  return [];
}

async function callTool(server: any, name: any, args: any): Promise<any> {
  if (server && typeof server === "object") {
    if (typeof server.callTool === "function") {
      try {
        return await server.callTool(name, args);
      } catch {
        // fall through
      }
    }
    if (typeof server.handleTool === "function") {
      try {
        return await server.handleTool(name, args);
      } catch {
        // fall through
      }
    }
  }
  return { content: [{ type: "text", text: `Unknown tool: ${String(name)}` }], isError: true };
}

function jsonRpcError(id: any, code: number, message: string): any {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleOne(req: any, server: any, meta: { name: string; version: string }): Promise<any> {
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }
  const { id, method, params } = req;
  if (typeof method !== "string") {
    return jsonRpcError(id ?? null, -32600, "Invalid Request");
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      result: {
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: serverCapabilities(server),
        serverInfo: { name: meta.name, version: meta.version }
      }
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id: id ?? null, result: {} };
  }

  if (method === "notifications/initialized" || method === "initialized" || method.startsWith("notifications/")) {
    return null;
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id: id ?? null, result: { tools: listTools(server) } };
  }

  if (method === "tools/call") {
    const result = await callTool(server, params?.name, params?.arguments ?? params?.args ?? {});
    return { jsonrpc: "2.0", id: id ?? null, result };
  }

  if (typeof server?.handleRequest === "function") {
    try {
      const r = await server.handleRequest(req);
      if (r && typeof r === "object") return r;
    } catch {
      // fall through
    }
  }

  return jsonRpcError(id ?? null, -32601, `Method not found: ${method}`);
}

async function handleJsonRpc(body: any, server: any, meta: { name: string; version: string }): Promise<{ status: number; payload: any }> {
  if (Array.isArray(body)) {
    const out: any[] = [];
    let hasResponse = false;
    for (const item of body) {
      const r = await handleOne(item, server, meta);
      if (r !== null) {
        out.push(r);
        hasResponse = true;
      }
    }
    if (!hasResponse) return { status: 202, payload: null };
    return { status: 200, payload: out };
  }

  const r = await handleOne(body, server, meta);
  if (r === null) return { status: 202, payload: null };
  return { status: 200, payload: r };
}

export function createFetchHandler(
  createServer: () => any,
  mcpPath?: string
): (request: Request) => Promise<Response> {
  const endpoint = mcpPath ?? "/mcp";

  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      url = new URL(request.url, "http://localhost");
    }

    if (url.pathname !== endpoint) {
      return new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain" }
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "content-type": "text/plain", allow: "POST" }
      });
    }

    const server = createServer();
    const meta = serverMeta(server);

    let body: any = null;
    try {
      body = await request.json();
    } catch {
      try {
        const text = await request.text();
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
    }

    const { status, payload } = await handleJsonRpc(body, server, meta);

    if (payload === null) {
      return new Response(null, { status });
    }

    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" }
    });
  };
}

export function toLambdaHandler(
  createServer: () => any,
  mcpPath?: string
): (event: any) => Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const fetchHandler = createFetchHandler(createServer, mcpPath);

  return async (event: any) => {
    const method =
      event?.requestContext?.http?.method ??
      event?.httpMethod ??
      event?.requestContext?.httpMethod ??
      "GET";

    const headers: Record<string, string> = {};
    if (event?.headers && typeof event.headers === "object") {
      for (const [key, value] of Object.entries(event.headers)) {
        if (value != null) headers[key] = String(value);
      }
    }

    let body: string | undefined;
    if (event?.body != null) {
      body = typeof event.body === "string" ? event.body : JSON.stringify(event.body);
      if (event?.isBase64Encoded && typeof event.body === "string") {
        body = Buffer.from(event.body, "base64").toString("utf8");
      }
    }

    const host = headers.host ?? headers.Host ?? "localhost";
    const path = event?.rawPath ?? event?.path ?? "/";
    const queryString =
      event?.rawQueryString ??
      (event?.queryStringParameters
        ? new URLSearchParams(event.queryStringParameters).toString()
        : "");
    const url = `https://${host}${path}${queryString ? `?${queryString}` : ""}`;

    const init: RequestInit = { method, headers };
    if (method !== "GET" && method !== "HEAD" && body != null) {
      init.body = body;
    }

    const response = await fetchHandler(new Request(url, init));
    const responseBody = await response.text();

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: responseBody
    };
  };
}

export function toVercelHandler(
  createServer: () => any,
  mcpPath?: string
): (req: any, res: any) => Promise<void> {
  const fetchHandler = createFetchHandler(createServer, mcpPath);

  return async (req: any, res: any): Promise<void> => {
    try {
      let raw = "";
      if (req?.body != null) {
        raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      } else if (req && typeof req[Symbol.asyncIterator] === "function") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        raw = Buffer.concat(chunks).toString("utf8");
      }

      const host = req?.headers?.host ?? req?.headers?.Host ?? "localhost";
      const url = `http://${host}${req?.url ?? "/"}`;

      const headers: Record<string, string> = {};
      if (req?.headers && typeof req.headers === "object") {
        for (const [key, value] of Object.entries(req.headers)) {
          if (value != null) headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
        }
      }

      const method = req?.method ?? "GET";
      const init: RequestInit = { method, headers };
      if (method !== "GET" && method !== "HEAD" && raw) {
        init.body = raw;
      }

      const response = await fetchHandler(new Request(url, init));

      res.statusCode = response.status;
      response.headers.forEach((value: string, key: string) => {
        res.setHeader(key, value);
      });
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);
    } catch (err: any) {
      res.statusCode = 500;
      res.end(String(err?.message ?? err));
    }
  };
}