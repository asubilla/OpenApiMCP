import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CacheEntry {
  value: string;
  /** Absolute epoch-ms expiry timestamp. */
  expires: number;
}

/**
 * A tiny file-backed cache: each entry is a JSON file named by the sha256 of
 * its key. All IO is best-effort — failures never throw and `get` returns
 * `undefined` for missing, corrupt or expired entries.
 */
export class DiskCache {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  get(key: string): CacheEntry | undefined {
    const file = this.fileFor(key);
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as CacheEntry;
      if (!parsed || typeof parsed.value !== "string" || typeof parsed.expires !== "number") return undefined;
      if (parsed.expires <= Date.now()) {
        this.removeFile(file);
        return undefined;
      }
      return { value: parsed.value, expires: parsed.expires };
    } catch {
      return undefined;
    }
  }

  set(key: string, value: string, ttlMs: number): void {
    const entry: CacheEntry = { value, expires: Date.now() + ttlMs };
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.fileFor(key), JSON.stringify(entry), "utf8");
    } catch {
      /* ignore */
    }
  }

  delete(key: string): void {
    this.removeFile(this.fileFor(key));
  }

  clear(): void {
    try {
      if (!existsSync(this.dir)) return;
      for (const name of readdirSync(this.dir)) {
        if (name.endsWith(".json")) this.removeFile(join(this.dir, name));
      }
    } catch {
      /* ignore */
    }
  }

  private fileFor(key: string): string {
    return join(this.dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  }

  private removeFile(file: string): void {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

/** Build a stable cache key for a request. Optionally includes a body. */
export function cacheKey(method: string, url: string, body?: string): string {
  const base = `${method.toUpperCase()} ${url}`;
  return body === undefined || body === "" ? base : `${base}\n${body}`;
}

/** Case-insensitive lookup of an `etag` header, returning its raw value. */
export function etagOf(headers: Record<string, string>): string | undefined {
  if (!headers) return undefined;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "etag") return value;
  }
  return undefined;
}
