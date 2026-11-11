# Launch checklist

## Pre-launch
- [ ] Record demo GIF (see `docs/demo.md`) → save as `docs/demo.gif`
- [ ] Add `![demo](docs/demo.gif)` to README right under the title
- [ ] Verify `npx @asubilla/openapimcp --version` works on a clean machine
- [ ] Verify `npm view @asubilla/openapimcp` shows 1.3.0
- [ ] Verify Docker image pulled: `docker pull ghcr.io/asubilla/openapimcp:1.3.0`
- [ ] Create GitHub Release v1.3.0 with CHANGELOG excerpt
- [ ] Add topics on GitHub (already set: openapi, mcp, mcp-server, …)

## Day 1 — Hacker News
- [ ] Post "Show HN" (Tuesday–Thursday, 9–11am ET)
- [ ] Reply to every comment in first 2 hours
- [ ] Drop demo GIF as first comment

## Day 1 — Reddit
- [ ] r/mcp — "I built a zero-config OpenAPI → MCP converter"
- [ ] r/LocalLLaMA — focus on local/stdio, no cloud
- [ ] r/programming — broader angle
- [ ] r/node — Node.js tooling angle

## Day 2 — Content
- [ ] dev.to article: "I built openapimcp — turn any API into an MCP server in one command"
- [ ] Hashnode cross-post
- [ ] X (Twitter) thread with before/after code snippets

## Day 3 — Ecosystem
- [ ] PR to `punkpeye/awesome-mcp-servers` (add openapimcp)
- [ ] PR to `modelcontextprotocol/servers` (if accepted)
- [ ] Submit to MCP registries (mcp.so, glama.ai, smithery.ai)
- [ ] Post in Discord servers (MCP, OpenCode, Claude)

## Ongoing
- [ ] Reply to issues within 24h
- [ ] Ship v1.4.0 with top-requested feature
- [ ] Track stars/downloads weekly
- [ ] Collect testimonials for README

## Metrics to track
- GitHub stars (target: 100 in first week, 500 in first month)
- npm weekly downloads
- Docker pulls
- GitHub issues / PRs
- HN points / comments
