import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Variant {
  id: string;
  description: string;
  impressions: number;
  selections: number;
}

export interface AbTest {
  tool: string;
  variants: Variant[];
  winner?: string;
}

/** File-backed A/B test store. Persisted as JSON (rewritten on every mutation). */
export class AbTestStore {
  private readonly file: string;
  private tests: AbTest[] = [];

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
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          let arr: unknown[] = [];
          if (Array.isArray(parsed)) {
            arr = parsed;
          } else if (parsed && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>;
            if (Array.isArray(obj.tests)) arr = obj.tests;
            else arr = Object.values(obj);
          }
          for (const entry of arr) {
            if (!entry || typeof entry !== "object") continue;
            const t = entry as Record<string, unknown>;
            if (typeof t.tool !== "string" || !Array.isArray(t.variants)) continue;
            const variants: Variant[] = [];
            for (const v of t.variants) {
              if (!v || typeof v !== "object") continue;
              const vv = v as Record<string, unknown>;
              if (typeof vv.id !== "string") continue;
              variants.push({
                id: vv.id,
                description: typeof vv.description === "string" ? vv.description : "",
                impressions: typeof vv.impressions === "number" && Number.isFinite(vv.impressions) ? vv.impressions : 0,
                selections: typeof vv.selections === "number" && Number.isFinite(vv.selections) ? vv.selections : 0,
              });
            }
            this.tests.push({
              tool: t.tool,
              variants,
              winner: typeof t.winner === "string" ? t.winner : undefined,
            });
          }
        }
      } catch {
        /* ignore corrupt file */
      }
    }
  }

  private persist(): void {
    try {
      const dir = dirname(this.file);
      if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.tests, null, 2) + "\n", "utf8");
    } catch {
      /* ignore */
    }
  }

  createTest(tool: string, variants: { id: string; description: string }[]): AbTest {
    const test: AbTest = {
      tool,
      variants: variants.map((v) => ({
        id: v.id,
        description: v.description,
        impressions: 0,
        selections: 0,
      })),
    };
    const idx = this.tests.findIndex((t) => t.tool === tool);
    if (idx >= 0) this.tests[idx] = test;
    else this.tests.push(test);
    this.persist();
    return test;
  }

  getTest(tool: string): AbTest | undefined {
    return this.tests.find((t) => t.tool === tool);
  }

  recordImpression(tool: string, variantId: string): void {
    const test = this.tests.find((t) => t.tool === tool);
    const variant = test?.variants.find((v) => v.id === variantId);
    if (!variant) return;
    variant.impressions += 1;
    this.persist();
  }

  recordSelection(tool: string, variantId: string): void {
    const test = this.tests.find((t) => t.tool === tool);
    const variant = test?.variants.find((v) => v.id === variantId);
    if (!variant) return;
    variant.selections += 1;
    this.persist();
  }

  getWinner(tool: string): string | undefined {
    const test = this.tests.find((t) => t.tool === tool);
    if (!test) return undefined;
    const candidates = test.variants.filter((v) => v.impressions >= 5);
    if (candidates.length === 0) {
      test.winner = undefined;
      this.persist();
      return undefined;
    }
    let best = candidates[0];
    for (const c of candidates.slice(1)) {
      const rBest = best.selections / best.impressions;
      const rC = c.selections / c.impressions;
      if (rC > rBest || (rC === rBest && c.id < best.id)) best = c;
    }
    test.winner = best.id;
    this.persist();
    return best.id;
  }

  allTests(): AbTest[] {
    return this.tests.map((t) => ({
      tool: t.tool,
      variants: t.variants.map((v) => ({ ...v })),
      winner: t.winner,
    }));
  }
}

export function createAbTestStore(file: string): AbTestStore {
  return new AbTestStore(file);
}

export function selectVariant(test: AbTest): string {
  if (test.variants.length === 0) return "";
  let best = test.variants[0];
  for (const v of test.variants.slice(1)) {
    if (v.impressions < best.impressions || (v.impressions === best.impressions && v.id < best.id)) {
      best = v;
    }
  }
  return best.id;
}
