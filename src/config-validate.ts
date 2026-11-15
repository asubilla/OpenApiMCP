/**
 * Static validation for openapimcp JSON configuration objects.
 *
 * Dependency-free (node builtins only). `validateConfig` never throws on
 * user input — it reports problems as {@link ConfigIssue} entries instead,
 * so callers can decide how to surface them.
 */

export interface ConfigIssue {
  severity: "error" | "warning";
  key: string;
  message: string;
}

type KeyType =
  | "boolean"
  | "number"
  | "string"
  | "array"
  | "object"
  | "headers"
  | "stringOrObject";

/**
 * Map of every known config key to its expected type. `KNOWN_KEYS` is
 * derived from this so the two can never drift apart.
 */
const KEY_TYPES: Record<string, KeyType> = {
  baseUrl: "string",
  headers: "headers",
  readOnly: "boolean",
  policy: "stringOrObject",
  fields: "array",
  maxBytes: "number",
  timeout: "number",
  retries: "number",
  cacheTtl: "number",
  rateLimit: "number",
  retryDelayMs: "number",
  maxPages: "number",
  paginate: "boolean",
  toolSearch: "boolean",
  redact: "boolean",
  summarize: "boolean",
  sanitize: "boolean",
  mock: "boolean",
  logJson: "boolean",
  name: "string",
  include: "array",
  exclude: "array",
  tag: "string",
  structuredContent: "boolean",
  http: "boolean",
  port: "number",
  host: "string",
  path: "string",
  args: "array",
  oauth2TokenUrl: "string",
  oauth2ClientId: "string",
  oauth2ClientSecret: "string",
  oauth2Scope: "string",
  audit: "boolean",
  dotenv: "boolean",
  overlay: "stringOrObject",
  /** Nested config object; validated recursively with a `config.` prefix. */
  config: "object",
  // Plausible extras commonly found in configs / CLI flags.
  spec: "string",
  specUrl: "string",
  apiKey: "string",
  token: "string",
  auth: "stringOrObject",
  cors: "boolean",
  followRedirects: "boolean",
  userAgent: "string",
  proxy: "string",
  verbose: "boolean",
  quiet: "boolean",
  debug: "boolean",
  strict: "boolean",
  trace: "boolean",
  metrics: "boolean",
  cache: "boolean",
  transport: "string",
  format: "string",
  output: "string",
  profile: "string",
  version: "string",
  description: "string",
  env: "object",
  mcp: "object",
  mcpServers: "object",
};

/** All config keys openapimcp recognizes. */
export const KNOWN_KEYS: string[] = Object.keys(KEY_TYPES);

const MAX_NESTING_DEPTH = 5;

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkValue(key: string, value: unknown, expected: KeyType): ConfigIssue[] {
  const issue = (message: string): ConfigIssue => ({ severity: "error", key, message });

  switch (expected) {
    case "boolean":
      return typeof value === "boolean"
        ? []
        : [issue(`must be a boolean, got ${typeName(value)}`)];
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? []
        : [issue(`must be a finite number, got ${typeName(value)}`)];
    case "string":
      return typeof value === "string"
        ? []
        : [issue(`must be a string, got ${typeName(value)}`)];
    case "array":
      return Array.isArray(value)
        ? []
        : [issue(`must be an array, got ${typeName(value)}`)];
    case "object":
      return isPlainObject(value)
        ? []
        : [issue(`must be an object, got ${typeName(value)}`)];
    case "stringOrObject":
      return typeof value === "string" || isPlainObject(value)
        ? []
        : [issue(`must be a string or an object, got ${typeName(value)}`)];
    case "headers": {
      if (!isPlainObject(value)) {
        return [issue(`must be an object with string values, got ${typeName(value)}`)];
      }
      const issues: ConfigIssue[] = [];
      for (const [name, headerValue] of Object.entries(value)) {
        if (typeof headerValue !== "string") {
          issues.push(
            issue(`header "${name}" must have a string value, got ${typeName(headerValue)}`),
          );
        }
      }
      return issues;
    }
  }
}

function validateObject(
  config: Record<string, unknown>,
  prefix: string,
  depth: number,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  for (const [key, value] of Object.entries(config)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const expected = KEY_TYPES[key];

    if (expected === undefined) {
      issues.push({
        severity: "warning",
        key: fullKey,
        message: `unknown config key "${key}"`,
      });
      continue;
    }

    const valueIssues = checkValue(fullKey, value, expected);
    issues.push(...valueIssues);

    // Recurse into nested `config` objects, unless the value already failed
    // the object check (nothing sensible to recurse into).
    if (key === "config" && isPlainObject(value)) {
      if (depth >= MAX_NESTING_DEPTH) {
        issues.push({
          severity: "warning",
          key: fullKey,
          message: `nesting deeper than ${MAX_NESTING_DEPTH} levels; skipping further checks`,
        });
      } else {
        issues.push(...validateObject(value, fullKey, depth + 1));
      }
    }
  }

  return issues;
}

/**
 * Validate an unknown value as an openapimcp config object.
 *
 * - The top level (and any nested `config` object) must be a JSON object.
 * - Unknown keys produce warnings; wrong types produce errors.
 * - `valid` is true when there are no error-severity issues.
 */
export function validateConfig(config: unknown): { valid: boolean; issues: ConfigIssue[] } {
  if (!isPlainObject(config)) {
    return {
      valid: false,
      issues: [
        {
          severity: "error",
          key: "(root)",
          message: `config must be a JSON object, got ${typeName(config)}`,
        },
      ],
    };
  }

  const issues = validateObject(config, "", 0);
  const valid = !issues.some((i) => i.severity === "error");
  return { valid, issues };
}

/**
 * Render issues grouped by severity: errors first (✗), then warnings (⚠).
 * Returns a friendly placeholder when there is nothing to report.
 */
export function formatConfigIssues(issues: ConfigIssue[]): string {
  if (issues.length === 0) {
    return "No config issues found.";
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const lines: string[] = [];

  if (errors.length > 0) {
    lines.push(`Errors (${errors.length}):`);
    for (const issue of errors) {
      lines.push(`✗ ${issue.key}: ${issue.message}`);
    }
  }

  if (warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`Warnings (${warnings.length}):`);
    for (const issue of warnings) {
      lines.push(`⚠ ${issue.key}: ${issue.message}`);
    }
  }

  return lines.join("\n");
}
