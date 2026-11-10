import type { ToolDef } from "./types.js";

export interface Policy {
  /** Tool names (glob) that are allowed. When set, everything else is denied. */
  allow?: string[];
  /** Tool names (glob) that are denied. Takes precedence over `allow`. */
  deny?: string[];
  /** Allowed HTTP methods (e.g. ["GET", "POST"]). */
  methods?: string[];
  /** Allowed outbound hosts. Supports exact names and `*.example.com` wildcards. */
  hosts?: string[];
}

/** Validate a policy object (from a JSON file) and return it normalized. */
export function loadPolicy(input: unknown): Policy {
  if (input == null || typeof input !== "object") throw new Error("policy must be a JSON object");
  const raw = input as Record<string, unknown>;
  const pick = (key: string): string[] | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      throw new Error(`policy.${key} must be an array of strings`);
    }
    return value as string[];
  };
  return { allow: pick("allow"), deny: pick("deny"), methods: pick("methods"), hosts: pick("hosts") };
}

const globCache = new Map<string, RegExp>();

function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const regexp = new RegExp(`^${pattern}$`, "i");
  globCache.set(glob, regexp);
  return regexp;
}

/** Whether a tool passes the policy's name/method rules (build-time filter). */
export function toolAllowed(policy: Policy, tool: ToolDef): boolean {
  if (policy.methods?.length) {
    const allowed = policy.methods.map((m) => m.toUpperCase());
    if (!allowed.includes(tool.method.toUpperCase())) return false;
  }
  if (policy.deny?.length && policy.deny.some((glob) => globToRegExp(glob).test(tool.name))) return false;
  if (policy.allow?.length && !policy.allow.some((glob) => globToRegExp(glob).test(tool.name))) return false;
  return true;
}

/** Whether an outbound hostname is permitted by the policy. */
export function hostAllowed(policy: Policy, hostname: string): boolean {
  if (!policy.hosts?.length) return true;
  const host = hostname.toLowerCase();
  return policy.hosts.some((pattern) => {
    const candidate = pattern.toLowerCase();
    if (candidate.startsWith("*.")) {
      const base = candidate.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    return host === candidate;
  });
}

/** Call-time enforcement (defense in depth): returns a reason string when blocked. */
export function checkRequest(policy: Policy, tool: ToolDef, url: string): string | null {
  if (policy.methods?.length) {
    const allowed = policy.methods.map((m) => m.toUpperCase());
    if (!allowed.includes(tool.method.toUpperCase())) return `method ${tool.method.toUpperCase()} blocked by policy`;
  }
  if (policy.hosts?.length) {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return null;
    }
    if (!hostAllowed(policy, hostname)) return `outbound host "${hostname}" not allowed by policy`;
  }
  return null;
}
