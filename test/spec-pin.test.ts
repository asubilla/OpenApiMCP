import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  hashDocument,
  createPin,
  verifyPin,
  pinFromSpec,
  formatPin,
  type SpecPin
} from "../src/spec-pin.js";

test("hashDocument is stable for the same input", () => {
  const a = hashDocument("hello world");
  const b = hashDocument("hello world");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, createHash("sha256").update("hello world").digest("hex"));
});

test("hashDocument accepts a Buffer input", () => {
  const fromString = hashDocument("abc");
  const fromBuffer = hashDocument(Buffer.from("abc", "utf8"));
  assert.equal(fromString, fromBuffer);
});

test("createPin sets url, hash, fetchedAt and specVersion", () => {
  const pin = createPin("https://example.com/spec.json", "raw-content", { version: "1.2.3" });
  assert.equal(pin.url, "https://example.com/spec.json");
  assert.equal(pin.hash, hashDocument("raw-content"));
  assert.ok(!Number.isNaN(Date.parse(pin.fetchedAt)));
  assert.equal(pin.specVersion, "1.2.3");
});

test("createPin omits specVersion when no info is given", () => {
  const pin = createPin("https://example.com/spec.json", "raw-content");
  assert.equal(pin.specVersion, undefined);
});

test("verifyPin returns valid for matching content", () => {
  const pin = createPin("https://example.com/spec.json", "raw-content");
  const result = verifyPin(pin, "raw-content");
  assert.deepEqual(result, { valid: true });
});

test("verifyPin reports hash-mismatch for different content", () => {
  const pin = createPin("https://example.com/spec.json", "raw-content");
  const result = verifyPin(pin, "tampered-content");
  assert.equal(result.valid, false);
  assert.equal(result.reason, "hash-mismatch");
});

test("pinFromSpec uses spec.info.version as specVersion", () => {
  const spec = { openapi: "3.0.0", info: { title: "T", version: "2.0.0" }, paths: {} };
  const pin = pinFromSpec("https://example.com/spec.json", spec);
  assert.equal(pin.specVersion, "2.0.0");
  assert.equal(pin.url, "https://example.com/spec.json");
  assert.ok(pin.hash.length === 64);
});

test("pinFromSpec hashes stably regardless of key order", () => {
  const a = { openapi: "3.0.0", info: { title: "T", version: "1" }, paths: { "/p": { get: { responses: { "200": {} } } } } };
  const b = { paths: { "/p": { get: { responses: { "200": {} } } } }, info: { version: "1", title: "T" }, openapi: "3.0.0" };
  const pinA = pinFromSpec("https://example.com/spec.json", a);
  const pinB = pinFromSpec("https://example.com/spec.json", b);
  assert.equal(pinA.hash, pinB.hash);
});

test("pinFromSpec produces different hashes for different specs", () => {
  const a = { info: { version: "1" }, paths: { "/a": {} } };
  const b = { info: { version: "1" }, paths: { "/b": {} } };
  assert.notEqual(pinFromSpec("https://example.com/spec.json", a).hash, pinFromSpec("https://example.com/spec.json", b).hash);
});

test("pinFromSpec hash differs from naive JSON.stringify when key order differs", () => {
  const spec: any = { b: 1, a: 2 };
  const pin = pinFromSpec("https://example.com/spec.json", spec);
  assert.equal(verifyPin(pin, JSON.stringify(spec)).valid, false);
});

test("formatPin contains the url and hash prefix", () => {
  const p: SpecPin = {
    url: "https://example.com/spec.json",
    hash: "deadbeef".repeat(8),
    fetchedAt: "2026-11-16T00:00:00.000Z",
    specVersion: "1.0.0"
  };
  const out = formatPin(p);
  assert.ok(out.includes("https://example.com/spec.json"));
  assert.ok(out.includes("deadbeef"));
  assert.ok(out.includes("1.0.0"));
});
