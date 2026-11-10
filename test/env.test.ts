import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDotenv, parseDotenv } from "../src/env.js";

test("parses simple KEY=VALUE lines", () => {
  assert.deepEqual(parseDotenv("A=1\nB=two"), { A: "1", B: "two" });
});

test("ignores blanks and comment lines", () => {
  const text = ["# a comment", "", "   ", "A=1", "   # indented comment", "B=2"].join("\n");
  assert.deepEqual(parseDotenv(text), { A: "1", B: "2" });
});

test("strips the export prefix", () => {
  assert.deepEqual(parseDotenv("export API_KEY=secret"), { API_KEY: "secret" });
});

test("trims keys and values", () => {
  assert.deepEqual(parseDotenv("  KEY  =  spaced value  "), { KEY: "spaced value" });
});

test("strips surrounding single and double quotes", () => {
  assert.deepEqual(parseDotenv(`A="quoted"\nB='single'\nC="with spaces"`), {
    A: "quoted",
    B: "single",
    C: "with spaces"
  });
});

test("keeps a lone quote as a literal value", () => {
  assert.deepEqual(parseDotenv('A="'), { A: '"' });
});

test("drops trailing comments on unquoted values", () => {
  assert.deepEqual(parseDotenv("A=value # trailing comment"), { A: "value" });
  assert.deepEqual(parseDotenv("A=value#notcomment"), { A: "value#notcomment" });
});

test("handles empty values", () => {
  assert.deepEqual(parseDotenv("EMPTY=\nQUOTED=\"\""), { EMPTY: "", QUOTED: "" });
});

test("skips lines without an equals sign", () => {
  assert.deepEqual(parseDotenv("JUSTAWORD\nA=1\n=noKey"), { A: "1" });
});

test("handles CRLF line endings", () => {
  assert.deepEqual(parseDotenv("A=1\r\nB=2\r\n"), { A: "1", B: "2" });
});

test("last duplicate key wins", () => {
  assert.deepEqual(parseDotenv("A=1\nA=2"), { A: "2" });
});

test("expands escaped characters in double quotes", () => {
  assert.deepEqual(parseDotenv('A="line\\nbreak"'), { A: "line\nbreak" });
});

test("applyDotenv sets new variables and returns the count", () => {
  const env: Record<string, string | undefined> = {};
  const count = applyDotenv(env, "A=1\nB=2");
  assert.equal(count, 2);
  assert.deepEqual(env, { A: "1", B: "2" });
});

test("applyDotenv keeps existing values by default", () => {
  const env: Record<string, string | undefined> = { A: "existing" };
  const count = applyDotenv(env, "A=new\nB=new");
  assert.equal(count, 1);
  assert.equal(env.A, "existing");
  assert.equal(env.B, "new");
});

test("applyDotenv overrides when requested", () => {
  const env: Record<string, string | undefined> = { A: "existing" };
  const count = applyDotenv(env, "A=new", true);
  assert.equal(count, 1);
  assert.equal(env.A, "new");
});

test("applyDotenv treats undefined values as unset", () => {
  const env: Record<string, string | undefined> = { A: undefined };
  const count = applyDotenv(env, "A=set");
  assert.equal(count, 1);
  assert.equal(env.A, "set");
});

test("applyDotenv returns zero when nothing changes", () => {
  const env: Record<string, string | undefined> = { A: "1" };
  assert.equal(applyDotenv(env, "A=2"), 0);
  assert.equal(applyDotenv(env, "# nothing"), 0);
});
