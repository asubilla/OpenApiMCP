# openapimcp — Roadmap for AI agents & manual developers

One-page truth: what this is, how to install it, how to call a tool, and what's
built vs. planned — for two audiences: **AI agents** (LLMs/MCP clients) and
**manual developers** (humans at a terminal).

## What it is

`openapimcp` turns any OpenAPI 3.x / Swagger 2.0 spec into a working MCP server
with one command. No code generation, no glue script, no framework lock-in.
Same process serves stdio (local IDE agents) and Streamable HTTP (team/shared
gateway), with real auth, policies, budgets and retries built in.

## Two ways people use it

**AI agents** want a spec turned into tools the model can call, with safety
rails (read-only mode, policies, response budgets). **Manual developers** want
the same spec explored, validated and called from a terminal — and a
standalone MCP project they can own.

---

## Install

### For AI agents (zero install)

```bash
npx -y @asubilla/openapimcp <spec>
```

MCP clients (OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue,
Zed) pick it up via the client snippet — `openapimcp setup` writes those for
you. See [Getting started → editors](../README.md#auto-configure-your-editors).

### For manual developers (global install)

```bash
npm install -g @asubilla/openapimcp
openapimcp --help
```

Requires **Node.js 20+**. No account, no registration, no telemetry asking.

---

## Use it (both audiences, same commands)

### AI agent flow — "give my model an API"

1. Point your MCP client at the gateway or stdio server:
   ```bash
   openapimcp ./openapi.json              # stdio MCP server (default)
   openapimcp ./openapi.json --http       # HTTP gateway on 127.0.0.1:3000
   ```
2. The agent gets one tool per API operation (or two meta-tools with
   `--tool-search` for huge specs).
3. The agent calls them like any other tool. Example of a real LLM call flow
   (Pokémon API — live, 2026-11-16, no key needed):
   ```
   POST /mcp  (tools/call pokemon_retrieve { "id": "ditto" })
   → HTTP 200, SSE: { "result": { "content": [ { "type": "text",
        "text": "GET https://pokeapi.co/api/v2/pokemon/ditto/\nHTTP 200 OK\n{...\"id\": 132...}" } ] } }
   ```

### Manual developer flow — "poke the API from a terminal"

```bash
openapimcp list ./openapi.json                # enumerate tools
openapimcp doctor ./openapi.json             # validate spec, auth, connectivity, compat
openapimcp call ./openapi.json findPetsByStatus --arg status=available
openapimcp run ./openapi.json "find available pets"   # no AI needed — fuzzy match
```

Real output (petstore3, live, 2026-11-16):

```
openapimcp call .../petstore3.openapi.json findPetsByStatus \
  --base-url https://petstore3.swagger.io/api/v3 --arg status=available
GET https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available
HTTP 200 OK
[ { "id": 4, "name": "Dog 1", "status": "available" }, ... ]
```

And for a shared team gateway:

```bash
openapimcp ./pokeapi.yml --http --port 3000 --gateway-key topsecret
# GET /healthz      → {"status":"ok","uptimeSeconds":2}
# GET /metrics      → openapimcp_gateway_info{version="1.13.2"} 1
# POST /mcp no-key  → HTTP 401
# POST /mcp w/ key  → HTTP 200 (SSE, serverInfo in body)
```

---

## How to call each tool

All 33 commands, one line each (as of v1.13.2). `✓` = verified with real runs
in this repo (see [CHANGELOG](../CHANGELOG.md) and
[`docs/aws-sigv4.md`](aws-sigv4.md) / [`docs/action-verification.md`](action-verification.md)).

| Command | What it does | Verified |
|---|---|---|
| `serve [specs...]` | stdio MCP server or `--http` gateway | ✓ |
| `list [specs...]`  | enumerate tools (`--json` for machines) | ✓ |
| `doctor [specs...]`| validate spec, auth readiness, latency, compat summary | ✓ |
| `call [spec] <tool>` | one-shot API call, no AI | ✓ |
| `run [spec] "<task>"` | match a task description to a tool, run it | ✓ |
| `setup [spec]`     | write MCP entries into every detected client | ✓ (`--dry-run`) |
| `init <spec>`      | write one client config entry | ✓ |
| `use <spec>`       | save a default spec | ✓ |
| `generate <specs...>` | emit a standalone offline MCP project | ✓ |
| `client <spec>`    | emit a typed TS client | ✓ |
| `smoke <spec>`     | emit a node:test smoke suite | ✓ |
| `diff <old> <new>` | breaking / non-breaking changes (CI gate) | ✓ |
| `compat <spec>`    | which operations are supported/partial/unsupported | ✓ |
| `lint <spec>`      | spec quality score + issues | ✓ |
| `pin <spec>`       | sha256 of a spec (change detection) | ✓ |
| `bundle <spec>`    | resolve external `$ref`s into a self-contained file | ✓ |
| `batch <spec> --file calls.json` | concurrent tool calls with partial-failure report | ✓ |
| `history [--file f]` | replay/inspect recorded calls (`--history <file>`) | ✓ |
| `dry-run <spec> <tool>` | preview the exact request, secrets masked | ✓ |
| `pin`              | spec change-detection hash | ✓ |
| `presets`          | curated public APIs (petstore, pokeapi, github) | ✓ |
| `marketplace [q]`  | browse APIs.guru directory | ✓ |
| `discover <input>` | best-effort spec discovery from a domain | ✓ (honest "found none" case included) |
| `eval <spec> <cases>` | measure tool-selection accuracy | ✓ (4/4, 100%) |
| `memory <file>`    | persistent agent memory (add/search/clear) | ✓ |
| `workflow <file>`  | multi-step JSON workflow runner | — (format defined, no real example yet) |
| `a2a <spec>`       | emit an A2A agent card | ✓ (card prints; no handshake yet) |
| `graphql <sdl>`    | GraphQL SDL → MCP tools (preview) | ✓ (from hand SDL) |
| `postman <collection>`| list operations in a Postman collection | ✓ |
| `config <file>`    | validate an openapimcp config file | ✓ |
| `ui <spec>`        | interactive TUI browser | — (interactive; covered by unit tests) |
| `completions [shell]` | bash/zsh/fish/powershell completion script | ✓ |
| `help`             | this list | ✓ |

---

## Roadmap — AI agents

**Shipped (live in v1.x, README ["Verified against real APIs"](../README.md))**
- One tool per API operation, or `--tool-search` progressive disclosure (`search_tools` + `call_tool`)
- Structured content (`--structured-content`) → typed `structuredContent` for agents
- MCP prompts (`<tool>_help`) — model can ask how a tool works
- MCP resources (`--resources`) — spec/operations/servers/security as resources
- Async 202 polling, multipart uploads, `--mock` offline mode
- Safety rails: `--read-only`, `--budget`, Idempotency-Key, SigV4, `--dry-run`, `--hide-deprecated`, policy engine
- HTTP gateway: Host/Origin guards, API-key/JWT/OAuth2-cred-client, Prometheus `/metrics` + `openapimcp_gateway_info`, `/healthz`, developer portal
- `--resources` for spec/ops/servers/security

**Next (not yet built)**
- `gRPC → MCP` (`.proto` input)
- A real **MCP SDK conformance matrix** as a CI job (initialize/tools-list/call/resources/prompts against the current MCP protocol revisions)
- **Per-user rate limits** at the gateway (today: process-wide rate limit + per-tenant policy)
- **Streamable HTTP long-lived connections** (SSE resumption tokens / Last-Event-ID) — today: stateless request/response
- **Structured output schemas** exported alongside `structuredContent` (today: payload only)

## Roadmap — manual developers

**Shipped**
- `doctor`, `call`, `run`, `list`, `ui` — full spec inspection from a terminal
- `generate` — offline standalone MCP project (Dockerfile, README, tsconfig, package.json)
- `client` — typed TS client emitted from the spec
- `smoke` — node:test suite emitted from the spec
- `compat` — human-readable support verdicts per operation
- `diff` — breaking-change detection, CI gate
- `lint` — quality score + issues
- `pin` — sha256 change detection
- `bundle` — external `$ref` resolver
- `batch` — concurrent tool calls with partial-failure report
- `history` — JSONL call log with replay
- `compat` — full/partial/unsupported verdicts
- `marketplace`, `discover`, `presets` — find APIs fast

**Next**
- Docker image on ghcr promoted to `latest` automatically on tags (Docker publish job now green as of v1.13.2, but image not always promoted in lock-step — improve trigger)
- `generate` emitting **audited, pin-first** projects (today: generated output is functional but untested end-to-end in this repo's CI matrix)
- IDE-side refactors for `openapimcp ui` (currently basic TUI; full keybinding map documented in `docs/`)
- `generate --target=vscode-extension` (today: standalone node project only)

---

## Honest status (today, 2026-11-18)

- **Tests:** 741/741 unit + e2e MCP handshake (2026-11-18)
- **CI:** green on Node 20/22/24 — `main` is always green or the push doesn't land
- **Docker / npm publish:** green as of v1.13.2 (image pushed to ghcr.io)
- **npm:** 1.13.1 `latest`; 1.13.2 staged → releases after the usual registry gate
- **Not yet proven by a real user outside this repo:** the PR spec-review Action on a real GitHub repo runner; SigV4 against live AWS; full multi-client IDE handshake matrix; 326 KB PokeAPI snapshot will drift from upstream (refresh commands in [`test/fixtures/corpus/README.md`](../test/fixtures/corpus/README.md))

## What we will not fake

- No "works with 1000+ APIs" claim without running them
- No CI badge that says anything but green/red
- No output in this doc that wasn't produced by running the command shown (specs pinned in `test/fixtures/corpus/` are the exact fixture data the tests use)
