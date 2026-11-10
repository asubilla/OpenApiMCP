import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../src/logger.js";
import type { LogLevel } from "../src/logger.js";

function capture(): { stream: { write(chunk: string): unknown }; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write(chunk: string): unknown {
        lines.push(chunk);
        return true;
      }
    }
  };
}

test("json logger writes one object per line with expected shape", () => {
  const { stream, lines } = capture();
  const log = createLogger({ json: true, level: "debug", stream });

  log.info("server started", { port: 8080, name: "openapimcp" });

  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith("\n"));
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.msg, "server started");
  assert.equal(parsed.port, 8080);
  assert.equal(parsed.name, "openapimcp");
  assert.equal(typeof parsed.time, "string");
  assert.ok(!Number.isNaN(Date.parse(parsed.time)));
});

test("json logger emits a valid line for every level", () => {
  const { stream, lines } = capture();
  const log = createLogger({ json: true, level: "debug", stream });

  log.debug("d");
  log.info("i");
  log.warn("w");
  log.error("e");

  const levels = lines.map((line) => JSON.parse(line).level);
  assert.deepEqual(levels, ["debug", "info", "warn", "error"]);
});

test("level threshold filters lower-severity records", () => {
  const { stream, lines } = capture();
  const log = createLogger({ level: "warn", stream });

  log.debug("nope");
  log.info("nope");
  log.warn("yes");
  log.error("yes");

  assert.equal(lines.length, 2);
  assert.match(lines[0], /^WARN yes/);
  assert.match(lines[1], /^ERROR yes/);
});

test("debug threshold emits everything", () => {
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  const { stream, lines } = capture();
  const log = createLogger({ level: "debug", stream });
  for (const level of levels) log[level]("msg");
  assert.equal(lines.length, 4);
});

test("error threshold drops all but errors", () => {
  const { stream, lines } = capture();
  const log = createLogger({ level: "error", stream });
  log.debug("a");
  log.info("b");
  log.warn("c");
  assert.equal(lines.length, 0);
  log.error("d");
  assert.equal(lines.length, 1);
});

test("text logger produces readable LEVEL msg k=v lines", () => {
  const { stream, lines } = capture();
  const log = createLogger({ level: "debug", stream });

  log.info("request", { method: "GET", status: 200, cached: false });

  assert.equal(lines.length, 1);
  const line = lines[0].trimEnd();
  assert.ok(line.startsWith("INFO request "));
  assert.match(line, /\bmethod=GET\b/);
  assert.match(line, /\bstatus=200\b/);
  assert.match(line, /\bcached=false\b/);
});

test("text logger omits fields suffix when there are none", () => {
  const { stream, lines } = capture();
  const log = createLogger({ stream });
  log.warn("plain");
  assert.equal(lines[0], "WARN plain\n");
});

test("default logger writes to process.stderr without throwing", () => {
  const log = createLogger({ level: "error" });
  assert.doesNotThrow(() => log.info("suppressed"));
  assert.doesNotThrow(() => log.error("visible to stderr"));
});
