/**
 * Helpers for constructing and validating MCP sampling requests.
 */

export interface SamplingMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface SamplingRequest {
  messages: SamplingMessage[];
  modelPreferences?: {
    hints?: { name: string }[];
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
  };
  systemPrompt?: string;
  includeContext?: "none" | "thisServer" | "allServers";
  maxTokens?: number;
  temperature?: number;
}

export function buildSamplingRequest(opts: {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): SamplingRequest {
  const req: SamplingRequest = {
    messages: [{ role: "user", content: { type: "text", text: opts.prompt } }],
  };
  if (opts.systemPrompt !== undefined) req.systemPrompt = opts.systemPrompt;
  if (opts.maxTokens !== undefined) req.maxTokens = opts.maxTokens;
  if (opts.temperature !== undefined) req.temperature = opts.temperature;
  if (opts.model !== undefined) {
    req.modelPreferences = { hints: [{ name: opts.model }] };
  }
  return req;
}

export function validateSamplingRequest(req: SamplingRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!req || typeof req !== "object") {
    errors.push("request must be an object");
    return { valid: false, errors };
  }
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    errors.push("messages must be a non-empty array");
  } else {
    req.messages.forEach((msg, index) => {
      if (!msg || typeof msg !== "object") {
        errors.push(`messages[${index}] must be an object`);
        return;
      }
      if (msg.role !== "user" && msg.role !== "assistant") {
        errors.push(`messages[${index}].role must be "user" or "assistant"`);
      }
      if (!msg.content || typeof msg.content !== "object") {
        errors.push(`messages[${index}].content must be an object`);
        return;
      }
      if (msg.content.type !== "text" || typeof msg.content.text !== "string") {
        errors.push(`messages[${index}].content must be text with a string text field`);
      }
    });
  }
  if (req.maxTokens !== undefined) {
    if (typeof req.maxTokens !== "number" || !Number.isFinite(req.maxTokens) || req.maxTokens <= 0) {
      errors.push("maxTokens must be a positive number");
    }
  }
  if (req.temperature !== undefined) {
    if (typeof req.temperature !== "number" || !Number.isFinite(req.temperature)) {
      errors.push("temperature must be a number");
    }
  }
  if (req.includeContext !== undefined) {
    if (req.includeContext !== "none" && req.includeContext !== "thisServer" && req.includeContext !== "allServers") {
      errors.push("includeContext must be one of none, thisServer, allServers");
    }
  }
  return { valid: errors.length === 0, errors };
}

export function formatSamplingRequest(req: SamplingRequest): string {
  return JSON.stringify(req, null, 2);
}
