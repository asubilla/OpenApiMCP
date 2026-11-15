# Real-spec corpus

These three real-world specs are vendored into this repo for regression testing.
They are pinned snapshots — do **not** assume they track upstream changes.
`test/corpus.test.ts` runs against them offline.

| File | Spec | Version | Size | Upstream source | License |
|---|---|---|---|---|---|
| `petstore3.openapi.json` | Swagger Petstore (OpenAPI 3.0.4) | 1.0.27 | ~17 KB | https://petstore3.swagger.io/api/v3/openapi.json | Apache 2.0 |
| `httpbin.openapi.json` | httpbin.org (**Swagger 2.0**) | 0.9.2 | ~45 KB | https://httpbin.org/spec.json | MIT |
| `pokeapi.openapi.yml` | PokeAPI (OpenAPI **3.1.0**, cyclic `$ref`s) | 2.10.0 | ~327 KB | https://raw.githubusercontent.com/PokeAPI/pokeapi/master/openapi.yml | BSD-3 |

Why these three:

- **petstore3** — OpenAPI 3.0.4 with non-JSON bodies (the corpus test pins the
  exact operations `compat` must flag).
- **httpbin** — legacy **Swagger 2.0** (different `securityDefinitions` path).
- **pokeapi** — OpenAPI 3.1.0, YAML, and **cyclic `$ref`s** (self-referential
  evolution chains like Ability -> Ability). Guards against crashes on
  real-world object graphs (`compat`, `lint`, `pin`, `bundle`).

## Refreshing the corpus

```bash
curl -sL https://petstore3.swagger.io/api/v3/openapi.json -o test/fixtures/corpus/petstore3.openapi.json
curl -sL https://httpbin.org/spec.json                     -o test/fixtures/corpus/httpbin.openapi.json
curl -sL https://raw.githubusercontent.com/PokeAPI/pokeapi/master/openapi.yml -o test/fixtures/corpus/pokeapi.openapi.yml
```

Then run `node --import tsx --test test/corpus.test.ts`. Note: upstream specs
**may** change and break the assertions — update the assertions deliberately,
don't tweak them silently.
