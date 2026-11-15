import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export interface TamperAuditEntry {
  time: string;
  tool: string;
  method: string;
  url?: string;
  status?: number;
  ok: boolean;
  durationMs: number;
  prevHash: string;
  hash: string;
}

export class TamperAuditLog {
  constructor(private readonly file: string) {
    const dir = dirname(file);
    if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  }

  write(entry: Omit<TamperAuditEntry, "prevHash" | "hash">): TamperAuditEntry {
    const entries = this.readAll();
    const prevHash = entries.length > 0 ? entries[entries.length - 1].hash : "GENESIS";
    const withoutHash: Record<string, unknown> = { ...entry, prevHash };
    const hash = hashEntry(prevHash, withoutHash);
    const full: TamperAuditEntry = { ...withoutHash, hash } as TamperAuditEntry;
    appendFileSync(this.file, `${JSON.stringify(full)}\n`, "utf8");
    return full;
  }

  verify(): { valid: boolean; brokenAt?: number; total: number } {
    const entries = this.readAll();
    let prevHash = "GENESIS";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.prevHash !== prevHash) {
        return { valid: false, brokenAt: i, total: entries.length };
      }
      const { hash, ...rest } = e;
      const computed = hashEntry(prevHash, rest as Record<string, unknown>);
      if (computed !== hash) {
        return { valid: false, brokenAt: i, total: entries.length };
      }
      prevHash = hash;
    }
    return { valid: true, total: entries.length };
  }

  readAll(): TamperAuditEntry[] {
    if (!existsSync(this.file)) return [];
    const raw = readFileSync(this.file, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line) => JSON.parse(line) as TamperAuditEntry);
  }
}

export function createTamperAuditLog(file: string): TamperAuditLog {
  return new TamperAuditLog(file);
}

export function hashEntry(prevHash: string, entry: Record<string, unknown>): string {
  const rest = { ...entry };
  if (Object.prototype.hasOwnProperty.call(rest, "hash")) delete rest.hash;
  return createHash("sha256").update(prevHash + JSON.stringify(rest)).digest("hex");
}