/**
 * Ready-to-paste MCP client config snippets for openapimcp.
 * Keyed by client name — each entry has the filename to write and the snippet.
 * These match what `openapimcp setup` produces when writing real files.
 */

export interface ExampleConfig {
  name: string;
  filename: string;
  snippet: (spec: string) => string;
}

export const EXAMPLE_CONFIGS: ExampleConfig[] = [
  {
    name: "OpenCode",
    filename: "opencode.json",
    snippet: (spec) =>
      JSON.stringify({ mcp: { servers: { openapimcp: { type: "local", command: ["npx", "-y", "@asubilla/openapimcp", spec] } } } }, null, 2)
  },
  {
    name: "Claude Desktop",
    filename: "claude_desktop_config.json",
    snippet: (spec) =>
      JSON.stringify({ mcpServers: { openapimcp: { command: "npx", args: ["-y", "@asubilla/openapimcp", spec] } } }, null, 2)
  },
  {
    name: "Cursor",
    filename: "~/.cursor/mcp.json",
    snippet: (spec) =>
      JSON.stringify({ mcpServers: { openapimcp: { command: "npx", args: ["-y", "@asubilla/openapimcp", spec] } } }, null, 2)
  },
  {
    name: "Windsurf",
    filename: "~/.codeium/windsurf/mcp_config.json",
    snippet: (spec) =>
      JSON.stringify({ mcpServers: { openapimcp: { command: "npx", args: ["-y", "@asubilla/openapimcp", spec] } } }, null, 2)
  },
  {
    name: "VS Code",
    filename: "settings.json (mcp.mcpServers)",
    snippet: (spec) =>
      JSON.stringify({ "mcp.mcpServers": { openapimcp: { command: "npx", args: ["-y", "@asubilla/openapimcp", spec] } } }, null, 2)
  },
  {
    name: "Continue",
    filename: "config.json (mcpServers)",
    snippet: (spec) =>
      JSON.stringify({ mcpServers: [{ name: "openapimcp", command: "npx", args: ["-y", "@asubilla/openapimcp", spec] }] }, null, 2)
  },
  {
    name: "Zed",
    filename: "settings.json (context_servers)",
    snippet: (spec) =>
      JSON.stringify({ context_servers: { openapimcp: { command: { path: "npx", args: ["-y", "@asubilla/openapimcp", spec], env: {} } } } }, null, 2)
  },
  {
    name: "TOML (generic)",
    filename: "MCP config (TOML)",
    snippet: (spec) =>
      `[mcp]\nservers = [{ name = "openapimcp", command = "npx", args = ["-y", "@asubilla/openapimcp", "${spec}"] }]\n`
  }
];

export function formatExamples(spec?: string): string {
  const s = spec ?? "https://example.com/openapi.json";
  const lines = ["# openapimcp — MCP client config examples", "", `Spec: ${s}`, ""];
  for (const ex of EXAMPLE_CONFIGS) {
    lines.push("---");
    lines.push(`## ${ex.name}`);
    lines.push(`Write to: ${ex.filename}`);
    lines.push("");
    lines.push(ex.snippet(s));
    lines.push("");
  }
  return lines.join("\n");
}
