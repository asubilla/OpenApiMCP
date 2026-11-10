import * as z from "zod/v4";

/**
 * Convert a JSON Schema fragment (from an OpenAPI document) into a live Zod
 * schema. This is intentionally dependency-free and covers the shapes that
 * appear in real-world specs: primitives, enums, arrays, objects, nullable
 * type arrays, anyOf/oneOf and object allOf.
 */
export function jsonSchemaToZod(schema: any): z.ZodType {
  if (!schema || typeof schema !== "object") return z.unknown();

  // type: ["string", "null"] -> nullable
  if (Array.isArray(schema.type)) {
    const types: string[] = schema.type;
    const nullable = types.includes("null");
    const rest = types.filter((t) => t !== "null");
    let base: z.ZodType =
      rest.length === 0
        ? z.unknown()
        : rest.length === 1
          ? jsonSchemaToZod({ ...schema, type: rest[0] })
          : z.union(rest.map((t) => jsonSchemaToZod({ ...schema, type: t })) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    if (nullable) base = base.nullable();
    return decorate(base, schema);
  }

  if (Array.isArray(schema.enum)) {
    const values: unknown[] = schema.enum;
    if (values.length === 0) return z.unknown();
    const allStrings = values.every((v) => typeof v === "string");
    const base: z.ZodType = allStrings
      ? z.enum(values as [string, ...string[]])
      : z.union(values.map((v) => z.literal(v as any)) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    return decorate(base, schema);
  }

  if (schema.const !== undefined) return z.literal(schema.const);

  const combo = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(combo)) {
    const isNull = (x: any) => x && x.type === "null";
    const nonNull = combo.filter((x: any) => !isNull(x));
    const nullable = combo.some(isNull);
    let base: z.ZodType =
      nonNull.length === 0
        ? z.unknown()
        : nonNull.length === 1
          ? jsonSchemaToZod(nonNull[0])
          : z.union(nonNull.map((x: any) => jsonSchemaToZod(x)) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    if (nullable) base = base.nullable();
    return decorate(base, schema);
  }

  if (Array.isArray(schema.allOf)) {
    const allObjects = schema.allOf.every((x: any) => x && (x.type === "object" || x.properties));
    if (allObjects || schema.properties) {
      let shape: Record<string, z.ZodType> = {};
      const required: string[] = [];
      for (const part of schema.allOf) {
        for (const [key, value] of Object.entries<any>(part?.properties ?? {})) shape[key] = jsonSchemaToZod(value);
        if (Array.isArray(part?.required)) required.push(...part.required);
      }
      for (const [key, value] of Object.entries<any>(schema.properties ?? {})) shape[key] = jsonSchemaToZod(value);
      if (Array.isArray(schema.required)) required.push(...schema.required);
      shape = applyRequired(shape, required);
      return decorate(z.object(shape), schema);
    }
    const parts = schema.allOf.map((x: any) => jsonSchemaToZod(x)) as z.ZodType[];
    let base: z.ZodType = parts[0] ?? z.unknown();
    for (let i = 1; i < parts.length; i++) base = z.intersection(base as any, parts[i] as any) as any;
    return decorate(base, schema);
  }

  const type: string | undefined =
    schema.type ?? (schema.properties ? "object" : schema.items ? "array" : undefined);

  let base: z.ZodType;
  switch (type) {
    case "string":
      base = z.string();
      break;
    case "integer":
      base = z.number().int();
      break;
    case "number":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "null":
      base = z.null();
      break;
    case "array": {
      const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
      base = z.array(items ? jsonSchemaToZod(items) : z.unknown());
      break;
    }
    case "object": {
      let shape: Record<string, z.ZodType> = {};
      for (const [key, value] of Object.entries<any>(schema.properties ?? {})) shape[key] = jsonSchemaToZod(value);
      shape = applyRequired(shape, Array.isArray(schema.required) ? schema.required : []);
      base = z.object(shape);
      break;
    }
    default:
      base = z.unknown();
  }

  return decorate(base, schema);
}

function applyRequired(shape: Record<string, z.ZodType>, required: string[]): Record<string, z.ZodType> {
  const req = new Set(required);
  const out: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(shape)) {
    out[key] = req.has(key) ? value : (value as any).optional();
  }
  return out;
}

function decorate(base: z.ZodType, schema: any): z.ZodType {
  let out = base;
  if (typeof schema.description === "string") out = out.describe(schema.description);
  if (schema.default !== undefined) out = (out as any).default(schema.default);
  return out;
}
