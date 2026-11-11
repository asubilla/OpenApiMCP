# Demo recording script

Record a ~15 second terminal demo for the README, Hacker News, and X.
Target: show "spec → MCP server → agent calling it" in one take.

## Setup (before recording)

```powershell
# 1. Clean slate
cd D:\test\openapimcp
npm run build

# 2. Make sure the demo fixture resolves
node dist/cli.js list test/fixtures/demo-api.json

# 3. Reset default spec (optional)
node dist/cli.js use test/fixtures/demo-api.json
```

## Recording (asciinema or screen recorder)

Use [asciinema](https://asciinema.org/) (best for GitHub README) or any screen recorder.
Recommended terminal: Windows Terminal, 100x30, dark theme, font size 14.

### Take 1 — "One command" (5s)

```bash
$ npx @asubilla/openapimcp test/fixtures/demo-api.json --list
getPetById        GET /pet/{petId}
deletePet         DELETE /pet/{petId}
findPetsByStatus  GET /pet/findByStatus
getInventory      GET /store/inventory
addPet            POST /pet

5 tool(s) from "Demo API"
```

### Take 2 — "Auto-config" (5s)

```bash
$ openapimcp setup test/fixtures/demo-api.json --dry-run
✓ configured:
  - OpenCode: ~/.config/opencode/opencode.json
  - VS Code (global): .../Code/User/settings.json
• skipped (not detected): Claude Desktop, Cursor, Windsurf, Continue, Zed
```

### Take 3 — "Call from terminal" (5s)

```bash
$ openapimcp run test/fixtures/demo-api.json "find available pets" --arg status=available --fields "id,name"
openapimcp: matched "findPetsByStatus" (GET /pet/findByStatus)
GET https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available
HTTP 200 OK

[{ "id": 9, "name": "Lion 3" }, { "id": 12345, "name": "fluffy" }]
```

## Output

- Save as `docs/demo.gif` (or `docs/demo.cast` for asciinema).
- Reference in README: `![demo](docs/demo.gif)`.
- Upload to asciinema.org and link in the HN post.

## Tips

- Keep it under 15 seconds — attention span.
- Show the **before/after** of "manual MCP server code" vs "one command".
- Dark terminal, large font, no typos.
- End on a satisfying result (HTTP 200 + JSON).
