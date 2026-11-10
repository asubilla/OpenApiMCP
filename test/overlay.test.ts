import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOverlay } from "../src/overlay.js";

function baseSpec(): any {
  return {
    openapi: "3.0.0",
    info: { title: "Pet API", version: "1.0.0", contact: { name: "old" } },
    paths: {
      "/pets": {
        get: {
          summary: "list pets",
          parameters: [{ name: "limit", in: "query" }],
          responses: { "200": { description: "ok" } }
        },
        delete: { responses: { "204": {} } }
      }
    }
  };
}

test("update deep-merges into an object target", () => {
  const spec = baseSpec();
  const out = applyOverlay(spec, {
    actions: [{ target: "$.info", update: { title: "Pet API v2", contact: { email: "a@b.c" } } }]
  });
  assert.equal(out.info.title, "Pet API v2");
  assert.equal(out.info.version, "1.0.0");
  assert.deepEqual(out.info.contact, { name: "old", email: "a@b.c" });
});

test("update targets a nested operation", () => {
  const out = applyOverlay(baseSpec(), {
    actions: [{ target: "$.paths['/pets'].get", update: { summary: "list all pets", deprecated: true } }]
  });
  assert.equal(out.paths["/pets"].get.summary, "list all pets");
  assert.equal(out.paths["/pets"].get.deprecated, true);
  assert.ok(Array.isArray(out.paths["/pets"].get.parameters));
});

test("array targets are replaced, not merged", () => {
  const out = applyOverlay(baseSpec(), {
    actions: [{ target: "$.paths['/pets'].get.parameters", update: [{ name: "page", in: "query" }] }]
  });
  assert.deepEqual(out.paths["/pets"].get.parameters, [{ name: "page", in: "query" }]);
});

test("remove deletes the target", () => {
  const out = applyOverlay(baseSpec(), {
    actions: [{ target: "$.paths['/pets'].delete", remove: true }]
  });
  assert.equal(out.paths["/pets"].delete, undefined);
  assert.ok(out.paths["/pets"].get);
});

test("removing a missing target is a no-op", () => {
  const out = applyOverlay(baseSpec(), {
    actions: [{ target: "$.paths['/pets'].put", remove: true }]
  });
  assert.deepEqual(Object.keys(out.paths["/pets"]).sort(), ["delete", "get"]);
});

test("inputs are never mutated", () => {
  const spec = baseSpec();
  const overlay = { actions: [{ target: "$.info", update: { title: "changed" } }, { target: "$.paths['/pets'].delete", remove: true }] };
  const snapshot = structuredClone(spec);
  applyOverlay(spec, overlay);
  assert.deepEqual(spec, snapshot);
  assert.equal(overlay.actions[0].update.title, "changed");
});

test("multiple actions apply in order", () => {
  const out = applyOverlay(baseSpec(), {
    actions: [
      { target: "$.info", update: { version: "2.0.0" } },
      { target: "$.paths['/pets']", update: { post: { responses: { "201": {} } } } }
    ]
  });
  assert.equal(out.info.version, "2.0.0");
  assert.ok(out.paths["/pets"].post);
});

test("actions without a valid target are ignored", () => {
  const spec = baseSpec();
  const out = applyOverlay(spec, { actions: [null, {}, { target: "$" }] });
  assert.deepEqual(out, spec);
});

test("no actions returns a clone", () => {
  const spec = baseSpec();
  const out = applyOverlay(spec, {});
  assert.deepEqual(out, spec);
  assert.notEqual(out, spec);
});
