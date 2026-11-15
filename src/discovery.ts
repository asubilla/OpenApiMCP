// Discovery helpers for locating an OpenAPI/Swagger spec from a domain or origin.

export const SPEC_PATHS: string[] = [
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/swagger/v1/swagger.json",
  "/api-docs",
  "/v3/api-docs",
  "/docs/openapi.json",
  "/api/openapi.json",
  "/openapi/v3.json",
];

export function normalizeDomain(input: string): string {
  let value = String(input ?? "").trim();
  if (!value) return "https://";
  if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(value)) {
    value = "https://" + value;
  }
  try {
    const u = new URL(value);
    const protocol = u.protocol || "https:";
    const host = (u.hostname || "").toLowerCase();
    return `${protocol}//${host}`;
  } catch {
    const withoutProtocol = value.replace(/^[a-z][a-z0-9+.\-]*:\/\//i, "");
    const host = withoutProtocol.split("/")[0].split(":")[0].toLowerCase();
    const protocol = /^https:/i.test(value) ? "https:" : "http:";
    return `${protocol}//${host}`;
  }
}

export function isValidSpec(doc: any): boolean {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  return Boolean(doc.openapi) || Boolean(doc.swagger);
}

function extractSpecUrl(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  const containers: any[] = [data, data?.data, data?.result, data?.spec, data?.info].filter(
    (c) => c && typeof c === "object"
  );
  for (const c of containers) {
    const versions = c.versions;
    const preferred = c.preferred ?? c.preferredVersion ?? c.latest ?? c.defaultVersion;
    if (versions && typeof versions === "object") {
      let v: any = null;
      if (preferred != null && versions[preferred] && typeof versions[preferred] === "object") {
        v = versions[preferred];
      } else if (typeof preferred === "string" && c[preferred] && typeof c[preferred] === "object") {
        v = c[preferred];
      } else {
        const keys = Object.keys(versions);
        if (keys.length > 0) v = versions[keys[keys.length - 1]];
      }
      if (v && typeof v === "object") {
        const url =
          v.swaggerUrl ??
          v.openapiUrl ??
          v.specUrl ??
          v.url ??
          v.swaggerYamlUrl ??
          v.openapiYamlUrl;
        if (typeof url === "string" && url.length > 0) return url;
      }
    }
    if (typeof preferred === "string" && c[preferred] && typeof c[preferred] === "object") {
      const v = c[preferred];
      const url =
        v.swaggerUrl ?? v.openapiUrl ?? v.specUrl ?? v.url ?? v.swaggerYamlUrl ?? v.openapiYamlUrl;
      if (typeof url === "string" && url.length > 0) return url;
    }
  }
  for (const c of containers) {
    if (typeof c.swaggerUrl === "string" && c.swaggerUrl) return c.swaggerUrl;
    if (typeof c.openapiUrl === "string" && c.openapiUrl) return c.openapiUrl;
    if (typeof c.specUrl === "string" && c.specUrl) return c.specUrl;
    if (typeof c.url === "string" && c.url && /swagger|openapi|spec/i.test(c.url)) return c.url;
  }
  return null;
}

function originFromInput(input: string): string {
  let value = String(input ?? "").trim();
  if (!value) return "https://";
  if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(value)) {
    value = "https://" + value;
  }
  try {
    const u = new URL(value);
    const protocol = u.protocol || "https:";
    const host = (u.hostname || "").toLowerCase();
    const port = u.port ? `:${u.port}` : "";
    return `${protocol}//${host}${port}`;
  } catch {
    const withoutProtocol = value.replace(/^[a-z][a-z0-9+.\-]*:\/\//i, "");
    const hostPort = withoutProtocol.split("/")[0];
    const [hostRaw, portRaw] = hostPort.split(":");
    const host = (hostRaw || "").toLowerCase();
    const port = portRaw ? `:${portRaw}` : "";
    const protocol = /^https:/i.test(value) ? "https:" : "http:";
    return `${protocol}//${host}${port}`;
  }
}

export async function discoverSpec(input: string): Promise<{ url: string; spec: any } | null> {
  const origin = originFromInput(input);

  for (const path of SPEC_PATHS) {
    const url = `${origin}${path}`;
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json, application/yaml, text/yaml, */*" },
      });
      if (!res.ok) continue;
      const text = await res.text();
      let doc: any;
      try {
        doc = JSON.parse(text);
      } catch {
        continue;
      }
      if (isValidSpec(doc)) return { url, spec: doc };
    } catch {
      continue;
    }
  }

  // APIs.guru registry fallback
  try {
    const host = new URL(origin).hostname;
    const registryUrl = `https://api.apis.guru/v2/specs/${host}`;
    const res = await fetch(registryUrl);
    if (res.ok) {
      let data: any;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      const specUrl = extractSpecUrl(data);
      if (specUrl) {
        const res2 = await fetch(specUrl);
        if (res2.ok) {
          const text2 = await res2.text();
          let spec: any;
          try {
            spec = JSON.parse(text2);
          } catch {
            spec = null;
          }
          if (isValidSpec(spec)) return { url: specUrl, spec };
        }
      }
    }
  } catch {
    // ignore network/parse errors
  }

  return null;
}