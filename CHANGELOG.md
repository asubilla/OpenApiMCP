# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [1.12.0]

### Added
- **Corporate proxy / custom CA (wired for real)** — `--ca <pem>` and `--proxy <url>` now route every upstream request through an undici dispatcher (verified live: HTTPS via custom CA, HTTP and HTTPS-via-CONNECT through a local proxy). `undici` is an optional dependency; install it with `npm install undici` when needed.
- **`--ca` / `--proxy` flags** on all runtime commands; a startup log line shows the active proxy plan (credentials masked).
- **`openapimcp_gateway_info` metric** on the HTTP gateway `/metrics` (Prometheus build/version gauge).
- **`test/client-compat.test.ts`** — MCP client compatibility matrix across stdio (default, `--tool-search`, `--structured-content`, `--resources`) and Streamable HTTP (healthz/metrics/initialize, 401-with/200-with `--gateway-key`).
- **`test/action-sim.test.ts`** + diff fixtures — simulates the spec-review Action end-to-end (base vs breaking/additive specs; exit code 1/0 as the PR gate requires).
- **`docs/aws-sigv4.md`** — what was verified (14 official suite vectors recomputed with OpenSSL) and what is not (live AWS calls need credentials).
- **`docs/action-verification.md`** — the Action's fail gate, reproduction steps, and known limitations.
- **SigV4 suite vectors** — 14 official vectors (from a mirror of the AWS SigV4 test suite) verified byte-for-byte; `canonicalUri` percent-triplet bug fixed; 21 tests.
- **`--ca`/`--proxy` covered by `test/proxy-dispatcher.test.ts`**.

### Fixed
- **Any upstream fetch failure crashed the process** with a raw `TypeError: fetch failed` stack (TLS, DNS, refused connections). The CLI now reports `Request failed: <cause>` with exit code 1.

## [1.11.0]

### Added
- **`batch`** — `openapimcp batch <spec> --file calls.json [--concurrency 5] [--json]` calls many tools concurrently with partial-failure reporting.
- **`history`** — `openapimcp history [--file f] [--limit n] [--clear]` shows calls recorded via `--history <file>` (all commands that execute HTTP requests support `--history`).
- **Tenant isolation (wired)** — `--tenants file.json --tenant <name> --user-key <key>` on serve/call/run/list/generate/batch; per-user creds override tenant creds.
- **`--hide-deprecated` (wired)** — drops `deprecated` / `x-sunset` operations on all tool-filtered commands and direct calls.
- **`--idempotency`** — adds a fresh `Idempotency-Key` header to POST/PUT/PATCH/DELETE.
- **`--budget '{"maxCalls":N,"maxBytes":N}'`** — per-gateway usage budget; blocks calls and records bytes.
- **`--response-map '{"pick":[],"rename":{},"drop":[]}'`** — normalize JSON responses for the model.
- **`--plugin <path...>`** — load `hooks: [{ beforeRequest?, afterResponse? }]` plugins (custom auth/signing) on the request path.
- **`--sigv4 <region>:<service>`** — AWS SigV4 request signing (env credentials).
- **`--resources`** — expose the spec, operations, servers and security as MCP resources (single-spec stdio/HTTP servers).
- **Production guardrails** — starting the HTTP gateway logs `ERROR`/`WARN` checks (non-loopback host without `allowedHosts`, plain HTTP off-loopback, no read-only/policy, no auth) with fix hints.
- **`--preset` on serve/list/doctor/generate** — curated APIs: petstore, pokeapi, github.
- **`--read-only` on `call`** — refuses to invoke mutating operations.
- **Per-operation `x-openapimcp`** — `x-timeout`, `x-retries`, `x-maxResponseBytes`, `x-budget` respected by the fetch path.

### Fixed
- **`--mock` was dead** — `mockSpec` was never forwarded to the request pipeline, so mock responses never engaged and every call hit the network. `mockSpec` is now wired through and mock works in serve/call/run.
- **PowerShell quoting** — inline JSON flags (`--budget`, `--response-map`) also accept file paths; BOMs tolerated.

### Changed
- `--mock` added to `call` and `run` commands.

## [1.10.0]

### Added
- **`bundle`** — `openapimcp bundle <spec> [--out]` resolves external `$ref`s into a self-contained spec.
- **`pin`** — `openapimcp pin <spec>` records a sha256 hash of the spec (detect unexpected changes).
- **call-history** — persistent call history with replay (`--history <file>`).
- **idempotency** — `Idempotency-Key` header generation and propagation.
- **sigv4** — AWS SigV4 request signing.
- **deprecation** — detect/hide deprecated operations.
- **op-config** — per-operation timeout/retry/response limits from `x-openapimcp` extensions.
- **mcp-resources** — expose spec/operations/servers/security as MCP resources.
- **production-defaults** — gateway safety checks (non-loopback, no-auth, no-policy warnings).
- **tenant** — multi-tenant config (`--tenant`, per-user credential isolation).

## [1.9.0]

### Added
- **`presets`** — `openapimcp presets` lists curated APIs (petstore, pokeapi, github); `--preset <name>` on serve/list/doctor uses them automatically (read-only where appropriate).
- **`response-map.ts`** — normalize awkward API responses: pick/rename/drop fields (`applyMapping`).
- **`budget.ts`** — per-gateway usage budgets (`--budget`, `BudgetTracker`).
- **`plugin-hooks.ts`** — before/after request plugin hooks; dynamic loading via `loadPlugin`.
- **`batch.ts`** — `runBatch()` with concurrency control, order preservation, partial-failure reporting.
- **`proxy-tls.ts`** — corporate CA / proxy / TLS config (`planProxyTls`, env-var based).

## [1.8.0]

### Added
- **Async job support** — 202 Accepted responses are polled until completion (or timeout) with `--async`, `--async-poll-interval`, `--async-max-wait`.
- **File upload / multipart** — body args starting with `@path/to/file` are sent as `multipart/form-data`.
- **`dry-run`** — preview the exact request (method, URL, headers with secrets masked, body) without sending.
- **`--profile` / `--profiles`** — named environments (baseUrl, headers, readOnly, policy); `env:KEY` header values resolve from environment variables.
- **Config validation** — `openapimcp config <file>` validates a config file and exits non-zero on errors; warnings for unknown keys.
- **`compat`** — `openapimcp compat <spec>` reports fully/partially/unsupported operations; `doctor` now shows a summary too.
- **Error enrichment** — upstream errors now include request-id, Retry-After, content-type, and redacted bodies.

## [1.7.2]

### Added
- **`structuredContent`** — tool results now include typed parsed JSON when `--structured-content` is set.
- **`compat`** — `openapimcp compat <spec>` reports fully/partially/unsupported operations.
- `doctor` now prints compatibility summary.

### Docs
- `docs/production.md` — Docker Compose, nginx + TLS, secrets, CI, policy baseline, monitoring.

## [1.5.0]

### Added
- **Gateway auth** — protect the HTTP gateway with API keys (`--gateway-key`) or signed JWTs (HS256).
- **OAuth2 client-credentials** — auto-fetch and refresh upstream tokens.
- **Spec auto-discovery** — `openapimcp discover <domain>` finds an OpenAPI spec.
- **Cost tracking** — per-tool token estimation + cost log (`--cost-log`, `--cost-model`).
- **Agent memory** — persist facts/decisions across sessions (file-based, searchable).
- **Workflow engine** — define multi-step tool chains with `{{placeholder}}` resolution.
- **Spec linting** — `openapimcp lint <spec>` (10 rules, quality score).
- **MCP sampling** — helper for server-initiated model calls.
- **Marketplace** — `openapimcp marketplace [query]` browses 2000+ public APIs on APIs.guru.
- **Context budget** — auto-trim responses to fit LLM context windows.
- **Feedback store** — thumbs up/down per tool with improvement suggestions.
- **Eval harness** — measure tool-selection accuracy.

## [1.4.0]

### Added
- **Gateway auth** — protect the HTTP gateway with API keys (`--gateway-key`) or signed JWTs (HS256, `--gateway-jwt-secret`).
- **OAuth2 client-credentials** — auto-fetch and refresh upstream tokens from env or spec security schemes.
- **Spec auto-discovery** — `openapimcp discover <domain>` finds an OpenAPI spec by probing common paths (and APIs.guru).
- **Cost tracking** — per-tool token estimation + cost log (`--cost-log`, `--cost-model`) with a pricing table for major models.

## [1.3.1]

### Fixed
- `postinstall` no longer references a compiled file that doesn't exist during `npm ci` (moved to `scripts/postinstall.js`). Fixes install failures on CI and Docker.

## [1.3.0]

### Added
- **Developer portal** — self-contained "Try it" playground served at `/` of the HTTP gateway (lists tools, runs them, shows results).
- **MCP prompts** — every operation exposed as `<tool>_help` prompt with parameter summaries.
- **Few-shot examples** — `example`/`examples` from the spec are appended to tool descriptions.
- **Auto-configure** (`setup` command) — detects OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed on Windows/macOS/Linux and writes their MCP config. `--dry-run`, `--project`, `--target`. Postinstall hint + `OPENAPIMCP_AUTO_SETUP=1`.
- `--arg key=value` shorthand for `call`/`run`.
- `init`, `use`, `run`, `client`, `smoke`, `ui`, `completions` commands.

## [1.2.0]

### Added
- Auto-configure detected MCP clients (setup command + postinstall hint).

## [1.1.0]

### Added

**Context economy**
- `--fields` response allowlists, `--summarize` large-response trimming, `--redact` secret/PII masking,
  untrusted-content wrapping, and JSON Schema response validation.

**Scale & reliability**
- `--tool-search` progressive disclosure (`search_tools` + `call_tool`) for very large APIs.
- `--rate-limit` (token bucket) and `--breaker` (circuit breaker).
- `--cache-dir` persistent on-disk cache (sha256-keyed) with ETag helper.

**Observability**
- Structured JSON logging (`--log-json`), JSON-lines audit log (`--audit`),
  Prometheus metrics registry + `healthPayload()`.

**Configuration & tooling**
- `--config` file (CLI overrides), `--dotenv` loader, `--overlay` OpenAPI Overlays.
- New commands: `ui`, `diff`, `postman`, `client`, `smoke`, `completions`.
- Typed TypeScript client generation and `node:test` smoke-suite generation.
- Terminal tool browser (`ToolKit`, `formatToolList`, `formatToolDetail`).

**Distribution**
- Published Docker image workflow (ghcr.io), composite GitHub Action,
  Helm chart, Homebrew formula and Scoop manifest templates.

### Changed
- The library entry point (`openapimcp`) now re-exports the full public API.

## [1.0.0]

### Added
- Remote Streamable HTTP gateway (`serve --http`) with Host/Origin guards.
- Policy engine: tool allow/deny globs, HTTP-method allowlist, outbound-host allowlist.
- OpenTelemetry spans + metrics on every tool call.
- `Dockerfile`, `docker-compose.yml`.

## [0.3.0]

### Added
- Retries with backoff, response caching, pagination following.
- Multi-spec servers with namespaced tool names.
- `generate` — emit a standalone, offline MCP server project.
- Library entry point.

## [0.2.0]

### Added
- Auto auth from `securitySchemes` + `{env:}` substitution.
- `--read-only`, `--tag` filters, `--fields` response filtering.
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).
- `list` / `doctor` / `call` subcommands.

## [0.1.0]

### Added
- Initial release: `openapimcp <spec>` turns any OpenAPI 3.x / Swagger 2.0
  document into an MCP server over stdio.
