/**
 * Helpers for constructing and validating MCP elicitation requests.
 */

export interface ElicitationField {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  label?: string;
  required?: boolean;
  enumValues?: string[];
  default?: unknown;
}

export interface ElicitationRequest {
  message: string;
  fields: ElicitationField[];
  url?: string;
}

export function buildElicitationRequest(
  message: string,
  fields: ElicitationField[],
  url?: string,
): ElicitationRequest {
  const req: ElicitationRequest = {
    message,
    fields: fields.map((f) => ({ ...f, enumValues: f.enumValues ? [...f.enumValues] : undefined })),
  };
  if (url !== undefined) req.url = url;
  return req;
}

function isCoercibleToNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return false;
    const n = Number(trimmed);
    return Number.isFinite(n);
  }
  return false;
}

function isCoercibleToBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "false";
  }
  return false;
}

function typeValid(field: ElicitationField, value: unknown): boolean {
  switch (field.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return isCoercibleToNumber(value);
    case "boolean":
      return isCoercibleToBoolean(value);
    case "enum": {
      const allowed = field.enumValues ?? [];
      return typeof value === "string" && allowed.includes(value);
    }
    default:
      return true;
  }
}

export function validateElicitationResponse(
  fields: ElicitationField[],
  response: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!response || typeof response !== "object" || Array.isArray(response)) {
    errors.push("response must be an object");
    return { valid: false, errors };
  }

  for (const field of fields) {
    const key = field.name;
    const raw = response[key];
    const present = Object.prototype.hasOwnProperty.call(response, key) && raw !== undefined && raw !== null;

    if (field.required && !present) {
      errors.push(`missing required field "${key}"`);
      continue;
    }
    if (!present) continue;

    if (!typeValid(field, raw)) {
      errors.push(`field "${key}" must be a valid ${field.type}`);
      continue;
    }

    if (field.type === "enum") {
      const allowed = field.enumValues ?? [];
      if (!allowed.includes(raw as string)) {
        errors.push(`field "${key}" must be one of ${allowed.join(", ")}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function formatElicitationRequest(req: ElicitationRequest): string {
  return JSON.stringify(req, null, 2);
}