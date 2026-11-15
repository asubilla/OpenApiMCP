export interface OAuth2Config {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope?: string;
}

export function buildTokenRequest(config: OAuth2Config): { url: string; headers: Record<string, string>; body: string } {
  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", config.clientId);
  params.set("client_secret", config.clientSecret);
  if (config.scope) params.set("scope", config.scope);
  if (config.audience) params.set("audience", config.audience);
  return {
    url: config.tokenUrl,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  };
}

const SAFETY_BUFFER_MS = 60_000;

function envKey(name: string): string {
  return (
    "OPENAPIMCP_" +
    String(name)
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase()
  );
}

function lookupCreds(name: string | undefined): { clientId: string; clientSecret: string } | null {
  if (name) {
    const id = process.env[`${envKey(name)}_CLIENT_ID`];
    const secret = process.env[`${envKey(name)}_CLIENT_SECRET`];
    if (id && secret) return { clientId: id, clientSecret: secret };
  }
  return null;
}

export function parseOAuth2Config(scheme: any): OAuth2Config | null {
  if (!scheme || typeof scheme !== "object") return null;
  if (String(scheme.type ?? "").toLowerCase() !== "oauth2") return null;

  const flow = scheme?.flows?.clientCredentials;
  if (!flow || typeof flow.tokenUrl !== "string" || !flow.tokenUrl) return null;

  // Determine candidate scheme names for env lookup.
  const names: string[] = [];
  for (const candidate of [scheme.name, scheme.id, scheme.title, scheme["x-name"], scheme.schemeName]) {
    if (typeof candidate === "string" && candidate.trim()) names.push(candidate.trim());
  }

  let creds: { clientId: string; clientSecret: string } | null = null;
  for (const name of names) {
    creds = lookupCreds(name);
    if (creds) break;
  }
  if (!creds) {
    const globalId = process.env.OPENAPIMCP_CLIENT_ID;
    const globalSecret = process.env.OPENAPIMCP_CLIENT_SECRET;
    if (globalId && globalSecret) creds = { clientId: globalId, clientSecret: globalSecret };
  }
  if (!creds) {
    // Fallback: scan the environment for any OPENAPIMCP_<NAME>_CLIENT_ID pair.
    const keys = Object.keys(process.env)
      .filter((k) => /^OPENAPIMCP_.+_CLIENT_ID$/.test(k))
      .sort();
    for (const key of keys) {
      const name = key.slice("OPENAPIMCP_".length, -"_CLIENT_ID".length);
      if (!name) continue;
      const secretKey = `OPENAPIMCP_${name}_CLIENT_SECRET`;
      const id = process.env[key];
      const secret = process.env[secretKey];
      if (id && secret) {
        creds = { clientId: id, clientSecret: secret };
        break;
      }
    }
  }
  if (!creds) return null;

  const scopes = flow.scopes;
  let scope: string | undefined;
  if (scopes && typeof scopes === "object" && !Array.isArray(scopes)) {
    const keys = Object.keys(scopes);
    if (keys.length) scope = keys.join(" ");
  } else if (typeof flow.scope === "string") {
    scope = flow.scope;
  } else if (typeof scheme.scope === "string") {
    scope = scheme.scope;
  }

  const audience =
    (typeof flow.audience === "string" && flow.audience) ||
    (typeof scheme.audience === "string" && scheme.audience) ||
    undefined;

  return {
    tokenUrl: flow.tokenUrl,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    scope,
    audience,
  };
}

export class OAuth2TokenProvider {
  private config: OAuth2Config;
  private token: string | null = null;
  private expiresAt = 0;
  private inFlight: Promise<string> | null = null;

  constructor(config: OAuth2Config) {
    this.config = config;
  }

  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
    this.inFlight = null;
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    if (this.inFlight) return this.inFlight;
    const promise = this.fetchToken().finally(() => {
      if (this.inFlight === promise) this.inFlight = null;
    });
    this.inFlight = promise;
    return promise;
  }

  private async fetchToken(): Promise<string> {
    const req = buildTokenRequest(this.config);
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body }).catch((err) => {
      throw new Error(`OAuth2 token request failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        detail = "";
      }
      throw new Error(
        `OAuth2 token request failed: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ""}`
      );
    }
    let data: any;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(`OAuth2 token response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const accessToken = data?.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("OAuth2 token response missing access_token");
    }
    const expiresInRaw = data?.expires_in;
    const expiresIn = Number.isFinite(Number(expiresInRaw)) ? Number(expiresInRaw) : 0;

    this.token = accessToken;
    this.expiresAt = Date.now() + expiresIn * 1000 - SAFETY_BUFFER_MS;
    return accessToken;
  }
}
