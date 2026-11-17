import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  NodeStreamableHTTPServerTransport,
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation
} from "@modelcontextprotocol/node";
import { healthPayload, type Metrics } from "./metrics.js";
import { portalHtml } from "./portal.js";
import { authMiddleware, type GatewayAuthConfig } from "./gateway-auth.js";
import { InMemoryEventStore } from "./event-store.js";
import { UserRateLimiter, userKeyFromHeaders, type UserRateLimitConfig } from "./user-ratelimit.js";

export interface GatewayOptions {
  port: number;
  host: string;
  /** Path the MCP endpoint is mounted on, e.g. "/mcp". */
  path: string;
  /** Display name for the developer portal. */
  serverName?: string;
  /** Optional gateway auth (API key / JWT). */
  auth?: GatewayAuthConfig;
  /** Allowed `Host` header values. Defaults to localhost-only. */
  allowedHosts?: string[];
  /** Allowed `Origin` header values. Defaults to localhost-only. */
  allowedOrigins?: string[];
  /** Factory that returns a fresh server per request (stateless gateway). */
  createServer: () => McpServer;
  /** Metrics registry exposed at GET /metrics. */
  metrics?: Metrics;
  /** Called after the server is listening. */
  onListening?: (url: string) => void;
  /** Enable SSE resumability (session IDs + Last-Event-ID event replay). */
  resumable?: boolean;
  /** Maximum events to retain in the in-memory event store. Default 1000. */
  resumableMaxEvents?: number;
  /** Per-user rate limit (x-user-key / x-api-key / auth tail). */
  userRateLimit?: UserRateLimitConfig;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Start a Streamable HTTP MCP gateway. Resolves once the socket is listening. */
export function startGateway(options: GatewayOptions): Promise<Server> {
  const validateHost = options.allowedHosts?.length
    ? hostHeaderValidation(options.allowedHosts)
    : isLoopback(options.host)
      ? localhostHostValidation()
      : null;
  const validateOrigin = options.allowedOrigins?.length
    ? originValidation(options.allowedOrigins)
    : isLoopback(options.host)
      ? localhostOriginValidation()
      : null;

  const userLimiter = options.userRateLimit ? new UserRateLimiter(options.userRateLimit) : undefined;
  const eventStore = options.resumable ? new InMemoryEventStore({ maxEvents: options.resumableMaxEvents }) : undefined;

  const handler = async (req: any, res: any) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (options.auth && url.pathname !== "/healthz" && url.pathname !== "/metrics") {
      const guard = authMiddleware(options.auth);
      if (!guard(req, res)) return;
    }

    if (userLimiter && req.method === "POST" && url.pathname === options.path) {
      const key = userKeyFromHeaders(req.headers as Record<string, string | string[] | undefined>);
      if (!userLimiter.check(key)) {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
        res.end(JSON.stringify({ error: "rate limit exceeded", user: key ?? "default" }));
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(healthPayload()));
      return;
    }
    if (req.method === "GET" && url.pathname === "/metrics" && options.metrics) {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(options.metrics.render());
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/portal")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(portalHtml(options.path, options.serverName ?? "openapimcp"));
      return;
    }
    if (url.pathname !== options.path) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`Not found. The MCP endpoint is ${options.path}\n`);
      return;
    }
    if (validateHost && !validateHost(req, res)) return;
    if (validateOrigin && !validateOrigin(req, res)) return;

    const server = options.createServer();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: options.resumable ? () => randomUUID() : undefined,
      ...(eventStore ? { eventStore } : {})
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("Internal error");
    }
  };

  return new Promise((resolve, reject) => {
    const httpServer = createServer(handler);
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      options.onListening?.(`http://${options.host}:${port}${options.path}`);
      resolve(httpServer);
    });
  });
}
