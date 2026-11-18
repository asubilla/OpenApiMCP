# compat-openapimcp-vs-spec.md

How much of an OpenAPI/Swagger document can `openapimcp` infer without hints,
and what needs manual help?

Facts in this document are tied to the source as of this writing. Nothing here
is benchmarked unless it says so, and the only empirical numbers quoted are the
corpus results already published in `README.md` (see "Reading the compat
report"). Where a requested feature is not implemented, this document says so
explicitly. Source references are paths, not line numbers, on purpose.

Tested upstream support: OpenAPI 3.x and Swagger 2.0 (`parseDocument` handles
both, including Swagger 2.0 `host`/`basePath`/`schemes` and
`securityDefinitions`). See `src/openapi.ts`.

---

## What is inferred from the spec alone

- **operationId / tags / summary / description → tool name + description**
  One MCP tool per operation (`get|post|put|patch|delete|head|options`). Tool name =
  sanitized `operationId` (falls back to `<method>_<path>`), `[a-zA-Z0-9_-]` only,
  leading/trailing underscores stripped, max 64 chars, collisions deduplicated with
  `_2`, `_3`, … Description = `summary || description || "<METHOD> <path>"`, trimmed,
  with up to 3 spec `example`/`examples` appended (each truncated to 120 chars).
  `tags` are copied to the tool definition. Evidence: `src/openapi.ts`
  (`buildTool`, `parseDocument`, `collectExamples`, `sanitizeName`).
  Note: `tools[n].annotations.title` comes from `summary`; `readOnlyHint` /
  `destructiveHint` / `idempotentHint` come **only from the HTTP method**
  (`annotationsFor`: GET/HEAD/OPTIONS → readOnly, DELETE → destructive,
  readOnly|PUT|DELETE → idempotent), not from `deprecated` and not from tags.

- **path + method → tool signature**
  `path` and `method` are carried on every `ToolDef` (`src/types.ts`) and one MCP tool
  per operation is registered with the server, plus a parallel `<tool>_help` MCP prompt
  (`src/server.ts`). Base URL(s) come from `servers[]` (OpenAPI 3) or `host` +
  `basePath` + `schemes[0]` (Swagger 2.0); first base URL wins for single-spec usage
  (`collectBaseUrls` in `src/openapi.ts`). If the spec declares no servers, the base
  URL is the empty string.

- **JSON-schema request body → Zod input args (via `jsonSchemaToZod`)**
  Request body schemas are read from `requestBody.content["application/json"]` or
  `application/*+json` (or Swagger 2.0 `body` parameters) — non-JSON bodies are never
  read. Object-shaped bodies are expanded into one tool argument per property
  (property `required` honored; argument name collisions with path/query params get
  `_body` suffixes). Non-object bodies become a single required `body` argument.
  `jsonSchemaToZod` handles primitives, enums, `const`, arrays, objects,
  `type: [..., "null"]` nullable unions, `anyOf`/`oneOf` (→ Zod union; a
  `null` branch makes it nullable), and object-shaped `allOf` (properties merged,
  required unioned; intersection otherwise). Evidence: `src/schema.ts`,
  `src/openapi.ts`.

- **path/query params (name/type/required) → CLI args**
  Parameters are merged from the path-item object and the operation itself
  (operation wins on `in:name` collision). Only `in: path` and `in: query` become
  tool arguments; **`header`, `cookie`, and Swagger `body` params are dropped from
  the argument list entirely** (`buildTool` skips them). Path params are always
  `required: true`; query params honor the spec's `required`. Swagger 2.0 parameters
  carry their type inline and are lifted via `swagger2ParamSchema` (type/format/
  items/enum/default/min/max/pattern/…). Evidence: `src/openapi.ts`.

- **2xx response content (`application/json` → schema) → optional `outputSchema` on tools (via `responseSchemaForOperation` + `toOutputSchema`)**
  `responseSchemaForOperation` picks the preferred 2xx response in order
  `200` → `201` → `default` → any other concrete `2xx` key ascending; JSON media types
  are matched by substring (`application/json`) or any `+json` suffix (e.g.
  `application/problem+json`), first key in document order wins. The raw schema is
  stored on `tool.responseSchema`. At server-build time, **only when
  `--structured-content` is on**, the schema is collapsed through `toOutputSchema`
  (object-shaped roots only; keywords kept are `type`, `enum`, `description`,
  `additionalProperties: false`, `required`, `properties`, `items`; everything else —
  including `x-*` and `format`/`pattern` — is dropped silently; any `$ref` anywhere in
  the subtree aborts the conversion to `undefined`) and attached to the MCP tool as
  `outputSchema`. Evidence: `src/spec-output.ts`, `src/output.ts`, `src/server.ts`
  (`buildServer`), `src/openapi.ts`. Inspect per-operation coverage with
  `openapimcp output-schema <spec>` (src/cli.ts). `collectResponseSchemas` and
  `formatOutputSchemaSummary` implement the same walk (src/spec-output.ts).

- **security schemes (http/apiKey/oauth2/openIdConnect) → auth resolution via env vars**
  For each scheme, `OPENAPIMCP_<SCHEME-NAME>` is the conventional env var (non-alnum →
  `_`, upper-cased). HTTP bearer → `Authorization: Bearer <token>`; HTTP basic →
  `OPENAPIMCP_<SCHEME>_USERNAME` / `_PASSWORD` (or raw `OPENAPIMCP_<SCHEME>`, or global
  `OPENAPIMCP_USERNAME`/`OPENAPIMCP_PASSWORD`); any other `http` scheme passes the env
  value through as the raw `Authorization` header. `apiKey` in `header` / `query` /
  `cookie` puts the token in that location under the spec's `name`. `oauth2` and
  `openIdConnect` resolve to a Bearer token from `OPENAPIMCP_<SCHEME>` or
  `OPENAPIMCP_TOKEN` (no token endpoint is called — you supply the token). Per-tool,
  the first satisfiable requirement from `op.security` (or root `security`) wins;
  explicit `security: []` means no auth. `schemesWithCreds` / `schemesWithoutCreds`
  in the parsed result report which schemes are env-complete (used by `doctor`).
  Evidence: `src/auth.ts`, `src/openapi.ts`.

- **deprecated ops → flagged; annotations are method-derived only**
  `isDeprecated` checks `op.deprecated === true`, `op["x-deprecated"] === true`, and
  the presence of `sunset` / `expires` / `x-sunset` / `x-expires` (src/deprecation.ts).
  `compat` reports any deprecated operation as **partial** (reason
  `deprecated operation`, see `src/compat.ts`). The CLI's only automated handling is
  `--hide-deprecated`, which drops such tools. `annotateTools` (deprecation.ts) adds
  a `[DEPRECATED]` title prefix and `(deprecated)` description suffix, but it is
  **not wired into any CLI command** (only exported and unit-tested). The MCP tool
  annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint` /
  `openWorldHint`) in `annotationsFor` are derived from the HTTP method and are
  identical for deprecated and non-deprecated twins. So: deprecation is **detected**
  and **reported**, and optionally filtered; it is not woven into the tool hints.

- **`x-openapimcp` extension → per-op timeout/retries**
  `opConfigFor` reads `op["x-openapimcp"]` only. Keys (first defined wins):
  `timeout` ← `x-timeout` / `x-timeoutMs` / `timeoutMs` / `x-timeout-ms`
  (number = ms; string `"500ms"` or `"10s"`; bare numeric string = ms);
  `retries` ← `x-retries` / `x-maxRetries` / `retries` / `maxRetries`
  (non-negative integer); `maxResponseBytes` ← `x-maxResponseBytes` /
  `maxResponseBytes`; `budgetBytes` ← `x-budget` / `x-budgetBytes` /
  `budgetBytes` / `x-budget-bytes` (number, or decimal string).
  Unrecognized keys are dropped; invalid values are ignored, never thrown.
  **Only `timeoutMs` and `retries` are honored by the fetch path** — see the
  `x-openapimcp` table below. Evidence: `src/op-config.ts`, `src/http.ts`,
  `src/openapi.ts`.

- **Also inferred (not in the required list, but true):**
  `info.title` / `info.version` → server metadata (defaults `"API"` / `"0.0.0"`);
  `openWorldHint: true` always; per-tool MCP prompts (`<tool>_help`); MCP resources
  mode; Swagger 2.0 `securityDefinitions` fallback; `$ref`-dereferenced documents via
  `@apidevtools/swagger-parser` (`loadDocument`, `loadDocumentRaw`).

---

## What is NOT inferred (and why)

- **Streaming / SSE endpoints (`text/event-stream`) — openapimcp treats them as ordinary JSON calls**
  Nothing in the fetch path special-cases SSE. `http.ts` reads the whole response with
  `res.text()`, then attempts `JSON.parse` with a raw-text fallback (`renderBody`). An
  endpoint that emits an unbounded SSE stream will effectively hang until the
  (per-op or global) timeout — it will not be delivered incrementally to the agent,
  and it will not fail fast either. The only `text/event-stream` reference in the
  codebase is an `Accept` header in the developer portal's own SSE client
  (`src/portal.ts`) and the gateway's *outbound* Streamable HTTP transport; neither is
  upstream-SSE handling. `src/streaming.ts` is a text-chunking/SSE-frame helper for
  openapimcp's own messages, not an upstream proxy. `compat` has no keyword for SSE and
  will report such operations as supported. (MCP-level "Streamable HTTP" is about the
  server ↔ agent transport, not about proxying SSE APIs — see README highlights and
  `docs/roadmap.md`.)

- **File-upload bodies (`application/octet-stream`, `multipart/form-data` without `@path` hint) — compat flags as "unsupported"**
  `compat` marks any request body content type that does not match `/json/i` as
  `non-JSON body: <ct>` → **unsupported** (src/compat.ts). The fetch path never reads a
  non-JSON declared body from the spec. There is a runtime escape hatch: for tools
  whose bodies became flat `body` args (`bodyObject`), a string argument starting with
  `@` is interpreted as a file path, the file is read from disk, and the request is
  re-encoded as `multipart/form-data` (src/http.ts, fileArgs block;
  `src/multipart.ts`). That is a *value* convention on the client side, not spec
  inference — `compat` still reports the operation as unsupported, and the `@file`
  behavior applies only when the tool has a flat body object argument, not for
  octet-stream `requestBody`s unsupported by the JSON reader. Consequence:
  `multipart/form-data` without disciplined use of `@path` is effectively unusable
  without manual intervention.

- **oneOf/anyOf discriminated unions — tools get no type narrowing; compat marks "partial"**
  `jsonSchemaToZod` converts `anyOf`/`oneOf` to plain Zod unions (with nullable
  flattening) — it does **not** read `discriminator` and cannot narrow by it, so the
  emitted input type is a blind union. The keyword `discriminator` itself is flagged as
  `exotic schema` → **partial** by `compat`, as are `oneOf`, `anyOf`, `allOf`, `not`,
  `unevaluatedProperties`, and `x-nullable` (substring scan over the stringified
  operation, src/compat.ts). Note `x-nullable` is flagged by compat but is *not*
  honored by `jsonSchemaToZod` either (nullable is only derived from
  `type: [..., "null"]` or a `null` union branch). On the output side, `toOutputSchema`
  silently drops union/intersection keywords, so `outputSchema` — if one is produced at
  all — will not reflect them. There is no generated TypeScript type surface for MCP
  tools; the `client` command emits a standalone TS client as a separate path, but that
  is code generation, not the MCP tool type.

- **Callbacks / webhooks (`callbacks` key) — openapimcp doesn't start callback receivers**
  `compat` flags any operation with a `callbacks` key as `callbacks` → **partial**
  (src/compat.ts). No HTTP listener is ever bound for callbacks, and nothing subscribes
  to webhooks declared in the spec. `src/webhook.ts` is an outbound webhook
  *notification sender* (HMAC-signed payloads for openapimcp's own events), unrelated to
  OpenAPI `callbacks`. To exercise such operations you need an external receiver and
  typically out-of-band handling.

- **Extensions outside `x-openapimcp` — ignored silently**
  `opConfigFor` reads only `op["x-openapimcp"]`; every other `x-*` keyword is dropped
  (and `toOutputSchema` drops `x-*` from output schemas too). There is no warning, log,
  or compat note for unknown extensions. If your spec encodes meaning in
  `x-ratelimit-*`, `x-internal`, `x-codegen-*`, etc., openapimcp cannot see it.

- **Tool selection policy (which tools to expose when a spec has 1000+ operations) — needs `--tool-search` or `--include/--exclude`, not automatic**
  openapimcp registers every operation as a tool unless told otherwise. The knobs are
  CLI-side: `--tool-search` (expose only `search_tools` + `call_tool` for progressive
  disclosure), `--include <regex>` / `--exclude <regex>` (name match), `--tag <tag...>`,
  `--read-only` (drop non-GET/HEAD/OPTIONS), `--hide-deprecated`. None of these are
  inferred from the spec, and there is no automatic cost-based pruning; a 1,000-op spec
  served naively will hand a 1,000-tool list to the agent. README markets `--tool-search`
  for this; it is opt-in.

- **Other gaps worth knowing (not asked for, but defensible from source)**
  - **Required header/cookie parameters are not callable.** They are excluded from the
    argument list in `buildTool`, and `compat` flags them only as **partial**
    (`required header: <name>` / `cookie parameter`), not unsupported. An operation
    that requires `X-Tenant-Id` cannot be supplied that value through the tool at all —
    the verdict "partial" understates the breakage.
  - **Non-object 2xx roots (arrays, scalars) yield no `outputSchema`** by design
    (`toOutputSchema` returns `undefined`; see `docs/roadmap.md`, "Structured output
    schemas").
  - **`allOf` merging is naive** (object-branch merge only; falls back to Zod
    intersection); cyclic ref chains that survive dereferencing (e.g. self-referential
    models) report fine but describe hollow schemas in output positions.
  - **Pagination is opt-in** (`--paginate`, Link-header / next-URL heuristics), not
    derived from the spec.
  - **Examples are capped** at 3 per operation, 120 chars each.
  - **JSON-bodied callbacks to `default` only**: output-schema selection looks only at
    `200` → `201` → `default` → other 2xx; a spec whose success case is, say, only a
    `202` is covered by the other-2xx fallback, but non-2xx success semantics are not.

---

## What needs a hint (`x-openapimcp` extension)

The `x-openapimcp` extension is read **per operation**, not per spec. All values go
through `parseOpConfig`; unknown keys are dropped and invalid values ignored. The right
column states what actually happens at runtime — which does not always match what the
keys suggest.

| Need | Extension | Example | Reality check (source) |
| --- | --- | --- | --- |
| per-op timeout | `x-openapimcp: { timeoutMs: 5000 }` | PokeAPI `GET /api/v2/pokemon/{id}/` (illustrative — the vendored PokeAPI fixture does **not** carry this extension) | ✅ Honored. `http.ts` computes `effectiveTimeoutMs = tool.opConfig?.timeoutMs ?? opts.timeoutMs` (global default `--timeout`, 30000 ms on the serve path). Strings like `"5s"` / `"5000"` also accepted; aliases `x-timeout`, `x-timeoutMs`, `x-timeout-ms`. `src/op-config.ts`, `src/http.ts` |
| per-op retries | `x-openapimcp: { retries: 2 }` | safe idempotent ops | ✅ Honored the same way: `tool.opConfig?.retries ?? opts.retries`. Global `--retries` defaults to `2`. Aliases `x-retries`, `x-maxRetries`, `maxRetries`. Note: `opConfigFor` also exports `resolveRetries` (idempotent methods fall back to the global default, others default to 0), but **that function is not called anywhere in the fetch path** — do not rely on per-method defaulting. `src/op-config.ts`, `src/http.ts`, `src/cli.ts` |
| budget cap | `x-openapimcp: { budgetBytes: 1000000 }` | large-response APIs | ⚠️ Parsed and displayed (`formatOpConfig` shows it) but **not enforced anywhere**. Grep confirms `opConfig.budgetBytes` / `opConfig.maxResponseBytes` are consumed nowhere outside `op-config.ts`. What *is* enforced: the global `--budget '{"maxCalls":N,"maxBytes":N}'` (`BudgetTracker`, `src/budget.ts`, wired in the CLI) and `--max-bytes` (response truncation for the agent, default 20000). Note this extension is per **operation**, never per spec; a per-spec cap needs `--budget`. Also, `CHANGELOG.md` claims `x-maxResponseBytes`/`x-budget` are "respected by the fetch path" — that contradicts the current source. `src/op-config.ts`, `src/budget.ts`, `src/cli.ts`, `CHANGELOG.md` |
| drop output schema | `x-openapimcp: { noOutputSchema: true }` | streams disguised as JSON | ❌ **Not implemented.** There is no `noOutputSchema` key anywhere in the source (`opConfigFor` drops it silently as unrecognized). The only way to suppress `outputSchema` is to not pass `--structured-content`; there is no per-op opt-out. If you need it, the workable pattern today is a global flag or post-hoc removal of `responseSchema`, not an extension. `src/op-config.ts`, `src/server.ts`, `src/cli.ts` |

Other accepted-but-inert keys for completeness: `maxResponseBytes` (parsed, unused), and
the retry/timeout aliases listed above. Everything else under `x-openapimcp` is ignored
silently.

Where a hint genuinely cannot help — SSE endpoints, callbacks, required header params,
tool selection — the answer is CLI flags, spec surgery, or a hand-written wrapper, not an
extension.

---

## Reading the compat report

`openapimcp compat <spec>` (optionally `--json`, optionally `--overlay <file>`) loads
the spec through the regular dereferencer (`loadDocument`), then runs
`analyzeSpecCompat(doc)` and prints `formatCompatReport(report)` (text) or the raw
report object (`--json`). `openapimcp doctor` also embeds a one-line compat summary in
its output. See `src/compat.ts`, `src/cli.ts`.

**What the analysis does.** For every operation it serializes the operation with a
cycle-safe stringifier (`stringifyCycles` — `$ref` cycles become `"[circular]"`,
src/json-safe.ts) and does substring searches for the following:

| Pattern scanned | Reason pushed | Effect |
| --- | --- | --- |
| request body content types not matching `/json/i` | `non-JSON body: <ct>` | **unsupported** |
| `"oneOf"`, `"anyOf"`, `"allOf"`, `"not"`, `"discriminator"`, `"unevaluatedProperties"`, `"x-nullable"` | `exotic schema: <kw>` | partial |
| `op.callbacks` present | `callbacks` | partial |
| required parameter with `in: header` | `required header: <name>` | partial |
| parameter with `in: cookie` | `cookie parameter` | partial |
| `op.deprecated` truthy | `deprecated operation` | partial |

Verdict rule (src/compat.ts): **unsupported** iff at least one reason starts with
`non-JSON`; otherwise **partial** iff any reason exists; otherwise **supported**.

**Format.** Text output is a 4-line header (`supported` / `partial` / `unsupported` /
`total`) followed by one line per operation: `✓ <operationId> (METHOD /path)`,
`~ …` (partial, with reasons), or `✗ …` (unsupported, with reasons). Operation IDs
fall back to `<method>_<path>` when absent (and are **not** sanitized in the report —
the sanitizer applies only to tool names). JSON output shape:

```json
{
  "entries": [{ "operationId": "...", "method": "get", "path": "/x",
                "status": "supported|partial|unsupported", "reasons": ["..."] }],
  "summary": { "supported": 0, "partial": 0, "unsupported": 0 }
}
```

**Exit codes.** `compat` sets **no** exit code based on the report — it exits `0` on
success regardless of how many operations are unsupported. Failure paths (unreadable or
unparseable spec, unreadable overlay) surface as a non-zero exit (the CLI does not wrap
`parseAsync` in a global error handler; unexpected exceptions reject and Node exits
non-zero, and explicit `fatal()` calls `process.exit(1)`). No exit code reflects the
verdict counts, and there is no built-in CI gate; to fail a build on regressions you must
parse `--json` yourself (e.g. in a small node one-liner or `jq`). `doctor`'s compat summary is likewise
informational.

**What supported / partial / unsupported actually mean**

- `supported` — no scanned red flag. Not a promise of reachability, auth completeness,
  or upstream health; for that use `doctor` (which also does an optional `baseUrl`
  probe and lists schemes missing credentials).
- `partial` — callable, with caveats. The operation will usually produce a working
  tool; the reasons tell you what was swept under the rug (exotic schema keywords —
  often a false-positive-ish substring hit inside a shared `$ref`-expanded schema, which
  is why the vendored PokeAPI corpus reports 51/51 partial from `allOf`). Deprecated ops
  and required-header/cookie params land here — note the required-header case is
  effectively unusable, not merely "with notes" (see above).
- `unsupported` — a request body exists whose content type is not JSON-like. The tool
  will be registered but its body cannot be constructed faithfully by openapimcp (only a
  JSON `body`/`bodyObject` path exists). Fix the spec (convert the operation to JSON), do
  not use the tool for that call, or hand-write a wrapper.

**Limits of the report**

- Substring matching over a serialized operation: a keyword appearing inside prose
  (e.g. a description mentioning "anyOf") counts; there is no schema-aware analysis.
- The report itself resolves nothing. In the CLI it is fed the *dereferenced* document,
  so counts reflect the expanded schema; called on a raw document, unexpanded `$ref`s
  simply hide their targets from the scan.
- It does not check auth, pagination, rate limits, or reachability — those surface only
  at call time (and via `doctor`'s separate checks).
- Corpus reference points (published in `README.md`, asserted in `test/corpus.test.ts`
  against pinned real specs — not independent measurements): Swagger Petstore OpenAPI
  3.0.4 → 13 supported / 0 partial / 6 unsupported (XML and form bodies) of 19 ops;
  httpbin Swagger 2.0 → 73 / 0 / 0; PokeAPI OpenAPI 3.1.0 (cyclic `$ref`s) →
  51 / 51 / 0 (all `exotic schema: allOf`). Treat these as "known-good calibration
  points", not as a guarantee for your spec.
- README's prose description of `unsupported` (callbacks, required header/cookie
  params, deprecated ops) is looser than the implementation: in the current source all
  of those are **partial**; only non-JSON request bodies yield **unsupported**. This
  document follows the source.

**Fraction of a spec inferable without hints (summary).** For plain REST-style JSON
APIs, effectively everything about the *call surface* (names, signatures, argument
validation, auth wiring, base URL, annotations, examples) is inferred — the limiting
factors are schema exoticism (which only flags, doesn't block) and non-JSON bodies
(which block). The inferable fraction drops on machine-generated 3.1 specs with heavy
`allOf` reuse (~50% of PokeAPI ops are flagged partial) — still callable, but flagged.
The parts that remain genuinely manual are: streaming/SSE behavior, binary/multipart
uploads, discriminated-union precision, callback receivers, selection policy for huge
specs, required header/cookie plumbing, and per-operation budget enforcement. In every
one of those cases the escape hatch is a CLI flag (`--structured-content`,
`--tool-search`, `--include/--exclude`, `--tag`, `--read-only`, `--hide-deprecated`,
`--budget`, `--max-bytes`, `--paginate`, `--overlay`) or a spec edit — not a magic
hint.
