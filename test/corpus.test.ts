import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDocument, loadDocumentRaw, parseDocument } from "../src/openapi.js";
import { analyzeSpecCompat } from "../src/compat.js";
import { lintSpec } from "../src/lint.js";
import { pinFromSpec } from "../src/spec-pin.js";
import { bundleDocument } from "../src/spec-bundle.js";

const corpus = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "corpus");

const PETSTORE = join(corpus, "petstore3.openapi.json");
const HTTPBIN = join(corpus, "httpbin.openapi.json"); // Swagger 2.0
const POKEAPI = join(corpus, "pokeapi.openapi.yml");   // OpenAPI 3.1, cyclic $refs

const opCount = (doc: any): number => {
  let n = 0;
  for (const item of Object.values<any>(doc?.paths ?? {})) {
    for (const m of ["get", "post", "put", "patch", "delete", "head", "options"]) if (item?.[m]) n++;
  }
  return n;
};

test("corpus: petstore3 (OpenAPI 3.0.4) loads and has tools", async () => {
  const doc = await loadDocument(PETSTORE);
  assert.equal(opCount(doc), 19);
  const api = parseDocument(doc);
  assert.ok(api.tools.length >= 15);
  assert.equal(api.title, "Swagger Petstore - OpenAPI 3.0");
});

test("corpus: httpbin (Swagger 2.0) loads and has tools", async () => {
  const doc = await loadDocument(HTTPBIN);
  assert.ok(opCount(doc) >= 50);
  const api = parseDocument(doc);
  assert.ok(api.tools.length >= 50);
  assert.ok(["https://httpbin.org", "https://httpbin.org/"].includes(api.baseUrls[0]));
});

test("corpus: PokeAPI (OpenAPI 3.1, cyclic $refs) loads without hanging", async () => {
  const doc = await loadDocument(POKEAPI);
  assert.ok(opCount(doc) >= 100);
  const api = parseDocument(doc);
  assert.ok(api.tools.length >= 100);
});

test("corpus: compat report on a cyclic spec does not crash", async () => {
  const doc = await loadDocument(POKEAPI);
  const report = analyzeSpecCompat(doc);
  const total = report.summary.supported + report.summary.partial + report.summary.unsupported;
  assert.equal(total, opCount(doc));
  assert.ok(report.summary.supported > 0);
});

test("corpus: compat report on petstore3 flags the non-JSON body ops only", async () => {
  const doc = await loadDocument(PETSTORE);
  const report = analyzeSpecCompat(doc);
  const total = report.summary.supported + report.summary.partial + report.summary.unsupported;
  assert.equal(total, 19);
  const unsupported = report.entries.filter((e) => e.status === "unsupported").map((e) => e.operationId);
  assert.ok(unsupported.includes("addPet"));
  assert.ok(unsupported.includes("uploadFile"));
  assert.ok(!unsupported.includes("getPetById"));
});

test("corpus: lint survives cyclic schemas", async () => {
  const doc = await loadDocument(POKEAPI);
  const result = lintSpec(doc);
  assert.ok(typeof result.score === "number");
  assert.ok(result.summary.errors + result.summary.warnings + result.summary.infos === result.issues.length);
});

test("corpus: pin hashing survives cyclic schemas", async () => {
  const doc = await loadDocument(POKEAPI);
  const pin = pinFromSpec("https://raw.githubusercontent.com/PokeAPI/pokeapi/master/openapi.yml", doc);
  assert.match(pin.hash, /^[0-9a-f]{64}$/);
  assert.equal(pin.specVersion, "2.10.0");
});

test("corpus: bundle on a cyclic spec does not hang or crash", async () => {
  const raw = await loadDocumentRaw(POKEAPI);
  const bundled = await bundleDocument(raw, async () => { throw new Error("no external refs expected"); });
  assert.ok(bundled.paths && Object.keys(bundled.paths).length >= 100);
});

test("corpus: fixture manifests stay parseable", () => {
  const a = JSON.parse(readFileSync(PETSTORE, "utf8"));
  const b = JSON.parse(readFileSync(HTTPBIN, "utf8"));
  assert.ok(a.openapi.startsWith("3."));
  assert.ok(b.swagger.startsWith("2."));
});
