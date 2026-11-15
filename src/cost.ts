/**
 * Lightweight cost tracking for LLM-backed tool calls.
 *
 * Pricing is approximate 2025 USD pricing per 1,000 tokens. Everything here is
 * dependency-free and in-memory.
 */

export interface CostEntry {
  tool: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  time: string;
}

export interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01 },
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "gpt-4-turbo": { inputPer1k: 0.01, outputPer1k: 0.03 },
  "claude-3-5-sonnet": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "claude-3-5-haiku": { inputPer1k: 0.0008, outputPer1k: 0.004 },
  "claude-3-opus": { inputPer1k: 0.015, outputPer1k: 0.075 },
  "gemini-1.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.005 },
  "gemini-1.5-flash": { inputPer1k: 0.000075, outputPer1k: 0.0003 },
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function lookupPrice(model: string): ModelPricing | undefined {
  const key = Object.keys(MODEL_PRICING).find(
    (k) => k.toLowerCase() === model.toLowerCase(),
  );
  return key ? MODEL_PRICING[key] : undefined;
}

export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = lookupPrice(model);
  if (!pricing) return 0;
  return (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;
}

export class CostTracker {
  private readonly entries: CostEntry[] = [];

  constructor() {}

  record(entry: Omit<CostEntry, "costUsd" | "time"> & { costUsd?: number; time?: string }): void {
    const costUsd =
      entry.costUsd !== undefined ? entry.costUsd : computeCost(entry.model, entry.inputTokens, entry.outputTokens);
    const time = entry.time !== undefined ? entry.time : new Date().toISOString();
    this.entries.push({
      tool: entry.tool,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costUsd,
      time,
    });
  }

  summary(): {
    totalCostUsd: number;
    totalCalls: number;
    byTool: Record<string, { calls: number; costUsd: number }>;
    byModel: Record<string, { calls: number; costUsd: number }>;
  } {
    const byTool: Record<string, { calls: number; costUsd: number }> = {};
    const byModel: Record<string, { calls: number; costUsd: number }> = {};
    let totalCostUsd = 0;
    for (const e of this.entries) {
      totalCostUsd += e.costUsd;
      if (!byTool[e.tool]) byTool[e.tool] = { calls: 0, costUsd: 0 };
      byTool[e.tool].calls += 1;
      byTool[e.tool].costUsd += e.costUsd;
      if (!byModel[e.model]) byModel[e.model] = { calls: 0, costUsd: 0 };
      byModel[e.model].calls += 1;
      byModel[e.model].costUsd += e.costUsd;
    }
    const round = (n: number): number => Number(n.toFixed(10));
    totalCostUsd = round(totalCostUsd);
    for (const k of Object.keys(byTool)) byTool[k].costUsd = round(byTool[k].costUsd);
    for (const k of Object.keys(byModel)) byModel[k].costUsd = round(byModel[k].costUsd);
    return { totalCostUsd, totalCalls: this.entries.length, byTool, byModel };
  }

  render(): string {
    const s = this.summary();
    const lines: string[] = [];
    lines.push("Tool               Calls  Cost");
    lines.push("------------------ -----  --------");
    const tools = Object.keys(s.byTool).sort();
    for (const tool of tools) {
      const agg = s.byTool[tool];
      lines.push(`${tool.padEnd(18)} ${String(agg.calls).padStart(5)}  ${formatCost(agg.costUsd)}`);
    }
    lines.push("------------------ -----  --------");
    lines.push(`${"Total".padEnd(18)} ${String(s.totalCalls).padStart(5)}  ${formatCost(s.totalCostUsd)}`);
    return lines.join("\n");
  }
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}