type Tree = { [key: string]: Tree };

/**
 * Keep only the requested fields in a JSON response. Supports dotted paths
 * (`category.name`), nested objects, and arrays of objects. A path that lands on
 * an object keeps that whole subtree, which is handy for large nested payloads.
 */
export function filterFields(value: any, fields: string[] | undefined): any {
  if (!fields || fields.length === 0) return value;
  return prune(value, buildTree(fields));
}

function buildTree(fields: string[]): Tree {
  const root: Tree = {};
  for (const field of fields) {
    const parts = field.split(".").map((part) => part.trim()).filter(Boolean);
    let node = root;
    for (const part of parts) {
      node[part] ??= {};
      node = node[part];
    }
  }
  return root;
}

function prune(value: any, tree: Tree): any {
  if (Array.isArray(value)) return value.map((item) => prune(item, tree));
  if (value && typeof value === "object") {
    const keys = Object.keys(tree);
    if (keys.length === 0) return value;
    const out: Record<string, any> = {};
    for (const key of keys) if (key in value) out[key] = prune(value[key], tree[key]);
    return out;
  }
  return value;
}
