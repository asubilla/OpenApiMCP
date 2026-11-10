import { test } from "node:test";
import assert from "node:assert/strict";
import { generateClient, sanitizeMethodName } from "../src/clientgen.js";

const spec = {
  openapi: "3.0.0",
  info: { title: "Pet Store", version: "1.0.0" },
  servers: [{ url: "https://api.petstore.test/v1" }],
  paths: {
    "/pets/{petId}": {
      get: {
        operationId: "get-pet",
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
        responses: {}
      },
      delete: {
        operationId: "deletePet",
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
        responses: {}
      }
    },
    "/pets": {
      get: {
        operationId: "listPets",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 20 } }],
        responses: {}
      },
      post: {
        operationId: "createPet",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" }, age: { type: "integer" } }
              }
            }
          }
        },
        responses: {}
      }
    }
  }
};

test("generateClient returns a string map with client.ts and types.ts", () => {
  const files = generateClient(spec);
  assert.deepEqual(Object.keys(files).sort(), ["client.ts", "types.ts"]);
  assert.equal(typeof files["client.ts"], "string");
  assert.equal(typeof files["types.ts"], "string");
});

test("client.ts contains one method per operation and uses fetch + base URL", () => {
  const client = generateClient(spec)["client.ts"];
  for (const name of ["getPet", "deletePet", "listPets", "createPet"]) {
    assert.match(client, new RegExp(name));
  }
  assert.match(client, /export class PetStore/);
  assert.match(client, /fetch/);
  assert.match(client, /https:\/\/api\.petstore\.test\/v1/);
  assert.match(client, /method: "GET"/);
  assert.match(client, /method: "POST"/);
});

test("types.ts declares a params interface per operation", () => {
  const types = generateClient(spec)["types.ts"];
  assert.match(types, /export interface GetPetParams/);
  assert.match(types, /petId: string;/);
  assert.match(types, /limit\?: number;/);
  assert.match(types, /name: string;/);
  assert.match(types, /age\?: number;/);
});

test("generateClient is deterministic", () => {
  assert.deepEqual(generateClient(spec), generateClient(spec));
});

test("opts.name overrides the generated class name", () => {
  const client = generateClient(spec, { name: "pets" })["client.ts"];
  assert.match(client, /export class Pets/);
});

test("sanitizeMethodName produces valid camelCase identifiers", () => {
  assert.equal(sanitizeMethodName("get-user"), "getUser");
  assert.equal(sanitizeMethodName("Get Pet By Id"), "getPetById");
  assert.equal(sanitizeMethodName("getUser"), "getUser");
  assert.equal(sanitizeMethodName("GET_USERS"), "getUsers");
  assert.equal(sanitizeMethodName("pet.store/getById"), "petStoreGetById");
  assert.equal(sanitizeMethodName("123 start"), "op123Start");
  assert.equal(sanitizeMethodName(""), "operation");
  assert.equal(sanitizeMethodName("!!!"), "operation");
  assert.match(sanitizeMethodName("hello-world"), /^[A-Za-z_$][A-Za-z0-9_$]*$/);
});
