import { randomBytes } from "node:crypto";

export interface MultipartFile {
  name: string;
  filename: string;
  contentType?: string;
  data: Buffer | string | Uint8Array;
}

export interface MultipartBody {
  body: Buffer;
  contentType: string;
}

export function boundary(): string {
  return `----openapimcp-${randomBytes(16).toString("hex")}`;
}

function escapeHeaderValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
}

function toBuffer(data: Buffer | string | Uint8Array): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === "string") return Buffer.from(data, "utf8");
  return Buffer.from(data);
}

export function buildMultipartBody(
  fields: Record<string, string | number | boolean>,
  files?: MultipartFile[],
): MultipartBody {
  const boundaryStr = boundary();
  const chunks: Buffer[] = [];

  const push = (s: string) => chunks.push(Buffer.from(s, "utf8"));

  for (const [name, value] of Object.entries(fields)) {
    push(`--${boundaryStr}\r\n`);
    push(`Content-Disposition: form-data; name="${escapeHeaderValue(name)}"\r\n`);
    push(`Content-Type: text/plain; charset=utf-8\r\n`);
    push(`\r\n`);
    push(`${String(value)}\r\n`);
  }

  for (const file of files ?? []) {
    const contentType = file.contentType ?? "application/octet-stream";
    push(`--${boundaryStr}\r\n`);
    push(
      `Content-Disposition: form-data; name="${escapeHeaderValue(file.name)}"; filename="${escapeHeaderValue(file.filename)}"\r\n`,
    );
    push(`Content-Type: ${contentType}\r\n`);
    push(`\r\n`);
    chunks.push(toBuffer(file.data));
    push(`\r\n`);
  }

  push(`--${boundaryStr}--\r\n`);

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundaryStr}`,
  };
}

export function parseMultipartFields(
  schema: any,
): { fields: string[]; files: string[] } | undefined {
  if (!schema || typeof schema !== "object") return undefined;

  // Unwrap common wrappers (e.g. content media entry or allOf with a single object).
  const resolved = resolveObjectSchema(schema);
  if (!resolved || !resolved.properties || typeof resolved.properties !== "object") {
    return undefined;
  }

  const fields: string[] = [];
  const files: string[] = [];

  for (const [name, prop] of Object.entries<any>(resolved.properties)) {
    if (isBinarySchema(prop)) {
      files.push(name);
    } else {
      fields.push(name);
    }
  }

  return { fields, files };
}

function resolveObjectSchema(schema: any): any | undefined {
  if (!schema || typeof schema !== "object") return undefined;

  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    return schema;
  }

  // OpenAPI media-type object: { schema: {...} }
  if (schema.schema && typeof schema.schema === "object") {
    const inner = resolveObjectSchema(schema.schema);
    if (inner) return inner;
  }

  // allOf / oneOf / anyOf with a single object branch
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        const inner = resolveObjectSchema(branch);
        if (inner) return inner;
      }
    }
  }

  return undefined;
}

function isBinarySchema(prop: any): boolean {
  if (!prop || typeof prop !== "object") return false;
  if (prop.format === "binary") return true;
  if (prop.type === "string" && prop.format === "binary") return true;
  // Nested arrays of binary strings, e.g. type: array, items: { format: binary }
  if (prop.type === "array" && prop.items && typeof prop.items === "object") {
    return isBinarySchema(prop.items);
  }
  return false;
}
