import type { ToolDef } from "./types.js";

/** Name of the progressive-disclosure meta tool used to find operations. */
export const TOOL_SEARCH_NAME = "search_tools";

/** Name of the progressive-disclosure meta tool used to invoke an operation. */
export const TOOL_CALL_NAME = "call_tool";

const NAME_WEIGHT = 3;
const TAG_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;
const DEFAULT_LIMIT = 15;

/**
 * Tokenize a free-text query: lowercase and split on any run of non
 * alphanumeric characters. Duplicate tokens are collapsed so a repeated word
 * does not inflate a score.
 */
function tokenize(query: string): string[] {
  if (typeof query !== "string" || query.length === 0) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

/**
 * Score a single tool by weighted token overlap. Each query token contributes
 * its weight once per field it appears in: name (3), any tag (2), description
 * (1). Matching is a case-insensitive substring test.
 */
function scoreTool(tool: ToolDef, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const name = (tool.name ?? "").toLowerCase();
  const tags = (tool.tags ?? []).map((tag) => String(tag).toLowerCase());
  const description = (tool.description ?? "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += NAME_WEIGHT;
    if (tags.some((tag) => tag.includes(token))) score += TAG_WEIGHT;
    if (description.includes(token)) score += DESCRIPTION_WEIGHT;
  }
  return score;
}

/** Compare names lexicographically (ASCII) so ordering is locale independent. */
function compareName(a: ToolDef, b: ToolDef): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/**
 * Rank tools against a search query. Tools are ordered by descending weighted
 * score, then by ascending name for stable ties. An empty query (or a query
 * with no alphanumeric characters) yields the first `limit` tools by name.
 */
export function rankTools(tools: ToolDef[], query: string, limit: number = DEFAULT_LIMIT): ToolDef[] {
  const tokens = tokenize(query);
  const max = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : DEFAULT_LIMIT;

  return tools
    .map((tool, index) => ({ tool, index, score: scoreTool(tool, tokens) }))
    .sort((a, b) => b.score - a.score || compareName(a.tool, b.tool) || a.index - b.index)
    .slice(0, max)
    .map((entry) => entry.tool);
}

/**
 * Describe the two progressive-disclosure tools so a model knows to search for
 * an API operation first and then invoke it by its exact tool name.
 */
export function describeProgressiveTools(): {
  search: { name: string; description: string };
  call: { name: string; description: string };
} {
  return {
    search: {
      name: TOOL_SEARCH_NAME,
      description:
        "Search the available API operations by keyword. Use this when you do not know the exact tool name for an operation. " +
        "Pass a short query (for example an HTTP verb, resource, or phrase) and pick the best matching operation, then run it with " +
        `${TOOL_CALL_NAME}.`,
    },
    call: {
      name: TOOL_CALL_NAME,
      description:
        `Call an API operation by its exact tool name, passing the operation's arguments as the request body. ` +
        `Always use ${TOOL_SEARCH_NAME} first to find the operation name and its expected arguments.`,
    },
  };
}
