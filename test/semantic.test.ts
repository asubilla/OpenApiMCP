import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolDef } from "../src/types.js";
import {
  createSemanticRouter,
  cosineSimilarity,
  defaultEmbedding,
} from "../src/semantic.js";

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

test("defaultEmbedding is deterministic", () => {
  const a = defaultEmbedding("hello world");
  const b = defaultEmbedding("hello world");
  assert.deepEqual(a, b);
  assert.equal(a.length, 64);
});

test("defaultEmbedding respects dimensions", () => {
  assert.equal(defaultEmbedding("hello", 16).length, 16);
});

test("cosineSimilarity identical vectors is 1", () => {
  const v = [1, 2, 3, 4];
  assert.equal(cosineSimilarity(v, v), 1);
});

test("index+route returns relevant tool first", () => {
  const router = createSemanticRouter(defaultEmbedding);
  const tools = [
    tool("createOrder", "Create a new order", ["orders"]),
    tool("getPet", "Retrieve a pet by ID", ["pets"]),
    tool("listUsers", "List all users", ["users"]),
  ];
  router.index(tools);
  const res = router.route("retrieve pet by id");
  assert.ok(res.length > 0);
  assert.equal(res[0].tool.name, "getPet");
});

test("topK limits results", () => {
  const router = createSemanticRouter(defaultEmbedding);
  const tools = [tool("a"), tool("b"), tool("c"), tool("d")];
  router.index(tools);
  const res = router.route("anything", 2);
  assert.equal(res.length, 2);
});

test("isIndexed and size tracking", () => {
  const router = createSemanticRouter(defaultEmbedding);
  assert.equal(router.isIndexed(), false);
  assert.equal(router.size(), 0);
  const tools = [tool("a"), tool("b")];
  router.index(tools);
  assert.equal(router.isIndexed(), true);
  assert.equal(router.size(), 2);
});

test("route on empty index returns []", () => {
  const router = createSemanticRouter(defaultEmbedding);
  router.index([]);
  assert.deepEqual(router.route("query"), []);
  const r2 = createSemanticRouter(defaultEmbedding);
  assert.deepEqual(r2.route("query"), []);
});
