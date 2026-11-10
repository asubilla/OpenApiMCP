import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, redactText } from "../src/redact.js";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

test("redact hides sensitive keys but keeps safe fields", () => {
  const input = {
    name: "Alice",
    age: 30,
    password: "hunter2",
    nested: { token: "abc", keep: true },
    headers: { Authorization: "Basic zzz" }
  };
  const out = redact(input);
  assert.equal(out.name, "Alice");
  assert.equal(out.age, 30);
  assert.equal(out.nested.keep, true);
  assert.equal(out.password, "***");
  assert.equal(out.nested.token, "***");
  assert.equal(out.headers.Authorization, "***");
});

test("redact masks JWTs, bearer tokens and card-like strings in values", () => {
  const out = redact({
    message: `here is the token ${JWT} ok`,
    header: "Bearer abc.def-ghi",
    card: "4111 1111 1111 1111",
    safe: "just some ordinary text"
  });
  assert.ok(!out.message.includes(JWT));
  assert.ok(out.message.includes("***"));
  assert.ok(!out.header.includes("abc.def-ghi"));
  assert.ok(!out.card.includes("4111"));
  assert.equal(out.safe, "just some ordinary text");
});

test("redact does not mutate the input", () => {
  const input = { password: "p", list: [{ token: "t" }] };
  const snapshot = JSON.stringify(input);
  const out = redact(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(out, input);
  assert.notEqual(out.list, input.list);
  assert.notEqual(out.list[0], input.list[0]);
  assert.equal(out.password, "***");
});

test("redact handles cyclic structures", () => {
  const node: { name: string; password: string; self?: unknown } = { name: "n", password: "p" };
  node.self = node;
  const out = redact(node);
  assert.equal(out.name, "n");
  assert.equal(out.password, "***");
  assert.equal((out as { self: unknown }).self, out);
});

test("redact supports extra keys and a custom mask", () => {
  const out = redact(
    { sessionId: "abc", password: "p", keep: 1 },
    { keys: ["session"], mask: "[HIDDEN]" }
  );
  assert.equal(out.sessionId, "[HIDDEN]");
  assert.equal(out.password, "[HIDDEN]");
  assert.equal(out.keep, 1);
});

test("redactText masks matching patterns and leaves plain text", () => {
  assert.equal(redactText("Bearer abc123"), "***");
  assert.ok(redactText(`token=${JWT}`).includes("***"));
  assert.ok(!redactText(`token=${JWT}`).includes(JWT));
  assert.equal(redactText("nothing to hide"), "nothing to hide");
});

test("redactText honours a custom mask and extra patterns", () => {
  assert.equal(redactText("Bearer abc123", { mask: "[X]" }), "[X]");
  assert.equal(redactText("id 12345", { patterns: [/\d+/], mask: "#" }), "id #");
});
