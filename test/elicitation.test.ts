import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildElicitationRequest,
  validateElicitationResponse,
  formatElicitationRequest,
} from "../src/elicitation.js";

test("build request", () => {
  const fields = [{ name: "name", type: "string" as const, required: true }];
  const req = buildElicitationRequest("Please provide info", fields, "https://example.com");
  assert.equal(req.message, "Please provide info");
  assert.equal(req.fields.length, 1);
  assert.equal(req.url, "https://example.com");
});

test("validate success", () => {
  const fields = [
    { name: "name", type: "string" as const, required: true },
    { name: "age", type: "number" as const, required: true },
    { name: "active", type: "boolean" as const },
    { name: "color", type: "enum" as const, enumValues: ["red", "blue"] },
  ];
  const res = validateElicitationResponse(fields, { name: "Alice", age: 30, active: true, color: "red" });
  assert.equal(res.valid, true);
  assert.deepEqual(res.errors, []);
});

test("validate missing required", () => {
  const fields = [{ name: "name", type: "string" as const, required: true }];
  const res = validateElicitationResponse(fields, {});
  assert.equal(res.valid, false);
  assert.ok(res.errors.length > 0);
});

test("validate enum mismatch", () => {
  const fields = [{ name: "color", type: "enum" as const, enumValues: ["red", "blue"] }];
  const res = validateElicitationResponse(fields, { color: "green" });
  assert.equal(res.valid, false);
  assert.ok(res.errors.length > 0);
});

test("validate type mismatch", () => {
  const fields = [{ name: "age", type: "number" as const, required: true }];
  const res = validateElicitationResponse(fields, { age: "not-a-number" });
  assert.equal(res.valid, false);
  assert.ok(res.errors.length > 0);
});

test("format contains message", () => {
  const req = buildElicitationRequest("hello world", [{ name: "x", type: "string" }]);
  const out = formatElicitationRequest(req);
  assert.ok(out.includes("hello world"));
  assert.ok(out.includes("\n"));
});