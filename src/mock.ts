/**
 * Generate plausible example payloads from JSON Schema fragments and OpenAPI
 * response definitions. Dependency-free and tolerant of malformed input.
 */

const MAX_DEPTH = 6;

/** Produce a plausible example value for a JSON Schema fragment. */
export function exampleFromSchema(schema: any, depth = 0): any {
  if (schema == null || typeof schema !== "object") return null;
  if (depth > MAX_DEPTH) return null;

  // Explicit examples win over everything else.
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    const first = schema.examples[0];
    return unwrapExample(first);
  }
  if (schema.examples && typeof schema.examples === "object") {
    const values = Object.values(schema.examples);
    if (values.length > 0) return unwrapExample(values[0]);
  }
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;

  // We cannot resolve references without the enclosing document.
  if (schema.$ref) return {};

  const combo = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(combo) && combo.length > 0) {
    const nonNull = combo.filter((s: any) => s && s.type !== "null");
    return exampleFromSchema(nonNull[0] ?? combo[0], depth + 1);
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    let merged: any = {};
    for (const part of schema.allOf) {
      const value = exampleFromSchema(part, depth + 1);
      if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(merged, value);
      else if (merged === undefined) merged = value;
    }
    if (schema.properties) Object.assign(merged, objectExample(schema, depth));
    return merged;
  }

  let type: string | undefined = schema.type;
  if (Array.isArray(type)) type = type.find((t: string) => t !== "null") ?? type[0];
  if (!type) {
    if (schema.properties) type = "object";
    else if (schema.items) type = "array";
  }

  switch (type) {
    case "string":
      return stringExample(schema);
    case "number":
      return 0;
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "array": {
      if (depth >= MAX_DEPTH) return [];
      const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
      if (!items) return [];
      return [exampleFromSchema(items, depth + 1)];
    }
    case "object":
      return objectExample(schema, depth);
    default:
      return null;
  }
}

/**
 * Return an example response body for an OpenAPI operation. Prefers an explicit
 * media-type/`examples` value, then falls back to generating one from the
 * response schema. Returns `undefined` when no usable response exists.
 */
export function mockResponse(spec: any, path: string, method: string, status?: number): any | undefined {
  const operation = spec?.paths?.[path]?.[method?.toLowerCase()];
  if (!operation) return undefined;

  const responses = operation.responses;
  if (!responses || typeof responses !== "object") return undefined;

  const response = selectResponse(responses, status);
  if (!response) return undefined;

  const content = response.content;
  if (!content || typeof content !== "object") return undefined;

  const media = selectJsonMedia(content);
  if (!media) return undefined;

  if (media.example !== undefined) return media.example;
  if (media.examples && typeof media.examples === "object") {
    const values = Object.values(media.examples);
    if (values.length > 0) return unwrapExample(values[0]);
  }
  if (media.schema !== undefined) return exampleFromSchema(media.schema);
  return undefined;
}

function selectResponse(responses: Record<string, any>, status?: number): any | undefined {
  if (status !== undefined) {
    const exact = responses[String(status)];
    if (exact) return exact;
  }
  for (const code of ["200", "201", "202", "204", "default"]) {
    if (responses[code]) return responses[code];
  }
  const keys = Object.keys(responses);
  return keys.length > 0 ? responses[keys[0]] : undefined;
}

function selectJsonMedia(content: Record<string, any>): any | undefined {
  if (content["application/json"]) return content["application/json"];
  for (const key of Object.keys(content)) {
    if (key.toLowerCase().includes("json")) return content[key];
  }
  return undefined;
}

function objectExample(schema: any, depth: number): Record<string, any> {
  const out: Record<string, any> = {};
  if (depth >= MAX_DEPTH) return out;
  for (const [key, value] of Object.entries<any>(schema.properties ?? {})) {
    out[key] = exampleFromSchema(value, depth + 1);
  }
  return out;
}

function stringExample(schema: any): string {
  switch (schema.format) {
    case "date-time":
      return "2020-01-01T00:00:00Z";
    case "date":
      return "2020-01-01";
    case "time":
      return "00:00:00Z";
    case "email":
    case "idn-email":
      return "user@example.com";
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    case "uri":
    case "url":
      return "https://example.com";
    case "hostname":
      return "example.com";
    case "ipv4":
      return "127.0.0.1";
    case "ipv6":
      return "::1";
    case "byte":
      return "c3RyaW5n";
    default:
      return "string";
  }
}

function unwrapExample(example: any): any {
  if (example && typeof example === "object" && !Array.isArray(example) && "value" in example) {
    return (example as { value: any }).value;
  }
  return example;
}
