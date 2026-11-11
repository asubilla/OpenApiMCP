# Show HN post draft

**Title (≤80 chars):**
> Show HN: openapimcp – turn any OpenAPI spec into an MCP server in one command

**URL:** https://github.com/asubilla/OpenApiMCP

**Text:**

```
Hi HN,

I built openapimcp because every time I wanted an AI agent to talk to an API,
I ended up hand-writing an MCP server: define tools, wire params, handle auth,
deal with pagination, trim huge responses so they don't blow the context window.

openapimcp does all of that from the spec:

  npx @asubilla/openapimcp https://petstore3.swagger.io/api/v3/openapi.json

That single command exposes every endpoint as an MCP tool, with input schemas
inferred from the spec, auth resolved from securitySchemes, retries, caching,
pagination, a policy engine (allow/deny tools + outbound hosts), and response
trimming (--fields, --max-bytes, --summarize, --redact).

A few things I'm proud of:

- Zero code. No generated files to maintain — re-run and it's in sync with the spec.
- Auto-config: `openapimcp setup <spec>` detects and configures OpenCode, Claude
  Desktop, Cursor, Windsurf, VS Code, Continue and Zed on Windows/macOS/Linux.
- Progressive disclosure: --tool-search exposes only search_tools + call_tool for
  APIs with 1000+ endpoints, so you don't load 1000 tools into context.
- HTTP gateway mode (--http) for sharing one server across a team, with a
  built-in "Try it" developer portal, /healthz and Prometheus /metrics.
- `generate` emits a standalone, publishable MCP server project (offline).
- Works without AI: `openapimcp call <spec> <tool> --arg key=value`.

It's written in TypeScript on the official MCP SDK. 232 unit tests + an
end-to-end MCP handshake test + a generated-project smoke test.

I know the obvious objection: "an LLM can write this in one prompt." That's true
for a one-off. But the value is persistence and reliability — no hallucinated
endpoints, no stale code when the spec changes, one setup shared by every session
and teammate. The README has a "Why not just ask an AI to write it?" section
addressing this head-on.

Repo: https://github.com/asubilla/OpenApiMCP
npm:  https://www.npmjs.com/package/@asubilla/openapimcp
Try:  npx @asubilla/openapimcp https://petstore3.swagger.io/api/v3/openapi.json

I'd love feedback on: which features would you actually use, and what's missing
for you to adopt this in production?
```

**Posting tips:**
- Post Tuesday–Thursday, 9–11am ET (peak HN).
- Reply to every comment in the first 2 hours.
- Have the demo GIF ready as the first comment.
- Don't ask for upvotes; ask for feedback.
- Follow up with a dev.to / Hashnode article the next day.