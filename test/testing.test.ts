import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSmokeTests, sampleArgs } from "../src/testing.js";
import { ToolKit, formatToolDetail, formatToolList } from "../src/toolkit.js";
import type { Param, ParsedApi, ToolDef } from "../src/types.js";

function tool(over: Partial<ToolDef> = {}): ToolDef {
  return {
    name: "getUser",
    description: "Fetch a user",
    method: "get",
    path: "/users/{id}",
    params: [],
    bodyObject: false,
    tags: [],
    annotations: {},
    security: { headers: {}, query: {} },
    ...over
  };
}

function param(over: Partial<Param> & { argName: string }): Param {
  return {
    location: "query",
    origName: over.argName,
    required: false,
    schema: { type: "string" },
    ...over
  };
}

const api: ParsedApi = {
  title: "Demo API",
  version: "1.0.0",
  baseUrls: ["https://api.demo.test"],
  tools: [
    tool({
      name: "getPet",
      description: "Fetch a pet",
      method: "get",
      path: "/pets/{petId}",
      tags: ["pets"],
      annotations: { readOnlyHint: true },
      params: [
        param({ argName: "petId", location: "path", required: true, schema: { type: "string" } }),
        param({ argName: "limit", schema: { type: "integer", default: 25 } })
      ]
    }),
    tool({
      name: "listPets",
      description: "List pets",
      method: "HEAD",
      path: "/pets",
      tags: ["pets"],
      annotations: { readOnlyHint: true }
    }),
    tool({
      name: "createPet",
      description: "Create a pet",
      method: "post",
      path: "/pets",
      annotations: {}
    })
  ],
  securitySchemes: {},
  schemesWithCreds: [],
  schemesWithoutCreds: []
};

test("generateSmokeTests includes every read-only tool and the base URL", () => {
  const source = generateSmokeTests(api);
  assert.match(source, /getPet/);
  assert.match(source, /listPets/);
  assert.doesNotMatch(source, /createPet/);
  assert.match(source, /https:\/\/api\.demo\.test/);
  assert.match(source, /node:test/);
  assert.match(source, /fetch/);
});

test("generated smoke test source parses as JavaScript", () => {
  const source = generateSmokeTests(api)
    .replace('import { test } from "node:test";', "const test = () => {};")
    .replace('import assert from "node:assert/strict";', "const assert = { ok() {} };");
  // Throws on a syntax error; the leading import lines are replaced above.
  new Function(source);
});

test("sampleArgs fills path params with 1 and honours schema defaults", () => {
  const args = sampleArgs(api.tools[0]);
  assert.equal(args.petId, "1");
  assert.equal(args.limit, 25);

  const source = generateSmokeTests(api);
  assert.match(source, /"petId": "1"/);
});

test("sampleArgs maps JSON Schema types to samples", () => {
  const args = sampleArgs(
    tool({
      params: [
        param({ argName: "count", schema: { type: "integer" } }),
        param({ argName: "ratio", schema: { type: "number" } }),
        param({ argName: "flag", schema: { type: "boolean" } }),
        param({ argName: "mode", schema: { type: "string", enum: ["a", "b"] } }),
        param({ argName: "tags", schema: { type: "array", items: { type: "string" } } }),
        param({ argName: "opts", schema: { type: "object" } })
      ]
    })
  );
  assert.equal(args.count, 1);
  assert.equal(args.ratio, 1);
  assert.equal(args.flag, true);
  assert.equal(args.mode, "a");
  assert.deepEqual(args.tags, ["1"]);
  assert.deepEqual(args.opts, {});
});

test("ToolKit.find returns the matching tool and undefined otherwise", () => {
  const kit = new ToolKit(api.tools);
  assert.equal(kit.find("getPet")?.name, "getPet");
  assert.equal(kit.find("missing"), undefined);
  assert.equal(kit.all().length, 3);
});

test("ToolKit.search ranks by token overlap on name/description/tags", () => {
  const kit = new ToolKit(api.tools);
  const results = kit.search("pets");
  assert.deepEqual(
    results.map((t) => t.name).sort(),
    ["getPet", "listPets"]
  );
  assert.deepEqual(
    kit.search("create").map((t) => t.name),
    ["createPet"]
  );
  assert.deepEqual(kit.search(""), []);
  assert.equal(kit.search("getPet")[0].name, "getPet");
});

test("formatToolList renders an aligned table with a footer count", () => {
  const text = formatToolList(api.tools);
  assert.match(text, /NAME/);
  assert.match(text, /METHOD/);
  assert.match(text, /PATH/);
  assert.match(text, /getPet/);
  assert.match(text, /GET/);
  assert.match(text, /3 tools/);
});

test("formatToolDetail summarises a tool", () => {
  const text = formatToolDetail(api.tools[0]);
  assert.match(text, /getPet/);
  assert.match(text, /Endpoint: GET \/pets\/\{petId\}/);
  assert.match(text, /petId \(path, required, string\)/);
  assert.match(text, /limit \(query, optional, integer\)/);
  assert.match(text, /Tags: pets/);
  assert.match(text, /readOnlyHint=true/);
});
