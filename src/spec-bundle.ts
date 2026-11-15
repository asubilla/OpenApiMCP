/**
 * Bundling helpers for OpenAPI documents that reference external files over
 * HTTP(S). `bundleDocument` deep-walks a spec and inlines plain-object/schema
 * `$ref`s fetched from absolute http(s) URLs; local refs ("#/...") are left
 * untouched. `extractExternalRefs` lists the unique remote refs in a document,
 * and `rewriteRelativeRefs` absolutizes relative refs against the document's
 * own URL.
 */

export interface BundleOptions {
  timeoutMs?: number;
  maxExternalRefs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_EXTERNAL_REFS = 100;

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HTTP_REF_RE = /^https?:\/\//i;

/** Split an external ref into its URL and JSON-pointer fragment parts. */
function splitRef(ref: string): { url: string; fragment: string | null } {
  const hash = ref.indexOf("#");
  if (hash === -1) return { url: ref, fragment: null };
  return { url: ref.slice(0, hash), fragment: ref.slice(hash + 1) };
}

/** Resolve a JSON pointer fragment (e.g. "/components/schemas/Foo") against a document. */
function resolveJsonPointer(doc: any, fragment: string, url: string): any {
  if (fragment === "") return doc;
  const pointer = fragment.startsWith("/") ? fragment.slice(1) : fragment;
  let current = doc;
  for (const rawSeg of pointer.split("/")) {
    const seg = rawSeg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isPlainObject(current) && !Array.isArray(current)) {
      throw new Error(`bundleDocument: cannot resolve fragment "#${fragment}" in ${url}: segment "${seg}" traverses a non-object`);
    }
    if (!(seg in current)) {
      throw new Error(`bundleDocument: cannot resolve fragment "#${fragment}" in ${url}: missing segment "${seg}"`);
    }
    current = (current as any)[seg];
  }
  return current;
}

/** Collect every unique external http(s) $ref URL in a document, in first-seen order. */
export function extractExternalRefs(doc: any): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (node: any): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isPlainObject(node)) return;
    const ref = node.$ref;
    if (typeof ref === "string" && HTTP_REF_RE.test(ref)) {
      const { url } = splitRef(ref);
      if (!seen.has(url)) {
        seen.add(url);
        out.push(url);
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(doc);
  return out;
}

/**
 * Rewrite relative $refs (e.g. "./fragment.json", "../schema.yaml") to absolute
 * URLs resolved against the directory of `docUrl`. Absolute http(s) refs and
 * local ("#/...") refs are left unchanged. Returns a new document; the input is
 * not mutated.
 */
export function rewriteRelativeRefs(doc: any, docUrl: string): any {
  let base: URL;
  try {
    base = new URL(docUrl);
  } catch {
    throw new Error(`rewriteRelativeRefs: docUrl "${docUrl}" is not a valid absolute URL`);
  }
  const clone = structuredClone(doc);
  const walk = (node: any): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isPlainObject(node)) return;
    const ref = node.$ref;
    if (typeof ref === "string" && !HTTP_REF_RE.test(ref) && !ref.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
      try {
        node.$ref = new URL(ref, base).toString();
      } catch {
        // Leave unresolvable refs untouched.
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(clone);
  return clone;
}

/**
 * Deep-walk `doc` and inline every external (http(s)) $ref whose resolved value
 * is a plain object/schema by replacing it with the fetched object. Local refs
 * ("#/...") are left alone. Refs are fetched through the injected `fetchRef`;
 * each distinct URL is fetched at most once per call (results are cached and
 * reused), and after `opts.maxExternalRefs` fetches (default 100) the bundle
 * aborts with an error. `opts.timeoutMs` (default 10000) bounds each fetch.
 * Throws a descriptive error when a fetch fails or a fragment cannot be
 * resolved. Returns a new document; the input is not mutated.
 */
export async function bundleDocument(
  doc: any,
  fetchRef: (url: string) => Promise<any>,
  opts?: BundleOptions
): Promise<any> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxExternalRefs = opts?.maxExternalRefs ?? DEFAULT_MAX_EXTERNAL_REFS;

  const fetchCache = new Map<string, Promise<any>>();
  const bundleCache = new Map<string, any>();
  const inProgress = new Set<string>();
  let fetchCount = 0;

  const fetchWithTimeout = (url: string): Promise<any> => {
    const cached = fetchCache.get(url);
    if (cached) return cached;
    if (fetchCount >= maxExternalRefs) {
      return Promise.reject(
        new Error(`bundleDocument: exceeded maxExternalRefs limit of ${maxExternalRefs} while fetching ${url}`)
      );
    }
    fetchCount += 1;
    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`bundleDocument: fetching ${url} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      // Do not keep the event loop alive solely for the timeout.
      if (typeof t.unref === "function") t.unref();
    });
    const p = Promise.race([fetchRef(url), timeout]).catch((err: any) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Preserve our own timeout error message, wrap everything else.
      if (msg.startsWith("bundleDocument:")) throw err;
      throw new Error(`bundleDocument: failed to fetch ${url}: ${msg}`);
    });
    fetchCache.set(url, p);
    return p;
  };

  const bundleRef = async (ref: string): Promise<any> => {
    const { url, fragment } = splitRef(ref);
    const cacheKey = fragment === null ? url : `${url}#${fragment}`;
    const cached = bundleCache.get(cacheKey);
    if (cached !== undefined) return structuredClone(cached);
    if (inProgress.has(cacheKey)) {
      // Circular reference through an external file: keep the $ref in place.
      return { $ref: ref };
    }
    inProgress.add(cacheKey);
    try {
      const fetched = await fetchWithTimeout(url);
      const resolved = fragment === null ? fetched : resolveJsonPointer(fetched, fragment, url);
      if (!isPlainObject(resolved)) {
        // Only plain objects/schemas get inlined; anything else keeps the $ref.
        return { $ref: ref };
      }
      const bundled = await walk(structuredClone(resolved));
      bundleCache.set(cacheKey, structuredClone(bundled));
      return bundled;
    } finally {
      inProgress.delete(cacheKey);
    }
  };

  const walk = async (node: any): Promise<any> => {
    if (Array.isArray(node)) {
      const out: any[] = new Array(node.length);
      for (let i = 0; i < node.length; i += 1) out[i] = await walk(node[i]);
      return out;
    }
    if (!isPlainObject(node)) return node;
    const ref = node.$ref;
    if (typeof ref === "string" && HTTP_REF_RE.test(ref)) {
      return bundleRef(ref);
    }
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = await walk(value);
    }
    return out;
  };

  return walk(structuredClone(doc));
}
