import type { ToolDef, ToolAnnotations } from "./types.js";

export interface DeprecationInfo {
  operationId?: string;
  deprecatedAt?: string;
  sunset?: string;
  message?: string;
  replacement?: string;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;

/** Coerce a spec value to a non-empty trimmed string, else undefined. */
function str(value: any): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Same name sanitization the tool builder applies to operationIds. */
function sanitizeToolName(value: string): string {
  let name = String(value)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) name = "tool";
  if (name.length > 64) name = name.slice(0, 64);
  return name;
}

interface OperationRef {
  method: string;
  path: string;
  op: any;
}

function* iterOperations(spec: any): Generator<OperationRef> {
  const paths = spec?.paths;
  if (!paths || typeof paths !== "object") return;
  for (const [path, item] of Object.entries<any>(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (op && typeof op === "object") yield { method, path, op };
    }
  }
}

/**
 * Find the spec operation backing a tool. Matches on operationId (raw or the
 * sanitized form used for tool names); falls back to method + path when no
 * operationId match is found.
 */
function findOperation(tool: ToolDef, spec: any): any | undefined {
  if (!spec || typeof spec !== "object") return undefined;
  const toolOperationId = str((tool as any)?.operationId);
  let methodPathMatch: any | undefined;
  for (const { method, path, op } of iterOperations(spec)) {
    const opId = str(op?.operationId);
    if (toolOperationId && opId && toolOperationId === opId) return op;
    if (opId && (opId === tool.name || sanitizeToolName(opId) === tool.name)) return op;
    if (!opId && sanitizeToolName(`${method}_${path}`) === tool.name) return op;
    if (
      methodPathMatch === undefined &&
      typeof tool.method === "string" &&
      tool.method.toLowerCase() === method &&
      tool.path === path
    ) {
      methodPathMatch = op;
    }
  }
  return methodPathMatch;
}

/** True when the tool itself carries deprecation markers (no spec needed). */
function isToolMarkedDeprecated(tool: ToolDef): boolean {
  if (!tool) return false;
  if ((tool as any).deprecated === true) return true;
  const annotations: any = tool.annotations ?? {};
  const titlePrefix = str(annotations.titlePrefix);
  if (titlePrefix && titlePrefix.startsWith("[DEPRECATED]")) return true;
  const title = str(annotations.title);
  if (title && title.startsWith("[DEPRECATED]")) return true;
  if (typeof tool.description === "string" && tool.description.trimEnd().endsWith("(deprecated)")) {
    return true;
  }
  return false;
}

/** Is the given spec operation marked as deprecated (or past its sunset/expires date)? */
export function isDeprecated(op: any): boolean {
  if (!op || typeof op !== "object") return false;
  if (op.deprecated === true) return true;
  if (op["x-deprecated"] === true) return true;
  return Boolean(
    str(op.sunset) ?? str(op.expires) ?? str(op["x-sunset"]) ?? str(op["x-expires"])
  );
}

/** Pull whatever deprecation metadata the operation carries. */
export function extractDeprecation(op: any): DeprecationInfo {
  const o = op && typeof op === "object" ? op : {};
  const info: DeprecationInfo = {};

  const operationId = str(o.operationId);
  if (operationId) info.operationId = operationId;

  const xDeprecated = o["x-deprecated"];
  const deprecatedAt =
    str(o["x-deprecated-at"]) ??
    str(o["x-deprecatedAt"]) ??
    (typeof xDeprecated === "string" ? str(xDeprecated) : undefined) ??
    (typeof o.deprecated === "string" ? str(o.deprecated) : undefined) ??
    (o.deprecated === true ? str(o["x-deprecated-since"]) : undefined);
  if (deprecatedAt) info.deprecatedAt = deprecatedAt;

  const sunset = str(o.sunset) ?? str(o.expires) ?? str(o["x-sunset"]) ?? str(o["x-expires"]);
  if (sunset) info.sunset = sunset;

  const message =
    str(o["x-message"]) ??
    str(o["x-deprecation-message"]) ??
    str(o["x-deprecationMessage"]) ??
    str(o["x-sunset-message"]);
  if (message) info.message = message;

  const replacement =
    str(o["x-replacement"]) ??
    str(o["x-replacement-operation-id"]) ??
    str(o["x-replacementOperationId"]) ??
    str(o["x-replaced-by"]);
  if (replacement) info.replacement = replacement;

  return info;
}

/** Short human-readable reason for the warning line. */
function deprecationReason(op: any): string {
  const info = extractDeprecation(op);
  if (info.sunset) return `sunset: ${info.sunset}`;
  return "deprecated";
}

/** True when the tool (or its backing spec operation) is deprecated. */
function isToolDeprecated(tool: ToolDef, spec?: any): boolean {
  const op = findOperation(tool, spec);
  if (op) return isDeprecated(op);
  return isToolMarkedDeprecated(tool);
}

/**
 * For every tool whose underlying spec operation is deprecated, return a
 * { tool, reason } entry. When no spec is provided (or the operation can't be
 * found), tools carrying their own deprecation markers are reported instead.
 */
export function warnInactive(
  tools: ToolDef[],
  spec?: any
): { tool: string; reason: string }[] {
  const out: { tool: string; reason: string }[] = [];
  for (const tool of tools ?? []) {
    if (!tool) continue;
    const op = findOperation(tool, spec);
    if (op) {
      if (isDeprecated(op)) out.push({ tool: tool.name, reason: deprecationReason(op) });
    } else if (isToolMarkedDeprecated(tool)) {
      out.push({ tool: tool.name, reason: "deprecated" });
    }
  }
  return out;
}

/**
 * Return a new tools array where deprecated tools carry
 * annotations.titlePrefix "[DEPRECATED] " and a " (deprecated)" suffix on their
 * description. Non-deprecated tools pass through unchanged.
 */
export function annotateTools(tools: ToolDef[], spec?: any): ToolDef[] {
  return (tools ?? []).map((tool) => {
    if (!tool || !isToolDeprecated(tool, spec)) return tool;
    const annotations = {
      ...(tool.annotations ?? {}),
      titlePrefix: "[DEPRECATED] ",
    } as ToolAnnotations;
    const base = typeof tool.description === "string" ? tool.description.trimEnd() : "";
    const description = base.endsWith("(deprecated)")
      ? base
      : base
        ? `${base} (deprecated)`
        : "(deprecated)";
    return { ...tool, description, annotations };
  });
}

/** Return a new tools array with deprecated tools removed. */
export function filterDeprecated(tools: ToolDef[], spec?: any): ToolDef[] {
  return (tools ?? []).filter((tool) => tool && !isToolDeprecated(tool, spec));
}

/** One line per warning, or a friendly note when there is nothing to report. */
export function formatDeprecationWarnings(
  list: { tool: string; reason: string }[]
): string {
  if (!list || list.length === 0) return "No deprecated operations.";
  return list.map((entry) => `${entry.tool}: ${entry.reason}`).join("\n");
}
