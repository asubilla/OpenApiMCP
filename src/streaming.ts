export interface StreamChunk {
  index: number;
  total?: number;
  data: string;
  done: boolean;
}

export function chunkText(text: string, chunkSize: number = 1000): StreamChunk[] {
  const size = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 1000;
  const total = text.length === 0 ? 0 : Math.ceil(text.length / size);
  const chunks: StreamChunk[] = [];
  if (text.length === 0) return chunks;
  for (let i = 0; i < text.length; i += size) {
    const index = chunks.length;
    chunks.push({
      index,
      total,
      data: text.slice(i, i + size),
      done: index === total - 1,
    });
  }
  return chunks;
}

export function formatSSE(chunks: StreamChunk[]): string {
  return chunks
    .map((chunk) => `event: message\ndata: ${JSON.stringify(chunk)}\n\n`)
    .join("");
}

export function parseSSE(text: string): StreamChunk[] {
  const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chunks: StreamChunk[] = [];
  const events = normalized.split(/\n\n+/);
  for (const event of events) {
    if (!event.trim()) continue;
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"));
    if (dataLines.length === 0) continue;
    const payload = dataLines
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    try {
      chunks.push(JSON.parse(payload) as StreamChunk);
    } catch {
      // Ignore malformed events.
    }
  }
  return chunks;
}

export function mergeChunks(chunks: StreamChunk[]): string {
  return [...chunks]
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.data)
    .join("");
}