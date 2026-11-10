/**
 * Convert a Postman collection into a flat list of operations.
 *
 * Collections nest folders under `item[]`, so the walker recurses into any item
 * that has its own `item[]` and emits an operation for every leaf that carries a
 * `request`. Requests may be a plain URL string or an object with `method` and
 * `url` (string, `{ raw }`, or `{ path[] }`). Everything is normalized to a path
 * beginning with `/`.
 */

export interface PostmanOperation {
  name: string;
  method: string;
  path: string;
  description?: string;
}

export function postmanToOperations(collection: any): PostmanOperation[] {
  const out: PostmanOperation[] = [];

  const visit = (items: any): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item.item)) {
        visit(item.item);
        continue;
      }
      if (item.request === undefined) continue;

      const request = item.request;
      let method = "GET";
      let url: any;
      let description: string | undefined;

      if (typeof request === "string") {
        url = request;
      } else if (request && typeof request === "object") {
        method = typeof request.method === "string" ? request.method : "GET";
        url = request.url;
        description = typeof request.description === "string" ? request.description : undefined;
      } else {
        continue;
      }

      const operation: PostmanOperation = {
        name: typeof item.name === "string" ? item.name : String(item.name ?? ""),
        method: method.toUpperCase(),
        path: normalizePath(url)
      };
      if (description !== undefined) operation.description = description;
      out.push(operation);
    }
  };

  visit(collection?.item);
  return out;
}

function normalizePath(url: any): string {
  if (url === undefined || url === null) return "/";
  if (typeof url === "string") return pathFromRaw(url);
  if (Array.isArray(url.path)) {
    const joined = url.path.map(String).filter((part: string) => part !== "").join("/");
    return ensureLeadingSlash(stripQuery(joined));
  }
  if (typeof url.raw === "string") return pathFromRaw(url.raw);
  if (typeof url.path === "string") return ensureLeadingSlash(stripQuery(url.path));
  return "/";
}

function pathFromRaw(raw: string): string {
  let text = raw.trim();
  const scheme = text.indexOf("://");
  if (scheme !== -1) {
    const afterScheme = text.slice(scheme + 3);
    const slash = afterScheme.indexOf("/");
    text = slash === -1 ? "/" : afterScheme.slice(slash);
  } else if (!text.startsWith("/")) {
    const slash = text.indexOf("/");
    if (slash !== -1) text = text.slice(slash);
  }
  return ensureLeadingSlash(stripQuery(text));
}

function stripQuery(text: string): string {
  let out = text;
  const hash = out.indexOf("#");
  if (hash !== -1) out = out.slice(0, hash);
  const query = out.indexOf("?");
  if (query !== -1) out = out.slice(0, query);
  return out;
}

function ensureLeadingSlash(text: string): string {
  if (!text) return "/";
  return text.startsWith("/") ? text : "/" + text;
}
