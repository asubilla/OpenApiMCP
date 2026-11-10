/**
 * Helpers for wiring OpenAPI response schemas into MCP structured output.
 *
 * These are intentionally dependency-free and conservative: they only emit the
 * keyword subset that MCP clients reliably understand, and they refuse to emit
 * anything that still needs reference resolution.
 */

/** True when a schema resolves to an object shape (typed object or properties). */
function resolvesToObject(schema: any): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  if ("$ref" in schema) return false;
  if (schema.type === "object") return true;
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) return true;
  return false;
}

/**
 * Recursively copy a schema, keeping only supported keywords. Returns
 * `undefined` as soon as a `$ref` is encountered, which signals the caller that
 * the schema is unusable.
 */
function convert(schema: any): any | undefined {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return {};
  if ("$ref" in schema) return undefined;

  const out: Record<string, any> = {};

  if (typeof schema.type === "string" || Array.isArray(schema.type)) out.type = schema.type;
  if (Array.isArray(schema.enum)) out.enum = [...schema.enum];
  if (typeof schema.description === "string") out.description = schema.description;
  if (schema.additionalProperties === false) out.additionalProperties = false;
  if (Array.isArray(schema.required)) out.required = schema.required.filter((item: unknown) => typeof item === "string");

  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    const properties: Record<string, any> = {};
    for (const [key, value] of Object.entries<any>(schema.properties)) {
      const child = convert(value);
      if (child === undefined) return undefined;
      properties[key] = child;
    }
    out.properties = properties;
  }

  if (schema.items !== undefined) {
    const raw = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    const child = convert(raw);
    if (child === undefined) return undefined;
    out.items = child;
  }

  return out;
}

/**
 * Convert a response JSON Schema into a schema suitable for an MCP tool's
 * `outputSchema`. Returns `undefined` unless the schema resolves to an object
 * type; strips unsupported keywords (including any `x-*` extensions) and
 * refuses schemas that still contain a `$ref`.
 */
export function toOutputSchema(jsonSchema: any): any | undefined {
  if (!resolvesToObject(jsonSchema)) return undefined;
  return convert(jsonSchema);
}

/**
 * Wrap a value for MCP structured output. Only non-null objects (and arrays,
 * which are objects in JavaScript) are valid; primitives and `null` yield
 * `undefined`.
 */
export function structuredContent(value: any): { structuredContent: any } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return { structuredContent: value };
}
