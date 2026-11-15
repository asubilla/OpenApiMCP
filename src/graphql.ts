/**
 * Minimal GraphQL SDL parsing and query building utilities.
 *
 * Dependency-free: uses regex-based parsing only.
 */

export interface GraphQLOperation {
  name: string;
  type: "query" | "mutation" | "subscription";
  description?: string;
  args: { name: string; type: string }[];
}

export function parseGraphQLSchema(sdl: string): GraphQLOperation[] {
  const ops: GraphQLOperation[] = [];
  const typeRegex = /(?:extend\s+)?type\s+(Query|Mutation|Subscription)\b[^{]*\{([\s\S]*?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = typeRegex.exec(sdl)) !== null) {
    const kind = match[1];
    const body = match[2];
    const type =
      kind === "Query"
        ? "query"
        : kind === "Mutation"
          ? "mutation"
          : "subscription";
    for (const field of parseFields(body)) {
      ops.push({
        name: field.name,
        type,
        description: field.description,
        args: field.args,
      });
    }
  }
  return ops;
}

interface ParsedField {
  name: string;
  args: { name: string; type: string }[];
  description?: string;
}

function parseFields(body: string): ParsedField[] {
  const result: ParsedField[] = [];
  const fieldRegex =
    /(?:"""([\s\S]*?)"""\s*)?((?:#[^\n]*\n)*)\s*(\w+)\s*(?:\(([^)]*)\))?\s*:\s*[^\n]*/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(body)) !== null) {
    const triple = match[1];
    const hashLines = match[2];
    const name = match[3];
    const argsStr = match[4];

    let description: string | undefined;
    if (triple !== undefined) {
      description = triple.trim();
    } else if (hashLines && hashLines.trim()) {
      const lines = hashLines
        .split("\n")
        .map((line) => line.replace(/^#\s?/, "").trim())
        .filter((line) => line.length > 0);
      if (lines.length > 0) description = lines.join(" ");
    }

    const args = argsStr ? parseArgs(argsStr) : [];
    result.push({ name, args, description });
  }
  return result;
}

function parseArgs(s: string): { name: string; type: string }[] {
  const args: { name: string; type: string }[] = [];
  for (const part of splitTopLevel(s)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\w+)\s*:\s*(.+)$/);
    if (!m) continue;
    let type = m[2].trim();
    const eqIndex = topLevelEquals(type);
    if (eqIndex !== -1) type = type.slice(0, eqIndex).trim();
    args.push({ name: m[1], type });
  }
  return args;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      current += c;
      if (c === "\\") {
        if (i + 1 < s.length) {
          current += s[++i];
        }
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === "[" || c === "{" || c === "(") {
      depth++;
      current += c;
      continue;
    }
    if (c === "]" || c === "}" || c === ")") {
      depth = Math.max(0, depth - 1);
      current += c;
      continue;
    }
    if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

function topLevelEquals(s: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "[" || c === "{" || c === "(") {
      depth++;
      continue;
    }
    if (c === "]" || c === "}" || c === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (c === "=" && depth === 0) {
      if (
        i > 0 &&
        (s[i - 1] === "!" ||
          s[i - 1] === "=" ||
          s[i - 1] === "<" ||
          s[i - 1] === ">")
      ) {
        continue;
      }
      return i;
    }
  }
  return -1;
}

export function graphqlToToolName(op: GraphQLOperation): string {
  return op.name.replace(/[^a-zA-Z0-9]/g, "_");
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return JSON.stringify(value);
}

export function buildGraphQLQuery(
  op: GraphQLOperation,
  args: Record<string, unknown>,
): string {
  const provided = op.args.filter((a) => args[a.name] !== undefined);
  const argsStr = provided
    .map((a) => `${a.name}: ${formatValue(args[a.name])}`)
    .join(", ");
  const call = argsStr ? `${op.name}(${argsStr})` : op.name;
  return `${op.type} { ${call} }`;
}
