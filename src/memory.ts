import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  tags?: string[];
  time: string;
}

/** Tokenize free text into unique lowercase alphanumeric tokens. */
function tokenize(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

/** Score an entry by how many query tokens appear in key+value+tags. */
function scoreEntry(entry: MemoryEntry, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const haystack = [entry.key, entry.value, ...(entry.tags ?? [])]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

/**
 * A small file-backed agent memory. Entries are persisted as JSON Lines;
 * `add` appends a single line, while mutations rewrite the file.
 */
export class AgentMemory {
  private readonly file: string;
  private entries: MemoryEntry[] = [];

  constructor(file: string) {
    this.file = file;
    const dir = dirname(file);
    if (dir && dir !== ".") {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        /* ignore */
      }
    }
    if (existsSync(file)) {
      try {
        const raw = readFileSync(file, "utf8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as MemoryEntry;
            if (
              parsed &&
              typeof parsed.id === "string" &&
              typeof parsed.key === "string" &&
              typeof parsed.value === "string" &&
              typeof parsed.time === "string"
            ) {
              this.entries.push(parsed);
            }
          } catch {
            /* ignore malformed lines */
          }
        }
      } catch {
        /* ignore read errors */
      }
    }
  }

  add(key: string, value: string, tags?: string[]): string {
    const entry: MemoryEntry = {
      id: randomUUID(),
      key,
      value,
      tags: tags === undefined ? undefined : [...tags],
      time: new Date().toISOString(),
    };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
    } catch {
      /* ignore */
    }
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
    this.entries.push(entry);
    return entry.id;
  }

  get(key: string): MemoryEntry | undefined {
    return this.entries.find((entry) => entry.key === key);
  }

  search(query: string, limit?: number): MemoryEntry[] {
    const tokens = tokenize(query);
    const scored = this.entries
      .map((entry, index) => ({ entry, index, score: scoreEntry(entry, tokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const max =
      limit === undefined
        ? scored.length
        : Math.max(0, Number.isFinite(limit) ? Math.trunc(limit) : scored.length);

    return scored.slice(0, max).map((item) => item.entry);
  }

  list(): MemoryEntry[] {
    return this.entries.map((entry) => ({ ...entry, tags: entry.tags ? [...entry.tags] : undefined }));
  }

  delete(key: string): boolean {
    const index = this.entries.findIndex((entry) => entry.key === key);
    if (index === -1) return false;
    this.entries.splice(index, 1);
    this.persistAll();
    return true;
  }

  clear(): void {
    this.entries = [];
    this.persistAll();
  }

  private persistAll(): void {
    try {
      const dir = dirname(this.file);
      if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
      const data =
        this.entries.length === 0
          ? ""
          : `${this.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
      writeFileSync(this.file, data, "utf8");
    } catch {
      /* ignore */
    }
  }
}

/** Create an {@link AgentMemory} backed by `file`, creating parent dirs. */
export function createMemory(file: string): AgentMemory {
  return new AgentMemory(file);
}