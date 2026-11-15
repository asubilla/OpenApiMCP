import type { ToolDef } from "./types.js";
import { rankTools } from "./toolsearch.js";

export interface EvalCase {
  query: string;
  expectedTool: string;
}

export interface EvalResult {
  query: string;
  expected: string;
  actual: string | null;
  passed: boolean;
  score: number;
}

export interface EvalReport {
  total: number;
  passed: number;
  accuracy: number;
  results: EvalResult[];
}

export function evaluateToolSelection(tools: ToolDef[], cases: EvalCase[]): EvalReport {
  const results: EvalResult[] = [];
  let passed = 0;
  for (const c of cases) {
    const ranked = rankTools(tools, c.query, 1);
    const actual = ranked.length > 0 ? ranked[0].name : null;
    const ok = actual === c.expectedTool;
    if (ok) passed++;
    results.push({
      query: c.query,
      expected: c.expectedTool,
      actual,
      passed: ok,
      score: ok ? 1 : 0,
    });
  }
  const total = cases.length;
  const accuracy = total === 0 ? 0 : passed / total;
  return { total, passed, accuracy, results };
}

export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(
    `Eval: ${report.passed}/${report.total} passed (Accuracy: ${(report.accuracy * 100).toFixed(1)}%)`,
  );
  for (const r of report.results) {
    lines.push(
      `${r.passed ? "PASS" : "FAIL"}: "${r.query}" expected=${r.expected} actual=${r.actual ?? "null"} score=${r.score}`,
    );
  }
  return lines.join("\n");
}