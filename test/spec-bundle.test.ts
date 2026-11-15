import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleDocument, extractExternalRefs, rewriteRelativeRefs } from "../src/spec-bundle.js";

test("extractExternalRefs finds nested refs and dedupes", () => {
  const doc = {
    openapi: "3.0.0",
    paths: {
      "/pets": {
        get: {
          parameters: [
            { name: "x", in: "query", schema: { $ref: "https://h/schemas/param.json" } }
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "https://h/schemas/pet.json" }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        Pet: { $ref: "https://h/schemas/pet.json" },
        Owner: { $ref: "https://h/schemas/owner.json#/components/schemas/Owner" },
        Local: { $ref: "#/components/schemas/Pet" },
        Relative: { $ref: "./local.json" }
      }
    }
  };
  const refs = extractExternalRefs(doc);
  assert.deepEqual(refs, [
    "https://h/schemas/param.json",
    "https://h/schemas/pet.json",
    "https://h/schemas/owner.json"
  ]);
});

test("rewriteRelativeRefs resolves ./x.json against the doc directory", () => {
  const doc = {
    a: { $ref: "./x.json" },
    b: { $ref: "../schema.yaml" },
    c: { $ref: "#/components/schemas/Local" },
    d: { $ref: "https://other/abs.json" },
    e: { nested: [{ $ref: "deep/nested.json#/frag" }] }
  };
  const out = rewriteRelativeRefs(doc, "https://h/specs/api.json");
  assert.equal(out.a.$ref, "https://h/specs/x.json");
  assert.equal(out.b.$ref, "https://h/schema.yaml");
  assert.equal(out.c.$ref, "#/components/schemas/Local");
  assert.equal(out.d.$ref, "https://other/abs.json");
  assert.equal(out.e.nested[0].$ref, "https://h/specs/deep/nested.json#/frag");
  // Input document is not mutated.
  assert.equal(doc.a.$ref, "./x.json");
});

test("bundleDocument inlines an external ref and leaves local refs alone", async () => {
  const doc = {
    paths: {
      "/pets": {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "https://h/schemas/pet.json" }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        Local: { $ref: "#/components/schemas/Pet" }
      }
    }
  };
  const petSchema = { type: "object", properties: { id: { type: "integer" } } };
  const fetchRef = async (url: string) => {
    assert.equal(url, "https://h/schemas/pet.json");
    return petSchema;
  };
  const out = await bundleDocument(doc, fetchRef);
  assert.deepEqual(out.paths["/pets"].get.responses["200"].content["application/json"].schema, petSchema);
  assert.deepEqual(out.components.schemas.Local, { $ref: "#/components/schemas/Pet" });
});

test("bundleDocument caches duplicate URLs and fetches each only once", async () => {
  const doc = {
    a: { $ref: "https://h/shared.json" },
    b: { nested: { $ref: "https://h/shared.json" } },
    c: [{ $ref: "https://h/shared.json" }]
  };
  let calls = 0;
  const fetchRef = async (_url: string) => {
    calls += 1;
    return { type: "object", properties: { id: { type: "string" } } };
  };
  const out = await bundleDocument(doc, fetchRef);
  assert.equal(calls, 1);
  assert.deepEqual(out.a, out.b.nested);
  assert.deepEqual(out.a, out.c[0]);
});

test("bundleDocument throws a clear error when fetch fails", async () => {
  const doc = { a: { $ref: "https://h/missing.json" } };
  const fetchRef = async (_url: string): Promise<any> => {
    throw new Error("boom");
  };
  await assert.rejects(() => bundleDocument(doc, fetchRef), /failed to fetch https:\/\/h\/missing\.json: boom/);
});

test("bundleDocument enforces maxExternalRefs", async () => {
  const doc = {
    a: { $ref: "https://h/a.json" },
    b: { $ref: "https://h/b.json" }
  };
  const fetchRef = async (_url: string) => ({ type: "object" });
  await assert.rejects(
    () => bundleDocument(doc, fetchRef, { maxExternalRefs: 1 }),
    /maxExternalRefs/
  );
});

test("bundleDocument resolves fragment refs against the fetched document", async () => {
  const doc = { a: { $ref: "https://h/api.json#/components/schemas/Pet" } };
  const fetchRef = async (_url: string) => ({
    components: { schemas: { Pet: { type: "object", title: "Pet" } } }
  });
  const out = await bundleDocument(doc, fetchRef);
  assert.deepEqual(out.a, { type: "object", title: "Pet" });
});
