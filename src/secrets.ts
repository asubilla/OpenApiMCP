import { statSync, readFileSync } from "node:fs";

export type SecretSource = "env" | "file" | "inline";

export interface SecretProvider {
  get(name: string): string | undefined;
  has(name: string): boolean;
}

/**
 * Read secrets from `process.env`, optionally prefixing every lookup key
 * (e.g. `envSecretProvider("OPENAPIMCP_")` looks up `OPENAPIMCP_<name>`).
 */
export function envSecretProvider(prefix = ""): SecretProvider {
  return {
    get(name: string): string | undefined {
      const value = process.env[prefix + name];
      return value === undefined ? undefined : value;
    },
    has(name: string): boolean {
      return process.env[prefix + name] !== undefined;
    }
  };
}

/**
 * Read secrets from a JSON file of shape `{ "KEY": "value" }`. The parsed
 * object is cached and reloaded only when the file's mtime (or size) changes.
 */
export function fileSecretProvider(filePath: string): SecretProvider {
  let cache: { mtime: number; size: number; data: Record<string, string> } | null = null;

  function load(): Record<string, string> {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      cache = null;
      return {};
    }

    if (cache && cache.mtime === stat.mtimeMs && cache.size === stat.size) {
      return cache.data;
    }

    let data: Record<string, string> = {};
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "string") data[key] = value;
        }
      }
    } catch {
      data = {};
    }

    cache = { mtime: stat.mtimeMs, size: stat.size, data };
    return data;
  }

  return {
    get(name: string): string | undefined {
      const data = load();
      const value = data[name];
      return typeof value === "string" ? value : undefined;
    },
    has(name: string): boolean {
      const data = load();
      return Object.prototype.hasOwnProperty.call(data, name) && typeof data[name] === "string";
    }
  };
}

/**
 * Combine several providers; the first provider that has the secret wins.
 */
export function chainSecretProviders(...providers: SecretProvider[]): SecretProvider {
  return {
    get(name: string): string | undefined {
      for (const provider of providers) {
        const value = provider.get(name);
        if (value !== undefined) return value;
      }
      return undefined;
    },
    has(name: string): boolean {
      return providers.some((provider) => provider.has(name));
    }
  };
}

/**
 * Resolve a secret by name, throwing if no provider can supply it.
 */
export function resolveSecret(name: string, provider: SecretProvider): string {
  const value = provider.get(name);
  if (value === undefined) {
    throw new Error(`Secret not found: ${name}`);
  }
  return value;
}