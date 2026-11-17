import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUserRateLimit,
  UserRateLimiter,
  userKeyFromHeaders,
  formatUserRateLimit,
} from "../src/user-ratelimit.js";
import type { UserRateLimitConfig } from "../src/user-ratelimit.js";

test("default limit applies when no config given (60/min)", () => {
  const l = new UserRateLimiter();
  assert.equal(l.remaining(), 60);
  for (let i = 0; i < 60; i++) {
    assert.equal(l.check(), true);
  }
  assert.equal(l.check(), false);
  assert.equal(l.remaining(), 0);
});

test("defaultPerMinute from config applies", () => {
  const l = new UserRateLimiter({ defaultPerMinute: 3 });
  assert.equal(l.remaining(), 3);
  assert.equal(l.check(), true);
  assert.equal(l.check(), true);
  assert.equal(l.check(), true);
  assert.equal(l.check(), false);
});

test("perUser override wins over defaultPerMinute", () => {
  const l = new UserRateLimiter({
    defaultPerMinute: 10,
    perUser: { alice: 2 },
  });
  assert.equal(l.remaining("alice"), 2);
  assert.equal(l.remaining("bob"), 10);
  assert.equal(l.check("alice"), true);
  assert.equal(l.check("alice"), true);
  assert.equal(l.check("alice"), false);
  // Other users unaffected.
  assert.equal(l.check("bob"), true);
});

test("userKey undefined uses the default bucket, separate from named users", () => {
  const l = new UserRateLimiter({ defaultPerMinute: 5, perUser: { alice: 1 } });
  assert.equal(l.check("alice"), true);
  assert.equal(l.check("alice"), false);
  assert.equal(l.check(), true);
  assert.equal(l.remaining(), 4);
});

test("check and remaining track per-user buckets independently", () => {
  const l = new UserRateLimiter({ defaultPerMinute: 10 });
  l.check("alice");
  l.check("alice");
  l.check("bob");
  assert.equal(l.remaining("alice"), 8);
  assert.equal(l.remaining("bob"), 9);
});

test("remaining decreases on check and refills with elapsed time", () => {
  const realNow = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  try {
    const l = new UserRateLimiter({ defaultPerMinute: 60 });
    for (let i = 0; i < 60; i++) l.check();
    assert.equal(l.remaining(), 0);
    assert.equal(l.check(), false);

    t += 30_000; // half a minute at 60/min -> 30 tokens
    assert.equal(l.remaining(), 30);
    assert.equal(l.check(), true);
    assert.equal(l.remaining(), 29);

    t += 60_000; // well past a full refill
    assert.equal(l.remaining(), 60);
  } finally {
    Date.now = realNow;
  }
});

test("refill is prorated to the per-user limit", () => {
  const realNow = Date.now;
  let t = 5_000_000;
  Date.now = () => t;
  try {
    const l = new UserRateLimiter({ perUser: { alice: 120 } });
    for (let i = 0; i < 120; i++) l.check("alice");
    assert.equal(l.check("alice"), false);
    t += 10_000; // 10s of 120/min -> 20 tokens
    assert.equal(l.remaining("alice"), 20);
  } finally {
    Date.now = realNow;
  }
});

test("reset() restores full buckets for all users", () => {
  const l = new UserRateLimiter({ defaultPerMinute: 3, perUser: { alice: 1 } });
  l.check();
  l.check();
  l.check("alice");
  assert.equal(l.remaining(), 1);
  assert.equal(l.remaining("alice"), 0);
  l.reset();
  assert.equal(l.remaining(), 3);
  assert.equal(l.remaining("alice"), 1);
});

test("userKeyFromHeaders prefers x-user-key over x-api-key and authorization", () => {
  const h = {
    "x-user-key": "alice",
    "x-api-key": "key-123",
    authorization: "Bearer 0123456789abcdef0123456789",
  };
  assert.equal(userKeyFromHeaders(h), "alice");
});

test("userKeyFromHeaders falls back to x-api-key then authorization", () => {
  assert.equal(
    userKeyFromHeaders({
      "x-api-key": "key-123",
      authorization: "Bearer 0123456789abcdef0123456789",
    }),
    "key-123",
  );
  assert.equal(
    userKeyFromHeaders({
      authorization: "Bearer 0123456789abcdef0123456789",
    }),
    "0123456789abcdef0123456789".slice(-20),
  );
});

test("userKeyFromHeaders takes last 20 chars of authorization", () => {
  const auth = "Bearer token-abcdefghijklmnopqrstuvwxyz";
  assert.equal(userKeyFromHeaders({ authorization: auth }), auth.slice(-20));
  assert.equal(userKeyFromHeaders({ authorization: "short" }), "short");
});

test("userKeyFromHeaders takes first entry of array values", () => {
  assert.equal(
    userKeyFromHeaders({ "x-user-key": ["alice", "bob"] }),
    "alice",
  );
  assert.equal(
    userKeyFromHeaders({ "x-api-key": ["k1", "k2"] }),
    "k1",
  );
});

test("userKeyFromHeaders is case-insensitive on header names", () => {
  assert.equal(userKeyFromHeaders({ "X-User-Key": "alice" }), "alice");
  assert.equal(userKeyFromHeaders({ "X-API-Key": "key-9" }), "key-9");
});

test("userKeyFromHeaders returns undefined when no usable header", () => {
  assert.equal(userKeyFromHeaders({}), undefined);
  assert.equal(userKeyFromHeaders({ "x-user-key": [] }), undefined);
  assert.equal(userKeyFromHeaders({ "x-user-key": "   " }), undefined);
  assert.equal(userKeyFromHeaders({ authorization: "" }), undefined);
  assert.equal(userKeyFromHeaders({ other: "value" }), undefined);
});

test("parseUserRateLimit accepts valid input and drops unknown top-level keys", () => {
  assert.deepEqual(parseUserRateLimit({ defaultPerMinute: 30 }), {
    defaultPerMinute: 30,
  });
  assert.deepEqual(
    parseUserRateLimit({
      defaultPerMinute: 30,
      perUser: { alice: 5, bob: 10 },
      bogus: "dropped",
    }),
    { defaultPerMinute: 30, perUser: { alice: 5, bob: 10 } },
  );
  assert.deepEqual(parseUserRateLimit({}), {});
});

test("parseUserRateLimit rejects invalid input", () => {
  assert.equal(parseUserRateLimit(undefined), undefined);
  assert.equal(parseUserRateLimit(null), undefined);
  assert.equal(parseUserRateLimit("ratelimit"), undefined);
  assert.equal(parseUserRateLimit(42), undefined);
  assert.equal(parseUserRateLimit(true), undefined);
  assert.equal(parseUserRateLimit([1, 2]), undefined);
  assert.equal(parseUserRateLimit({ defaultPerMinute: "60" }), undefined);
  assert.equal(parseUserRateLimit({ defaultPerMinute: 0 }), undefined);
  assert.equal(parseUserRateLimit({ defaultPerMinute: -5 }), undefined);
  assert.equal(parseUserRateLimit({ defaultPerMinute: Number.NaN }), undefined);
  assert.equal(
    parseUserRateLimit({ defaultPerMinute: Number.POSITIVE_INFINITY }),
    undefined,
  );
  assert.equal(parseUserRateLimit({ perUser: "nope" }), undefined);
  assert.equal(parseUserRateLimit({ perUser: null }), undefined);
  assert.equal(parseUserRateLimit({ perUser: [1] }), undefined);
  assert.equal(parseUserRateLimit({ perUser: { alice: "5" } }), undefined);
  assert.equal(parseUserRateLimit({ perUser: { alice: 0 } }), undefined);
  assert.equal(parseUserRateLimit({ perUser: { alice: -1 } }), undefined);
  assert.equal(
    parseUserRateLimit({ perUser: { alice: Number.NaN } }),
    undefined,
  );
  assert.equal(
    parseUserRateLimit({ perUser: { alice: Number.POSITIVE_INFINITY } }),
    undefined,
  );
});

test("formatUserRateLimit renders remaining/limit", () => {
  const l = new UserRateLimiter({
    defaultPerMinute: 60,
    perUser: { alice: 100 },
  });
  for (let i = 0; i < 53; i++) l.check("alice");
  assert.equal(
    formatUserRateLimit(l, "alice"),
    "user: alice — 47/100 remaining (this minute)",
  );
  assert.equal(
    formatUserRateLimit(l),
    "user: default — 60/60 remaining (this minute)",
  );
});

test("config is exposed readonly on the limiter", () => {
  const cfg: UserRateLimitConfig = {
    defaultPerMinute: 25,
    perUser: { alice: 7 },
  };
  const l = new UserRateLimiter(cfg);
  assert.equal(l.config.defaultPerMinute, 25);
  assert.equal(l.config.perUser?.alice, 7);
});
