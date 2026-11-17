/**
 * In-memory EventStore for the MCP Streamable HTTP transport.
 *
 * Implements the `EventStore` interface used by `NodeStreamableHTTPServerTransport`
 * so SSE streams can replay events missed by a reconnecting client.
 *
 * Trade-off (ring buffer eviction):
 *   When the buffer is full, `storeEvent` drops the *globally oldest* event,
 *   regardless of which stream it belongs to. This can evict events from a
 *   stream that a client is actively replaying, in which case that client's
 *   `replayEventsAfter` may silently skip evicted entries (or fail with
 *   "unknown event id" if the anchor event itself was dropped). A stricter
 *   implementation would pin in-flight replay streams and refuse writes to
 *   them instead; here we favour a simple, predictable global bound on
 *   memory usage and document the limitation.
 */

export type EventId = string;
export type StreamId = string;
// Structural — we don't validate the JSON-RPC shape.
export type JSONRPCMessage = any;

export interface EventStore {
  storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId>;
  getStreamIdForEventId?(eventId: EventId): Promise<StreamId | undefined>;
  replayEventsAfter(
    lastEventId: EventId,
    opts: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId>;
}

interface StoredEvent {
  id: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
}

export class InMemoryEventStore implements EventStore {
  private readonly maxEvents: number;
  /** Insertion-ordered map doubling as the ring buffer. */
  private readonly events = new Map<EventId, StoredEvent>();
  private counter = 0;

  constructor(opts?: { maxEvents?: number }) {
    const requested = opts?.maxEvents ?? 1000;
    // Wrap maxEvents < 1 (including NaN-ish inputs coerced below) as 1.
    this.maxEvents = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 1;
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const id = String(++this.counter);
    this.events.set(id, { id, streamId, message });
    // Drop globally oldest events until we are within budget.
    while (this.events.size > this.maxEvents) {
      const oldest = this.events.keys().next();
      if (oldest.done) break;
      this.events.delete(oldest.value);
    }
    return id;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    return this.events.get(eventId)?.streamId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    opts: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    const anchor = this.events.get(lastEventId);
    if (!anchor) {
      throw new Error("unknown event id");
    }

    const ordered = [...this.events.values()];
    const anchorIndex = ordered.findIndex((e) => e.id === lastEventId);

    let streamId = anchor.streamId;
    for (let i = anchorIndex + 1; i < ordered.length; i++) {
      const event = ordered[i];
      await opts.send(event.id, event.message);
      streamId = event.streamId;
    }
    return streamId;
  }

  /** Number of events currently held (for tests/inspection). */
  size(): number {
    return this.events.size;
  }

  /** Distinct stream ids that still have at least one stored event. */
  streams(): StreamId[] {
    const seen = new Set<StreamId>();
    for (const event of this.events.values()) {
      seen.add(event.streamId);
    }
    return [...seen];
  }
}
