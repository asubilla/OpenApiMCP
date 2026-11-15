import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  envSecretProvider,
  fileSecretProvider,
  chainSecretProviders,
  resolveSecret
} from "../src/secrets.js";
import type { SecretProvider } from "../src/secrets.js";

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "openapimcp-secrets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("env provider reads process.env without prefix", (t) => {
  process.env.SECRETS_TEST_A = "alpha";
  t.after(() => {
    delete process.env.SECRETS_TEST_A;
  });
  const provider = envSecretProvider();
  assert.equal(provider.get("SECRETS_TEST_A"), "alpha");
  assert.equal(provider.has("SECRETS_TEST_A"), true);
  assert.equal(provider.get("SECRETS_TEST_MISSING"), undefined);
  assert.equal(provider.has("SECRETS_TEST_MISSING"), false);
});

test("env provider applies prefix", (t) => {
  process.env.OPENAPIMCP_TOKEN = "tok-123";
  t.after(() => {
    delete process.env.OPENAPIMCP_TOKEN;
  });
  const provider = envSecretProvider("OPENAPIMCP_");
  assert.equal(provider.get("TOKEN"), "tok-123");
  assert.equal(provider.has("TOKEN"), true);
  assert.equal(provider.get("MISSING"), undefined);
});

test("file provider reads a JSON file", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify({ API_KEY: "secret123", TOKEN: "abc" }));
  const provider = fileSecretProvider(file);
  assert.equal(provider.get("API_KEY"), "secret123");
  assert.equal(provider.get("TOKEN"), "abc");
  assert.equal(provider.has("API_KEY"), true);
  assert.equal(provider.get("NOPE"), undefined);
  assert.equal(provider.has("NOPE"), false);
});

test("file provider reloads when file changes", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify({ K: "v1" }));
  const provider = fileSecretProvider(file);
  assert.equal(provider.get("K"), "v1");
  writeFileSync(file, JSON.stringify({ K: "v2" }));
  const future = new Date(Date.now() + 2000);
  utimesSync(file, future, future);
  assert.equal(provider.get("K"), "v2");
});

test("chain returns first hit", () => {
  const first: SecretProvider = {
    get: (name) => (name === "X" ? "first" : undefined),
    has: (name) => name === "X"
  };
  const second: SecretProvider = {
    get: (name) => (name === "X" ? "second" : undefined),
    has: (name) => name === "X"
  };
  const chained = chainSecretProviders(first, second);
  assert.equal(chained.get("X"), "first");
  assert.equal(chained.has("X"), true);
  assert.equal(chained.get("Y"), undefined);
  assert.equal(chained.has("Y"), false);
});

test("resolveSecret throws on missing", (t) => {
  process.env.SECRETS_TEST_PRESENT = "yes";
  t.after(() => {
    delete process.env.SECRETS_TEST_PRESENT;
  });
  const provider = envSecretProvider();
  assert.equal(resolveSecret("SECRETS_TEST_PRESENT", provider), "yes");
  assert.throws(() => resolveSecret("SECRETS_TEST_ABSENT", provider));
});