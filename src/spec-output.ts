/**
 * Helpers for wiring OpenAPI response schemas into MCP structured output.
 *
 * Dependency-free and conservative, mirroring `output.ts`: anything that
 * still needs reference resolution (a `$ref`) collapses to `undefined` once
 * it goes through `toOutputSchema`.
 */

import { toOutputSchema } from "./output.js";

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** True for concrete 2xx status keys like "200", "204", "299". */
function is2xxKey(key: string): boolean {
  return /^2\d\d$/.test(key);
}

/** True for media-type keys that carry JSON (JSON substring, or any `+json` suffix). */
function isJsonMediaType(key: string): boolean {
  const raw = key.toLowerCase();
  // Substring match on the media type key covers "application/json" and
  // parameters such as "application/json; charset=utf-8".
  if (raw.includes("application/json")) return true;
  // Strip parameters, then match "application/problem+json" / "*/*+json".
  const base = raw.split(";")[0].trim();
  return base.endsWith("+json");
}

/**
 * Pick the response object for an operation.
 *
 * Preference order: `"200"`, then `"201"`, then `"default"`, then any other
 * 2xx key (ascending numeric order). The first key present in `op.responses`
 * wins. Pass `defaultViaDefault: false` to exclude the `"default"` response
 * from consideration (it is included by default).
 */
function pickResponse(op: any, defaultViaDefault?: boolean): any | undefined {
  if (!op || typeof op !== "object") return undefined;
  const responses = op.responses;
  if (!responses || typeof responses !== "object" || Array.isArray(responses)) return undefined;

  const keys = Object.keys(responses);
  const preferred = defaultViaDefault === false
    ? ["200", "201"]
    : ["200", "201", "default"];

  for (const key of preferred) {
    if (keys.includes(key)) return responses[key];
  }

  const other2xx = keys.filter((key) => is2xxKey(key) && key !== "200" && key !== "201").sort();
  if (other2xx.length > 0) return responses[other2xx[0]];

  return undefined;
}

/**
 * Find the first JSON media type within an OpenAPI `content` object and
 * return its `schema`. Matches `application/json` prefixes (substring match on the
 * media type key) as well as `application/problem+json` and any `+json` suffix. Keys
 * are examined in document order; the first match wins. Returns `undefined`
 * when nothing matches (or the matched entry carries no `schema`).
 */
function jsonSchemaFromContent(content: any): any | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;
  for (const [mediaType, mediaObj] of Object.entries<any>(content)) {
    if (!isJsonMediaType(mediaType)) continue;
    if (!mediaObj || typeof mediaObj !== "object") return undefined;
    return mediaObj.schema;
  }
  return undefined;
}

/**
 * Return the raw JSON Schema of the operation's preferred JSON response, or
 * `undefined` when the operation has no usable 200/201/default/other-2xx
 * response or that response has no JSON content. The returned schema may
 * still contain `$ref` — use `toolOutputSchema` to get an MCP-safe shape.
 */
export function responseSchemaForOperation(op: any, defaultViaDefault?: boolean): any | undefined {
  const response = pickResponse(op, defaultViaDefault);
  if (!response || typeof response !== "object") return undefined;
  return jsonSchemaFromContent(response.content);
}

/**
 * Like `responseSchemaForOperation`, but collapses the schema into an
 * MCP-compatible `outputSchema` via `toOutputSchema`. Returns `undefined`
 * when there is no JSON response or the schema is not an object shape /
 * still contains a `$ref`.
 */
export function toolOutputSchema(op: any): any | undefined {
  return toOutputSchema(responseSchemaForOperation(op));
}

/**
 * Walk `doc.paths` and build a flat map of `"<method> <path>"` (method
 * lowercased) to the operation's MCP output schema. Operations whose output
 * schema is unavailable map to `undefined`. Non-operation keys inside path
 * items (`parameters`, `summary`, ...) are ignored.
 */
export function collectResponseSchemas(doc: any): Record<string, any | undefined> {
  const map: Record<string, any | undefined> = {};
  if (!doc || typeof doc !== "object") return map;
  const paths = doc.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return map;

  for (const [path, pathItem] of Object.entries<any>(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const [rawMethod, op] of Object.entries<any>(pathItem)) {
      const method = rawMethod.toLowerCase();
      if (!HTTP_METHODS.has(method)) continue;
      if (!op || typeof op !== "object" || Array.isArray(op)) continue;
      map[`${method} ${path}`] = toolOutputSchema(op);
    }
  }
  return map;
}

/**
 * Render one line per operation: `"<method> <path>: schema ✓"` when an
 * output schema was collected, `"<method> <path>: schema —"` otherwise.
 */
export function formatOutputSchemaSummary(map: Record<string, any | undefined>): string {
  return Object.entries(map)
    .map(([key, schema]) => `${key}: schema ${schema ? "✓" : "—"}`)
    .join("\n");
}
