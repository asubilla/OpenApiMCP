# openapimcp ⚡

**Turn any OpenAPI/Swagger spec into an MCP server — with one command.**

Point it at an API spec and instantly get an [MCP](https://modelcontextprotocol.io) server exposing every endpoint as a tool your AI agent can call. Run it locally over stdio, or host it as a shared HTTP gateway. No boilerplate, no codegen step, no glue code to maintain.

```bash
npx openapimcp https://petstore3.swagger.io/api/v3/openapi.json
```

That's it. Your agent now has hands on that API.

---

## "Why not just ask an AI to write it?"

Fair question. An LLM *can* generate an MCP server, or just `curl` the API ad-hoc. Here is what you get from `openapimcp` instead:

| One-off prompt / ad-hoc curl | openapimcp |
| --- | --- |
| Code you must **maintain**; breaks when the spec changes | Nothing to maintain — re-run and it's in sync |
| LLMs **hallucinate** endpoints, params, and encodings | Built **deterministically** from the spec |
| Burns tokens **every session** re-figuring out the API | Configured once; available to every session, agent, and teammate |
| Chokes on **large specs** (1000+ endpoints) | Handles any size; filter with `--tag` / `--read-only` |
| Dumps a 2 MB JSON blob into your context | `--fields` trims responses; `--max-bytes` caps them |
| No auth, retries, caching, pagination, policy, or telemetry | All built in |

Ad-hoc is fine for a one-off. `openapimcp` is a **permanent capability**.

## Highlights

- 🔌 **Zero code** — runtime-generated tools, nothing to maintain
- 🔐 **Auto auth** — resolves `securitySchemes` from environment variables
- 🪶 **Context-friendly** — field allowlists and byte caps keep responses small
- ♻️ **Resilient** — retries with backoff, response caching, pagination
- 🧩 **Multi-spec** — combine several APIs into one server, namespaced
- 🌐 **HTTP gateway** — Streamable HTTP with Host/Origin guards for teams
- 🛡️ **Policy engine** — allow/deny tools by name, restrict methods and outbound hosts
- 📈 **OpenTelemetry** — spans and metrics on every tool call (opt-in)
- 📦 **`generate`** — emit a standalone, offline project
- 🐳 **Docker** — ship a gateway in one image

## Install

```bash
npx openapimcp <spec>          # no install needed
npm install -g openapimcp      # or globally
```

Requires **Node.js 20+**.

## Quickstart

```bash
openapimcp list ./openapi.json         # see the tools
openapimcp doctor ./openapi.json       # validate spec, auth, connectivity
openapimcp call ./openapi.json findPetsByStatus --args '{"status":"available"}'
openapimcp ./openapi.json              # run as a stdio MCP server
openapimcp ./openapi.json --http       # ...or as an HTTP gateway
```

## Provider setup

**OpenCode** (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "demo": {
        "type": "local",
        "command": ["npx", "-y", "openapimcp", "https://petstore3.swagger.io/api/v3/openapi.json"]
      }
    }
  }
}
```

**Claude Desktop / Cursor** (`mcpServers`):

```json
{
  "mcpServers": {
    "demo": {
      "command": "npx",
      "args": ["-y", "openapimcp", "https://petstore3.swagger.io/api/v3/openapi.json"]
    }
  }
}
```

**Remote HTTP gateway** (point any client at the URL):

```json
{
  "mcpServers": { "demo": { "url": "http://127.0.0.1:3000/mcp" } }
}
```

## Commands

```
openapimcp [specs...] [options]      # same as `serve` (default command)
openapimcp serve [specs...]          # stdio server, or --http gateway
openapimcp list [specs...]           # list tools (--json for machine output)
openapimcp doctor [specs...]         # validate specs, auth, and connectivity
openapimcp call [spec] <tool>        # call one tool from the terminal
openapimcp generate <specs...> -o .  # emit a standalone project
```

Options for `serve`/`call`: `--base-url`, `-H/--header`, `--include`, `--exclude`, `--tag`, `--read-only`, `--policy`, `--fields`, `--max-bytes`, `--timeout`, `--retries`, `--cache-ttl`, `--paginate`, `--max-pages`, `--print-config`.

Gateway options: `--http`, `--port`, `--host`, `--path`, `--allowed-host`, `--allowed-origin`.

## Auth from `securitySchemes`

`openapimcp` reads the spec's security schemes and looks for credentials in environment variables named `OPENAPIMCP_<SCHEME>`:

| Scheme | Env var | Example |
| --- | --- | --- |
| `http` bearer | `OPENAPIMCP_<SCHEME>` (or `OPENAPIMCP_TOKEN`) | `Authorization: Bearer <value>` |
| `http` basic | `OPENAPIMCP_<SCHEME>_USERNAME` + `_PASSWORD` | base64-encoded |
| `apiKey` header / query / cookie | `OPENAPIMCP_<SCHEME>` | sent in the named slot |
| `oauth2` / `openIdConnect` | `OPENAPIMCP_<SCHEME>` (or `OPENAPIMCP_TOKEN`) | `Authorization: Bearer <value>` |

`{env:NAME}` is substituted anywhere you pass a value, e.g. `-H "Authorization: Bearer {env:MY_TOKEN}"`.

## Keep responses small

```bash
openapimcp call ./openapi.json findPetsByStatus --fields "id,name,status"
openapimcp ./openapi.json --max-bytes 4000
```

## Policy engine

Lock a gateway down with a JSON policy:

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

- `allow` / `deny` — tool-name globs (`deny` wins)
- `methods` — HTTP method allowlist
- `hosts` — outbound host allowlist (SSRF guard); checked again at call time

## Remote HTTP gateway

Serve Streamable HTTP instead of stdio, so a team can share one server:

```bash
openapimcp ./openapi.json --http --port 3000 --path /mcp
# gateway listening on http://127.0.0.1:3000/mcp (5 tools)
```

The gateway is stateless and, when bound to localhost, validates the `Host` and
`Origin` headers. To expose it, bind `--host 0.0.0.0` and pass explicit
`--allowed-host` / `--allowed-origin` values.

## Docker

```bash
docker build -t openapimcp .
docker run -p 3000:3000 openapimcp \
  https://petstore3.swagger.io/api/v3/openapi.json \
  --http --host 0.0.0.0 --read-only
```

Or `docker compose up` (see `docker-compose.yml`).

## OpenTelemetry

Every tool call emits a span (`mcp.tool <name>`) plus `openapimcp.tool.calls`
and `openapimcp.tool.duration` metrics through `@opentelemetry/api`. It is a
no-op until you register a provider, so instrument freely:

```bash
npm i @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
NODE_OPTIONS="--import ./otel.mjs" openapimcp ./openapi.json --http
```

## Combine several APIs

```bash
openapimcp ./stripe.json ./github.json
# -> stripe_createCharge, github_getRepo, ...
```

## Generate a standalone project

Bundle the spec(s) into a publishable, offline MCP server:

```bash
openapimcp generate ./openapi.json --out ./my-mcp --read-only
cd my-mcp && npm install && npm start
```

Output includes `spec.json`, `src/index.ts`, `openapimcp.config.json`, a `Dockerfile`, and a README.

## Use as a library

```ts
import { parseSpec, buildServer, startGateway, serveStdio } from "openapimcp";

const api = await parseSpec("https://example.com/openapi.json");
const createServer = () =>
  buildServer(api, { serverName: "example", version: "1.0.0", headers: {}, timeoutMs: 30000, maxBytes: 20000, retries: 2 });

// local:
await serveStdio(createServer);
// or hosted:
await startGateway({ port: 3000, host: "127.0.0.1", path: "/mcp", createServer });
```

## How it works

1. **Parse** — loads and `$ref`-dereferences the spec (OpenAPI 3.x or Swagger 2.0).
2. **Flatten** — each `path` + `method` becomes a tool; params, JSON body, tags, auth, annotations, and base URL are derived from the spec.
3. **Serve** — tools are registered on an MCP server over stdio or Streamable HTTP; calls run through the policy engine and telemetry, with retries, caching, and pagination.

JSON Schema → Zod conversion is done in-house, so there are no heavyweight codegen dependencies.

## Roadmap

- [x] Auth presets, `--read-only`, response filtering, annotations
- [x] Retries, caching, pagination, multi-spec, `generate`
- [x] Remote HTTP gateway, policy engine, OpenTelemetry, Docker
- [ ] OAuth2 client-credentials flow (auto token fetch + refresh)
- [ ] `structuredContent` output schemas
- [ ] Published Docker image + Helm chart

## Contributing

```bash
npm install
npm test   # build + 39 unit tests + end-to-end MCP handshake
```

## License

[MIT](./LICENSE)
