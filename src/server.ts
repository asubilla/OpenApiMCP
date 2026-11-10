import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { jsonSchemaToZod } from "./schema.js";
import { callApi, type RequestOptions } from "./http.js";
import { TOOL_CALL_NAME, TOOL_SEARCH_NAME, rankTools } from "./toolsearch.js";
import type { ParsedApi } from "./types.js";

export interface BuildServerOptions extends RequestOptions {
  serverName?: string;
  version?: string;
  /** Expose only `search_tools` + `call_tool` for very large APIs (progressive disclosure). */
  toolSearch?: boolean;
}

/** Build an MCP server that exposes one tool per OpenAPI operation. */
export function buildServer(api: ParsedApi, opts: BuildServerOptions): McpServer {
  const server = new McpServer({ name: opts.serverName || "openapimcp", version: opts.version || "1.1.0" });

  if (opts.toolSearch) {
    server.registerTool(
      TOOL_SEARCH_NAME,
      {
        description:
          "Search this API's operations by keyword. Returns matching operation names with their method, path and description. Use this first, then call the operation with `call_tool`.",
        inputSchema: z.object({ query: z.string().describe("What you want to do, e.g. 'list pets by status'") })
      },
      async ({ query }) => {
        const matches = rankTools(api.tools, query, 20);
        const text =
          matches.map((t) => `${t.name} (${t.method.toUpperCase()} ${t.path}) - ${t.description}`).join("\n") ||
          "No matching operations.";
        return { content: [{ type: "text" as const, text }] };
      }
    );

    server.registerTool(
      TOOL_CALL_NAME,
      {
        description: "Call an API operation by name with JSON arguments. Get operation names from `search_tools`.",
        inputSchema: z.object({
          name: z.string().describe("Operation name from search_tools"),
          arguments: z.record(z.string(), z.unknown()).optional().describe("Arguments object for the operation")
        })
      },
      async ({ name, arguments: args }) => {
        const tool = api.tools.find((t) => t.name === name);
        if (!tool) {
          return {
            content: [{ type: "text" as const, text: `Unknown operation "${name}". Use ${TOOL_SEARCH_NAME} first.` }],
            isError: true
          };
        }
        try {
          const result = await callApi(tool, (args as Record<string, any>) ?? {}, opts);
          return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text" as const, text: `Request failed: ${message}` }], isError: true };
        }
      }
    );

    return server;
  }

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
