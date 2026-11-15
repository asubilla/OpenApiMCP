import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import {
  searchApisGuru,
  getSpecFromApisGuru,
  formatMarketplaceList,
} from "../src/marketplace.js";

let server: Server;
let port = 0;
let base = "";

const specs: Record<string, any> = {};

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/v2/list.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        petstore: {
          preferred: "1.0.0",
          versions: {
            "1.0.0": {
              info: {
                description: "Pet store API for pets",
                "x-apisguru-categories": ["animals", "pets"],
              },
              swaggerUrl: `${base}/specs/petstore.json`,
            },
          },
        },
        weather: {
          preferred: "2.0.0",
          versions: {
            "2.0.0": {
              info: {
                description: "Weather data service",
                "x-apisguru-categories": ["weather"],
              },
              swaggerUrl: `${base}/specs/weather.json`,
            },
          },
        },
      }));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(specs, url.pathname)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(specs[url.pathname]));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as any).port;
  base = `http://localhost:${port}`;
  specs["/specs/petstore.json"] = { openapi: "3.0.0", info: { title: "Petstore" } };
  specs["/specs/weather.json"] = { openapi: "3.0.0", info: { title: "Weather" } };
});

after(() => {
  server.close();
});

test("search filters by query on name/description/categories", async () => {
  const pets = await searchApisGuru("pet", 20, base);
  assert.equal(pets.length, 1);
  assert.equal(pets[0].name, "petstore");

  const weather = await searchApisGuru("weather", 20, base);
  assert.equal(weather.length, 1);
  assert.equal(weather[0].name, "weather");

  const animals = await searchApisGuru("animals", 20, base);
  assert.equal(animals.length, 1);
  assert.equal(animals[0].name, "petstore");
});

test("search respects limit", async () => {
  const all = await searchApisGuru("", 1, base);
  assert.equal(all.length, 1);
});

test("search returns [] on network error", async () => {
  const result = await searchApisGuru("pet", 10, "http://localhost:65530");
  assert.deepEqual(result, []);
});

test("getSpecFromApisGuru returns url and spec", async () => {
  const result = await getSpecFromApisGuru("petstore", base);
  assert.ok(result);
  assert.equal(result!.url, `${base}/specs/petstore.json`);
  assert.equal(result!.spec.openapi, "3.0.0");
});

test("getSpecFromApisGuru returns null for unknown", async () => {
  const result = await getSpecFromApisGuru("nope", base);
  assert.equal(result, null);
});

test("formatMarketplaceList produces aligned table", () => {
  const out = formatMarketplaceList([
    { name: "petstore", description: "Pet store API for pets", specUrl: "http://example.com/pet.json" },
  ]);
  assert.match(out, /petstore/);
  assert.match(out, /Pet store API for pets/);
  assert.match(out, /http:\/\/example.com\/pet.json/);
  const long = "a".repeat(100);
  const out2 = formatMarketplaceList([{ name: "x", description: long, specUrl: "u" }]);
  assert.ok(!out2.includes("a".repeat(61)));
});
