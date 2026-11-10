import type { ToolDef } from "./types.js";

/** Render an aligned table of tools (name, METHOD, path) with a footer count. */
export function formatToolList(tools: ToolDef[]): string {
  const rows = tools.map((tool) => [tool.name, String(tool.method ?? "").toUpperCase(), tool.path]);
  const table = renderTable(["NAME", "METHOD", "PATH"], rows);
  const count = tools.length;
  return `${table}\n\n${count} tool${count === 1 ? "" : "s"}`;
}

/** Render a human-readable multi-line summary of a single tool. */
export function formatToolDetail(tool: ToolDef): string {
  const lines: string[] = [];
  lines.push(`Tool: ${tool.name}`);
  if (tool.description) lines.push(`Description: ${tool.description}`);
  lines.push(`Endpoint: ${String(tool.method ?? "").toUpperCase()} ${tool.path}`);

  if (tool.params.length === 0) {
    lines.push("Params: (none)");
  } else {
    lines.push("Params:");
    for (const param of tool.params) {
      const flags = `${param.location}, ${param.required ? "required" : "optional"}, ${schemaTypeName(param.schema)}`;
      const suffix = param.description ? ` - ${param.description}` : "";
      lines.push(`  - ${param.argName} (${flags})${suffix}`);
    }
  }

  lines.push(`Tags: ${tool.tags.length > 0 ? tool.tags.join(", ") : "(none)"}`);

  const annotations = Object.entries(tool.annotations).filter(([, value]) => value !== undefined);
  lines.push(
    `Annotations: ${annotations.length > 0 ? annotations.map(([key, value]) => `${key}=${String(value)}`).join(", ") : "(none)"}`
  );

  return lines.join("\n");
}

/** A tiny in-memory index over a set of tool definitions. */
export class ToolKit {
  private readonly tools: ToolDef[];

  constructor(tools: ToolDef[]) {
    this.tools = [...tools];
  }

  /** All tools, in their original order. */
  all(): ToolDef[] {
    return [...this.tools];
  }

  /** Find a tool by its exact name. */
  find(name: string): ToolDef | undefined {
    return this.tools.find((tool) => tool.name === name);
  }

  /** Rank tools by simple token overlap across name, description and tags. */
  search(query: string): ToolDef[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    return this.tools
      .map((tool) => ({ tool, score: overlapScore(tool, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
      .map((entry) => entry.tool);
  }
}

function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? "").length), 0)
  );

  const format = (row: string[]) =>
    row
      .map((cell, column) => (cell ?? "").padEnd(widths[column]))
      .join("  ")
      .replace(/\s+$/, "");

  const lines: string[] = [];
  lines.push(format(header));
  lines.push(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) lines.push(format(row));
  return lines.join("\n");
}

function tokenize(value: string): string[] {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function overlapScore(tool: ToolDef, tokens: string[]): number {
  const haystack = [tool.name, tool.description, ...tool.tags].join(" ").toLowerCase();
  const name = tool.name.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) continue;
    score += 1;
    if (name.includes(token)) score += 1;
  }
  return score;
}

/** Best-effort, human-friendly name for a JSON Schema value. */
function schemaTypeName(schema: any): string {
  if (!schema || typeof schema !== "object") return "any";
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "enum";
  const rawType = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type;
  switch (rawType) {
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "array": {
      const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
      return `array<${items ? schemaTypeName(items) : "any"}>`;
    }
    case "object":
      return "object";
    default:
      if (schema.properties) return "object";
      if (schema.items) return "array<any>";
      return "any";
  }
}
