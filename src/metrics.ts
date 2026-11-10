const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type Labels = Record<string, string>;

interface Bucket {
  labels: Labels;
  value: number;
}

const startedAt = Date.now();

function assertName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid metric name: ${JSON.stringify(name)}`);
}

function assertLabels(labels: Labels): void {
  for (const key of Object.keys(labels)) {
    if (!LABEL_RE.test(key)) throw new Error(`invalid label name: ${JSON.stringify(key)}`);
  }
}

/** Escape a label value per the Prometheus text exposition format. */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Stable label identity: sorted by name, independent of insertion order. */
function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}="${escapeLabelValue(labels[key])}"`)
    .join(",");
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

function renderSeries(name: string, labels: Labels, value: string): string {
  const key = labelKey(labels);
  return key ? `${name}{${key}} ${value}` : `${name} ${value}`;
}

/** Minimal in-memory metrics registry that renders Prometheus text format. */
export class Metrics {
  private readonly counters = new Map<string, Map<string, Bucket>>();
  private readonly summaries = new Map<string, Map<string, Bucket & { count: number }>>();

  /** Increment a counter by one. */
  counter(name: string, labels: Labels = {}): void {
    this.add(name, labels, 1);
  }

  /** Add `delta` to a counter. */
  private add(name: string, labels: Labels, delta: number): void {
    assertName(name);
    assertLabels(labels);
    let buckets = this.counters.get(name);
    if (!buckets) {
      buckets = new Map();
      this.counters.set(name, buckets);
    }
    const key = labelKey(labels);
    const existing = buckets.get(key);
    if (existing) existing.value += delta;
    else buckets.set(key, { labels: { ...labels }, value: delta });
  }

  /** Record an observation for a summary metric. */
  observe(name: string, value: number, labels: Labels = {}): void {
    assertName(name);
    assertLabels(labels);
    let buckets = this.summaries.get(name);
    if (!buckets) {
      buckets = new Map();
      this.summaries.set(name, buckets);
    }
    const key = labelKey(labels);
    const existing = buckets.get(key);
    if (existing) {
      existing.value += value;
      existing.count += 1;
    } else {
      buckets.set(key, { labels: { ...labels }, value, count: 1 });
    }
  }

  /** Render all series in Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];

    for (const name of [...this.counters.keys()].sort()) {
      lines.push(`# TYPE ${name} counter`);
      const buckets = this.counters.get(name)!;
      for (const key of [...buckets.keys()].sort()) {
        const bucket = buckets.get(key)!;
        lines.push(renderSeries(name, bucket.labels, formatNumber(bucket.value)));
      }
    }

    for (const name of [...this.summaries.keys()].sort()) {
      lines.push(`# TYPE ${name} summary`);
      const buckets = this.summaries.get(name)!;
      for (const key of [...buckets.keys()].sort()) {
        const bucket = buckets.get(key)!;
        lines.push(renderSeries(`${name}_count`, bucket.labels, formatNumber(bucket.count)));
        lines.push(renderSeries(`${name}_sum`, bucket.labels, formatNumber(bucket.value)));
      }
    }

    return lines.length ? `${lines.join("\n")}\n` : "";
  }
}

/** Liveness/readiness payload with process uptime. */
export function healthPayload(): { status: "ok"; uptimeSeconds: number } {
  const elapsed = Date.now() - startedAt;
  return { status: "ok", uptimeSeconds: Math.floor(elapsed / 1000) };
}
