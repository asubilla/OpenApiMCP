import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, CircuitBreaker } from "../src/ratelimit.js";

test("token bucket allows a full burst then rejects", () => {
  const rl = new RateLimiter({ ratePerSecond: 1, burst: 3 });
  assert.equal(rl.tryAcquire(0), true);
  assert.equal(rl.tryAcquire(0), true);
  assert.equal(rl.tryAcquire(0), true);
  assert.equal(rl.tryAcquire(0), false);
});

test("token bucket refills at the configured rate", () => {
  const rl = new RateLimiter({ ratePerSecond: 1, burst: 1 });
  assert.equal(rl.tryAcquire(0), true);
  assert.equal(rl.tryAcquire(500), false); // only half a token
  assert.equal(rl.tryAcquire(1000), true); // full token refilled
});

test("token bucket refills continuously and caps at burst", () => {
  const rl = new RateLimiter({ ratePerSecond: 2, burst: 2 });
  assert.equal(rl.tryAcquire(0), true);
  assert.equal(rl.tryAcquire(0), true);
  assert.equal(rl.tryAcquire(250), false); // 0.5 tokens
  assert.equal(rl.tryAcquire(500), true); // 1.0 tokens
  assert.equal(rl.tryAcquire(10000), true); // refilled and capped, not overfull
});

test("burst defaults to one second of tokens", () => {
  const rl = new RateLimiter({ ratePerSecond: 5 });
  for (let i = 0; i < 5; i++) assert.equal(rl.tryAcquire(0), true);
  assert.equal(rl.tryAcquire(0), false);
});

test("acquire resolves immediately when a token is available", async () => {
  const rl = new RateLimiter({ ratePerSecond: 1, burst: 1 });
  await rl.acquire(0);
  assert.equal(rl.tryAcquire(0), false);
});

test("acquire waits for a refill", async () => {
  const rl = new RateLimiter({ ratePerSecond: 100, burst: 1 });
  assert.equal(rl.tryAcquire(0), true);
  await rl.acquire();
  assert.equal(rl.tryAcquire(), false);
});

test("circuit breaker opens after threshold consecutive failures", () => {
  const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  assert.equal(cb.state(), "closed");
  cb.onFailure();
  cb.onFailure();
  assert.equal(cb.state(), "closed");
  assert.equal(cb.canRequest(), true);
  cb.onFailure();
  assert.equal(cb.state(), "open");
  assert.equal(cb.canRequest(), false);
});

test("circuit breaker success resets the failure count", () => {
  const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  cb.onFailure();
  cb.onFailure();
  cb.onSuccess();
  cb.onFailure();
  cb.onFailure();
  assert.equal(cb.state(), "closed");
});

test("circuit breaker half-opens after cooldown and allows one probe", () => {
  let t = 0;
  const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  cb.onFailure();
  cb.onFailure();
  assert.equal(cb.state(), "open");

  t = 999;
  assert.equal(cb.state(), "open");
  assert.equal(cb.canRequest(), false);

  t = 1000;
  assert.equal(cb.state(), "half-open");
  assert.equal(cb.canRequest(), true); // the single probe
  assert.equal(cb.canRequest(), false); // no second probe while in flight
});

test("circuit breaker probe success closes the breaker", () => {
  let t = 0;
  const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  cb.onFailure();
  cb.onFailure();
  t = 1000;
  assert.equal(cb.canRequest(), true);
  cb.onSuccess();
  assert.equal(cb.state(), "closed");
  assert.equal(cb.canRequest(), true);
});

test("circuit breaker probe failure reopens the breaker", () => {
  let t = 0;
  const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  cb.onFailure();
  cb.onFailure();
  t = 1000;
  cb.canRequest();
  cb.onFailure();
  assert.equal(cb.state(), "open");
  assert.equal(cb.canRequest(), false);
  t = 2000;
  assert.equal(cb.state(), "half-open");
});
