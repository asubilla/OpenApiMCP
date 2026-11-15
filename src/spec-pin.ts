import { createHash } from "node:crypto";
import { stableStringifyCycles } from "./json-safe.js";

export interface SpecPin {
  url: string;
  hash: string;
  fetchedAt: string;
  specVersion?: string;
}

export function hashDocument(doc: string | Buffer): string {
  return createHash("sha256").update(doc).digest("hex");
}

export function createPin(url: string, rawContent: string | Buffer, info?: { version?: string }): SpecPin {
  const pin: SpecPin = {
    url,
    hash: hashDocument(rawContent),
    fetchedAt: new Date().toISOString()
  };
  if (info?.version !== undefined) {
    pin.specVersion = info.version;
  }
  return pin;
}

export function verifyPin(pin: SpecPin, rawContent: string | Buffer): { valid: boolean; reason?: string } {
  const actual = hashDocument(rawContent);
  if (actual === pin.hash) {
    return { valid: true };
  }
  return { valid: false, reason: "hash-mismatch" };
}

export function pinFromSpec(url: string, spec: any): SpecPin {
  const content = stableStringifyCycles(spec);
  const pin = createPin(url, content, { version: spec?.info?.version });
  return pin;
}

export function formatPin(p: SpecPin): string {
  const lines = [
    `Spec pin for ${p.url}`,
    `  hash: ${p.hash}`,
    `  fetchedAt: ${p.fetchedAt}`
  ];
  if (p.specVersion !== undefined) {
    lines.push(`  specVersion: ${p.specVersion}`);
  }
  return lines.join("\n");
}
