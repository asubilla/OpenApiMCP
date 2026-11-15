import { readFileSync } from "node:fs";

export interface ProxyNetworkOptions {
  /** Path to a PEM CA bundle to trust (e.g. corporate MITM proxy root). */
  ca?: string;
  /** Proxy URL, e.g. http://127.0.0.1:3128 (CONNECT-tunneled for HTTPS targets). */
  proxy?: string;
}

/**
 * Build an undici dispatcher from --ca/--proxy. Returns undefined when neither
 * is set. `undici` ships as an optional dependency: if it is missing, the
 * error message tells the user how to install it.
 *
 * Option shapes are verified empirically against Node's global fetch:
 * - direct HTTPS + CA:  Agent({ connect: { ca } })
 * - proxied HTTPS + CA: ProxyAgent({ uri, requestTls: { ca } })
 */
export async function createDispatcher(opts: ProxyNetworkOptions): Promise<unknown> {
  if (!opts.ca && !opts.proxy) return undefined;

  let undici: any;
  try {
    undici = await import("undici");
  } catch {
    throw new Error('--ca/--proxy need the optional "undici" package. Run: npm install undici');
  }

  let ca: Buffer | undefined;
  if (opts.ca) {
    try {
      ca = readFileSync(opts.ca);
    } catch (err) {
      throw new Error(`--ca file "${opts.ca}" could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (opts.proxy) {
    return new undici.ProxyAgent({ uri: opts.proxy, ...(ca ? { requestTls: { ca } } : {}) });
  }
  return new undici.Agent({ connect: { ca } });
}

/** Human-readable summary (masks credentials embedded in the proxy URL). */
export function formatDispatcherPlan(opts: ProxyNetworkOptions): string {
  const lines: string[] = [];
  if (opts.proxy) lines.push(`proxy: ${opts.proxy.replace(/\/\/[^/@]*@/, "//******@")} (CONNECT for HTTPS)`);
  if (opts.ca) lines.push(`ca:    ${opts.ca}`);
  return lines.length ? lines.join("\n") : "(proxy/TLS: not configured)";
}
