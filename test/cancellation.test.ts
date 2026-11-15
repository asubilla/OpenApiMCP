import { test } from "node:test";
import assert from "node:assert/strict";
import { CancellationToken, CancellationRegistry, withCancellation } from "../src/cancellation.js";

test("token cancel and isCancelled", () => {
  const token = new CancellationToken();
  assert.equal(token.isCancelled(), false);
  token.cancel();
  assert.equal(token.isCancelled(), true);
  token.cancel();
  assert.equal(token.isCancelled(), true);
});

test("onCancel callback fires", () => {
  const token = new CancellationToken();
  let fired = false;
  token.onCancel(() => {
    fired = true;
  });
  token.cancel();
  assert.equal(fired, true);
});

test("throwIfCancelled throws when cancelled", () => {
  const token = new CancellationToken();
  token.cancel();
  assert.throws(() => token.throwIfCancelled(), /Cancelled/);
  const other = new CancellationToken();
  assert.doesNotThrow(() => other.throwIfCancelled());
});

test("registry register/cancel/get/remove/cancelAll/activeCount", () => {
  const reg = new CancellationRegistry();
  const t1 = new CancellationToken();
  const t2 = new CancellationToken();
  reg.register("a", t1);
  reg.register("b", t2);
  assert.equal(reg.activeCount(), 2);
  assert.equal(reg.get("a"), t1);
  assert.equal(reg.cancel("a"), true);
  assert.equal(reg.cancel("missing"), false);
  assert.equal(t1.isCancelled(), true);
  reg.remove("a");
  assert.equal(reg.get("a"), undefined);
  assert.equal(reg.activeCount(), 1);
  reg.cancelAll();
  assert.equal(t2.isCancelled(), true);
});

test("withCancellation resolves on success", async () => {
  const token = new CancellationToken();
  const result = await withCancellation(token, async () => 42);
  assert.equal(result, 42);
});

test("withCancellation rejects if already cancelled", async () => {
  const token = new CancellationToken();
  token.cancel();
  await assert.rejects(withCancellation(token, async () => "ok"), /Cancelled/);
});

test("withCancellation rejects on cancel", async () => {
  const token = new CancellationToken();
  const p = withCancellation(token, async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return "ok";
  });
  setTimeout(() => token.cancel(), 10);
  await assert.rejects(p, /Cancelled/);
});
