import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSpecResources,
  listResourceUris,
  formatResourcesSummary,
  type McpResource,
} from "../src/mcp-resources.js";

const spec = {
  openapi: "3.0.0",
  info: { title: "Pet API", version: "1.2.3" },
  servers: [
    { url: "https://api.example.com/v1", description: "prod" },
    { url: "https://staging.example.com/v1" },
  ],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        description: "List all pets",
        responses: { "200": { description: "ok" } },
      },
      post: {
        operationId: "createPet",
        summary: "Create a pet",
        responses: { "201": { description: "created" } },
      },
      parameters: [{ name: "shared", in: "query" }],
    },
    "/pets/{id}": {
      get: {
        // no operationId — should fall back to a slug of method + path
        description: "Fetch one pet",
        responses: { "200": { description: "ok" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
  },
};

test("buildSpecResources produces spec, operations, servers and security resources", () => {
  const resources = buildSpecResources(spec);
  const uris = resources.map((r) => r.uri);

  assert.ok(uris.includes("openapi:spec"));
  assert.ok(uris.includes("openapi:servers"));
  assert.ok(uris.includes("openapi:security"));
  assert.ok(uris.includes("openapi:op/listPets"));
  assert.ok(uris.includes("openapi:op/createPet"));

  // one resource per path+method operation (3 operations in the fixture)
  const ops = resources.filter((r) => r.uri.startsWith("openapi:op/"));
  assert.equal(ops.length, 3);

  // fallback operationId for the operation without one
  assert.ok(uris.includes("openapi:op/get-pets-id"));
});

test("spec resource carries the full JSON spec and application/json mimeType", () => {
  const resources = buildSpecResources(spec);
  const full = resources.find((r) => r.uri === "openapi:spec");
  assert.ok(full);
  assert.equal(full!.mimeType, "application/json");
  assert.equal(full!.text, JSON.stringify(spec));
  assert.match(full!.description ?? "", /Pet API/);
  assert.match(full!.description ?? "", /1\.2\.3/);
});

test("operation resources describe method, path and description", () => {
  const resources = buildSpecResources(spec);
  const list = resources.find((r) => r.uri === "openapi:op/listPets");
  assert.ok(list);
  assert.equal(list!.name, "listPets");
  assert.match(list!.description ?? "", /GET/);
  assert.match(list!.description ?? "", /\/pets/);
  assert.match(list!.description ?? "", /List all pets/);
  assert.equal(list!.mimeType, "application/json");
  const parsed = JSON.parse(list!.text ?? "{}");
  assert.equal(parsed.operationId, "listPets");
  assert.equal(parsed.method, "GET");
  assert.equal(parsed.path, "/pets");

  // summary is used when description is absent
  const create = resources.find((r) => r.uri === "openapi:op/createPet");
  assert.ok(create);
  assert.match(create!.description ?? "", /POST/);
  assert.match(create!.description ?? "", /\/pets/);
  assert.match(create!.description ?? "", /Create a pet/);

  // fallback slug operation has a description too
  const fallback = resources.find((r) => r.uri === "openapi:op/get-pets-id");
  assert.ok(fallback);
  assert.equal(fallback!.name, "get-pets-id");
  assert.match(fallback!.description ?? "", /GET/);
  assert.match(fallback!.description ?? "", /\/pets\/\{id\}/);
  assert.match(fallback!.description ?? "", /Fetch one pet/);
});

test("servers and security resources carry JSON content", () => {
  const resources = buildSpecResources(spec);

  const servers = resources.find((r) => r.uri === "openapi:servers");
  assert.ok(servers);
  assert.equal(servers!.mimeType, "application/json");
  assert.deepEqual(JSON.parse(servers!.text ?? "[]"), spec.servers);
  assert.match(servers!.description ?? "", /2/);
  assert.match(servers!.description ?? "", /https:\/\/api\.example\.com\/v1/);

  const security = resources.find((r) => r.uri === "openapi:security");
  assert.ok(security);
  assert.equal(security!.mimeType, "application/json");
  const schemes = JSON.parse(security!.text ?? "{}");
  assert.ok(schemes.bearerAuth);
  assert.ok(schemes.apiKey);
  assert.match(security!.description ?? "", /bearerAuth/);
  assert.match(security!.description ?? "", /apiKey/);
});

test("baseUri overrides the openapi scheme prefix", () => {
  const resources = buildSpecResources(spec, "myapi");
  const uris = resources.map((r) => r.uri);
  assert.ok(uris.includes("myapi:spec"));
  assert.ok(uris.includes("myapi:op/listPets"));
  assert.ok(uris.includes("myapi:servers"));
  assert.ok(uris.includes("myapi:security"));
  assert.ok(!uris.some((u) => u.startsWith("openapi:")));
});

test("empty/missing spec sections still produce spec, servers and security resources", () => {
  const resources = buildSpecResources({});
  const uris = resources.map((r) => r.uri);
  assert.deepEqual(uris, ["openapi:spec", "openapi:servers", "openapi:security"]);
  assert.equal(JSON.parse(resources[1].text ?? "null").length, 0);
  assert.deepEqual(JSON.parse(resources[2].text ?? "null"), {});
});

test("listResourceUris projects name/uri pairs only", () => {
  const resources = buildSpecResources(spec);
  const list = listResourceUris(resources);
  assert.equal(list.length, resources.length);
  for (const entry of list) {
    assert.deepEqual(Object.keys(entry).sort(), ["name", "uri"]);
  }
  assert.deepEqual(
    list.find((e) => e.uri === "openapi:op/listPets"),
    { name: "listPets", uri: "openapi:op/listPets" },
  );
});

test("formatResourcesSummary reports grouped counts", () => {
  const resources = buildSpecResources(spec);
  const summary = formatResourcesSummary(resources);
  assert.match(summary, /6 total/);
  assert.match(summary, /spec: 1/);
  assert.match(summary, /operations: 3/);
  assert.match(summary, /servers: 1/);
  assert.match(summary, /security: 1/);

  const empty = formatResourcesSummary([]);
  assert.match(empty, /0 total/);
});

test("formatResourcesSummary groups unknown resources as other", () => {
  const custom: McpResource[] = [
    { uri: "openapi:spec", name: "spec" },
    { uri: "custom:thing", name: "thing" },
  ];
  const summary = formatResourcesSummary(custom);
  assert.match(summary, /2 total/);
  assert.match(summary, /spec: 1/);
  assert.match(summary, /other: 1/);
});
