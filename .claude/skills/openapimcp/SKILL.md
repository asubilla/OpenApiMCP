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
npx @asubilla/openapimcp <spec>          # no install needed
npm install -g @asubilla/openapimcp      # or globally
```

Requires Node.js 20+.

## Quick commands

```bash
openapimcp list ./openapi.json                              # see tools
openapimcp doctor ./openapi.json                            # validate spec, auth, connectivity
openapimcp call ./openapi.json findPetsByStatus --arg status=available   # call a tool (no AI)
openapimcp run ./openapi.json "find available pets" --arg status=available  # task match (no AI)
openapimcp ui ./openapi.json                                # browse tools
openapimcp ./openapi.json                                   # stdio MCP server
openapimcp ./openapi.json --http --port 3000                # HTTP gateway
openapimcp setup ./openapi.json                             # auto-configure all editors
openapimcp use ./openapi.json                               # save default spec
```

## Auto-configure editors

```bash
openapimcp setup ./openapi.json          # user-level clients
openapimcp setup ./openapi.json --project # project-level only
openapimcp setup ./openapi.json --dry-run # preview
```

Detects: OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed.

## Auth

Set credentials via environment variables named `OPENAPIMCP_<SCHEME>` (scheme
name from the spec's `securitySchemes`, uppercased). Supports bearer, basic,
apiKey (header/query/cookie), oauth2, openIdConnect.

```bash
export OPENAPIMCP_APIKEYAUTH=sk_live_...
openapimcp doctor ./openapi.json
```

`{env:NAME}` substitution works anywhere: `-H "Authorization: Bearer {env:MY_TOKEN}"`.

## Policy (lock down a gateway)

```json
{ "allow": ["get*", "find*"], "deny": ["delete*"], "methods": ["GET", "POST"], "hosts": ["api.example.com", "*.trusted.com"] }
```

```bash
openapimcp ./openapi.json --http --read-only --policy ./policy.json
```

## Keep responses small

```bash
openapimcp call ./openapi.json findPetsByStatus --fields "id,name,status" --max-bytes 4000
openapimcp ./openapi.json --summarize --redact --max-bytes 4000
```

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
{ "mcpServers": { "demo": { "command": "npx", "args": ["-y", "openapimcp", "https://example.com/openapi.json"] } } }
```

OpenCode (`opencode.json`):
```json
{ "mcp": { "servers": { "demo": { "type": "local", "command": ["npx", "-y", "openapimcp", "https://example.com/openapi.json"] } } } }
```

Remote HTTP gateway:
```json
{ "mcpServers": { "demo": { "url": "http://127.0.0.1:3000/mcp" } } }
```

## Notes for agents

- Tool names are the operationId (sanitized). Use `openapimcp list <spec> --json` to discover them.
- Multi-spec tool names are namespaced: `<slug>_<operationId>`.
- `--tool-search` exposes only `search_tools` + `call_tool` for huge APIs (progressive disclosure).
- The HTTP gateway is stateless; `GET /` is a developer portal, `GET /healthz`, `GET /metrics` (Prometheus).
- Every tool call emits OpenTelemetry spans + metrics (no-op without a provider).

## Links

- Repo: https://github.com/asubilla/OpenApiMCP
- npm: https://www.npmjs.com/package/openapimcp
- Docker: `docker run ghcr.io/asubilla/openapimcp:latest`
- License: MIT
