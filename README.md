# openapimcp ⚡

**Turn any OpenAPI/Swagger spec into an MCP server — with one command.**

Point it at an API spec and instantly get an [MCP](https://modelcontextprotocol.io) server exposing every endpoint as a tool your AI agent can call. No boilerplate, no codegen step, no glue code to maintain.

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
| No auth, retries, caching, or pagination | All built in |

Ad-hoc is fine for a one-off. `openapimcp` is a **permanent capability**.

## Why

Every API already ships a machine-readable spec. Every coding agent speaks MCP. `openapimcp` is the missing bridge — it reads the spec and registers one MCP **tool per operation**, wiring up path/query params, JSON bodies, auth, annotations, retries, caching, and pagination automatically.

- 🔌 **Zero code** — runtime-generated tools, nothing to maintain
- 🔐 **Auto auth** — resolves `securitySchemes` from environment variables
- 🪶 **Context-friendly** — field allowlists and byte caps keep responses small
- 🧠 **Schema-aware** — input schemas inferred from the spec, plus tool annotations
- 🛡️ **Safe by default** — `--read-only` to expose only `GET`/`HEAD`/`OPTIONS`
- ♻️ **Resilient** — automatic retries with backoff, response caching, pagination
- 🧩 **Multi-spec** — combine several APIs into one server, namespaced
- 📦 **`generate`** — emit a standalone, offline project you can publish
- 🌍 **Any API** — Stripe, GitHub, your company's internal service

## Install

```bash
npx openapimcp <spec>          # no install needed
npm install -g openapimcp      # or globally
```

Requires **Node.js 20+**.

## Quickstart

```bash
# See what tools a spec would expose
openapimcp list ./openapi.json

# Validate the spec, auth, and connectivity
openapimcp doctor ./openapi.json

# Call a single tool from the terminal
openapimcp call ./openapi.json findPetsByStatus --args '{"status":"available"}'

# Run it as an MCP server (stdio)
openapimcp ./openapi.json
```

## Add it to your agent

### OpenCode (`opencode.json`)

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

### Claude Desktop / Cursor (`mcpServers`)

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

Tip: `openapimcp <spec> --print-config` generates this snippet for you.

## Commands

```
openapimcp [specs...] [options]      # same as `serve` (default command)
openapimcp serve [specs...]          # run the MCP server over stdio
openapimcp list [specs...]           # list tools (--json for machine output)
openapimcp doctor [specs...]         # validate specs, auth, and connectivity
openapimcp call [spec] <tool>        # call one tool from the terminal
openapimcp generate <specs...> -o .  # emit a standalone project
```

Most options apply to `serve` and `call`: `--base-url`, `-H/--header`, `--include`, `--exclude`, `--tag`, `--read-only`, `--fields`, `--max-bytes`, `--timeout`, `--retries`, `--cache-ttl`, `--paginate`, `--max-pages`, `--print-config`.

## Auth from `securitySchemes`

`openapimcp` reads the spec's security schemes and looks for credentials in environment variables named `OPENAPIMCP_<SCHEME>`:

| Scheme | Env var | Example |
| --- | --- | --- |
| `http` bearer | `OPENAPIMCP_<SCHEME>` (or `OPENAPIMCP_TOKEN`) | `Authorization: Bearer <value>` |
| `http` basic | `OPENAPIMCP_<SCHEME>_USERNAME` + `_PASSWORD` | base64-encoded |
| `apiKey` header | `OPENAPIMCP_<SCHEME>` | sent in the named header |
| `apiKey` query | `OPENAPIMCP_<SCHEME>` | appended to the query string |
| `apiKey` cookie | `OPENAPIMCP_<SCHEME>` | sent as a cookie |
| `oauth2` / `openIdConnect` | `OPENAPIMCP_<SCHEME>` (or `OPENAPIMCP_TOKEN`) | `Authorization: Bearer <value>` |

`{env:NAME}` is substituted anywhere you pass a value, e.g. `-H "Authorization: Bearer {env:MY_TOKEN}"`.

```bash
export OPENAPIMCP_APIKEYAUTH=sk_live_...
openapimcp doctor ./openapi.json   # shows which schemes are ready
```

## Keep responses small

Agents pay for every token. Trim what the API returns:

```bash
# keep only the fields you need (dotted paths + arrays supported)
openapimcp call ./openapi.json findPetsByStatus --fields "id,name,status"

# hard cap the response size
openapimcp ./openapi.json --max-bytes 4000
```

## Stay safe

```bash
# expose only read operations — no POST/PUT/PATCH/DELETE
openapimcp ./openapi.json --read-only

# narrow a huge spec
openapimcp ./openapi.json --tag pets --include "^get"
```

## Resilient by default

```bash
openapimcp ./openapi.json \
  --retries 3 \        # retry network errors and 429/5xx with backoff
  --cache-ttl 60 \     # cache GET/HEAD responses for 60s
  --paginate \         # follow `next` links and merge pages
  --max-pages 10
```

## Combine several APIs

Pass more than one spec and tool names are namespaced by API title:

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

The output contains `spec.json`, `src/index.ts`, `openapimcp.config.json`, a `Dockerfile`, and a README.

## Use as a library

```ts
import { parseSpec, buildServer, serveStdio } from "openapimcp";

const api = await parseSpec("https://example.com/openapi.json");
await serveStdio(() =>
  buildServer(api, { serverName: "example", version: "1.0.0", headers: {}, timeoutMs: 30000, maxBytes: 20000, retries: 2 })
);
```

## How it works

1. **Parse** — loads and `$ref`-dereferences the spec (OpenAPI 3.x or Swagger 2.0).
2. **Flatten** — each `path` + `method` becomes a tool. Parameters, JSON body, tags, auth, annotations, and base URL are derived from the spec.
3. **Serve** — tools are registered on an MCP server over stdio; calling a tool issues the matching HTTP request (with retries, caching, pagination) and returns a trimmed, pretty-printed response.

JSON Schema → Zod conversion is done in-house, so there are no heavyweight codegen dependencies.

## Roadmap

- [x] Auth presets, `--read-only`, response filtering, annotations
- [x] Retries, caching, pagination, multi-spec, `generate`
- [ ] OAuth2 client-credentials flow (auto token fetch + refresh)
- [ ] Remote transport (Streamable HTTP) for shared team gateways
- [ ] Docker image, OpenTelemetry, policy engine
- [ ] `structuredContent` output schemas

## Contributing

Issues and PRs welcome. Run the suite locally:

```bash
npm install
npm test   # build + unit tests + end-to-end MCP handshake
```

## License

[MIT](./LICENSE)
