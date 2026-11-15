// Marketplace helpers for discovering public OpenAPI specs via APIs.guru.

export interface MarketplaceApi {
  name: string;
  description?: string;
  specUrl: string;
  categories?: string[];
}

const DEFAULT_BASE_URL = "https://api.apis.guru";
const DEFAULT_LIMIT = 20;

function normalizeBaseUrl(baseUrl?: string): string {
  const value = String(baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return value || DEFAULT_BASE_URL;
}

function listUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v2/list.json`;
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined || limit === null) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(0, Math.trunc(limit));
}

function pickVersion(entry: any): any {
  if (!entry || typeof entry !== "object") return entry;
  const versions = entry.versions;
  if (versions && typeof versions === "object" && !Array.isArray(versions)) {
    const preferred = entry.preferred ?? entry.preferredVersion ?? entry.latest ?? entry.defaultVersion;
    if (preferred != null && versions[preferred] && typeof versions[preferred] === "object") {
      return versions[preferred];
    }
    const keys = Object.keys(versions);
    if (keys.length > 0) return versions[keys[keys.length - 1]];
  }
  return entry;
}

function extractSpecUrl(version: any): string | undefined {
  if (!version || typeof version !== "object") return undefined;
  const url =
    version.swaggerUrl ??
    version.openapiUrl ??
    version.specUrl ??
    version.swaggerYamlUrl ??
    version.openapiYamlUrl ??
    version.url;
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

function extractCategories(info: any): string[] | undefined {
  const raw =
    info?.["x-apisguru-categories"] ??
    info?.categories ??
    info?.tags;
  if (!Array.isArray(raw)) return undefined;
  const cats = raw.map((c: any) => String(c)).filter((c) => c.length > 0);
  return cats.length > 0 ? cats : undefined;
}

function toMarketplaceApi(name: string, entry: any): MarketplaceApi | null {
  const version = pickVersion(entry);
  const info = (version && typeof version === "object" && version.info) || (entry && entry.info) || {};
  const specUrl = extractSpecUrl(version) ?? extractSpecUrl(entry);
  if (!specUrl) return null;
  const api: MarketplaceApi = { name, specUrl };
  if (typeof info.description === "string" && info.description.length > 0) {
    api.description = info.description;
  }
  const categories = extractCategories(info);
  if (categories) api.categories = categories;
  return api;
}

function matchesQuery(api: MarketplaceApi, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (api.name.toLowerCase().includes(q)) return true;
  if (api.description && api.description.toLowerCase().includes(q)) return true;
  if (api.categories && api.categories.some((c) => c.toLowerCase().includes(q))) return true;
  return false;
}

function findEntry(data: any, name: string): any {
  if (!data || typeof data !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(data, name)) return data[name];
  for (const [key, value] of Object.entries(data)) {
    if (key === name) return value;
    if (value && typeof value === "object" && (((value as any).name === name) || ((value as any).id === name))) return value;
  }
  return undefined;
}

export async function searchApisGuru(query: string, limit?: number, baseUrl?: string): Promise<MarketplaceApi[]> {
  const max = normalizeLimit(limit);
  const q = String(query ?? "").trim();
  try {
    const res = await fetch(listUrl(baseUrl));
    if (!res.ok) return [];
    const data = await res.json();
    const result: MarketplaceApi[] = [];
    if (Array.isArray(data)) {
      for (const item of data) {
        const name = typeof item?.name === "string" ? item.name : (typeof item?.id === "string" ? item.id : "");
        if (!name) continue;
        const api = toMarketplaceApi(name, item);
        if (!api) continue;
        if (!matchesQuery(api, q)) continue;
        result.push(api);
        if (result.length >= max) break;
      }
    } else if (data && typeof data === "object") {
      for (const [key, value] of Object.entries(data)) {
        const name = typeof (value as any)?.name === "string" ? (value as any).name : key;
        const api = toMarketplaceApi(name, value);
        if (!api) continue;
        if (!matchesQuery(api, q)) continue;
        result.push(api);
        if (result.length >= max) break;
      }
    }
    return result.slice(0, max);
  } catch {
    return [];
  }
}

export async function getSpecFromApisGuru(name: string, baseUrl?: string): Promise<{ url: string; spec: any } | null> {
  try {
    const res = await fetch(listUrl(baseUrl));
    if (!res.ok) return null;
    const data = await res.json();
    const entry = findEntry(data, name);
    if (!entry) return null;
    const version = pickVersion(entry);
    const specUrl = extractSpecUrl(version) ?? extractSpecUrl(entry);
    if (!specUrl) return null;
    const res2 = await fetch(specUrl);
    if (!res2.ok) return null;
    const text = await res2.text();
    let spec: any;
    try {
      spec = JSON.parse(text);
    } catch {
      return null;
    }
    const dereferenced = dereferenceSpec(spec);
    return { url: specUrl, spec: dereferenced };
  } catch {
    return null;
  }
}

function dereferenceSpec(spec: any): any {
  const root = spec;
  function resolvePointer(pointer: string): any {
    const parts = pointer.replace(/^#\/?/, "").split("/").map((part) => {
      try {
        return decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"));
      } catch {
        return part;
      }
    });
    let current: any = root;
    for (const part of parts) {
      if (current === null || typeof current !== "object") return undefined;
      current = current[part];
    }
    return current;
  }
  function transform(node: any, stack: Set<string>): any {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item) => transform(item, stack));
    if (typeof node.$ref === "string" && node.$ref.startsWith("#")) {
      const ref = node.$ref;
      if (stack.has(ref)) return node;
      const target = resolvePointer(ref);
      if (target === undefined) return node;
      const nextStack = new Set(stack);
      nextStack.add(ref);
      return transform(target, nextStack);
    }
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = transform(value, stack);
    }
    return out;
  }
  return transform(spec, new Set());
}

export function formatMarketplaceList(apis: MarketplaceApi[]): string {
  const rows = (apis ?? []).map((api) => [
    String(api?.name ?? ""),
    String(api?.description ?? "").slice(0, 60),
    String(api?.specUrl ?? ""),
  ]);
  const header = ["NAME", "DESCRIPTION", "SPEC URL"];
  const all = [header, ...rows];
  const widths = header.map((h, column) =>
    Math.max(h.length, ...all.map((row) => (row[column] ?? "").length), 0)
  );
  const formatRow = (row: string[]) =>
    row.map((cell, column) => (cell ?? "").padEnd(widths[column])).join("  ").replace(/\s+$/, "");
  const lines: string[] = [];
  lines.push(formatRow(header));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) lines.push(formatRow(row));
  return lines.join("\n");
}
