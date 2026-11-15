/**
 * Lightweight workflow helpers: describe a sequence of tool calls, resolve
 * `{{...}}` placeholders against a shared context, validate the definition,
 * and render it as human-readable text.
 */

export interface WorkflowStep {
  tool: string;
  args?: Record<string, unknown>;
  saveAs?: string;
  condition?: string;
}

export interface Workflow {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface WorkflowContext {
  results: Record<string, unknown>;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function createWorkflowContext(): WorkflowContext {
  const results: Record<string, unknown> = {};

  function traverse(root: unknown, segments: string[]): unknown {
    let current: unknown = root;
    for (const segment of segments) {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) {
        const index = Number(segment);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
        current = current[index];
      } else if (typeof current === "object") {
        const obj = current as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(obj, segment)) {
          current = obj[segment];
        } else if (segment === "result") {
          // Tolerate both wrapped ({ result: ... }) and unwrapped step results.
          continue;
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    }
    return current;
  }

  function get(key: string): unknown {
    const segments = String(key).split(".").filter((part) => part.length > 0);
    const withoutResults = segments[0] === "results" ? segments.slice(1) : segments;
    return traverse(results, withoutResults);
  }

  function set(key: string, value: unknown): void {
    const segments = String(key).split(".").filter((part) => part.length > 0);
    if (segments.length === 0) return;
    if (segments.length === 1) {
      results[segments[0]] = value;
      return;
    }
    // Support dotted keys by creating intermediate objects.
    let current: Record<string, unknown> = results;
    for (let i = 0; i < segments.length - 1; i++) {
      const part = segments[i];
      if (!isPlainObject(current[part])) current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]] = value;
  }

  return { results, get, set };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveValue(value: unknown, ctx: WorkflowContext): unknown {
  if (typeof value === "string") {
    const single = value.match(/^\{\{\s*(.+?)\s*\}\}$/);
    if (single) {
      const resolved = ctx.get(single[1]);
      return resolved === undefined ? value : resolved;
    }
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
      const resolved = ctx.get(expr);
      if (resolved === undefined) return `{{${expr}}}`;
      if (resolved === null) return "null";
      if (typeof resolved === "object") {
        try {
          return JSON.stringify(resolved);
        } catch {
          return String(resolved);
        }
      }
      return String(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, ctx));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = resolveValue(child, ctx);
    }
    return out;
  }
  return value;
}

export function resolveArgs(step: WorkflowStep, ctx: WorkflowContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!step.args || typeof step.args !== "object" || Array.isArray(step.args)) return out;
  for (const [key, value] of Object.entries(step.args)) {
    out[key] = resolveValue(value, ctx);
  }
  return out;
}

export function validateWorkflow(wf: Workflow): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!wf || typeof wf !== "object" || Array.isArray(wf)) {
    return { valid: false, errors: ["workflow must be an object"] };
  }
  if (!Array.isArray(wf.steps)) {
    errors.push("steps must be an array");
    return { valid: false, errors };
  }
  if (wf.steps.length === 0) {
    errors.push("steps must not be empty");
  }
  const seenSaveAs = new Set<string>();
  wf.steps.forEach((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      errors.push(`step ${index} must be an object`);
      return;
    }
    if (typeof step.tool !== "string" || step.tool.trim() === "") {
      errors.push(`step ${index} must have a tool`);
    }
    if (step.saveAs !== undefined) {
      if (typeof step.saveAs !== "string" || step.saveAs.trim() === "") {
        errors.push(`step ${index} has an invalid saveAs`);
      } else if (seenSaveAs.has(step.saveAs)) {
        errors.push(`duplicate saveAs: ${step.saveAs}`);
      } else {
        seenSaveAs.add(step.saveAs);
      }
    }
  });
  return { valid: errors.length === 0, errors };
}

export function formatWorkflow(wf: Workflow): string {
  const lines: string[] = [];
  lines.push(`Workflow: ${wf?.name ?? ""}`);
  if (wf?.description) lines.push(wf.description);
  lines.push("Steps:");
  const steps = Array.isArray(wf?.steps) ? wf.steps : [];
  steps.forEach((step, index) => {
    let line = `${index + 1}. ${step?.tool ?? "(unknown)"}`;
    if (step?.saveAs) line += ` (saveAs: ${step.saveAs})`;
    if (step?.condition) line += ` [if ${step.condition}]`;
    if (step?.args && Object.keys(step.args).length > 0) {
      line += ` args=${JSON.stringify(step.args)}`;
    }
    lines.push(line);
  });
  return lines.join("\n");
}
