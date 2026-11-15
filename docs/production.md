# Production deployment

## 1. Docker Compose

```yaml
services:
  openapimcp:
    image: ghcr.io/asubilla/openapimcp:latest
    ports: ["3000:3000"]
    command: ["/app/spec.json", "--http", "--host", "0.0.0.0", "--port", "3000", "--read-only", "--policy", "/app/policy.json"]
    volumes:
      - ./openapi.json:/app/spec.json:ro
      - ./policy.json:/app/policy.json:ro
    environment:
      OPENAPIMCP_TOKEN: ${API_TOKEN}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "dist/cli.js", "doctor", "/app/spec.json"]
      interval: 30s
      timeout: 5s
      retries: 3
```

## 2. Reverse proxy + TLS (nginx)

> **Outbound proxy as well?** If your corporate network requires an HTTP(S) proxy for outbound calls, add `--proxy http://proxy.corp:3128 --ca /path/to/corp-root.pem` to the `command:` above (needs `npm install undici`; HTTPS is CONNECT-tunneled). No code changes required.

```nginx
server {
  listen 443 ssl http2;
  server_name mcp.example.com;

  ssl_certificate     /etc/letsencrypt/live/mcp.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mcp.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;
  }
}
```

Terminate TLS at the proxy; keep openapimcp on loopback with `--host 127.0.0.1`.

## 3. Secrets management

Prefer file-mounted secrets over env vars:

```yaml
environment:
  OPENAPIMCP_APIKEYAUTH: /run/secrets/api_key
secrets:
  api_key:
    external: true
```

Or use `--secrets-provider file:/run/secrets/openapimcp.json` where the JSON maps `OPENAPIMCP_<SCHEME>` keys.

## 4. CI example (GitHub Actions)

```yaml
- name: openapimcp doctor
  uses: asubilla/OpenApiMCP@main
  with:
    spec: ./openapi.json
    command: doctor
    args: "--read-only --policy ./policy.json"
```

And for spec drift:

```yaml
- name: openapimcp diff
  uses: asubilla/OpenApiMCP@main
  with:
    spec: ${{ github.workspace }}/openapi.json
    command: diff
```

CI exits non-zero on breaking changes.

## 5. Gateway policy baseline

```json
{
  "allow": ["get*", "find*", "list*"],
  "deny": ["delete*"],
  "methods": ["GET"],
  "hosts": ["api.internal.example.com"]
}
```

## 6. Monitoring

- `/healthz` — liveness/readiness probe (200 JSON).
- `/metrics` — Prometheus counters (`openapimcp_tool_calls_total`, `openapimcp_tool_duration_ms`).
- `--audit ./audit.jsonl` — JSON-lines tool-call audit (who/what/when/status).
- `--log-json` — structured logs for log aggregation.

## 7. Useful one-liners

```bash
# Validate + compat report for a spec
openapimcp doctor ./openapi.json

# See which operations are fully/partially supported
openapimcp compat ./openapi.json

# Generate a standalone MCP server project
openapimcp generate ./openapi.json --out ./my-mcp --read-only
```
