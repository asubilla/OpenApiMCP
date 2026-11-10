/**
 * A tiny, dependency-free JSON Schema validator covering the subset of keywords
 * that matters for tool arguments: types (including unions), required,
 * properties, items, enum, numeric and length bounds, and
 * `additionalProperties: false`.
 */

/** JSON Schema equality, deep for arrays and plain objects. */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

function isPlainObject(value: any): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Does the value satisfy a single JSON Schema type name? */
function matchesType(value: any, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
    case "boolean":
      return typeof value === type;
    default:
      return true;
  }
}

function formatValue(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function childPath(path: string, key: string): string {
  return `${path}.${key}`;
}

function itemPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

/** Validate one node, pushing human-readable errors (with a path) on failure. */
function validateNode(value: any, schema: any, path: string, errors: string[]): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;

  // type (single or union)
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type: unknown) => typeof type === "string") as string[];
    if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: expected ${types.join(" or ")}`);
    }
  } else if (typeof schema.type === "string" && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}`);
  }

  // enum
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate: any) => deepEqual(candidate, value))) {
    errors.push(`${path}: expected one of ${schema.enum.map(formatValue).join(", ")}`);
  }

  // string bounds
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: length must be >= ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path}: length must be <= ${schema.maxLength}`);
    }
  }

  // numeric bounds
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path}: must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path}: must be <= ${schema.maximum}`);
    }
  }

  // arrays
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: must have at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path}: must have at most ${schema.maxItems} items`);
    }
    if (schema.items && !Array.isArray(schema.items)) {
      value.forEach((item, index) => validateNode(item, schema.items, itemPath(path, index), errors));
    }
  }

  // objects
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(`${path}: missing required property "${key}"`);
        }
      }
    }

    for (const [key, childSchema] of Object.entries<any>(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateNode(value[key], childSchema, childPath(path, key), errors);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${path}: additional property "${key}" is not allowed`);
        }
      }
    }
  }
}

/**
 * Validate a value against a JSON Schema fragment. Supports `type` (single or
 * union), `required`, `properties`, `items`, `enum`, `minimum`/`maximum`,
 * `minLength`/`maxLength`, `minItems`/`maxItems`, and
 * `additionalProperties: false`. Errors carry a JSON path such as
 * `$.items[0].name: expected string`.
 */
export function validateAgainstSchema(value: any, schema: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  validateNode(value, schema, "$", errors);
  return { valid: errors.length === 0, errors };
}
