import type { Param, ParsedApi, ToolAnnotations, ToolDef } from "./types.js";
import { resolveToolSecurity, schemeAuth, type Env } from "./auth.js";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export interface ParseOptions {
  env?: Env;
}

/** Load and `$ref`-dereference an OpenAPI 3.x or Swagger 2.0 document. */
export async function loadDocument(specPath: string): Promise<any> {
  const mod: any = await import("@apidevtools/swagger-parser");
  const SwaggerParser = mod.default ?? mod;
  return SwaggerParser.dereference(specPath);
}

/** Turn an already-dereferenced document into tool definitions. */
export function parseDocument(api: any, options: ParseOptions = {}): ParsedApi {
  const env = options.env ?? process.env;

  const info = api.info ?? {};
  const baseUrls = collectBaseUrls(api);
  const securitySchemes: Record<string, any> = api.components?.securitySchemes ?? api.securityDefinitions ?? {};
  const rootSecurity = api.security;

  const tools: ToolDef[] = [];
  const usedNames = new Set<string>();

  for (const [path, item] of Object.entries<any>(api.paths ?? {})) {
    const pathItem = item ?? {};
    const commonParams: any[] = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      const tool = buildTool(path, method, op, commonParams, securitySchemes, rootSecurity, env, baseUrls[0]);
      let name = tool.name;
      let n = 2;
      while (usedNames.has(name)) name = `${tool.name}_${n++}`;
      usedNames.add(name);
      tool.name = name;
      tools.push(tool);
    }
  }

  const schemesWithCreds: string[] = [];
  const schemesWithoutCreds: string[] = [];
  for (const [name, scheme] of Object.entries(securitySchemes)) {
    (schemeAuth(name, scheme, env) ? schemesWithCreds : schemesWithoutCreds).push(name);
  }

  return {
    title: info.title ?? "API",
    version: info.version ?? "0.0.0",
    baseUrls,
    tools,
    securitySchemes,
    schemesWithCreds,
    schemesWithoutCreds,
  };
}

/** Load a spec and parse it in one step. */
export async function parseSpec(specPath: string, options: ParseOptions = {}): Promise<ParsedApi> {
  return parseDocument(await loadDocument(specPath), options);
}

function collectBaseUrls(api: any): string[] {
  const urls = new Set<string>();
  if (Array.isArray(api.servers)) {
    for (const server of api.servers) if (server?.url) urls.add(String(server.url));
  }
  if (api.host) {
    const scheme = (Array.isArray(api.schemes) && api.schemes[0]) || "https";
    urls.add(`${scheme}://${api.host}${api.basePath ?? ""}`);
  }
  if (urls.size === 0) urls.add("");
  return [...urls];
}

function buildTool(
  path: string,
  method: string,
  op: any,
  commonParams: any[],
  schemes: Record<string, any>,
  rootSecurity: any,
  env: Env,
  baseUrl: string
): ToolDef {
  const name = sanitizeName(op.operationId || `${method}_${path}`);
  const description = String(op.summary || op.description || `${method.toUpperCase()} ${path}`).trim();

  const merged = new Map<string, any>();
  for (const param of [...commonParams, ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
    if (!param || !param.name) continue;
    if (param.in === "header" || param.in === "cookie" || param.in === "body") continue;
    merged.set(`${param.in}:${param.name}`, param);
  }

  const params: Param[] = [];
  const used = new Set<string>();

  for (const param of merged.values()) {
    const location = param.in === "path" ? "path" : "query";
    params.push({
      argName: param.name,
      location,
      origName: param.name,
      required: location === "path" ? true : Boolean(param.required),
      schema: param.schema ?? swagger2ParamSchema(param),
      description: param.description,
    });
    used.add(param.name);
  }

  let bodyObject = false;
  const bodySchema =
    op.requestBody?.content?.["application/json"]?.schema ??
    op.requestBody?.content?.["application/*+json"]?.schema ??
    swagger2BodySchema(op, commonParams);

  if (bodySchema) {
    if (bodySchema.type === "object" || bodySchema.properties) {
      bodyObject = true;
      const required = new Set<string>(Array.isArray(bodySchema.required) ? bodySchema.required : []);
      for (const [key, propSchema] of Object.entries<any>(bodySchema.properties ?? {})) {
        let argName = key;
        while (used.has(argName)) argName = `${argName}_body`;
        used.add(argName);
        params.push({
          argName,
          location: "body",
          origName: key,
          required: required.has(key),
          schema: propSchema,
          description: propSchema?.description,
        });
      }
    } else {
      let argName = "body";
      while (used.has(argName)) argName = `${argName}_arg`;
      used.add(argName);
      params.push({
        argName,
        location: "body",
        origName: null,
        required: true,
        schema: bodySchema,
        description: bodySchema.description,
      });
    }
  }

  return {
    name,
    description,
    method,
    path,
    params,
    bodyObject,
    tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
    annotations: annotationsFor(method, op),
    security: resolveToolSecurity(schemes, op.security ?? rootSecurity, env),
    baseUrl,
  };
}

function annotationsFor(method: string, op: any): ToolAnnotations {
  const m = method.toLowerCase();
  const readOnly = m === "get" || m === "head" || m === "options";
  return {
    title: typeof op.summary === "string" ? op.summary : undefined,
    readOnlyHint: readOnly,
    destructiveHint: m === "delete",
    idempotentHint: readOnly || m === "put" || m === "delete",
    openWorldHint: true,
  };
}

/** Swagger 2.0 keeps parameter type info directly on the parameter object. */
function swagger2ParamSchema(param: any): any {
  const keys = ["type", "format", "items", "enum", "default", "minimum", "maximum", "minLength", "maxLength", "pattern"];
  const out: any = {};
  for (const key of keys) if (param[key] !== undefined) out[key] = param[key];
  return out;
}

function swagger2BodySchema(op: any, commonParams: any[]): any {
  const all = [...(op.parameters ?? []), ...commonParams];
  const body = all.find((p) => p && p.in === "body");
  return body?.schema;
}

function sanitizeName(value: string): string {
  let name = String(value)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) name = "tool";
  if (name.length > 64) name = name.slice(0, 64);
  return name;
}
