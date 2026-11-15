import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_KEYS,
  formatConfigIssues,
  validateConfig,
} from "../src/config-validate.js";
import type { ConfigIssue } from "../src/config-validate.js";

test("KNOWN_KEYS includes the documented keys", () => {
  for (const key of [
    "baseUrl", "headers", "readOnly", "policy", "fields", "maxBytes", "timeout",
    "retries", "cacheTtl", "rateLimit", "retryDelayMs", "maxPages", "paginate",
    "toolSearch", "redact", "summarize", "sanitize", "mock", "logJson", "name",
    "include", "exclude", "tag", "structuredContent", "http", "port", "host",
    "path", "args", "oauth2TokenUrl", "oauth2ClientId", "oauth2ClientSecret",
    "oauth2Scope", "audit", "dotenv", "overlay", "config",
  ]) {
    assert.ok(KNOWN_KEYS.includes(key), `missing known key "${key}"`);
  }
});

test("a valid config passes with no issues", () => {
  const result = validateConfig({
    baseUrl: "https://api.example.com",
    headers: { Authorization: "Bearer token", "X-Env": "prod" },
    readOnly: true,
    maxBytes: 1048576,
    timeout: 5000,
    retries: 3,
    cacheTtl: 60,
    rateLimit: 100,
    retryDelayMs: 250,
    maxPages: 10,
    paginate: true,
    toolSearch: true,
    redact: true,
    summarize: false,
    sanitize: true,
    mock: false,
    logJson: true,
    name: "my-server",
    include: ["users"],
    exclude: ["internal"],
    tag: "public",
    structuredContent: true,
    http: true,
    port: 8080,
    host: "127.0.0.1",
    path: "/mcp",
    args: ["--spec", "api.yaml"],
    oauth2TokenUrl: "https://auth.example.com/token",
    oauth2ClientId: "id",
    oauth2ClientSecret: "secret",
    oauth2Scope: "read",
    audit: true,
    dotenv: true,
    overlay: { actions: [] },
    policy: { allow: ["get"] },
    fields: ["id", "name"],
    config: { timeout: 1000 },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("an empty object is valid", () => {
  const result = validateConfig({});
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("unknown keys produce warnings, not errors", () => {
  const result = validateConfig({ definitelyNotAKey: 123 });
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "warning");
  assert.equal(result.issues[0].key, "definitelyNotAKey");
  assert.match(result.issues[0].message, /unknown config key/);
});

test("boolean keys must be booleans", () => {
  const result = validateConfig({ readOnly: "yes", mock: 1, logJson: null });
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 3);
  for (const issue of result.issues) {
    assert.equal(issue.severity, "error");
    assert.match(issue.message, /must be a boolean/);
  }
});

test("number keys must be finite numbers", () => {
  const result = validateConfig({ timeout: "5000", maxBytes: NaN, port: "8080" });
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 3);
  for (const issue of result.issues) {
    assert.equal(issue.severity, "error");
    assert.match(issue.message, /must be a finite number/);
  }
});

test("number keys reject non-numeric and non-finite values", () => {
  assert.equal(validateConfig({ retries: Infinity }).valid, false);
  assert.equal(validateConfig({ retries: 3 }).valid, true);
});

test("string keys must be strings", () => {
  const result = validateConfig({ baseUrl: 42, name: true, host: {} });
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 3);
  for (const issue of result.issues) {
    assert.equal(issue.severity, "error");
    assert.match(issue.message, /must be a string/);
  }
});

test("array keys must be arrays", () => {
  const result = validateConfig({ include: "users", args: "--spec", fields: 7 });
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 3);
  for (const issue of result.issues) {
    assert.equal(issue.severity, "error");
    assert.match(issue.message, /must be an array/);
  }
});

test("headers must be an object with string values", () => {
  const notObject = validateConfig({ headers: "Authorization: Bearer x" });
  assert.equal(notObject.valid, false);
  assert.match(notObject.issues[0].message, /must be an object/);

  const badValue = validateConfig({ headers: { "X-Count": 3, "X-Ok": "yes" } });
  assert.equal(badValue.valid, false);
  assert.equal(badValue.issues.length, 1);
  assert.match(badValue.issues[0].message, /"X-Count"/);
  assert.match(badValue.issues[0].message, /must have a string value/);

  const good = validateConfig({ headers: { "X-Ok": "yes" } });
  assert.equal(good.valid, true);
});

test("headers reject arrays", () => {
  const result = validateConfig({ headers: [["a", "b"]] });
  assert.equal(result.valid, false);
  assert.match(result.issues[0].message, /must be an object/);
});

test("stringOrObject keys accept either a string or an object", () => {
  assert.equal(validateConfig({ overlay: "overlay.json" }).valid, true);
  assert.equal(validateConfig({ overlay: { actions: [] } }).valid, true);
  assert.equal(validateConfig({ overlay: 42 }).valid, false);
  assert.equal(validateConfig({ policy: "policy.json" }).valid, true);
  assert.equal(validateConfig({ policy: { deny: ["post"] } }).valid, true);
  assert.equal(validateConfig({ policy: true }).valid, false);
});

test("non-object configs are invalid", () => {
  for (const input of [null, [1, 2, 3], "str", 42, true, undefined]) {
    const result = validateConfig(input);
    assert.equal(result.valid, false, `expected invalid for ${String(input)}`);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].severity, "error");
    assert.equal(result.issues[0].key, "(root)");
    assert.match(result.issues[0].message, /must be a JSON object/);
  }
});

test("nested config objects are validated recursively with prefixed keys", () => {
  const result = validateConfig({
    config: { timeout: "soon", bogusKey: true },
  });
  assert.equal(result.valid, false);
  const keys = result.issues.map((i) => i.key);
  assert.ok(keys.includes("config.timeout"));
  assert.ok(keys.includes("config.bogusKey"));
  const nestedError = result.issues.find((i) => i.key === "config.timeout");
  assert.equal(nestedError?.severity, "error");
  const nestedWarning = result.issues.find((i) => i.key === "config.bogusKey");
  assert.equal(nestedWarning?.severity, "warning");
});

test("nested config that is not an object errors without crashing", () => {
  const result = validateConfig({ config: "nope" });
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /must be an object/);
});

test("formatConfigIssues returns a friendly message for no issues", () => {
  assert.equal(formatConfigIssues([]), "No config issues found.");
});

test("formatConfigIssues groups errors before warnings with markers", () => {
  const issues: ConfigIssue[] = [
    { severity: "warning", key: "mystery", message: "unknown config key \"mystery\"" },
    { severity: "error", key: "timeout", message: "must be a finite number, got string" },
    { severity: "error", key: "mock", message: "must be a boolean, got number" },
    { severity: "warning", key: "extra", message: "unknown config key \"extra\"" },
  ];
  const output = formatConfigIssues(issues);

  assert.match(output, /Errors \(2\):/);
  assert.match(output, /Warnings \(2\):/);
  assert.ok(output.indexOf("Errors (2):") < output.indexOf("Warnings (2):"));
  assert.ok(output.includes("✗ timeout: must be a finite number, got string"));
  assert.ok(output.includes("✗ mock: must be a boolean, got number"));
  assert.ok(output.includes("⚠ mystery: unknown config key \"mystery\""));
  assert.ok(output.includes("⚠ extra: unknown config key \"extra\""));
  // Errors section contains no ⚠ markers, warnings section no ✗ markers.
  const errorsSection = output.slice(0, output.indexOf("Warnings (2):"));
  const warningsSection = output.slice(output.indexOf("Warnings (2):"));
  assert.ok(!errorsSection.includes("⚠"));
  assert.ok(!warningsSection.includes("✗"));
});

test("formatConfigIssues renders warnings-only output without an errors section", () => {
  const output = formatConfigIssues([
    { severity: "warning", key: "mystery", message: "unknown config key \"mystery\"" },
  ]);
  assert.ok(!output.includes("Errors"));
  assert.ok(output.includes("Warnings (1):"));
  assert.ok(output.includes("⚠ mystery:"));
});

test("formatConfigIssues renders errors-only output without a warnings section", () => {
  const output = formatConfigIssues([
    { severity: "error", key: "timeout", message: "must be a finite number, got string" },
  ]);
  assert.ok(output.includes("Errors (1):"));
  assert.ok(!output.includes("Warnings"));
  assert.ok(output.includes("✗ timeout:"));
});

test("warnings alone keep the config valid; errors make it invalid", () => {
  assert.equal(validateConfig({ unknownThing: 1 }).valid, true);
  assert.equal(validateConfig({ unknownThing: 1, timeout: "x" }).valid, false);
});
