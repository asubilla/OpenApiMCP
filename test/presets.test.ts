import { test } from "node:test";
import assert from "node:assert/strict";
import {
  API_PRESETS,
  getPreset,
  presetNames,
  formatPresetList,
  type ApiPreset,
} from "../src/presets.js";

test("API_PRESETS is non-empty and well-formed", () => {
  assert.ok(Array.isArray(API_PRESETS));
  assert.ok(API_PRESETS.length > 0);
  for (const preset of API_PRESETS as ApiPreset[]) {
    assert.equal(typeof preset.name, "string");
    assert.ok(preset.name.length > 0);
    assert.equal(typeof preset.description, "string");
    assert.ok(preset.description.length > 0);
    assert.equal(typeof preset.specUrl, "string");
    assert.match(preset.specUrl, /^https:\/\//);
    assert.equal(typeof preset.readOnly, "boolean");
    assert.ok(Array.isArray(preset.tags));
  }
});

test("getPreset finds petstore", () => {
  const preset = getPreset("petstore");
  assert.ok(preset);
  assert.equal(preset!.name, "petstore");
  assert.equal(preset!.specUrl, "https://petstore3.swagger.io/api/v3/openapi.json");
  assert.equal(preset!.readOnly, false);
});

test("getPreset returns undefined for unknown names", () => {
  assert.equal(getPreset("does-not-exist"), undefined);
  assert.equal(getPreset(""), undefined);
});

test("presetNames includes petstore", () => {
  const names = presetNames();
  assert.ok(names.includes("petstore"));
  assert.ok(names.includes("pokeapi"));
});

test("formatPresetList contains petstore and its spec URL", () => {
  const out = formatPresetList();
  assert.match(out, /petstore/);
  assert.match(out, /https:\/\/petstore3\.swagger\.io\/api\/v3\/openapi\.json/);
});
