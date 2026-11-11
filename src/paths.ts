import os from "node:os";
import path from "node:path";

export function configHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

export function appData(): string {
  return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
}

export function localAppData(): string {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}

export function claudeDesktopConfigPath(global: boolean, cwd: string): string {
  if (!global) return path.join(cwd, "claude_desktop_config.json");
  if (process.platform === "win32") return path.join(appData(), "Claude", "claude_desktop_config.json");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return path.join(configHome(), "Claude", "claude_desktop_config.json");
}

export function opencodeConfigPath(global: boolean, cwd: string): string {
  if (!global) return path.join(cwd, "opencode.json");
  return path.join(configHome(), "opencode", "opencode.json");
}

export function cursorConfigPath(global: boolean, cwd: string): string {
  if (!global) return path.join(cwd, ".cursor", "mcp.json");
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

export function windsurfConfigPath(): string {
  return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
}

export function vscodeProjectConfigPath(cwd: string): string {
  return path.join(cwd, ".vscode", "mcp.json");
}

export function vscodeGlobalSettingsPath(): string {
  if (process.platform === "win32") return path.join(appData(), "Code", "User", "settings.json");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "settings.json");
  return path.join(configHome(), "Code", "User", "settings.json");
}

export function continueConfigPath(): string {
  return path.join(os.homedir(), ".continue", "config.json");
}

export function zedSettingsPath(): string {
  if (process.platform === "win32") return path.join(appData(), "Zed", "settings.json");
  return path.join(configHome(), "zed", "settings.json");
}
