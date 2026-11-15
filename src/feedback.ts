import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FeedbackEntry {
  tool: string;
  query?: string;
  rating: "up" | "down";
  comment?: string;
  timestamp: string;
}

/** Append-only JSON Lines feedback store. */
export class FeedbackStore {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    const dir = dirname(file);
    if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  }

  /** Append a feedback entry, stamping a timestamp when omitted. */
  add(entry: Omit<FeedbackEntry, "timestamp"> & { timestamp?: string }): void {
    const full: FeedbackEntry = {
      tool: entry.tool,
      query: entry.query,
      rating: entry.rating,
      comment: entry.comment,
      timestamp: entry.timestamp ?? new Date().toISOString()
    };
    appendFileSync(this.file, `${JSON.stringify(full)}\n`, "utf8");
  }

  /** Read all entries, optionally filtered by tool. */
  list(tool?: string): FeedbackEntry[] {
    if (!existsSync(this.file)) return [];
    const raw = readFileSync(this.file, "utf8");
    const entries: FeedbackEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as FeedbackEntry;
        if (tool === undefined || parsed.tool === tool) entries.push(parsed);
      } catch {
        // ignore malformed lines
      }
    }
    return entries;
  }

  /** Count up/down ratings for a tool. */
  score(tool: string): { up: number; down: number; total: number } {
    let up = 0;
    let down = 0;
    for (const entry of this.list(tool)) {
      if (entry.rating === "up") up += 1;
      else if (entry.rating === "down") down += 1;
    }
    return { up, down, total: up + down };
  }

  /** Suggest improvements for tools with more downs than ups. */
  suggestImprovements(tools: { name: string; description: string }[]): { tool: string; hint: string }[] {
    const result: { tool: string; hint: string }[] = [];
    for (const tool of tools) {
      const { up, down } = this.score(tool.name);
      if (down > up) {
        result.push({ tool: tool.name, hint: "Consider clarifying the description or adding examples" });
      }
    }
    return result;
  }
}

/** Create a {@link FeedbackStore} backed by `file`, creating parent dirs. */
export function createFeedbackStore(file: string): FeedbackStore {
  return new FeedbackStore(file);
}