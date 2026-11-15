import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatProfile,
  parseProfilesFile,
  profileNames,
  resolveProfile
} from "../src/env-profiles.js";

test("parseProfilesFile accepts a valid profiles document", () => {
  const parsed = parseProfilesFile({
    profiles: {
      prod: {
        baseUrl: "https://api.example.com",
        headers: { Authorization: "Bearer token" },
        readOnly: true,
        policy: "strict"
      }
    }
  });
  assert.deepEqual(parsed, {
    prod: {
      baseUrl: "https://api.example.com",
      headers: { Authorization: "Bearer token" },
      readOnly: true,
      policy: "strict"
    }
  });
});

test("parseProfilesFile throws when the root is not an object", () => {
  assert.throws(() => parseProfilesFile(null), TypeError);
  assert.throws(() => parseProfilesFile("nope"), TypeError);
  assert.throws(() => parseProfilesFile([1, 2]), TypeError);
});

test("parseProfilesFile throws when profiles is missing or not an object", () => {
  assert.throws(() => parseProfilesFile({}), TypeError);
  assert.throws(() => parseProfilesFile({ profiles: "nope" }), TypeError);
  assert.throws(() => parseProfilesFile({ profiles: [1] }), TypeError);
});

test("parseProfilesFile drops entries that are not objects", () => {
  const parsed = parseProfilesFile({
    profiles: {
      good: { baseUrl: "https://ok.example.com" },
      str: "nope",
      num: 42,
      nil: null,
      arr: [1, 2, 3]
    }
  });
  assert.deepEqual(Object.keys(parsed), ["good"]);
  assert.equal(parsed.good.baseUrl, "https://ok.example.com");
});

test("parseProfilesFile coerces missing and invalid fields", () => {
  const parsed = parseProfilesFile({
    profiles: {
      minimal: {},
      odd: {
        baseUrl: "   ",
        headers: { Good: "yes", Num: 42, Bool: true, Skip: null, Obj: { nested: 1 } },
        readOnly: "true",
        policy: 7
      }
    }
  });
  assert.deepEqual(parsed.minimal, {});
  assert.deepEqual(parsed.odd, {
    headers: { Good: "yes", Num: "42", Bool: "true" },
    readOnly: true
  });
});

test("parseProfilesFile coerces readOnly from numbers and strings", () => {
  const parsed = parseProfilesFile({
    profiles: {
      a: { readOnly: 1 },
      b: { readOnly: 0 },
      c: { readOnly: "yes" },
      d: { readOnly: "no" },
      e: { readOnly: "maybe" }
    }
  });
  assert.equal(parsed.a.readOnly, true);
  assert.equal(parsed.b.readOnly, false);
  assert.equal(parsed.c.readOnly, true);
  assert.equal(parsed.d.readOnly, false);
  assert.equal(parsed.e.readOnly, undefined);
});

test("resolveProfile returns the named profile with its name attached", () => {
  const profiles = parseProfilesFile({
    profiles: { prod: { baseUrl: "https://api.example.com", readOnly: true, policy: "strict" } }
  });
  const resolved = resolveProfile(profiles, "prod");
  assert.deepEqual(resolved, {
    name: "prod",
    baseUrl: "https://api.example.com",
    readOnly: true,
    policy: "strict"
  });
});

test("resolveProfile returns undefined for an unknown name", () => {
  const profiles = parseProfilesFile({ profiles: { prod: {} } });
  assert.equal(resolveProfile(profiles, "nope"), undefined);
});

test("resolveProfile applies overrides for baseUrl, readOnly and policy", () => {
  const profiles = parseProfilesFile({
    profiles: { prod: { baseUrl: "https://a.example.com", readOnly: false, policy: "lax" } }
  });
  const resolved = resolveProfile(profiles, "prod", {
    baseUrl: "https://b.example.com",
    readOnly: true,
    policy: "strict"
  });
  assert.deepEqual(resolved, {
    name: "prod",
    baseUrl: "https://b.example.com",
    readOnly: true,
    policy: "strict"
  });
});

test("resolveProfile merges headers with overrides winning per key", () => {
  const profiles = parseProfilesFile({
    profiles: {
      prod: { headers: { A: "base-a", B: "base-b" } }
    }
  });
  const resolved = resolveProfile(profiles, "prod", {
    headers: { B: "override-b", C: "override-c" }
  });
  assert.deepEqual(resolved?.headers, { A: "base-a", B: "override-b", C: "override-c" });
});

test("resolveProfile does not mutate the source profile's headers", () => {
  const profiles = parseProfilesFile({
    profiles: { prod: { headers: { A: "base-a" } } }
  });
  const resolved = resolveProfile(profiles, "prod", { headers: { B: "new" } });
  assert.deepEqual(profiles.prod.headers, { A: "base-a" });
  assert.deepEqual(resolved?.headers, { A: "base-a", B: "new" });
});

test("resolveProfile adds headers when the base profile has none", () => {
  const profiles = parseProfilesFile({ profiles: { prod: {} } });
  const resolved = resolveProfile(profiles, "prod", { headers: { A: "1" } });
  assert.deepEqual(resolved?.headers, { A: "1" });
});

test("profileNames returns the sorted profile names", () => {
  const profiles = parseProfilesFile({
    profiles: { beta: {}, alpha: {}, gamma: {} }
  });
  assert.deepEqual(profileNames(profiles), ["alpha", "beta", "gamma"]);
  assert.deepEqual(profileNames({}), []);
});

test("formatProfile renders a readable multi-line summary", () => {
  const text = formatProfile({
    name: "prod",
    baseUrl: "https://api.example.com",
    readOnly: true,
    policy: "strict",
    headers: { "X-Team": "red", Authorization: "Bearer token" }
  });
  const lines = text.split("\n");
  assert.equal(lines[0], 'Profile "prod"');
  assert.ok(lines.some((line) => line.includes("baseUrl: https://api.example.com")));
  assert.ok(lines.some((line) => line.includes("readOnly: true")));
  assert.ok(lines.some((line) => line.includes("policy: strict")));
  assert.ok(lines.some((line) => line.includes("headers (2):")));
  assert.ok(lines.some((line) => line.includes("Authorization: Bearer token")));
  assert.ok(lines.some((line) => line.includes("X-Team: red")));
});

test("formatProfile handles missing optional fields", () => {
  const text = formatProfile({ name: "bare" });
  assert.ok(text.includes('Profile "bare"'));
  assert.ok(text.includes("baseUrl: (not set)"));
  assert.ok(text.includes("readOnly: (not set)"));
  assert.ok(text.includes("policy: (not set)"));
  assert.ok(text.includes("headers: (none)"));
});
