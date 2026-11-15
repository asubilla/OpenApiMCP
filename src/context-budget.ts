/**
 * Helpers for keeping text within an LLM context budget.
 *
 * Budgets are expressed in tokens; text is estimated with a simple
 * characters-per-token heuristic. Everything here is dependency-free.
 */

export interface BudgetOptions {
  maxTokens?: number;
  reservedTokens?: number;
  charsPerToken?: number;
}

const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_RESERVED_TOKENS = 1000;
const DEFAULT_CHARS_PER_TOKEN = 4;

const TRIM_MARKER = "\n... [trimmed to fit context budget]";

interface ResolvedBudget {
  maxTokens: number;
  reservedTokens: number;
  charsPerToken: number;
  budget: number;
}

function resolve(opts?: BudgetOptions): ResolvedBudget {
  const maxTokens = opts?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const reservedTokens = opts?.reservedTokens ?? DEFAULT_RESERVED_TOKENS;
  const charsPerToken = opts?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  return { maxTokens, reservedTokens, charsPerToken, budget: maxTokens - reservedTokens };
}

export function estimateTokens(text: string, charsPerToken?: number): number {
  const cpt = charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  return Math.max(1, Math.ceil(text.length / cpt));
}

export function fitsInBudget(text: string, opts?: BudgetOptions): boolean {
  const { charsPerToken, budget } = resolve(opts);
  return estimateTokens(text, charsPerToken) <= budget;
}

export function trimToBudget(
  text: string,
  opts?: BudgetOptions,
): { text: string; truncated: boolean; originalTokens: number; finalTokens: number } {
  const { charsPerToken, budget } = resolve(opts);
  const originalTokens = estimateTokens(text, charsPerToken);

  if (originalTokens <= budget) {
    return { text, truncated: false, originalTokens, finalTokens: originalTokens };
  }

  // Binary search for the largest prefix that still fits once the marker is appended.
  let lo = 0;
  let hi = text.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = text.slice(0, mid) + TRIM_MARKER;
    if (estimateTokens(candidate, charsPerToken) <= budget) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const finalText = text.slice(0, best) + TRIM_MARKER;
  const finalTokens = estimateTokens(finalText, charsPerToken);
  return { text: finalText, truncated: true, originalTokens, finalTokens };
}

export function budgetReport(
  text: string,
  opts?: BudgetOptions,
): { fits: boolean; tokens: number; budget: number; utilization: number } {
  const { charsPerToken, budget } = resolve(opts);
  const tokens = estimateTokens(text, charsPerToken);
  const fits = tokens <= budget;
  const utilization = budget > 0 ? tokens / budget : tokens === 0 ? 0 : Infinity;
  return { fits, tokens, budget, utilization };
}