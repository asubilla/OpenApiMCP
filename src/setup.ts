import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appData,
  claudeDesktopConfigPath,
  configHome,
  continueConfigPath,
  cursorConfigPath,
  opencodeConfigPath,
  vscodeGlobalSettingsPath,
  vscodeProjectConfigPath,
  windsurfConfigPath,
  zedSettingsPath
} from "./paths.js";

export interface ClientInfo {
  id: string;
  name: string;
  path: string;
  scope: "global" | "project";
  exists: boolean;
}

export interface SetupOptions {
  spec: string;
  serverName?: string;
  targets?: string[];
  global?: boolean;
  project?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
  postinstall?: boolean;
}

export interface SetupResult {
  written: { client: string; path: string }[];
  skipped: { client: string; reason: string }[];
  errors: { client: string; error: string }[];
}

const ALL_CLIENTS = ["opencode", "claude", "cursor", "windsurf", "vscode", "continue", "zed"];

function readJson(file: string): any {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function entryFor(spec: string, serverName: string): { command: string; args: string[] } {
  return { command: "npx", args: ["-y", "openapimcp", spec] };
}

function writeClient(client: ClientInfo, spec: string, serverName: string): { ok: boolean; error?: string } {
  try {
    if (client.id === "opencode") {
      const cfg = readJson(client.path) ?? { $schema: "https://opencode.ai/config.json", mcp: { servers: {} } };
      cfg.mcp ??= { servers: {} };
      cfg.mcp.servers ??= {};
      if (client.scope === "global") cfg.mcp.servers[serverName] = { type: "local", command: ["npx", "-y", "openapimcp", spec] };
      else cfg.mcp.servers[serverName] = { type: "local", command: ["npx", "-y", "openapimcp", spec] };
      writeJson(client.path, cfg);
      return { ok: true };
    }
    if (client.id === "vscode" && client.scope === "project") {
      const cfg = readJson(client.path) ?? { servers: {} };
      cfg.servers ??= {};
      cfg.servers[serverName] = { command: "npx", args: ["-y", "openapimcp", spec] };
      writeJson(client.path, cfg);
      return { ok: true };
    }
    if (client.id === "vscode" && client.scope === "global") {
      const cfg = readJson(client.path) ?? {};
      cfg.mcp ??= {};
      cfg.mcp.servers ??= {};
      cfg.mcp.servers[serverName] = { command: "npx", args: ["-y", "openapimcp", spec] };
      writeJson(client.path, cfg);
      return { ok: true };
    }
    if (client.id === "continue") {
      const cfg = readJson(client.path) ?? {};
      const list = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
      cfg.mcpServers = list.filter((x: any) => x?.name !== serverName).concat({ name: serverName, command: "npx", args: ["-y", "openapimcp", spec] });
      writeJson(client.path, cfg);
      return { ok: true };
    }
    if (client.id === "zed") {
      const cfg = readJson(client.path) ?? {};
      cfg.context_servers ??= {};
      cfg.context_servers[serverName] = { command: { path: "npx", args: ["-y", "openapimcp", spec], env: {} } };
      writeJson(client.path, cfg);
      return { ok: true };
    }
    // default: mcpServers object (claude, cursor, windsurf)
    const cfg = readJson(client.path) ?? { mcpServers: {} };
    cfg.mcpServers ??= {};
    cfg.mcpServers[serverName] = entryFor(spec, serverName);
    writeJson(client.path, cfg);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function detectClients(cwd: string, opts: { global?: boolean; project?: boolean } = {}): ClientInfo[] {
  const global = opts.global !== false;
  const project = Boolean(opts.project);
  const out: ClientInfo[] = [];
  const add = (id: string, name: string, p: string, scope: "global" | "project", exists: boolean) => {
    out.push({ id, name, path: p, scope, exists });
  };

  if (global) {
    const p = opencodeConfigPath(true, cwd); add("opencode", "OpenCode", p, "global", existsSync(path.dirname(p)));
    const cp = claudeDesktopConfigPath(true, cwd); add("claude", "Claude Desktop", cp, "global", existsSync(path.dirname(cp)));
    const cu = cursorConfigPath(true, cwd); add("cursor", "Cursor", cu, "global", existsSync(path.dirname(cu)));
    const w = windsurfConfigPath(); add("windsurf", "Windsurf", w, "global", existsSync(path.dirname(w)));
    const v = vscodeGlobalSettingsPath(); add("vscode", "VS Code (global)", v, "global", existsSync(path.dirname(v)));
    const c = continueConfigPath(); add("continue", "Continue", c, "global", existsSync(path.dirname(c)));
    const z = zedSettingsPath(); add("zed", "Zed", z, "global", existsSync(path.dirname(z)));
  }

  if (project) {
    const op = opencodeConfigPath(false, cwd); add("opencode", "OpenCode (project)", op, "project", true);
    const cu = cursorConfigPath(false, cwd); add("cursor", "Cursor (project)", cu, "project", existsSync(path.dirname(cu)) || true);
    const vs = vscodeProjectConfigPath(cwd); add("vscode", "VS Code (project)", vs, "project", existsSync(path.dirname(vs)) || true);
  }

  return out;
}

export function runSetup(opts: SetupOptions): SetupResult {
  const result: SetupResult = { written: [], skipped: [], errors: [] };
  const cwd = process.cwd();
  const targets = opts.targets?.length ? opts.targets : ALL_CLIENTS;
  const serverName = opts.serverName ?? "openapimcp";

  const candidates = detectClients(cwd, { global: opts.global === true || !opts.project, project: Boolean(opts.project) })
    .filter((c) => targets.includes(c.id));

  for (const client of candidates) {
    if (!client.exists && !opts.project) {
      result.skipped.push({ client: client.name, reason: "not installed (config dir missing)" });
      continue;
    }
    if (opts.dryRun) {
      result.written.push({ client: client.name, path: client.path });
      continue;
    }
    const res = writeClient(client, opts.spec, serverName);
    if (res.ok) result.written.push({ client: client.name, path: client.path });
    else result.errors.push({ client: client.name, error: res.error ?? "unknown error" });
  }

  if (!opts.quiet) {
    const log = (line: string) => process.stdout.write(line + "\n");
    if (result.written.length) {
      log("✓ configured:");
      for (const w of result.written) log(`  - ${w.client}: ${w.path}`);
    }
    if (result.skipped.length) {
      log("• skipped (not detected):");
      for (const s of result.skipped) log(`  - ${s.client}`);
    }
    if (result.errors.length) {
      log("✗ errors:");
      for (const e of result.errors) log(`  - ${e.client}: ${e.error}`);
    }
    if (!result.written.length && !result.errors.length) log("Nothing to configure. Install an MCP client (OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, or Zed) first.");
  }

  return result;
}

export function postinstallHint(): void {
  process.stdout.write("\nopenapimcp installed. Run `npx openapimcp setup <spec>` to auto-configure your editors (OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed).\n");
  process.stdout.write("Set OPENAPIMCP_AUTO_SETUP=1 to run setup automatically on install.\n");
}
