export type ParamLocation = "path" | "query" | "body";

export interface Param {
  /** Name the agent uses as the tool argument. */
  argName: string;
  /** Where the value belongs in the outgoing HTTP request. */
  location: ParamLocation;
  /** Original name in the spec (path/query key or body property). */
  origName: string | null;
  required: boolean;
  /** JSON Schema describing this value. */
  schema: any;
  description?: string;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolSecurity {
  headers: Record<string, string>;
  query: Record<string, string>;
}

export interface ToolDef {
  name: string;
  description: string;
  method: string;
  path: string;
  params: Param[];
  /** True when the JSON request body was expanded into one arg per property. */
  bodyObject: boolean;
  tags: string[];
  annotations: ToolAnnotations;
  /** Static auth derived from the spec's security schemes. */
  security: ToolSecurity;
  /** Base URL of the API this tool belongs to (used for multi-spec servers). */
  baseUrl?: string;
}

export interface ParsedApi {
  title: string;
  version: string;
  baseUrls: string[];
  tools: ToolDef[];
  securitySchemes: Record<string, any>;
  /** Security scheme names that have credentials available in the environment. */
  schemesWithCreds: string[];
  /** Security scheme names that are declared but have no credentials set. */
  schemesWithoutCreds: string[];
}
