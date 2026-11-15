import type { ToolDef } from "./types.js";

export interface ToolCondition {
  tool: string;
  roles?: string[];
  contexts?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ConditionContext {
  roles?: string[];
  attributes?: Record<string, unknown>;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

export function evaluateCondition(condition: ToolCondition, ctx: ConditionContext): boolean {
  if (condition.enabled === false) return false;
  if (condition.roles && condition.roles.length > 0) {
    const ctxRoles = ctx.roles ?? [];
    const intersects = condition.roles.some((role) => ctxRoles.includes(role));
    if (!intersects) return false;
  }
  if (condition.contexts) {
    const attrs = ctx.attributes ?? {};
    for (const key of Object.keys(condition.contexts)) {
      if (!deepEqual(condition.contexts[key], attrs[key])) return false;
    }
  }
  return true;
}

export function buildConditionMap(conditions: ToolCondition[]): Map<string, ToolCondition> {
  const map = new Map<string, ToolCondition>();
  for (const condition of conditions) {
    map.set(condition.tool, condition);
  }
  return map;
}

export function filterToolsByContext(
  tools: ToolDef[],
  conditions: ToolCondition[],
  ctx: ConditionContext
): ToolDef[] {
  const map = buildConditionMap(conditions);
  return tools.filter((tool) => {
    const condition = map.get(tool.name);
    if (!condition) return true;
    return evaluateCondition(condition, ctx);
  });
}
