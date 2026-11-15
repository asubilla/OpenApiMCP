import { randomUUID } from "node:crypto";

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  skills: {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
  }[];
  authentication?: { schemes: string[] };
}

export function buildAgentCard(opts: {
  name: string;
  description: string;
  url: string;
  version: string;
  skills: {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
  }[];
  capabilities?: AgentCard["capabilities"];
  authSchemes?: string[];
}): AgentCard {
  const card: AgentCard = {
    name: opts.name,
    description: opts.description,
    url: opts.url,
    version: opts.version,
    capabilities: opts.capabilities ?? {},
    skills: opts.skills.map((s) => ({ ...s, tags: s.tags ? [...s.tags] : undefined, examples: s.examples ? [...s.examples] : undefined })),
  };
  if (opts.authSchemes) {
    card.authentication = { schemes: [...opts.authSchemes] };
  }
  return card;
}

export interface A2ATask {
  id: string;
  status: "submitted" | "working" | "completed" | "failed" | "canceled";
  message?: string;
  artifacts?: { name: string; parts: { type: string; text?: string }[] }[];
}

export function createTask(message: string): A2ATask {
  return { id: randomUUID(), status: "submitted", message };
}

export function updateTaskStatus(task: A2ATask, status: A2ATask["status"], message?: string): A2ATask {
  const updated: A2ATask = { ...task, status };
  if (message !== undefined) updated.message = message;
  return updated;
}

export function formatAgentCard(card: AgentCard): string {
  return JSON.stringify(card, null, 2);
}
