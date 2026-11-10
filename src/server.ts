import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { jsonSchemaToZod } from "./schema.js";
import { callApi, type RequestOptions } from "./http.js";
import type { ParsedApi } from "./types.js";

export interface BuildServerOptions extends RequestOptions {
  serverName?: string;
  version?: string;
}

/** Build an MCP server that exposes one tool per OpenAPI operation. */
export function buildServer(api: ParsedApi, opts: BuildServerOptions): McpServer {
  const server = new McpServer({ name: opts.serverName || "openapimcp", version: opts.version || "0.2.0" });

  for (const tool of api.tools) {
    const shape: Record<string, z.ZodType> = {};
    for (const param of tool.params) {
      let schema: z.ZodType = jsonSchemaToZod(param.schema);
      if (param.description && !(param.schema && param.schema.description)) schema = schema.describe(param.description);
      if (!param.required) schema = schema.optional();
      shape[param.argName] = schema;
    }
    const inputSchema = z.object(shape);

    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema, annotations: tool.annotations },
      async (args: Record<string, unknown>) => {
        try {
          const result = await callApi(tool, args, opts);
          return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text" as const, text: `Request failed: ${message}` }], isError: true };
        }
      }
    );
  }

  return server;
}
