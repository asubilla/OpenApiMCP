import type { ToolDef } from "./types.js";

export interface DryRunResult {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface DryRunOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  maskSecrets?: boolean;
}

const SENSITIVE_HEADER = /authorization|x-api-key|api[-_]?key|token|secret/i;

/** Return "***" when the header name looks sensitive, otherwise the original value. */
export function redactHeaderValue(name: string, value: string): string {
  return SENSITIVE_HEADER.test(name) ? "***" : value;
}

/** Build the HTTP request a tool call would produce, without sending it. */
export function buildDryRun(tool: ToolDef, args: Record<string, unknown>, opts?: DryRunOptions): DryRunResult {
  const base = (opts?.baseUrl || tool.baseUrl || "").replace(/\/+$/, "");
  const method = tool.method.toUpperCase();

  let path = tool.path;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(tool.security.query)) query.append(key, value);

  const headers: Record<string, string> = {
    accept: "application/json",
    ...tool.security.headers,
    ...(opts?.headers ?? {})
  };

  const body: Record<string, unknown> = {};
  let bodyValue: unknown;
  let hasBody = false;

  for (const param of tool.params) {
    const value = args[param.argName];
    if (value === undefined || value === null) continue;

    if (param.location === "path") {
      path = path.replace(`{${param.origName}}`, encodeURIComponent(String(value)));
    } else if (param.location === "query") {
      if (Array.isArray(value)) for (const item of value) query.append(param.origName!, String(item));
      else query.append(param.origName!, String(value));
    } else {
      hasBody = true;
      if (tool.bodyObject) body[param.origName!] = value;
      else bodyValue = value;
    }
  }

  // Whole-body fallback: no explicit body-location param, but a `body` arg was passed.
  if (!tool.bodyObject && !hasBody && args.body !== undefined && args.body !== null) {
    hasBody = true;
    bodyValue = args.body;
  }

  const qs = query.toString();
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;

  if (hasBody) headers["content-type"] = headers["content-type"] ?? "application/json";
  const payload = hasBody ? JSON.stringify(tool.bodyObject ? body : bodyValue) : undefined;

  const maskSecrets = opts?.maskSecrets ?? true;
  const finalHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    finalHeaders[name] = maskSecrets ? redactHeaderValue(name, value) : value;
  }

  const result: DryRunResult = { method, url, headers: finalHeaders };
  if (payload !== undefined) result.body = payload;
  return result;
}

/** Render a dry-run result as a human-readable multi-line block. */
export function formatDryRun(result: DryRunResult): string {
  const lines = [`METHOD ${result.method}`, `URL ${result.url}`, "Headers:"];
  for (const [name, value] of Object.entries(result.headers)) {
    lines.push(`  ${name}: ${value}`);
  }
  if (result.body !== undefined) {
    lines.push("Body:", result.body);
  }
  return lines.join("\n");
}
