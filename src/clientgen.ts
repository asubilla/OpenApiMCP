/**
 * Generate a small, dependency-free, typed TypeScript client from a raw
 * OpenAPI document. The result is a map of file name -> file contents:
 *
 *   - `types.ts`  request-parameter interfaces derived from JSON Schema
 *   - `client.ts` a class with one async method per operation
 *
 * Everything is deterministic: the same spec always yields the same files.
 */

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

type ParamLocation = "path" | "query" | "body";

interface ClientParam {
  /** Valid TypeScript identifier used as the argument/member name. */
  argName: string;
  location: ParamLocation;
  /** Original spec name (path/query key or body property). */
  origName: string | null;
  required: boolean;
  schema: any;
}

interface ClientOperation {
  method: string;
  path: string;
  operationId: string;
  methodName: string;
  /** True when the request body was expanded into one argument per property. */
  bodyObject: boolean;
  params: ClientParam[];
}

/** Build the generated files for `spec`. */
export function generateClient(spec: any, opts: { name?: string } = {}): Record<string, string> {
  const info = spec?.info ?? {};
  const className = pascal(sanitizeMethodName(opts.name ?? info.title ?? "ApiClient"));
  const baseUrl = normalizeBaseUrl(firstServerUrl(spec));
  const ops = collectOperations(spec);

  return {
    "types.ts": renderTypes(ops),
    "client.ts": renderClient(className, baseUrl, ops),
  };
}

/**
 * Turn an arbitrary operation id into a valid camelCase method name.
 * `get-user` -> `getUser`, `Get Pet By Id` -> `getPetById`, `GET_USERS` -> `getUsers`.
 */
export function sanitizeMethodName(operationId: string): string {
  const cleaned = String(operationId ?? "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  if (!cleaned) return "operation";

  const parts = cleaned.split(/\s+/).filter(Boolean);
  const mapped = parts.map((part, index) => {
    let piece = part;
    // Collapse fully-uppercase fragments (e.g. acronyms / snake case).
    if (/^[A-Z0-9]+$/.test(piece)) piece = piece.toLowerCase();
    if (index === 0) return piece.charAt(0).toLowerCase() + piece.slice(1);
    return piece.charAt(0).toUpperCase() + piece.slice(1);
  });

  let name = mapped.join("").replace(/[^a-zA-Z0-9]/g, "");
  if (!name) return "operation";
  if (/^[0-9]/.test(name)) name = `op${name}`;
  return name;
}

function collectOperations(spec: any): ClientOperation[] {
  const out: ClientOperation[] = [];
  const used = new Set<string>();
  const paths: Record<string, any> = spec?.paths ?? {};

  for (const [path, item] of Object.entries(paths)) {
    const pathItem = item ?? {};
    const common: any[] = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;

      const operationId = String(op.operationId || `${method}_${path}`);
      const base = sanitizeMethodName(operationId);
      let methodName = base;
      let n = 2;
      while (used.has(methodName)) methodName = `${base}${n++}`;
      used.add(methodName);

      const params: ClientParam[] = [];
      const seen = new Set<string>();

      const rawParams = [...common, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      for (const param of rawParams) {
        if (!param || !param.name) continue;
        if (param.in === "header" || param.in === "cookie") continue;
        const location: ParamLocation = param.in === "path" ? "path" : "query";
        const argName = sanitizeMethodName(String(param.name));
        if (seen.has(argName)) continue;
        seen.add(argName);
        params.push({
          argName,
          location,
          origName: String(param.name),
          required: location === "path" ? true : Boolean(param.required),
          schema: param.schema ?? swagger2ParamSchema(param),
        });
      }

      let bodyObject = false;
      const bodySchema = extractBodySchema(op, common);
      if (bodySchema) {
        if (bodySchema.type === "object" || bodySchema.properties) {
          bodyObject = true;
          const required = new Set<string>(Array.isArray(bodySchema.required) ? bodySchema.required : []);
          for (const [key, propSchema] of Object.entries<any>(bodySchema.properties ?? {})) {
            const argName = sanitizeMethodName(key);
            if (seen.has(argName)) continue;
            seen.add(argName);
            params.push({
              argName,
              location: "body",
              origName: key,
              required: required.has(key),
              schema: propSchema,
            });
          }
        } else {
          params.push({ argName: "body", location: "body", origName: null, required: true, schema: bodySchema });
        }
      }

      out.push({ method, path, operationId, methodName, bodyObject, params });
    }
  }

  return out;
}

function renderTypes(ops: ClientOperation[]): string {
  const lines: string[] = [];
  lines.push("// Generated by openapimcp. Do not edit by hand.");
  lines.push("");

  for (const op of ops) {
    lines.push(`/** Request parameters for ${op.method.toUpperCase()} ${op.path}. */`);
    lines.push(`export interface ${pascal(op.methodName)}Params {`);
    for (const p of op.params) {
      lines.push(`  ${p.argName}${p.required ? "" : "?"}: ${tsType(p.schema)};`);
    }
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

function renderClient(className: string, baseUrl: string, ops: ClientOperation[]): string {
  const lines: string[] = [];
  lines.push("// Generated by openapimcp. Do not edit by hand.");

  const interfaces = ops.map((op) => `${pascal(op.methodName)}Params`);
  if (interfaces.length > 0) {
    lines.push(`import type { ${interfaces.join(", ")} } from "./types.js";`);
  }
  lines.push("");
  lines.push("export interface ClientOptions {");
  lines.push("  baseUrl?: string;");
  lines.push("  fetch?: typeof fetch;");
  lines.push("  headers?: Record<string, string>;");
  lines.push("}");
  lines.push("");
  lines.push(`export class ${className} {`);
  lines.push("  private readonly baseUrl: string;");
  lines.push("  private readonly _fetch: typeof fetch;");
  lines.push("  private readonly headers: Record<string, string>;");
  lines.push("");
  lines.push("  constructor(options: ClientOptions = {}) {");
  lines.push(`    this.baseUrl = (options.baseUrl ?? ${JSON.stringify(baseUrl)}).replace(/\\/$/, "");`);
  lines.push("    this._fetch = options.fetch ?? fetch;");
  lines.push("    this.headers = { ...options.headers };");
  lines.push("  }");

  for (const op of ops) {
    const requestType = `${pascal(op.methodName)}Params`;
    const hasRequired = op.params.some((p) => p.required);
    const signature = hasRequired ? `params: ${requestType}` : `params: ${requestType} = {}`;
    const method = op.method.toUpperCase();

    lines.push("");
    lines.push(`  /** ${method} ${op.path} */`);
    lines.push(`  async ${op.methodName}(${signature}): Promise<unknown> {`);
    lines.push(`    const url = new URL(this.baseUrl + \`${renderPathTemplate(op.path, op.params)}\`);`);

    for (const p of op.params) {
      if (p.location !== "query") continue;
      const key = p.origName ?? p.argName;
      const access = `params.${p.argName}`;
      lines.push(
        `    if (${access} !== undefined) url.searchParams.set(${JSON.stringify(key)}, Array.isArray(${access}) ? ${access}.join(",") : String(${access}));`
      );
    }

    lines.push(`    const init: RequestInit = { method: ${JSON.stringify(method)}, headers: { ...this.headers } };`);

    const bodyParams = op.params.filter((p) => p.location === "body");
    if (bodyParams.length > 0) {
      if (op.bodyObject) {
        const fields = bodyParams.map((p) => `${p.argName}: params.${p.argName}`).join(", ");
        lines.push(`    init.body = JSON.stringify({ ${fields} });`);
        lines.push(`    init.headers = { ...this.headers, "content-type": "application/json" };`);
      } else {
        const p = bodyParams[0];
        lines.push(`    if (params.${p.argName} !== undefined) {`);
        lines.push(`      init.body = JSON.stringify(params.${p.argName});`);
        lines.push(`      init.headers = { ...this.headers, "content-type": "application/json" };`);
        lines.push("    }");
      }
    }

    lines.push("    const response = await this._fetch(url, init);");
    lines.push("    const text = await response.text();");
    lines.push("    if (!response.ok) {");
    lines.push(`      throw new Error(${JSON.stringify(`${method} ${op.path}`)} + " failed: " + response.status);`);
    lines.push("    }");
    lines.push("    return text.length > 0 ? JSON.parse(text) : undefined;");
    lines.push("  }");
  }

  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function renderPathTemplate(path: string, params: ClientParam[]): string {
  const byOrig = new Map<string, string>();
  for (const p of params) {
    if (p.location === "path" && p.origName) byOrig.set(p.origName, p.argName);
  }
  return path.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const arg = byOrig.get(key) ?? byOrig.get(match) ?? sanitizeMethodName(key);
    return "${encodeURIComponent(String(params." + arg + "))}";
  });
}

/** Loosely map a JSON Schema fragment onto a TypeScript type. */
function tsType(schema: any, seen: Set<any> = new Set()): string {
  if (!schema || typeof schema !== "object") return "unknown";

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((value: unknown) => tsLiteral(value)).join(" | ");
  }
  if (schema.const !== undefined) return tsLiteral(schema.const);

  const combo = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(combo)) {
    const parts = [...new Set(combo.map((part: any) => tsType(part, seen)))];
    return parts.length > 0 ? parts.join(" | ") : "unknown";
  }

  const rawType = Array.isArray(schema.type)
    ? schema.type.find((t: string) => t !== "null")
    : schema.type;

  switch (rawType) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "null":
      return "null";
    case "array": {
      const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
      return `Array<${items ? tsType(items, seen) : "unknown"}>`;
    }
    case "object":
      return objectType(schema, seen);
    default:
      if (schema.properties) return objectType(schema, seen);
      if (schema.items) {
        const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
        return `Array<${tsType(items, seen)}>`;
      }
      return "unknown";
  }
}

function objectType(schema: any, seen: Set<any>): string {
  if (seen.has(schema)) return "Record<string, unknown>";
  seen.add(schema);

  const properties: Record<string, any> = schema.properties ?? {};
  const entries = Object.entries(properties);
  if (entries.length === 0) return "Record<string, unknown>";

  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const members = entries.map(
    ([key, value]) => `${memberName(key)}${required.has(key) ? "" : "?"}: ${tsType(value, seen)}`
  );
  return `{ ${members.join("; ")} }`;
}

function tsLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return "unknown";
}

function memberName(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return key;
  return sanitizeMethodName(key);
}

function pascal(value: string): string {
  if (!value) return "Operation";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractBodySchema(op: any, common: any[]): any {
  const json =
    op.requestBody?.content?.["application/json"] ??
    op.requestBody?.content?.["application/*+json"];
  if (json?.schema) return json.schema;
  const all = [...(Array.isArray(op.parameters) ? op.parameters : []), ...common];
  const body = all.find((p) => p && p.in === "body");
  return body?.schema;
}

function swagger2ParamSchema(param: any): any {
  const keys = ["type", "format", "items", "enum", "default", "minimum", "maximum", "minLength", "maxLength", "pattern"];
  const out: any = {};
  for (const key of keys) if (param[key] !== undefined) out[key] = param[key];
  return out;
}

function firstServerUrl(spec: any): string {
  if (Array.isArray(spec?.servers) && spec.servers[0]?.url) return String(spec.servers[0].url);
  if (spec?.host) {
    const scheme = (Array.isArray(spec.schemes) && spec.schemes[0]) || "https";
    return `${scheme}://${spec.host}${spec.basePath ?? ""}`;
  }
  return "";
}

function normalizeBaseUrl(url: string): string {
  const value = String(url ?? "").trim().replace(/\{[^}]+\}/g, "localhost");
  if (!value) return "http://localhost";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return `http://localhost${value.startsWith("/") ? value : `/${value}`}`;
}
