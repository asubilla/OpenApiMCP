import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolDef } from "../src/types.js";
import {
  namespaceTools,
  mergeServers,
  findTool,
  type FederatedServer,
} from "../src/federation.js";

function tool(name: string): ToolDef {
  return {
    name,
    description: "",
    method: "GET",
    path: "/",
    params: [],
    bodyObject: false,
    tags: [],
    annotations: {},
    security: { headers: {}, query: {} },
  };
}

function server(name: string, tools: ToolDef[]): FederatedServer {
  return { name, url: `http://${name}`, tools };
}

test("namespaceTools prefixes names", () => {
  const s = server("alpha", [tool("listPets"), tool("getPet")]);
  assert.deepEqual(
    namespaceTools(s).map((t) => t.name),
    ["alpha_listPets", "alpha_getPet"]
  );
});

test("mergeServers merges + detects conflicts", () => {
  const s1 = server("svc", [tool("foo"), tool("bar")]);
  const s2 = server("svc", [tool("foo"), tool("baz")]);
  const { tools, conflicts } = mergeServers([s1, s2]);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["svc_foo", "svc_bar", "svc_foo", "svc_baz"]
  );
  assert.deepEqual(conflicts, ["svc_foo"]);
});

test("findTool finds by name", () => {
  const servers = [server("alpha", [tool("list")]), server("beta", [tool("get")])];
  const found = findTool(servers, "beta_get");
  assert.equal(found?.server.name, "beta");
  assert.equal(found?.tool.name, "get");
});

test("no conflicts case", () => {
  const s1 = server("alpha", [tool("list")]);
  const s2 = server("beta", [tool("get")]);
  const { conflicts } = mergeServers([s1, s2]);
  assert.deepEqual(conflicts, []);
});
