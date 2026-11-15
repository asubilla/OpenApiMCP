import { pathToFileURL } from "node:url";

export interface HookRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HookResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export interface PluginHook {
  name: string;
  beforeRequest?: (req: HookRequest) => Record<string, string> | void;
  afterResponse?: (req: HookRequest, res: HookResponse) => void;
}

/**
 * Run every hook's `beforeRequest` in order, merging any returned headers into
 * the request. Hooks that return `undefined` leave the request unchanged.
 * Returns a new request object; the input is not mutated.
 */
export function runBeforeRequest(hooks: PluginHook[], req: HookRequest): HookRequest {
  const out: HookRequest = {
    method: req.method,
    url: req.url,
    headers: { ...req.headers }
  };
  if (req.body !== undefined) out.body = req.body;

  for (const hook of hooks) {
    if (typeof hook.beforeRequest !== "function") continue;
    let returned: Record<string, string> | void;
    try {
      returned = hook.beforeRequest(out);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`plugin hook "${hook.name}" beforeRequest failed: ${detail}`);
    }
    if (returned === undefined) continue;
    if (returned === null || typeof returned !== "object" || Array.isArray(returned)) {
      throw new Error(`plugin hook "${hook.name}" beforeRequest must return a headers object or undefined`);
    }
    for (const [key, value] of Object.entries(returned)) {
      out.headers[key] = String(value);
    }
  }

  return out;
}

/** Run every hook's `afterResponse` in order. */
export function runAfterResponse(hooks: PluginHook[], req: HookRequest, res: HookResponse): void {
  for (const hook of hooks) {
    if (typeof hook.afterResponse !== "function") continue;
    try {
      hook.afterResponse(req, res);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`plugin hook "${hook.name}" afterResponse failed: ${detail}`);
    }
  }
}

/** Validate an unknown value as a PluginHook. */
export function validatePlugin(plugin: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (plugin === null || typeof plugin !== "object" || Array.isArray(plugin)) {
    errors.push("plugin must be an object");
    return { valid: false, errors };
  }

  const candidate = plugin as Record<string, unknown>;

  if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
    errors.push("plugin must have a non-empty string name");
  }

  if (candidate.beforeRequest !== undefined && typeof candidate.beforeRequest !== "function") {
    errors.push("beforeRequest must be a function when provided");
  }

  if (candidate.afterResponse !== undefined && typeof candidate.afterResponse !== "function") {
    errors.push("afterResponse must be a function when provided");
  }

  return { valid: errors.length === 0, errors };
}

function toImportSpecifier(modulePath: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(modulePath) || modulePath.startsWith("data:")) {
    return modulePath;
  }
  return pathToFileURL(modulePath).href;
}

/**
 * Dynamically import a plugin module. The module must either export a
 * `hooks: PluginHook[]` array, or default-export a single PluginHook (which is
 * wrapped into a one-element array). Throws with a clear message on failure.
 */
export async function loadPlugin(modulePath: string): Promise<PluginHook[]> {
  const specifier = toImportSpecifier(modulePath);

  let mod: Record<string, unknown>;
  try {
    mod = (await import(specifier)) as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to load plugin from "${modulePath}": ${detail}`);
  }

  let hooksArray: unknown[];
  if (mod.hooks !== undefined) {
    if (!Array.isArray(mod.hooks)) {
      throw new Error(`plugin module "${modulePath}" exports "hooks" but it is not an array`);
    }
    hooksArray = mod.hooks;
  } else if (mod.default !== undefined) {
    hooksArray = [mod.default];
  } else {
    throw new Error(`plugin module "${modulePath}" must export "hooks" (PluginHook[]) or a default-exported PluginHook`);
  }

  const result: PluginHook[] = [];
  for (let i = 0; i < hooksArray.length; i++) {
    const check = validatePlugin(hooksArray[i]);
    if (!check.valid) {
      throw new Error(`plugin module "${modulePath}" has invalid hook at index ${i}: ${check.errors.join("; ")}`);
    }
    result.push(hooksArray[i] as PluginHook);
  }

  return result;
}
