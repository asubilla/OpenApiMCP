import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryEventStore } from "../src/event-store.js";

test("storeEvent assigns monotonically increasing string ids", async () => {
  const store = new InMemoryEventStore();
  const id1 = await store.storeEvent("s1", { jsonrpc: "2.0", method: "a" });
  const id2 = await store.storeEvent("s1", { jsonrpc: "2.0", method: "b" });
  const id3 = await store.storeEvent("s2", { jsonrpc: "2.0", method: "c" });
  assert.equal(id1, "1");
  assert.equal(id2, "2");
  assert.equal(id3, "3");
});

test("getStreamIdForEventId returns the stream for a known event", async () => {
  const store = new InMemoryEventStore();
  const id = await store.storeEvent("stream-a", { hello: "world" });
  assert.equal(await store.getStreamIdForEventId(id), "stream-a");
});

test("getStreamIdForEventId returns undefined for an unknown event", async () => {
  const store = new InMemoryEventStore();
  assert.equal(await store.getStreamIdForEventId("nope"), undefined);
});

test("replayEventsAfter sends only events newer than lastEventId, in order", async () => {
  const store = new InMemoryEventStore();
  const id1 = await store.storeEvent("s1", { n: 1 });
  const id2 = await store.storeEvent("s1", { n: 2 });
  const id3 = await store.storeEvent("s1", { n: 3 });

  const sent: Array<{ id: string; message: unknown }> = [];
  const streamId = await store.replayEventsAfter(id1, {
    send: async (eventId, message) => {
      sent.push({ id: eventId, message });
    },
  });

  assert.deepEqual(sent.map((s) => s.id), [id2, id3]);
  assert.deepEqual(sent.map((s) => (s.message as { n: number }).n), [2, 3]);
  assert.equal(streamId, "s1");
});

test("replayEventsAfter with no newer events sends nothing and returns the anchor stream", async () => {
  const store = new InMemoryEventStore();
  const id1 = await store.storeEvent("s1", { n: 1 });
  const sent: string[] = [];
  const streamId = await store.replayEventsAfter(id1, {
    send: async (eventId) => {
      sent.push(eventId);
    },
  });
  assert.deepEqual(sent, []);
  assert.equal(streamId, "s1");
});

test("replayEventsAfter across streams returns the last sent event's stream", async () => {
  const store = new InMemoryEventStore();
  const id1 = await store.storeEvent("s1", { n: 1 });
  await store.storeEvent("s2", { n: 2 });
  const streamId = await store.replayEventsAfter(id1, { send: async () => {} });
  assert.equal(streamId, "s2");
});

test("replayEventsAfter throws on an unknown lastEventId", async () => {
  const store = new InMemoryEventStore();
  await store.storeEvent("s1", { n: 1 });
  await assert.rejects(
    () => store.replayEventsAfter("does-not-exist", { send: async () => {} }),
    /^Error: unknown event id$/,
  );
});

test("ring buffer drops the globally oldest event when maxEvents is exceeded", async () => {
  const store = new InMemoryEventStore({ maxEvents: 2 });
  const id1 = await store.storeEvent("s1", { n: 1 });
  const id2 = await store.storeEvent("s2", { n: 2 });
  const id3 = await store.storeEvent("s1", { n: 3 });

  assert.equal(store.size(), 2);
  assert.equal(await store.getStreamIdForEventId(id1), undefined);
  assert.equal(await store.getStreamIdForEventId(id2), "s2");
  assert.equal(await store.getStreamIdForEventId(id3), "s1");

  // The evicted anchor can no longer be used to replay.
  await assert.rejects(
    () => store.replayEventsAfter(id1, { send: async () => {} }),
    /^Error: unknown event id$/,
  );

  // Replay from the oldest surviving event yields only newer ones.
  const sent: string[] = [];
  await store.replayEventsAfter(id2, {
    send: async (eventId) => {
      sent.push(eventId);
    },
  });
  assert.deepEqual(sent, [id3]);
});

test("maxEvents below 1 is wrapped to 1", async () => {
  const store = new InMemoryEventStore({ maxEvents: 0 });
  await store.storeEvent("s1", { n: 1 });
  await store.storeEvent("s1", { n: 2 });
  assert.equal(store.size(), 1);
});

test("streams() lists distinct active streams", async () => {
  const store = new InMemoryEventStore({ maxEvents: 2 });
  await store.storeEvent("s1", { n: 1 });
  await store.storeEvent("s2", { n: 2 });
  assert.deepEqual(new Set(store.streams()), new Set(["s1", "s2"]));

  // Evicting every s1 event removes it from the active list.
  await store.storeEvent("s3", { n: 3 });
  assert.deepEqual(new Set(store.streams()), new Set(["s2", "s3"]));
});
