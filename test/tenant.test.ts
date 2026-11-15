import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTenantsFile,
  resolveTenant,
  tenantNames,
  formatTenant,
  type TenantConfig,
  type TenantsFile,
} from "../src/tenant.js";

const VALID_JSON = {
  tenants: {
    acme: {
      baseUrl: "https://api.acme.example.com",
      headers: { "x-tenant": "acme", "x-count": 3 },
      policy: "acme-policy",
      readOnly: false,
      users: {
        alice: { headers: { "x-user": "alice" }, policy: "alice-policy", readOnly: true },
        bob: { headers: { "x-user": "bob", "x-tenant": "bob-acme" } },
        broken: "not-an-object",
      },
    },
    minimal: {},
    droptable: "not-an-object",
  },
};

test("parseTenantsFile parses a valid file and coerces headers", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  assert.deepEqual(Object.keys(tenants).sort(), ["acme", "minimal"]);
  assert.equal(tenants.acme.baseUrl, "https://api.acme.example.com");
  assert.deepEqual(tenants.acme.headers, { "x-tenant": "acme", "x-count": "3" });
  assert.equal(tenants.acme.policy, "acme-policy");
  assert.equal(tenants.acme.readOnly, false);
  assert.deepEqual(tenants.minimal, {});
});

test("parseTenantsFile parses users and drops malformed user entries", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  const users = tenants.acme.users;
  assert.ok(users);
  assert.deepEqual(Object.keys(users).sort(), ["alice", "bob"]);
  assert.deepEqual(users.alice.headers, { "x-user": "alice" });
  assert.equal(users.alice.policy, "alice-policy");
  assert.equal(users.alice.readOnly, true);
});

test("parseTenantsFile throws on invalid root shape", () => {
  assert.throws(() => parseTenantsFile(null), TypeError);
  assert.throws(() => parseTenantsFile("nope"), TypeError);
  assert.throws(() => parseTenantsFile([]), TypeError);
  assert.throws(() => parseTenantsFile({}), TypeError);
  assert.throws(() => parseTenantsFile({ tenants: "nope" }), TypeError);
});

test("parseTenantsFile drops malformed entries and invalid fields", () => {
  const tenants = parseTenantsFile({
    tenants: {
      good: { baseUrl: 123, headers: "nope", policy: "  ", readOnly: "yes" },
      alsogood: { readOnly: "no" },
    },
  });
  assert.deepEqual(tenants.good, { readOnly: true });
  assert.deepEqual(tenants.alsogood, { readOnly: false });
});

test("resolveTenant returns undefined for unknown tenant", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  assert.equal(resolveTenant(tenants, "nope"), undefined);
});

test("resolveTenant returns the tenant with its name attached", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  const t = resolveTenant(tenants, "acme");
  assert.ok(t);
  assert.equal(t!.name, "acme");
  assert.equal(t!.baseUrl, "https://api.acme.example.com");
});

test("resolveTenant applies explicit overrides", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  const t = resolveTenant(tenants, "acme", undefined, {
    baseUrl: "https://override.example.com",
    headers: { "x-tenant": "override", "x-new": "1" },
    policy: "override-policy",
    readOnly: true,
  });
  assert.ok(t);
  assert.equal(t!.baseUrl, "https://override.example.com");
  assert.deepEqual(t!.headers, { "x-tenant": "override", "x-count": "3", "x-new": "1" });
  assert.equal(t!.policy, "override-policy");
  assert.equal(t!.readOnly, true);
});

test("resolveTenant merges user creds: user headers win over tenant headers", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  const t = resolveTenant(tenants, "acme", "bob");
  assert.ok(t);
  assert.equal(t!.headers!["x-tenant"], "bob-acme");
  assert.equal(t!.headers!["x-count"], "3");
  assert.equal(t!.headers!["x-user"], "bob");
});

test("resolveTenant: user policy and readOnly win over tenant", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  const t = resolveTenant(tenants, "acme", "alice");
  assert.ok(t);
  assert.equal(t!.policy, "alice-policy");
  assert.equal(t!.readOnly, true);
});

test("resolveTenant ignores unknown userKey", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  const t = resolveTenant(tenants, "acme", "mallory");
  assert.ok(t);
  assert.equal(t!.policy, "acme-policy");
  assert.equal(t!.readOnly, false);
  assert.equal(t!.headers!["x-tenant"], "acme");
});

test("resolveTenant does not mutate the source tenants map", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  const before = JSON.stringify(tenants);
  resolveTenant(tenants, "acme", "alice", { headers: { "x-tenant": "changed" } });
  assert.equal(JSON.stringify(tenants), before);
});

test("tenantNames returns sorted names", () => {
  const tenants = parseTenantsFile(VALID_JSON);
  assert.deepEqual(tenantNames(tenants), ["acme", "minimal"]);
  assert.deepEqual(tenantNames({}), []);
});

test("formatTenant renders a readable summary", () => {
  const t: TenantConfig = {
    name: "acme",
    baseUrl: "https://api.acme.example.com",
    headers: { "x-tenant": "acme" },
    policy: "acme-policy",
    readOnly: true,
    users: { alice: { readOnly: true }, bob: {} },
  };
  const out = formatTenant(t);
  assert.match(out, /Tenant "acme"/);
  assert.match(out, /baseUrl: https:\/\/api\.acme\.example\.com/);
  assert.match(out, /readOnly: true/);
  assert.match(out, /policy: acme-policy/);
  assert.match(out, /x-tenant: acme/);
  assert.match(out, /alice/);
  assert.match(out, /bob/);
});

test("formatTenant handles an empty tenant", () => {
  const out = formatTenant({ name: "solo" });
  assert.match(out, /Tenant "solo"/);
  assert.match(out, /baseUrl: \(not set\)/);
  assert.match(out, /headers: \(none\)/);
  assert.match(out, /users: \(none\)/);
});

test("TenantsFile type is usable", () => {
  const file: TenantsFile = { tenants: { acme: { baseUrl: "https://example.com" } } };
  const tenants = parseTenantsFile(file);
  assert.equal(tenants.acme.baseUrl, "https://example.com");
});
