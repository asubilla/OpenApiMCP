/**
 * Minimal implementation of the OpenAPI Overlay specification.
 *
 * An overlay is `{ actions: [{ target, update?, remove? }] }` where `target` is
 * a JSONPath-ish pointer such as `$.info` or `$.paths['/pets'].get`. `update`
 * deep-merges into the target and `remove: true` deletes it. Inputs are never
 * mutated: a fresh, patched clone is returned.
 */

export function applyOverlay(spec: any, overlay: any): any {
  const root = structuredClone(spec);
  const actions = Array.isArray(overlay?.actions) ? overlay.actions : [];

  for (const action of actions) {
    if (!action || typeof action.target !== "string") continue;
    const tokens = parsePointer(action.target);
    if (tokens.length === 0) continue;

    if (action.remove === true) {
      const parent = walk(root, tokens.slice(0, -1), false);
      if (parent && typeof parent === "object") delete parent[tokens[tokens.length - 1]];
      continue;
    }

    if (action.update === undefined) continue;

    const parent = walk(root, tokens.slice(0, -1), true);
    if (!parent || typeof parent !== "object") continue;
    const key = tokens[tokens.length - 1];
    if (isPlainObject(parent[key]) && isPlainObject(action.update)) {
      parent[key] = deepMerge(parent[key], action.update);
    } else {
      parent[key] = structuredClone(action.update);
    }
  }

  return root;
}

/** Walk `tokens` from `root`, optionally creating missing plain-object nodes. */
function walk(root: any, tokens: string[], create: boolean): any {
  let node = root;
  for (const token of tokens) {
    if (!node || typeof node !== "object") return undefined;
    if (isPlainObject(node[token])) {
      node = node[token];
      continue;
    }
    if (create) {
      if (node[token] === undefined || !isPlainObject(node[token])) {
        node[token] = {};
      }
      node = node[token];
      continue;
    }
    return undefined;
  }
  return node;
}

function deepMerge(target: any, source: any): any {
  if (!isPlainObject(target) || !isPlainObject(source)) return structuredClone(source);
  const out: Record<string, any> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : structuredClone(value);
  }
  return out;
}

function isPlainObject(value: any): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse a supported subset of JSONPath into path segments:
 * `$`, dot-separated keys (`.a.b`) and bracketed keys (`['a/b']`).
 */
function parsePointer(pointer: string): string[] {
  let text = pointer.trim();
  if (text.startsWith("$")) text = text.slice(1);

  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ".") {
      i++;
      continue;
    }
    if (ch === "[") {
      const quote = text[i + 1];
      if (quote === "'" || quote === '"') {
        let j = i + 2;
        let buf = "";
        while (j < text.length && text[j] !== quote) buf += text[j++];
        if (text[j] !== quote) throw new Error(`invalid overlay target: ${pointer}`);
        tokens.push(buf);
        i = j + 1;
        if (text[i] === "]") i++;
        else throw new Error(`invalid overlay target: ${pointer}`);
      } else {
        let j = i + 1;
        let buf = "";
        while (j < text.length && text[j] !== "]") buf += text[j++];
        tokens.push(buf.trim());
        i = j + 1;
      }
      continue;
    }
    let buf = "";
    while (i < text.length && text[i] !== "." && text[i] !== "[") buf += text[i++];
    if (buf) tokens.push(buf);
  }
  return tokens;
}
