---
name: openapimcp
description: Use openapimcp to turn any OpenAPI/Swagger spec into an MCP server, configure it across IDEs, call API operations from the terminal, and host a shared HTTP gateway. Use when the user wants to connect an API to an AI agent, expose API endpoints as MCP tools, set up MCP servers, or call API operations without writing code.
---

# openapimcp

`openapimcp` converts an OpenAPI 3.x / Swagger 2.0 spec into a working MCP server
with one command. It runs locally over stdio or as a shared Streamable HTTP gateway,
and can auto-configure itself into Claude Desktop, Cursor, OpenCode, Windsurf, VS Code,
Continue, and Zed on Windows, macOS, and Linux.

## When to use

- The user has an API with an OpenAPI/Swagger spec and wants an AI agent to call it.
- The user wants to expose API endpoints as MCP tools without writing code.
- The user wants to call an API operation from the terminal.
- The user wants to host a shared MCP gateway for a team.
- The user wants to auto-configure MCP clients.

## Install

```bash
npx @asubilla/openapimcp <spec>           # no install needed
npm install -g @asubilla/openapimcp       # or globally
```

Requires Node.js 20+.

## Quick commands

```bash
openapimcp list ./openapi.json                       # see tools (--json for machines)
openapimcp doctor ./openapi.json                     # validate spec, auth, connectivity
openapimcp call ./openapi.json findPetsByStatus --arg status=available   # call one tool (no AI)
openapimcp run ./openapi.json "find available pets" --arg status=available  # task match (no AI)
openapimcp ui ./openapi.json                         # browse tools
openapimcp batch ./openapi.json --file calls.json    # many tool calls at once (concurrent)
openapimcp history --file calls.jsonl                # replay/inspect recorded calls
openapimcp ./openapi.json                            # stdio MCP server
openapimcp ./openapi.json --http --port 3000         # HTTP gateway
openapimcp setup ./openapi.json                      # auto-configure all editors
openapimcp use ./openapi.json                        # save default spec
openapimcp presets                                   # curated APIs (petstore, pokeapi, github)
openapimcp list --preset github                      # use one directly
openapimcp bundle ./openapi.json --out bundled.json  # self-contained spec (external $refs inlined)
openapimcp pin ./openapi.json                        # sha256 of the spec (detect unexpected changes)
openapimcp compat ./openapi.json                     # which operations are fully/partially/unsupported
openapimcp serve ./openapi.json --resumable          # SSE event ids + Last-Event-ID replay
openapimcp serve ./openapi.json --user-rate-limit '{"defaultPerMinute":60,"perUser":{"vip":300}}'   # 429 over-limit
```

## Call APIs safely (agents please read)

```bash
# Preview the exact request WITHOUT sending (method, URL, masked headers, body)
openapimcp dry-run ./openapi.json addPet --args '{"name":"Rex"}'

# Add an Idempotency-Key to mutating calls (same key reused on retry)
openapimcp serve ./openapi.json --idempotency

# Cap how much the gateway may send: blocks when budget exhausted
openapimcp serve ./openapi.json --budget '{"maxCalls":100,"maxBytes":1000000}'

# Drop deprecated / sunset operations entirely
openapimcp list ./openapi.json --hide-deprecated
```

## Auto-configure editors

```bash
openapimcp setup ./openapi.json           # user-level clients
openapimcp setup ./openapi.json --project # project-level only
openapimcp setup ./openapi.json --dry-run # preview
```

Detects: OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed.

## Auth

Set credentials via environment variables named `OPENAPIMCP_<SCHEME>` (scheme
name from the spec's `securitySchemes`, uppercased). Supports bearer, basic,
apiKey (header/query/cookie), oauth2 (client-credentials auto-fetch), openIdConnect.

```bash
export OPENAPIMCP_APIKEYAUTH=sk_live_...
openapimcp doctor ./openapi.json
```

`{env:NAME}` substitution works anywhere: `-H "Authorization: Bearer {env:MY_TOKEN}"`.

AWS signed APIs: `--sigv4 us-east-1:execute-api` (with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).

## Policy (lock down a gateway)

```json
{ "allow": ["get*", "find*"], "deny": ["delete*"], "methods": ["GET", "POST"], "hosts": ["api.example.com", "*.trusted.com"] }
```

```bash
openapimcp ./openapi.json --http --read-only --policy ./policy.json
```

## Multi-tenant / per-user isolation

```json
{
  "tenants": {
    "acme": {
      "baseUrl": "https://api.acme.com",
      "headers": { "X-Tenant": "acme" },
      "users": { "bob": { "headers": { "Authorization": "Bearer bob-token" } } }
    }
  }
}
```

```bash
openapimcp serve ./openapi.json --tenants ./tenants.json --tenant acme --user-key bob
```

User credentials override tenant credentials.

## Keep responses small

```bash
openapimcp call ./openapi.json findPetsByStatus --fields "id,name,status" --max-bytes 4000
openapimcp ./openapi.json --summarize --redact --max-bytes 4000
# reshape awkward responses (pick/rename/drop)
openapimcp ./openapi.json --response-map '{"pick":["id","name"],"rename":{"id":"userId"}}'
```

## Corporate networks (outbound proxy / private CA)

```bash
npm install undici                       # optional dependency, needed for --ca/--proxy
openapimcp serve ./openapi.json --proxy http://proxy.corp:3128 --ca ./corp-root.pem
```

HTTPS is CONNECT-tunneled through the proxy; `--ca` trusts your corporate root CA.

## Combine several APIs

```bash
openapimcp ./stripe.json ./github.json
# -> stripe_createCharge, github_getRepo, ...
```

## Generate a standalone project

```bash
openapimcp generate ./openapi.json --out ./my-mcp --read-only
cd my-mcp && npm install && npm start
```

## Provider config snippets

Claude Desktop / Cursor (`mcpServers`):
```json
{ "mcpServers": { "demo": { "command": "npx", "args": ["-y", "@asubilla/openapimcp", "https://example.com/openapi.json"] } } }
```

OpenCode (`opencode.json`):
```json
{ "mcp": { "servers": { "demo": { "type": "local", "command": ["npx", "-y", "@asubilla/openapimcp", "https://example.com/openapi.json"] } } } }
```

Remote HTTP gateway:
```json
{ "mcpServers": { "demo": { "url": "http://127.0.0.1:3000/mcp" } } }
```

## Notes for agents

- Tool names are the operationId (sanitized). Use `openapimcp list <spec> --json` to discover them.
- Multi-spec tool names are namespaced: `<slug>_<operationId>`.
- `--tool-search` exposes only `search_tools` + `call_tool` for huge APIs (progressive disclosure).
- `openapimcp dry-run <spec> <tool>` previews the exact request without sending — safe for agents.
- `openapimcp compat <spec>` reports operations the tool builder can't fully support (rare, usually raw schemas).
- The HTTP gateway is stateless; `GET /` is a developer portal, `GET /healthz`, `GET /metrics` (Prometheus, includes `openapimcp_gateway_info`).
- Use `--resumable` on the HTTP gateway if clients need SSE replay across reconnects (Last-Event-ID).
- Tools whose 2xx response schema resolves cleanly carry `outputSchema` automatically; clients get typed JSON schemas when `--structured-content` is on.
- Per-user rate limits: `--user-rate-limit '{"defaultPerMinute":60,"perUser":{"vip":120}}'` — over-limit requests get HTTP 429 with `retry-after: 60`. Keyed by `x-user-key` header, then `x-api-key`, then authorization tail.
- Every tool call emits OpenTelemetry spans + metrics (no-op without a provider).

## Links

- Repo: https://github.com/asubilla/OpenApiMCP
- npm: https://www.npmjs.com/package/@asubilla/openapimcp
- Docker: `docker run ghcr.io/asubilla/openapimcp:latest`
- License: MIT
