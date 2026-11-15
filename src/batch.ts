export interface BatchCall {
  tool: string;
  args?: Record<string, unknown>;
}

export interface BatchResult {
  tool: string;
  ok: boolean;
  status?: number;
  body?: any;
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, tool: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms calling tool "${tool}"`));
    }, timeoutMs);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Run batch calls with at most `concurrency` in flight (default 5).
 * Result order matches input order. A throwing call is captured as a
 * failed BatchResult instead of rejecting the whole batch.
 */
export async function runBatch(
  calls: BatchCall[],
  opts: { concurrency?: number; timeoutMs?: number },
  call: (tool: string, args: Record<string, unknown>) => Promise<BatchResult>
): Promise<BatchResult[]> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 5));
  const timeoutMs = opts.timeoutMs;
  const results: BatchResult[] = new Array(calls.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= calls.length) return;

      const entry = calls[index];
      try {
        const pending = call(entry.tool, entry.args ?? {});
        results[index] = timeoutMs !== undefined
          ? await withTimeout(pending, timeoutMs, entry.tool)
          : await pending;
      } catch (err) {
        results[index] = { tool: entry.tool, ok: false, error: errorMessage(err) };
      }
    }
  }

  const workerCount = Math.min(concurrency, calls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Count ok/failed/total across batch results. */
export function formatBatchSummary(results: BatchResult[]): { ok: number; failed: number; total: number } {
  let ok = 0;
  for (const result of results) {
    if (result.ok) ok += 1;
  }
  return { ok, failed: results.length - ok, total: results.length };
}

/** One line per result: `✓ tool` on success, `✗ tool: error` on failure. */
export function formatBatchResults(results: BatchResult[]): string {
  return results
    .map((result) => {
      if (result.ok) return `✓ ${result.tool}`;
      const reason = result.error ?? (result.status !== undefined ? `status ${result.status}` : "failed");
      return `✗ ${result.tool}: ${reason}`;
    })
    .join("\n");
}
