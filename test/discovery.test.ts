import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import {
  discoverSpec,
  normalizeDomain,
  isValidSpec,
  SPEC_PATHS,
} from "../src/discovery.js";

const realFetch = global.fetch;

let server: Server;
let port = 0;
let base = "";
const specs: Record<string, string> = {};
let registryMock: any = null;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (Object.prototype.hasOwnProperty.call(specs, url.pathname)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(specs[url.pathname]);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as any).port;
  base = `http://localhost:${port}`;

  global.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url;
    if (typeof url === "string" && url.startsWith("https://api.apis.guru")) {
      if (registryMock) {
        return new Response(JSON.stringify(registryMock), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }
    return realFetch(input, init);
  }) as any;
});

after(() => {
  global.fetch = realFetch;
  server.close();
});

test("SPEC_PATHS exact list", () => {
  assert.deepEqual(SPEC_PATHS, [
    "/openapi.json",
    "/openapi.yaml",
    "/swagger.json",
    "/swagger/v1/swagger.json",
    "/api-docs",
    "/v3/api-docs",
    "/docs/openapi.json",
    "/api/openapi.json",
    "/openapi/v3.json",
  ]);
});

test("normalizeDomain handles protocols/ports/trailing slashes", () => {
  assert.equal(normalizeDomain("https://Example.com/"), "https://example.com");
  assert.equal(normalizeDomain("http://example.com:8080/path"), "http://example.com");
  assert.equal(normalizeDomain("example.com:3000/"), "https://example.com");
  assert.equal(normalizeDomain("EXAMPLE.COM"), "https://example.com");
  assert.equal(normalizeDomain("https://example.com:443"), "https://example.com");
});

test("isValidSpec validates spec shape", () => {
  assert.equal(isValidSpec({ openapi: "3.0.0" }), true);
  assert.equal(isValidSpec({ swagger: "2.0" }), true);
  assert.equal(isValidSpec({ foo: "bar" }), false);
  assert.equal(isValidSpec(null), false);
  assert.equal(isValidSpec("x"), false);
});

test("discovers /openapi.json", async () => {
  specs["/openapi.json"] = JSON.stringify({ openapi: "3.0.0", info: { title: "x" } });
  try {
    const result = await discoverSpec(base);
    assert.equal(result?.url, `${base}/openapi.json`);
    assert.equal(result?.spec?.openapi, "3.0.0");
  } finally {
    delete specs["/openapi.json"];
  }
});

test("falls back to /swagger.json", async () => {
  specs["/swagger.json"] = JSON.stringify({ swagger: "2.0" });
  try {
    const result = await discoverSpec(base);
    assert.equal(result?.url, `${base}/swagger.json`);
    assert.equal(result?.spec?.swagger, "2.0");
  } finally {
    delete specs["/swagger.json"];
  }
});

test("returns null when none", async () => {
  const result = await discoverSpec(base);
  assert.equal(result, null);
});

test("skips invalid spec shape", async () => {
  specs["/openapi.json"] = JSON.stringify({ foo: "bar" });
  try {
    const result = await discoverSpec(base);
    assert.equal(result, null);
  } finally {
    delete specs["/openapi.json"];
  }
});

test("uses APIs.guru registry", async () => {
  const specUrl = `${base}/registry-spec.json`;
  specs["/registry-spec.json"] = JSON.stringify({ openapi: "3.1.0" });
  registryMock = {
    preferred: "1.0.0",
    versions: { "1.0.0": { swaggerUrl: specUrl } },
  };
  try {
    const result = await discoverSpec(base);
    assert.equal(result?.url, specUrl);
    assert.equal(result?.spec?.openapi, "3.1.0");
  } finally {
    registryMock = null;
    delete specs["/registry-spec.json"];
  }
});