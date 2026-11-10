import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequest, hostAllowed, loadPolicy, toolAllowed } from "../src/policy.js";
import type { ToolDef } from "../src/types.js";

function tool(over: Partial<ToolDef> = {}): ToolDef {
  return {
    name: "getUser",
    description: "",
    method: "get",
    path: "/u",
    params: [],
    bodyObject: false,
    tags: [],
    annotations: {},
    security: { headers: {}, query: {} },
    ...over
  };
}

test("deny glob blocks tools", () => {
  const policy = loadPolicy({ deny: ["delete*"] });
  assert.equal(toolAllowed(policy, tool({ name: "deleteUser", method: "delete" })), false);
  assert.equal(toolAllowed(policy, tool({ name: "getUser" })), true);
});

test("allow list restricts tools", () => {
  const policy = loadPolicy({ allow: ["get*"] });
  assert.equal(toolAllowed(policy, tool({ name: "getUser" })), true);
  assert.equal(toolAllowed(policy, tool({ name: "createUser", method: "post" })), false);
});

test("method allowlist", () => {
  const policy = loadPolicy({ methods: ["GET"] });
  assert.equal(toolAllowed(policy, tool({ method: "post" })), false);
  assert.equal(toolAllowed(policy, tool({ method: "get" })), true);
});

test("host allowlist supports wildcards", () => {
  const policy = loadPolicy({ hosts: ["*.example.com"] });
  assert.equal(hostAllowed(policy, "api.example.com"), true);
  assert.equal(hostAllowed(policy, "example.com"), true);
  assert.equal(hostAllowed(policy, "evil.com"), false);
});

test("checkRequest blocks disallowed hosts", () => {
  const policy = loadPolicy({ hosts: ["api.example.com"] });
  assert.equal(checkRequest(policy, tool(), "https://api.example.com/u"), null);
  assert.match(checkRequest(policy, tool(), "https://evil.com/u") ?? "", /not allowed/);
});

test("loadPolicy rejects malformed policies", () => {
  assert.throws(() => loadPolicy({ allow: "nope" }));
  assert.throws(() => loadPolicy(null));
});
