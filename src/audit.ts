import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
  /** ISO-8601 timestamp of when the call happened. */
  time: string;
  /** Tool that was invoked. */
  tool: string;
  /** HTTP method used for the outbound request. */
  method: string;
  /** Fully resolved outbound URL, when a request was attempted. */
  url?: string;
  /** HTTP response status, when a response was received. */
  status?: number;
  /** Whether the call succeeded. */
  ok: boolean;
  /** Wall-clock duration of the call in milliseconds. */
  durationMs: number;
  /** Why the call failed or was blocked. */
  reason?: string;
}

/** Append-only JSON Lines audit trail. */
export class AuditLog {
  constructor(private readonly file: string) {
    const dir = dirname(file);
    if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  }

  /** Append a single entry as one JSON line. */
  write(entry: AuditEntry): void {
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

/** Create an {@link AuditLog} that writes to `file`, creating parent dirs. */
export function createAuditLog(file: string): AuditLog {
  return new AuditLog(file);
}
