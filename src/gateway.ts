import { createServer, type Server } from "node:http";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  NodeStreamableHTTPServerTransport,
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation
} from "@modelcontextprotocol/node";

export interface GatewayOptions {
  port: number;
  host: string;
  /** Path the MCP endpoint is mounted on, e.g. "/mcp". */
  path: string;
  /** Allowed `Host` header values. Defaults to localhost-only. */
  allowedHosts?: string[];
  /** Allowed `Origin` header values. Defaults to localhost-only. */
  allowedOrigins?: string[];
  /** Factory that returns a fresh server per request (stateless gateway). */
  createServer: () => McpServer;
  /** Called after the server is listening. */
  onListening?: (url: string) => void;
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

  const handler = async (req: any, res: any) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== options.path) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`Not found. The MCP endpoint is ${options.path}\n`);
      return;
    }
    if (validateHost && !validateHost(req, res)) return;
    if (validateOrigin && !validateOrigin(req, res)) return;

    const server = options.createServer();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
