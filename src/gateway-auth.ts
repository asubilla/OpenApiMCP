import { createHmac, timingSafeEqual } from "node:crypto";

export interface GatewayAuthConfig {
  apiKey?: string;
  jwtSecret?: string;
  jwtIssuer?: string;
  jwtAudience?: string;
}

export interface AuthResult {
  ok: boolean;
  identity?: string;
  reason?: string;
}

function toBase64Url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function validateApiKey(provided: string | undefined, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  if (provided === undefined) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createJwt(secret: string, payload: Record<string, unknown>, expiresInSeconds?: number): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body: Record<string, unknown> = { ...payload, iat: now };
  if (expiresInSeconds !== undefined) {
    body.exp = now + expiresInSeconds;
  }
  const headerPart = toBase64Url(JSON.stringify(header));
  const payloadPart = toBase64Url(JSON.stringify(body));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(signingInput, "utf8")
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyJwt(
  token: string,
  secret: string,
  opts?: { issuer?: string; audience?: string }
): { ok: boolean; payload?: Record<string, unknown>; reason?: string } {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "missing token" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "invalid token format" };
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: any;
  let payload: any;
  try {
    header = JSON.parse(fromBase64Url(headerPart).toString("utf8"));
    payload = JSON.parse(fromBase64Url(payloadPart).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid token encoding" };
  }
  if (!header || typeof header !== "object" || header.alg !== "HS256") {
    return { ok: false, reason: "unsupported algorithm" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "invalid payload" };
  }

  const expectedSignature = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${headerPart}.${payloadPart}`, "utf8")
    .digest();
  let providedSignature: Buffer;
  try {
    providedSignature = fromBase64Url(signaturePart);
  } catch {
    return { ok: false, reason: "invalid signature" };
  }
  if (providedSignature.length !== expectedSignature.length) {
    return { ok: false, reason: "invalid signature" };
  }
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return { ok: false, reason: "invalid signature" };
  }

  if (typeof payload.exp === "number") {
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) {
      return { ok: false, reason: "token expired" };
    }
  }

  if (opts?.issuer !== undefined && payload.iss !== opts.issuer) {
    return { ok: false, reason: "issuer mismatch" };
  }
  if (opts?.audience !== undefined) {
    const aud = payload.aud;
    const audienceOk =
      typeof aud === "string"
        ? aud === opts.audience
        : Array.isArray(aud)
          ? aud.includes(opts.audience)
          : false;
    if (!audienceOk) {
      return { ok: false, reason: "audience mismatch" };
    }
  }

  return { ok: true, payload: payload as Record<string, unknown> };
}

function getHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers ?? {})) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

function identityFromPayload(payload: Record<string, unknown>): string {
  for (const key of ["sub", "id", "userId", "username", "email"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return "jwt";
}

export function authenticateRequest(
  headers: Record<string, string | undefined>,
  config: GatewayAuthConfig
): AuthResult {
  const jwtSecret = config.jwtSecret;
  const apiKey = config.apiKey;

  if (!jwtSecret && !apiKey) {
    return { ok: true, identity: "anonymous" };
  }

  const authHeader = getHeader(headers, "authorization");
  const bearerMatch = authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader.trim()) : null;
  const bearerToken = bearerMatch ? bearerMatch[1].trim() : undefined;

  let providedApiKey = getHeader(headers, "x-api-key");
  if (providedApiKey === undefined && authHeader) {
    const apiKeyMatch = /^ApiKey\s+(.+)$/i.exec(authHeader.trim());
    if (apiKeyMatch) providedApiKey = apiKeyMatch[1].trim();
  }

  if (bearerToken !== undefined) {
    if (!jwtSecret) {
      return { ok: false, reason: "jwt auth not configured" };
    }
    const result = verifyJwt(bearerToken, jwtSecret, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience
    });
    if (!result.ok) {
      return { ok: false, reason: result.reason ?? "invalid token" };
    }
    return { ok: true, identity: identityFromPayload(result.payload!) };
  }

  if (providedApiKey !== undefined) {
    if (!apiKey) {
      return { ok: false, reason: "api key auth not configured" };
    }
    if (validateApiKey(providedApiKey, apiKey)) {
      return { ok: true, identity: "api-key" };
    }
    return { ok: false, reason: "invalid api key" };
  }

  return { ok: false, reason: "missing credentials" };
}

export function authMiddleware(config: GatewayAuthConfig): (req: any, res: any) => boolean {
  return (req: any, res: any): boolean => {
    const result = authenticateRequest(req?.headers ?? {}, config);
    if (result.ok) return true;
    const body = JSON.stringify({ ok: false, error: "unauthorized", reason: result.reason });
    if (res && typeof res.writeHead === "function" && !res.headersSent) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(body);
    } else if (res) {
      res.statusCode = 401;
      if (typeof res.end === "function") res.end(body);
    }
    return false;
  };
}