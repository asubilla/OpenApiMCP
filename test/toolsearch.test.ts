import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolDef } from "../src/types.js";
import {
  rankTools,
  describeProgressiveTools,
  TOOL_SEARCH_NAME,
  TOOL_CALL_NAME,
} from "../src/toolsearch.js";

function tool(name: string, description = "", tags: string[] = []): ToolDef {
  return {
    name,
    description,
    method: "GET",
    path: "/",
    params: [],
    bodyObject: false,
    tags,
    annotations: {},
    security: { headers: {}, query: {} },
  };
}

function names(tools: ToolDef[]): string[] {
  return tools.map((t) => t.name);
}

test("ranks name matches over tag matches over description matches", () => {
  const byName = tool("getPet"); // "pet" in name -> 3
  const byTag = tool("updateInventory", "adjust stock", ["pet"]); // -> 2
  const byDescription = tool("sendReport", "monthly pet statistics"); // -> 1
  const result = rankTools([byDescription, byTag, byName], "pet");
  assert.deepEqual(names(result), ["getPet", "updateInventory", "sendReport"]);
});

test("breaks score ties by ascending name", () => {
  const beta = tool("betaOperation", "", ["pet"]);
  const alpha = tool("alphaOperation", "", ["pet"]);
  const result = rankTools([beta, alpha], "pet");
  assert.deepEqual(names(result), ["alphaOperation", "betaOperation"]);
});

test("supports multiple weighted tokens", () => {
  const strong = tool("listPets", "list all pets", ["pets"]);
  const weak = tool("listReports", "monthly summary", []);
  const result = rankTools([weak, strong], "list pets");
  // strong: list(name)3 + pets(name)3 + pets(tag)2 + list(desc)1 + pets(desc)1 = 10
  // weak:  list(name)3 = 3
  assert.deepEqual(names(result), ["listPets", "listReports"]);
});

test("respects the limit", () => {
  const tools = [tool("a"), tool("b"), tool("c")];
  assert.equal(rankTools(tools, "", 2).length, 2);
  assert.deepEqual(names(rankTools(tools, "", 2)), ["a", "b"]);
});

test("applies the limit to ranked query results", () => {
  const tools = [tool("getPet"), tool("updateInventory", "", ["pet"]), tool("sendReport", "pet stuff")];
  assert.deepEqual(names(rankTools(tools, "pet", 1)), ["getPet"]);
});

test("empty query returns the first limit tools by name", () => {
  const tools = [tool("zebra"), tool("apple"), tool("mango")];
  assert.deepEqual(names(rankTools(tools, "")), ["apple", "mango", "zebra"]);
});

test("non-alphanumeric query behaves like an empty query", () => {
  const tools = [tool("zebra"), tool("apple"), tool("mango")];
  assert.deepEqual(names(rankTools(tools, "  !!!  ")), ["apple", "mango", "zebra"]);
});

test("defaults to a limit of 15", () => {
  const tools = Array.from({ length: 20 }, (_, i) => tool(`op${String(i).padStart(2, "0")}`));
  const result = rankTools(tools, "");
  assert.equal(result.length, 15);
  assert.equal(result[0]!.name, "op00");
  assert.equal(result[14]!.name, "op14");
});

test("tokenizes case-insensitively and splits on punctuation", () => {
  const tools = [tool("getPet"), tool("createOrder")];
  const result = rankTools(tools, "Get Pet!");
  assert.deepEqual(names(result), ["getPet", "createOrder"]);
});

test("exposes the search and call tool names", () => {
  assert.equal(TOOL_SEARCH_NAME, "search_tools");
  assert.equal(TOOL_CALL_NAME, "call_tool");
});

test("describes progressive disclosure tools that search then call by name", () => {
  const described = describeProgressiveTools();
  assert.equal(described.search.name, TOOL_SEARCH_NAME);
  assert.equal(described.call.name, TOOL_CALL_NAME);
  assert.match(described.search.description, /search/i);
  assert.match(described.search.description, /call_tool/);
  assert.match(described.call.description, /exact tool name/i);
  assert.match(described.call.description, /search_tools/);
});
