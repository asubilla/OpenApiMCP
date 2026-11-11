# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

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
