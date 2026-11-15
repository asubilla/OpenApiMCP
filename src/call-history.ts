import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export interface CallRecord {
  /** Unique identifier for the recorded call. */
  id: string;
  /** ISO-8601 timestamp of when the call happened. */
  time: string;
  /** Tool that was invoked. */
  tool: string;
  /** HTTP method used for the outbound request. */
  method: string;
  /** Fully resolved outbound URL. */
  url: string;
  /** Arguments the tool was called with. */
  args: Record<string, unknown>;
  /** HTTP response status, when a response was received. */
  status?: number;
  /** Whether the call succeeded. */
  ok: boolean;
  /** Wall-clock duration of the call in milliseconds. */
  durationMs: number;
  /** Truncated preview of the response body. */
  responsePreview: string;
}

const DEFAULT_MAX_ENTRIES = 100;

/** Persistent JSON Lines call history, trimmed to the most recent entries. */
export class CallHistory {
  private readonly file: string;
  private readonly maxEntries: number;

  constructor(file: string, opts?: { maxEntries?: number }) {
    this.file = file;
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const dir = dirname(file);
    if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  }

  /** Record a call, persisting it and trimming the log to `maxEntries`. */
  record(entry: Omit<CallRecord, "id" | "time">): CallRecord {
    const record: CallRecord = {
      id: randomUUID(),
      time: new Date().toISOString(),
      ...entry
    };
    appendFileSync(this.file, `${JSON.stringify(record)}\n`, "utf8");
    this.trim();
    return record;
  }

  /** List records in chronological order; `limit` keeps only the most recent entries. */
  list(limit?: number): CallRecord[] {
    const records = this.readAll();
    if (limit === undefined) return records;
    if (limit <= 0) return [];
    return records.slice(-limit);
  }

  /** Look up a single record by id. */
  get(id: string): CallRecord | undefined {
    return this.readAll().find((record) => record.id === id);
  }

  /** Remove all records. */
  clear(): void {
    if (existsSync(this.file)) rmSync(this.file, { force: true });
  }

  private readAll(): CallRecord[] {
    if (!existsSync(this.file)) return [];
    const raw = readFileSync(this.file, "utf8");
    const records: CallRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as CallRecord);
      } catch {
        // Skip unparseable lines rather than failing the whole read.
      }
    }
    return records;
  }

  private trim(): void {
    const records = this.readAll();
    if (records.length <= this.maxEntries) return;
    const kept = records.slice(-this.maxEntries);
    writeFileSync(this.file, kept.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  }
}

/** Create a {@link CallHistory} that persists to `file`, creating parent dirs. */
export function createCallHistory(file: string, opts?: { maxEntries?: number }): CallHistory {
  return new CallHistory(file, opts);
}

/** Format one line per entry: `<id> <time> <method> <tool> -> <status> <ok> (<durationMs>ms)`. */
export function formatCallList(entries: CallRecord[]): string {
  return entries
    .map((entry) => `${entry.id} ${entry.time} ${entry.method} ${entry.tool} -> ${entry.status ?? "-"} ${entry.ok} (${entry.durationMs}ms)`)
    .join("\n");
}

/** Merge a record's args with overrides; overrides win. */
export function replayArgs(record: CallRecord, overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...record.args, ...overrides };
}
