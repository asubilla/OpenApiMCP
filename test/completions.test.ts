import { test } from "node:test";
import assert from "node:assert/strict";
import { completionsFor } from "../src/completions.js";

const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
const SUBCOMMANDS = ["serve", "list", "doctor", "call", "generate"];

for (const shell of SHELLS) {
  test(`${shell} completion is non-empty and lists subcommands`, () => {
    const script = completionsFor(shell);
    assert.equal(typeof script, "string");
    assert.ok(script.trim().length > 0);
    assert.match(script, /openapimcp/);
    for (const command of SUBCOMMANDS) {
      assert.ok(script.includes(command), `missing subcommand ${command} in ${shell} output`);
    }
  });

  test(`${shell} completion is deterministic`, () => {
    assert.equal(completionsFor(shell), completionsFor(shell));
  });
}

test("bash completion registers a completion function", () => {
  const script = completionsFor("bash");
  assert.match(script, /complete -F _openapimcp openapimcp/);
  assert.match(script, /--read-only/);
});

test("fish completion emits complete lines", () => {
  const script = completionsFor("fish");
  assert.match(script, /complete -c openapimcp/);
  assert.match(script, /--base-url|-l 'base-url'/);
});

test("powershell completion registers an argument completer", () => {
  const script = completionsFor("powershell");
  assert.match(script, /Register-ArgumentCompleter/);
});

test("different shells produce different scripts", () => {
  const scripts = SHELLS.map((shell) => completionsFor(shell));
  assert.equal(new Set(scripts).size, SHELLS.length);
});
