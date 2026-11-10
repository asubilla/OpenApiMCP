import { readFileSync } from "node:fs";

/** Arbitrary JSON configuration, as loaded from a config file or the CLI. */
export interface Config {
  [key: string]: unknown;
}

/** Read and parse a JSON config file, throwing a clear error when invalid. */
export function loadConfig(file: string): Config {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`could not read config file "${file}": ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON in config file "${file}": ${err instanceof Error ? err.message : String(err)}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config file "${file}" must contain a JSON object`);
  }

  return parsed as Config;
}

/**
 * Shallow-merge config with CLI values. CLI values win, except `undefined`,
 * which means "not set" and keeps the config value. Returns a new object and
 * never mutates either input.
 */
export function mergeConfig(config: Config, cli: Config): Config {
  const merged: Config = { ...config };
  for (const [key, value] of Object.entries(cli)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
