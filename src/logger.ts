export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** Minimum level to emit. Lower-severity records are dropped. Default "info". */
  level?: LogLevel;
  /** Emit one JSON object per line instead of a readable `LEVEL msg k=v` line. */
  json?: boolean;
  /** Sink for rendered lines. Defaults to process.stderr. */
  stream?: { write(chunk: string): unknown };
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

/** Create a leveled logger. Small and dependency-free. */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const json = opts.json ?? false;
  const stream = opts.stream ?? process.stderr;
  const threshold = ORDER[level];

  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (ORDER[lvl] < threshold) return;
    let line: string;
    if (json) {
      line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields });
    } else {
      const suffix = fields
        ? Object.entries(fields)
            .map(([key, value]) => `${key}=${formatValue(value)}`)
            .join(" ")
        : "";
      line = `${lvl.toUpperCase()} ${msg}${suffix ? ` ${suffix}` : ""}`;
    }
    stream.write(`${line}\n`);
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields)
  };
}
