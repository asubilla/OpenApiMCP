import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkflowContext,
  resolveArgs,
  validateWorkflow,
  formatWorkflow,
} from "../src/workflow.js";

test("createWorkflowContext get/set", () => {
  const ctx = createWorkflowContext();
  assert.deepEqual(ctx.results, {});
  ctx.set("answer", 42);
  assert.equal(ctx.get("answer"), 42);
  assert.equal(ctx.results.answer, 42);
  ctx.set("nested.value", { a: 1 });
  assert.deepEqual(ctx.get("nested.value"), { a: 1 });
});

test("resolveArgs replaces placeholders", () => {
  const ctx = createWorkflowContext();
  ctx.set("user", { id: 7, name: "Ada" });
  ctx.set("step1", { result: { token: "abc" } });

  const step = {
    tool: "doThing",
    args: {
      userId: "{{user.id}}",
      userName: "{{user.name}}",
      whole: "{{user}}",
      token: "{{step1.result.token}}",
      embedded: "user={{user.id}} token={{step1.result.token}}",
      plain: "no placeholders",
      list: ["{{user.id}}", 2],
      obj: { id: "{{user.id}}" },
    },
  };

  const resolved = resolveArgs(step, ctx);
  assert.equal(resolved.userId, 7);
  assert.equal(resolved.userName, "Ada");
  assert.deepEqual(resolved.whole, { id: 7, name: "Ada" });
  assert.equal(resolved.token, "abc");
  assert.equal(resolved.embedded, "user=7 token=abc");
  assert.equal(resolved.plain, "no placeholders");
  assert.deepEqual(resolved.list, [7, 2]);
  assert.deepEqual(resolved.obj, { id: 7 });
});

test("resolveArgs tolerates unwrapped step results", () => {
  const ctx = createWorkflowContext();
  ctx.set("step1", { token: "xyz" });
  const resolved = resolveArgs(
    { tool: "t", args: { token: "{{step1.result.token}}" } },
    ctx,
  );
  assert.equal(resolved.token, "xyz");
});

test("validateWorkflow valid", () => {
  const result = validateWorkflow({
    name: "wf",
    steps: [
      { tool: "a", saveAs: "r1" },
      { tool: "b", args: { x: 1 } },
    ],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateWorkflow errors", () => {
  const empty = validateWorkflow({ name: "wf", steps: [] });
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.length > 0);

  const noTool = validateWorkflow({ name: "wf", steps: [{}] as any });
  assert.equal(noTool.valid, false);

  const dup = validateWorkflow({
    name: "wf",
    steps: [
      { tool: "a", saveAs: "r" },
      { tool: "b", saveAs: "r" },
    ],
  });
  assert.equal(dup.valid, false);
  assert.ok(dup.errors.some((e) => e.includes("duplicate saveAs")));
});

test("formatWorkflow contains step names", () => {
  const out = formatWorkflow({
    name: "MyFlow",
    description: "does things",
    steps: [{ tool: "fetchUser" }, { tool: "sendEmail", saveAs: "sent" }],
  });
  assert.ok(out.includes("MyFlow"));
  assert.ok(out.includes("fetchUser"));
  assert.ok(out.includes("sendEmail"));
  assert.ok(out.includes("sent"));
});
