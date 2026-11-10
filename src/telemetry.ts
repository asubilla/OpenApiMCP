import { SpanStatusCode, metrics, trace } from "@opentelemetry/api";

// The OpenTelemetry API is a no-op until the host registers an SDK/provider,
// so instrumenting unconditionally is free when telemetry is not configured.
const tracer = trace.getTracer("openapimcp", "1.0.0");
const meter = metrics.getMeter("openapimcp", "1.0.0");
const calls = meter.createCounter("openapimcp.tool.calls", { description: "Number of tool calls" });
const duration = meter.createHistogram("openapimcp.tool.duration", {
  description: "Tool call duration",
  unit: "ms"
});

/** Wrap a tool call in a span and record call/duration metrics. */
export function recordToolCall<T>(toolName: string, method: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(`mcp.tool ${toolName}`, async (span) => {
    const start = Date.now();
    let failed = false;
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      failed = true;
      if (err instanceof Error) span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      const attributes = { "mcp.tool.name": toolName, "http.request.method": method, error: failed };
      duration.record(Date.now() - start, attributes);
      calls.add(1, attributes);
      span.setAttribute("mcp.tool.name", toolName);
      span.setAttribute("http.request.method", method);
      span.end();
    }
  });
}
