# openapimcp ⚡

**Turn any OpenAPI/Swagger spec into an MCP server — with one command.**

Point it at an API spec and instantly get an [MCP](https://modelcontextprotocol.io) server exposing every endpoint as a tool your AI agent can call. Run it locally over stdio, or host it as a shared HTTP gateway. No boilerplate, no codegen step, no glue code to maintain.

```bash
npx openapimcp https://petstore3.swagger.io/api/v3/openapi.json
```

---

## "Why not just ask an AI to write it?"

Fair question. An LLM *can* generate an MCP server, or just `curl` the API ad-hoc. Here is what you get from `openapimcp` instead:

| One-off prompt / ad-hoc curl | openapimcp |
| --- | --- |
| Code you must **maintain**; breaks when the spec changes | Nothing to maintain — re-run and it's in sync |
| LLMs **hallucinate** endpoints, params, and encodings | Built **deterministically** from the spec |
| Burns tokens **every session** re-figuring out the API | Configured once; available to every session, agent, and teammate |
| Chokes on **large specs** (1000+ endpoints) | `--tool-search` progressive disclosure + `--tag`/`--read-only` |
| Dumps a 2 MB JSON blob into your context | `--fields`, `--summarize`, `--max-bytes`, `--redact` |

## Highlights

- 🔌 **Zero code** — runtime-generated tools, nothing to maintain
- 🔐 **Auto auth** — resolves `securitySchemes` from env vars; policy engine for tools/methods/hosts
- 🪶 **Context-friendly** — field allowlists, response summarization, redaction
- ♻️ **Resilient** — retries, caching (memory + disk), pagination, rate limiting, circuit breaker
- 🔎 **Progressive tool search** — `search_tools` + `call_tool` for huge APIs
- 🌐 **HTTP gateway** — Streamable HTTP with Host/Origin guards for teams
- 📈 **Observability** — OpenTelemetry, Prometheus metrics, health probe, JSON logs, audit log
- 📦 **Extras** — `generate`, TS client generation, spec diff, smoke tests, Postman import, shell completions, TUI
- 🐳 **Docker + Helm** — ship a gateway in one image or chart

## Install

```bash
npx openapimcp <spec>          # no install needed
npm install -g openapimcp      # or globally
```

Requires **Node.js 20+**.

## Quickstart

```bash
openapimcp ui ./openapi.json                     # browse tools in the terminal
openapimcp list ./openapi.json                   # list tools
openapimcp doctor ./openapi.json                 # validate spec, auth, connectivity
openapimcp call ./openapi.json findPetsByStatus --args '{"status":"available"}'
openapimcp ./openapi.json                        # run as a stdio MCP server
openapimcp ./openapi.json --http                 # ...or as an HTTP gateway
```

## Provider setup

**OpenCode** (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "demo": { "type": "local", "command": ["npx", "-y", "openapimcp", "./openapi.json"] }
    }
  }
}
```

**Claude Desktop / Cursor** (`mcpServers`):

```json
{ "mcpServers": { "demo": { "command": "npx", "args": ["-y", "openapimcp", "./openapi.json"] } } }
```

## Developer portal

When you run the HTTP gateway, open the root URL in a browser to get a
self-contained **"Try it"** playground — no client needed:

```bash
openapimcp ./openapi.json --http --port 3000
# open http://127.0.0.1:3000/  -> lists every tool, lets you run them
```

The portal fetches `tools/list` from the MCP endpoint and renders a form per
tool. Results are pretty-printed JSON.

## MCP prompts

Each operation is also exposed as an MCP **prompt** (`<tool>_help`) so agents
can ask "how do I use this?" and get a parameter summary. Prompts carry the
same descriptions, which now include any `example`/`examples` from the spec.

## Auto-configure your editors

One command detects and configures every MCP client installed on your machine
(OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed) on
Windows, macOS, and Linux:

```bash
openapimcp setup ./openapi.json          # detect + write (user-level clients by default)
openapimcp setup ./openapi.json --project # project-level clients only
openapimcp setup ./openapi.json --dry-run # preview without writing
```

On `npm install`, openapimcp prints a hint; set
`OPENAPIMCP_AUTO_SETUP=1` to run setup automatically.

## Commands

```
openapimcp [specs...] [options]      # same as `serve` (default command)
openapimcp serve [specs...]          # stdio server, or --http gateway
openapimcp list [specs...]           # list tools (--json)
openapimcp doctor [specs...]         # validate specs, auth, connectivity
openapimcp call [spec] <tool>        # call one tool from the terminal
openapimcp ui <spec> [--tool NAME]   # browse tools in the terminal
openapimcp diff <old> <new>          # breaking / non-breaking changes
openapimcp generate <specs...> -o .  # emit a standalone project
openapimcp client <spec> -o ./client # generate a typed TypeScript client
openapimcp smoke <spec> [--out f]    # generate a node:test smoke suite
openapimcp postman <collection>      # list operations in a Postman collection
openapimcp init <spec>              # write an MCP client config entry
openapimcp use <spec>               # save a default spec
openapimcp run <spec> "<task>"       # run a task by matching tool names (no AI)
openapimcp setup [spec]             # auto-configure ALL detected editors
openapimcp completions [shell]       # bash | zsh | fish | powershell
```

### Common options

`--include` `--exclude` `--tag` `--read-only` `--policy` `--base-url` `-H/--header`
`--fields` `--max-bytes` `--timeout` `--retries` `--cache-ttl` `--cache-dir`
`--paginate` `--max-pages` `--rate-limit` `--breaker` `--redact` `--summarize`
`--config` `--dotenv` `--overlay` `--audit` `--log-json` `--tool-search`
`--print-config`

Gateway: `--http` `--port` `--host` `--path` `--allowed-host` `--allowed-origin`.

## Context economy

```bash
# keep only the fields you need (dotted paths + arrays)
openapimcp call ./openapi.json findPetsByStatus --fields "id,name,status"

# trim big payloads, redact secrets/PII, cap size
openapimcp ./openapi.json --summarize --redact --max-bytes 4000
```

## Policy engine

```json
{
  "allow": ["get*", "find*"],
  "deny": ["delete*"],
  "methods": ["GET", "POST"],
  "hosts": ["api.example.com", "*.trusted.com"]
}
```

```bash
openapimcp ./openapi.json --http --read-only --policy ./policy.json
```

## Resilience & scale

```bash
openapimcp ./openapi.json \
  --retries 3 --cache-ttl 60 --cache-dir .cache \
  --paginate --max-pages 10 \
  --rate-limit 10 --breaker \
  --tool-search          # for large APIs: search_tools + call_tool
```

## Observability

```bash
openapimcp ./openapi.json --http --log-json --audit ./audit.jsonl
```

- Every tool call emits an OpenTelemetry span + `openapimcp.tool.*` metrics (no-op until you register a provider).
- `--log-json` emits structured JSON logs; `--audit` appends a JSON-lines audit trail.

## Config file & .env

```json
{
  "base-url": "https://api.example.com",
  "readOnly": true,
  "cacheTtl": 60,
  "rateLimit": 10,
  "fields": ["id", "name"]
}
```

```bash
openapimcp ./openapi.json --config openapimcp.config.json --dotenv .env
```

CLI flags always override the config file. `--dotenv` loads `OPENAPIMCP_*` credentials.

## OpenAPI Overlays

```bash
openapimcp serve ./openapi.json --overlay ./overlay.json
```

## Spec diff (CI-friendly)

```bash
openapimcp diff ./old.json ./new.json   # exits 1 when breaking changes are found
```

## Generate a standalone project / client

```bash
openapimcp generate ./openapi.json --out ./my-mcp --read-only
cd my-mcp && npm install && npm start

openapimcp client ./openapi.json --out ./client   # typed TS fetch client
openapimcp smoke ./openapi.json --out ./smoke.test.ts
```

## Docker & Kubernetes

```bash
docker run -p 3000:3000 ghcr.io/asubilla/openapimcp \
  https://petstore3.swagger.io/api/v3/openapi.json \
  --http --host 0.0.0.0 --read-only

helm install demo ./charts/openapimcp --set spec=https://example.com/openapi.json
```

## GitHub Action

```yaml
- uses: asubilla/OpenApiMCP@main
  with:
    spec: ./openapi.json
    command: doctor
```

## Use as a library

```ts
import { parseSpec, buildServer, startGateway, rankTools, redact, summarizeJson } from "openapimcp";

const api = await parseSpec("https://example.com/openapi.json");
await startGateway({ port: 3000, host: "127.0.0.1", path: "/mcp", createServer: () => buildServer(api, { headers: {}, timeoutMs: 30000, maxBytes: 20000, retries: 2 }) });
```

## How it works

1. **Parse** — loads and `$ref`-dereferences the spec (OpenAPI 3.x or Swagger 2.0).
2. **Flatten** — each `path` + `method` becomes a tool; params, JSON body, tags, auth, annotations, and base URL are derived from the spec.
3. **Serve** — tools are registered on an MCP server over stdio or Streamable HTTP; calls run through the policy engine, rate limiter, circuit breaker, cache, telemetry and audit log.

## Roadmap

- [x] Auth presets, filtering, annotations, retries, caching, pagination, multi-spec, `generate`
- [x] HTTP gateway, policy engine, OpenTelemetry, Docker
- [x] Redaction, summarization, tool search, rate limit, circuit breaker, disk cache
- [x] Config file, `.env`, overlays, diff, TS client, smoke tests, Postman, completions, TUI, Helm, Action
- [ ] OAuth2 client-credentials flow (auto token fetch + refresh)
- [ ] `structuredContent` output schemas
- [ ] GraphQL / gRPC → MCP

## Contributing

```bash
npm install
npm test   # build + 225 unit tests + end-to-end MCP handshake
```

## License

[MIT](./LICENSE)
