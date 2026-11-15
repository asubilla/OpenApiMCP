import { createHash, createHmac } from "node:crypto";

export interface SigV4Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export interface SignableRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    "%" + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}

export function canonicalUri(path: string): string {
  if (path === "") return "/";
  return path
    .split("/")
    .map((segment) => rfc3986Encode(segment))
    .join("/");
}

export function normalizeHeaders(headers: Record<string, string>): { names: string[]; lines: string[] } {
  const lowered = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    const key = name.trim().toLowerCase();
    const cleaned = value.trim().replace(/\s+/g, " ");
    lowered.set(key, cleaned);
  }
  const names = [...lowered.keys()].sort();
  const lines = names.map((name) => `${name}:${lowered.get(name) as string}`);
  return { names, lines };
}

function canonicalQueryString(searchParams: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  for (const [name, value] of searchParams) {
    pairs.push([rfc3986Encode(name), rfc3986Encode(value)]);
  }
  pairs.sort((a, b) => {
    if (a[0] === b[0]) return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    return a[0] < b[0] ? -1 : 1;
  });
  return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const amzDate =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function signRequest(config: SigV4Config, req: SignableRequest): Record<string, string> {
  const parsed = new URL(req.url);

  // Merge caller headers, derive host, and normalize date/content-sha256.
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    merged[name.trim().toLowerCase()] = value;
  }
  if (!merged["host"]) {
    merged["host"] = parsed.host;
  }

  let amzDate = merged["x-amz-date"];
  let dateStamp: string;
  if (amzDate) {
    dateStamp = amzDate.slice(0, 8);
  } else {
    const generated = amzDates(new Date());
    amzDate = generated.amzDate;
    dateStamp = generated.dateStamp;
  }
  merged["x-amz-date"] = amzDate;

  const payloadHash = sha256Hex(req.body ?? "");
  const contentSha256 = merged["x-amz-content-sha256"] ?? payloadHash;

  // The X-Amz-Content-Sha256 header is returned for the caller to send but is
  // not part of the signed header set (matching the canonical AWS example,
  // which signs host;x-amz-date).
  const signable: Record<string, string> = {};
  for (const [name, value] of Object.entries(merged)) {
    if (name === "x-amz-content-sha256") continue;
    signable[name] = value;
  }

  const { names, lines } = normalizeHeaders(signable);
  const signedHeaders = names.join(";");
  const canonicalHeaders = lines.join("\n") + "\n";

  const path = canonicalUri(parsed.pathname || "/");
  const query = canonicalQueryString(parsed.searchParams);
  const method = req.method.toUpperCase();

  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/${config.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, config.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "X-Amz-Date": amzDate,
    "X-Amz-Content-Sha256": contentSha256,
  };
}
