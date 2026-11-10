import { test } from "node:test";
import assert from "node:assert/strict";
import { postmanToOperations } from "../src/postman.js";

test("walks nested folders and flattens operations", () => {
  const collection = {
    info: { name: "Demo" },
    item: [
      {
        name: "Pets",
        item: [
          { name: "List Pets", request: { method: "GET", url: { raw: "https://api.test/v1/pets?limit=10" } } },
          {
            name: "Store",
            item: [{ name: "Create Pet", request: { method: "POST", url: { path: ["v1", "pets"] } } }]
          }
        ]
      }
    ]
  };

  const ops = postmanToOperations(collection);
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0], { name: "List Pets", method: "GET", path: "/v1/pets" });
  assert.deepEqual(ops[1], { name: "Create Pet", method: "POST", path: "/v1/pets" });
});

test("string requests default to GET", () => {
  const ops = postmanToOperations({ item: [{ name: "Health", request: "https://api.test/health" }] });
  assert.deepEqual(ops, [{ name: "Health", method: "GET", path: "/health" }]);
});

test("url.raw without a scheme keeps the path", () => {
  const ops = postmanToOperations({ item: [{ name: "One", request: { url: { raw: "{{baseUrl}}/users/42" } } }] });
  assert.equal(ops[0].method, "GET");
  assert.equal(ops[0].path, "/users/42");
});

test("method is uppercased", () => {
  const ops = postmanToOperations({ item: [{ name: "Del", request: { method: "delete", url: "/pets/1" } }] });
  assert.equal(ops[0].method, "DELETE");
});

test("url.path array is joined with a leading slash", () => {
  const ops = postmanToOperations({ item: [{ name: "Nested", request: { method: "put", url: { path: ["", "a", "b", ""] } } }] });
  assert.equal(ops[0].path, "/a/b");
});

test("query strings and fragments are stripped from raw urls", () => {
  const ops = postmanToOperations({ item: [{ name: "Q", request: "https://x.test/a/b?c=d#frag" }] });
  assert.equal(ops[0].path, "/a/b");
});

test("description is included only when present", () => {
  const ops = postmanToOperations({
    item: [
      { name: "With", request: { method: "GET", url: "/a", description: "hi" } },
      { name: "Without", request: { method: "GET", url: "/b" } }
    ]
  });
  assert.equal(ops[0].description, "hi");
  assert.ok(!Object.prototype.hasOwnProperty.call(ops[1], "description"));
});

test("empty or malformed input yields an empty list", () => {
  assert.deepEqual(postmanToOperations({}), []);
  assert.deepEqual(postmanToOperations({ item: "nope" }), []);
  assert.deepEqual(postmanToOperations(null), []);
  assert.deepEqual(postmanToOperations({ item: [null, 3, { name: "folder", item: [] }] }), []);
});
