// Built-in presets for well-known public APIs with published OpenAPI specs.

export interface ApiPreset {
  name: string;
  description: string;
  specUrl: string;
  readOnly: boolean;
  tags: string[];
  notes?: string;
}

export const API_PRESETS: ApiPreset[] = [
  {
    name: "petstore",
    description: "Swagger Petstore — sample pet shop API (pets, orders, users)",
    specUrl: "https://petstore3.swagger.io/api/v3/openapi.json",
    readOnly: false,
    tags: ["sample", "demo", "petstore"],
    notes: "Reference/example API; safe to experiment with. Supports writes.",
  },
  {
    name: "pokeapi",
    description: "PokeAPI — read-only Pokémon data (pokemon, moves, abilities, types)",
    specUrl: "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/openapi.yml",
    readOnly: true,
    tags: ["games", "pokemon", "read-only"],
    notes: "Spec is YAML served from the PokeAPI repo; all endpoints are GET-only.",
  },
  {
    name: "github",
    description: "GitHub REST API — repositories, issues, pull requests, users",
    specUrl: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    readOnly: true,
    tags: ["developer-tools", "github", "read-only"],
    notes: "Very large spec; most endpoints require authentication. Marked read-only as a conservative default — write endpoints exist but are not exercised by this preset.",
  },
];

export function getPreset(name: string): ApiPreset | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  return API_PRESETS.find((preset) => preset.name.toLowerCase() === needle);
}

export function presetNames(): string[] {
  return API_PRESETS.map((preset) => preset.name);
}

export function formatPresetList(): string {
  return API_PRESETS.map((preset) => `${preset.name} — ${preset.description} (${preset.specUrl})`).join("\n");
}
