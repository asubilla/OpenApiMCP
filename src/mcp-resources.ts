// MCP resource builders for OpenAPI specs.
// Dependency-free (node builtins only); turns a parsed OpenAPI-ish document
// into a list of MCP resources (full spec, per-operation, servers, security).

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  text?: string;
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

const JSON_MIME = "application/json";

function operationIdFor(method: string, path: string, op: any): string {
  const raw = op?.operationId != null ? String(op.operationId).trim() : "";
  if (raw) return raw;
  const slug = `${method}-${path}`
    .replace(/\{|\}/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || `${method}-operation`;
}

function uriSegment(id: string): string {
  // Keep typical operationIds as-is; encode anything URI-unsafe.
  return encodeURIComponent(id);
}

function operationDescription(method: string, path: string, op: any): string {
  const desc = op?.description ?? op?.summary;
  const base = `${method.toUpperCase()} ${path}`;
  return desc ? `${base} — ${String(desc)}` : base;
}

/**
 * Build MCP resources for an OpenAPI spec.
 *
 * URIs (with the default base "openapi"):
 *   openapi:spec            — the full spec, text = JSON.stringify(spec)
 *   openapi:op/<operationId>— one resource per path+method operation
 *   openapi:servers         — the servers list
 *   openapi:security        — the security schemes
 *
 * `baseUri` optionally overrides the "openapi" scheme prefix
 * (e.g. buildSpecResources(spec, "myapi") yields "myapi:spec").
 *
 * All resources carry JSON text and therefore use mimeType "application/json".
 */
export function buildSpecResources(spec: any, baseUri?: string): McpResource[] {
  const doc = spec ?? {};
  const base = baseUri && baseUri.trim() ? baseUri.trim() : "openapi";
  const resources: McpResource[] = [];

  const info = doc.info ?? {};
  const title = info.title != null ? String(info.title) : "";
  const version = info.version != null ? String(info.version) : "";
  const specDesc = `Full OpenAPI spec${title ? `: ${title}${version ? ` v${version}` : ""}` : ""}`;

  resources.push({
    uri: `${base}:spec`,
    name: "spec",
    description: specDesc,
    mimeType: JSON_MIME,
    text: JSON.stringify(doc),
  });

  for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
    const pathItem = item ?? {};
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      const id = operationIdFor(method, path, op);
      resources.push({
        uri: `${base}:op/${uriSegment(id)}`,
        name: id,
        description: operationDescription(method, path, op),
        mimeType: JSON_MIME,
        text: JSON.stringify({ method: method.toUpperCase(), path, ...op }),
      });
    }
  }

  const servers: any[] = Array.isArray(doc.servers) ? doc.servers : [];
  const serverUrls = servers
    .map((s: any) => (s && s.url != null ? String(s.url) : ""))
    .filter((u: string) => u.length > 0);
  resources.push({
    uri: `${base}:servers`,
    name: "servers",
    description: `API servers (${servers.length})${serverUrls.length ? `: ${serverUrls.join(", ")}` : ""}`,
    mimeType: JSON_MIME,
    text: JSON.stringify(servers),
  });

  const schemes: Record<string, any> =
    doc.components?.securitySchemes ?? doc.securityDefinitions ?? {};
  const schemeNames = Object.keys(schemes);
  resources.push({
    uri: `${base}:security`,
    name: "security",
    description: `Security schemes (${schemeNames.length})${schemeNames.length ? `: ${schemeNames.join(", ")}` : ""}`,
    mimeType: JSON_MIME,
    text: JSON.stringify(schemes),
  });

  return resources;
}

/** Project resources down to their public name/uri pairs. */
export function listResourceUris(resources: McpResource[]): { name: string; uri: string }[] {
  return (resources ?? []).map((r) => ({ name: r.name, uri: r.uri }));
}

type ResourceCategory = "spec" | "operations" | "servers" | "security" | "other";

function categoryOf(uri: string): ResourceCategory {
  const idx = uri.indexOf(":");
  const tail = idx >= 0 ? uri.slice(idx + 1) : uri;
  if (tail === "spec") return "spec";
  if (tail === "servers") return "servers";
  if (tail === "security") return "security";
  if (tail.startsWith("op/")) return "operations";
  return "other";
}

/** Grouped counts of resources, e.g. "operations: 2". */
export function formatResourcesSummary(resources: McpResource[]): string {
  const counts: Record<ResourceCategory, number> = {
    spec: 0,
    operations: 0,
    servers: 0,
    security: 0,
    other: 0,
  };
  for (const r of resources ?? []) {
    counts[categoryOf(r.uri)] += 1;
  }
  const total = (resources ?? []).length;
  const lines = [`Resources: ${total} total`];
  for (const key of ["spec", "operations", "servers", "security", "other"] as const) {
    if (counts[key] > 0) lines.push(`- ${key}: ${counts[key]}`);
  }
  return lines.join("\n");
}
