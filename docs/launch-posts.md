# Launch posts — ready to paste

## 1. Hacker News (Show HN)

**Title:**
```
Show HN: openapimcp – turn any OpenAPI spec into an MCP server in one command
```

**URL:** https://github.com/asubilla/OpenApiMCP

**Text:**
```
Hi HN,

I built openapimcp because every time I wanted an AI agent to talk to an API,
I ended up hand-writing an MCP server: define tools, wire params, handle auth,
pagination, and trim huge responses so they don't blow the context window.

  npx @asubilla/openapimcp https://petstore3.swagger.io/api/v3/openapi.json

One command exposes every endpoint as an MCP tool, with input schemas inferred
from the spec, auth resolved from securitySchemes, retries, caching, pagination,
a policy engine (allow/deny tools + outbound hosts), and response trimming
(--fields, --max-bytes, --summarize, --redact).

Some things I'm proud of:
- Zero code. No generated files to maintain — re-run and it's in sync with the spec.
- Auto-config: `openapimcp setup <spec>` detects and configures OpenCode, Claude
  Desktop, Cursor, Windsurf, VS Code, Continue and Zed on Windows/macOS/Linux.
- Progressive disclosure: --tool-search exposes only search_tools + call_tool for
  APIs with 1000+ endpoints, so you don't load 1000 tools into context.
- HTTP gateway mode (--http) for sharing one server across a team, with a built-in
  "Try it" developer portal, /healthz and Prometheus /metrics.
- generate emits a standalone, publishable MCP server project (offline).
- Works without AI: `openapimcp call <spec> <tool> --arg key=value`.

Written in TypeScript on the official MCP SDK. 400 unit tests + end-to-end MCP
handshake test + generated-project smoke test.

I know the obvious objection: "an LLM can write this in one prompt." That's true
for a one-off. But the value is persistence and reliability — no hallucinated
endpoints, no stale code when the spec changes, one setup shared by every session
and teammate. The README has a "Why not just ask an AI to write it?" section.

Repo: https://github.com/asubilla/OpenApiMCP
npm:  https://www.npmjs.com/package/@asubilla/openapimcp
```

---

## 2. Reddit — r/mcp

**Title:**
```
I built openapimcp — a zero-config OpenAPI → MCP converter (npx, 50+ modules)
```

**Body:**
```
Every time I wanted an agent to call an API, I hand-wrote an MCP server. So I built openapimcp.

    npx @asubilla/openapimcp <spec-url>

It reads the OpenAPI/Swagger spec and exposes every operation as an MCP tool.

Highlights:
- Zero code, nothing to maintain
- Auth from securitySchemes (bearer/basic/apiKey/oauth2)
- Retries, caching, pagination, rate limit, circuit breaker
- Policy engine (allow/deny tools, methods, outbound hosts)
- --fields / --summarize / --redact / --max-bytes to keep responses small
- --tool-search for huge APIs (progressive disclosure)
- HTTP gateway + developer portal + /healthz + /metrics
- `openapimcp setup <spec>` auto-configures OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed

Repo: https://github.com/asubilla/OpenApiMCP
npm: https://www.npmjs.com/package/@asubilla/openapimcp

Would love feedback on what's missing for production use.
```

---

## 3. Reddit — r/LocalLLaMA

**Title:**
```
openapimcp: give your local agent real API access with one command (OpenAPI → MCP)
```

**Body:**
```
If you run local models and want them to actually call APIs, openapimcp is a zero-config bridge:

    npx @asubilla/openapimcp ./openapi.json

It works fully offline (stdio), exposes every endpoint as a tool, and handles auth, retries, caching, pagination and response trimming so your context window doesn't explode.

- No cloud, no code, nothing to maintain
- --tool-search for APIs with 1000+ endpoints
- --read-only mode for safety
- HTTP gateway mode for a team

Repo: https://github.com/asubilla/OpenApiMCP
```

---

## 4. X (Twitter) thread

**Tweet 1:**
```
I got tired of hand-writing MCP servers for every API.

So I built openapimcp:

  npx @asubilla/openapimcp <spec-url>

One command turns any OpenAPI spec into an MCP server.

🧵 thread
```

**Tweet 2:**
```
Zero code. Nothing to maintain. It reads the spec and exposes every endpoint as a tool — input schemas, auth, params, pagination all handled.

No generated files to debug when the spec changes.
```

**Tweet 3:**
```
It also handles the boring stuff:
• retries + caching + rate limiting
• policy engine (allow/deny tools, methods, hosts)
• --fields / --summarize / --redact to keep responses small
• --tool-search for APIs with 1000+ endpoints
```

**Tweet 4:**
```
Plus:
• HTTP gateway with a built-in "Try it" portal, /healthz, /metrics
• `openapimcp setup <spec>` auto-configures OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed
• `generate` emits a standalone publishable MCP server
```

**Tweet 5:**
```
400 unit tests + an end-to-end MCP handshake test.

Repo: https://github.com/asubilla/OpenApiMCP
npm: https://www.npmjs.com/package/@asubilla/openapimcp

Feedback welcome.
```

---

## Posting tips
- HN: Tuesday–Thursday, 9–11am ET. Reply to every comment in the first 2 hours.
- Reddit: r/mcp, r/LocalLLaMA, r/programming, r/node.
- X: post the thread, pin it, reply to your own thread with the demo GIF.
- Always lead with the demo GIF.
