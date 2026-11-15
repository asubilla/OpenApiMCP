#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadDocument, parseDocument } from "./openapi.js";
import { buildServer } from "./server.js";
import { callApi, type RequestOptions } from "./http.js";
import { substituteEnv } from "./auth.js";
import { generateProject } from "./generate.js";
import { startGateway } from "./gateway.js";
import { loadPolicy, toolAllowed, type Policy } from "./policy.js";
import { createLogger } from "./logger.js";
import { createAuditLog } from "./audit.js";
import { RateLimiter, CircuitBreaker } from "./ratelimit.js";
import { DiskCache } from "./cache.js";
import { diffSpecs } from "./diff.js";
import { applyOverlay } from "./overlay.js";
import { postmanToOperations } from "./postman.js";
import { generateClient } from "./clientgen.js";
import { generateSmokeTests } from "./testing.js";
import { formatToolDetail, formatToolList } from "./toolkit.js";
import { loadConfig, mergeConfig, type Config } from "./config.js";
import { applyDotenv } from "./env.js";
import { completionsFor } from "./completions.js";
import { analyzeSpecCompat, formatCompatReport } from "./compat.js";
import { runSetup } from "./setup.js";
import { Metrics } from "./metrics.js";
import { rankTools } from "./toolsearch.js";
import { discoverSpec } from "./discovery.js";
import { searchApisGuru, getSpecFromApisGuru, formatMarketplaceList } from "./marketplace.js";
import { lintSpec, formatLint } from "./lint.js";
import { OAuth2TokenProvider, parseOAuth2Config } from "./oauth.js";
import { authMiddleware, type GatewayAuthConfig } from "./gateway-auth.js";
import { evaluateToolSelection, formatEvalReport } from "./eval.js";
import { createMemory } from "./memory.js";
import { parseGraphQLSchema, graphqlToToolName, buildGraphQLQuery } from "./graphql.js";
import { buildDryRun, formatDryRun } from "./dry-run.js";
import { parseProfilesFile, resolveProfile, profileNames } from "./env-profiles.js";
import { validateConfig, formatConfigIssues } from "./config-validate.js";
import { formatPresetList, getPreset, presetNames } from "./presets.js";
import { bundleDocument, extractExternalRefs } from "./spec-bundle.js";
import { pinFromSpec, formatPin } from "./spec-pin.js";
import { isDeprecated } from "./deprecation.js";
import { parseTenantsFile, resolveTenant, tenantNames } from "./tenant.js";
import { checkGateway, formatProductionReport } from "./production-defaults.js";
import { parseBudget, BudgetTracker } from "./budget.js";
import { parseMapping } from "./response-map.js";
import { loadPlugin } from "./plugin-hooks.js";
import { createDispatcher, formatDispatcherPlan } from "./proxy-dispatcher.js";
import { runBatch, formatBatchResults, formatBatchSummary, type BatchResult } from "./batch.js";
import { createCallHistory, formatCallList } from "./call-history.js";
import { TamperAuditLog } from "./tamper-audit.js";
import { FeedbackStore } from "./feedback.js";
import { chainSecretProviders, envSecretProvider, fileSecretProvider, type SecretProvider } from "./secrets.js";
import { SemanticCache } from "./semantic-cache.js";
import { buildAgentCard, formatAgentCard } from "./a2a.js";
import { createWorkflowContext, resolveArgs, validateWorkflow, formatWorkflow, type Workflow } from "./workflow.js";
import { createFetchHandler } from "./serverless.js";
import type { ParsedApi, ToolDef } from "./types.js";

const VERSION = "1.12.0";
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

interface FilterOptions {
  include?: string;
  exclude?: string;
  tag?: string[];
  readOnly?: boolean;
  policy?: string;
}

const program = new Command();
program.name("openapimcp").description("Turn any OpenAPI/Swagger spec into an MCP server — one command.").version(VERSION);

const filterFlags = (cmd: Command) =>
  cmd
    .option("--include <regex>", "Only include tools whose name matches this regex")
    .option("--exclude <regex>", "Exclude tools whose name matches this regex")
    .option("--tag <tag...>", "Only include operations with these tags")
    .option("--read-only", "Expose only read operations (GET/HEAD/OPTIONS)")
    .option("--policy <file>", "JSON policy file (allow/deny tools, methods, outbound hosts)")
    .option("--hide-deprecated", "Drop operations marked as deprecated in the spec")
    .option("--tenants <file>", "Tenant/user config file (JSON)")
    .option("--tenant <name>", "Tenant name from the tenants file")
    .option("--user-key <key>", "User key for per-user credential isolation (requires --tenants)");

const httpFlags = (cmd: Command) =>
  cmd
    .option("--base-url <url>", "Override the API base URL")
    .option("-H, --header <header...>", 'Extra HTTP header, e.g. -H "Authorization: Bearer TOKEN"')
    .option("--fields <fields>", "Comma-separated response field allowlist (dotted paths ok)")
    .option("--max-bytes <n>", "Max response bytes returned to the model", "20000")
    .option("--timeout <ms>", "HTTP timeout in milliseconds", "30000")
    .option("--retries <n>", "Retries for network errors and 429/5xx", "2")
    .option("--cache-ttl <seconds>", "Cache GET/HEAD responses for N seconds", "0")
    .option("--paginate", "Follow pagination links and merge pages")
    .option("--max-pages <n>", "Maximum pages to follow when paginating", "5");

const runtimeFlags = (cmd: Command) =>
  cmd
    .option("--config <file>", "Config file (JSON) providing defaults; CLI flags override")
    .option("--dotenv <file>", "Load environment variables from a .env file")
    .option("--overlay <file>", "OpenAPI Overlay (JSON) applied to the spec before parsing")
    .option("--log-json", "Emit structured JSON logs to stderr")
    .option("--audit <file>", "Append a JSON-lines audit log of every tool call")
    .option("--redact", "Redact secrets/PII from responses")
    .option("--summarize", "Trim large responses (arrays/depth/strings)")
    .option("--cache-dir <dir>", "Persistent on-disk response cache directory")
    .option("--rate-limit <n>", "Max upstream requests per second (client-side)")
    .option("--breaker", "Enable an upstream circuit breaker")
    .option("--tool-search", "Expose search_tools + call_tool instead of every operation")
    .option("--arg <kv...>", "Arguments as key=value (repeatable), e.g. --arg status=available")
    .option("--watch", "Watch the spec file and exit on change (for use with a process manager)")
    .option("--mock", "Return mock responses from the spec (offline dev)")
    .option("--sanitize", "Wrap responses in untrusted-content markers")
    .option("--context-budget <tokens>", "Auto-trim responses to fit a token budget")
    .option("--tamper-audit <file>", "Append a tamper-evident (hash-chained) audit log")
    .option("--webhook-url <url>", "POST a webhook on every tool call")
    .option("--webhook-events <events...>", "Webhook events to trigger (default: tool.call)")
    .option("--structured-content", "Return parsed JSON in structuredContent for typed client consumption")
    .option("--async", "Poll 202 Accepted responses until the job completes (default on for 202)")
    .option("--async-poll-interval <ms>", "Polling interval in ms for async jobs", "1000")
    .option("--async-max-wait <ms>", "Maximum wait time in ms for async jobs", "60000")
    .option("--profile <name>", "Named profile from the profiles file")
    .option("--profiles <file>", "Profiles file (JSON) for baseUrl/headers/policy/readOnly per environment")
    .option("--secrets-provider <spec>", "Secrets source: env | file:<path>")
    .option("--feedback-file <file>", "Record tool usage feedback")
    .option("--gateway-key <key>", "Require X-API-Key header on the HTTP gateway")
    .option("--gateway-jwt-secret <secret>", "Require a signed JWT (HS256) on the HTTP gateway")
    .option("--gateway-jwt-issuer <iss>", "Expected JWT issuer")
    .option("--gateway-jwt-audience <aud>", "Expected JWT audience")
    .option("--idempotency", "Add an Idempotency-Key header to unsafe methods (POST/PUT/PATCH/DELETE)")
    .option("--sigv4 <region:service>", "Sign requests with AWS SigV4 (creds from AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)")
    .option("--plugin <path...>", "Load plugin hooks from a module (beforeRequest/afterResponse)")
    .option("--budget <json>", "Usage budget: {\"maxCalls\": N, \"maxBytes\": N}")
    .option("--response-map <json>", "Normalize JSON responses: {\"pick\": [...], \"rename\": {...}, \"drop\": [...]}")
    .option("--ca <file>", "Trust a CA bundle for upstream HTTPS (e.g. corporate proxy root)")
    .option("--proxy <url>", "Route upstream requests via a proxy (CONNECT for HTTPS targets)")
    .option("--history <file>", "Append tool calls to a JSON-lines history file (replay with `openapimcp history`)")
    .option("--resources", "Expose the spec/operations/servers/security as MCP resources")
    .option("--cost-log <file>", "Append a JSON-lines cost log of every tool call")
    .option("--cost-model <model>", "Model used for cost estimation", "gpt-4o-mini")
    .option("--oauth2-token-url <url>", "OAuth2 token endpoint (client-credentials)")
    .option("--oauth2-client-id <id>", "OAuth2 client id")
    .option("--oauth2-client-secret <secret>", "OAuth2 client secret")
    .option("--oauth2-scope <scope>", "OAuth2 scope");

runtimeFlags(
  httpFlags(filterFlags(program.command("serve")))
    .description("Run an MCP server for one or more specs (the default command)")
    .argument("[specs...]", "Paths or URLs to OpenAPI/Swagger documents")
    .option("--name <name>", "MCP server name (default: slug of the spec title)")
    .option("--print-config", "Print an MCP client config snippet, then exit")
    .option("--http", "Serve over Streamable HTTP instead of stdio")
    .option("--port <n>", "HTTP port", "3000")
    .option("--host <addr>", "HTTP bind address", "127.0.0.1")
    .option("--preset <name>", "Use a curated API preset instead of passing a spec URL")
    .option("--path <path>", "HTTP endpoint path", "/mcp")
    .option("--allowed-host <host...>", "Allowed Host headers for the HTTP gateway")
    .option("--allowed-origin <origin...>", "Allowed Origin headers for the HTTP gateway")
).action(serveAction);

runtimeFlags(filterFlags(program.command("list")))
  .description("List the tools the specs would expose")
  .argument("[specs...]", "Paths or URLs to OpenAPI/Swagger documents")
  .option("--json", "Print JSON")
  .option("--preset <name>", "Use a curated API preset instead of passing a spec URL")
  .action(listAction);

program
  .command("doctor")
  .description("Validate specs, show tool counts, and check auth + connectivity")
  .argument("[specs...]", "Paths or URLs to OpenAPI/Swagger documents")
  .option("--base-url <url>", "Override the API base URL")
  .option("-H, --header <header...>", "Extra HTTP header for the connectivity check")
  .option("--overlay <file>", "OpenAPI Overlay (JSON) applied before parsing")
  .option("--timeout <ms>", "HTTP timeout in milliseconds", "10000")
  .option("--preset <name>", "Use a curated API preset instead of passing a spec URL")
  .action(doctorAction);

runtimeFlags(
  httpFlags(
    filterFlags(program.command("call"))
      .description("Call a single tool from the terminal (no AI needed)")
      .argument("[args...]", "Optional spec followed by the tool name")
  )
).option("--args <json>", "Tool arguments as JSON", "{}").action(callAction);

runtimeFlags(httpFlags(filterFlags(program.command("generate"))))
  .description("Generate a standalone, offline MCP server project")
  .argument("[specs...]", "Paths or URLs to OpenAPI/Swagger documents")
  .option("--out <dir>", "Output directory", "./generated")
  .option("--name <name>", "Project name (default: slug of the spec title)")
  .action(generateAction);

program
  .command("diff")
  .description("Compare two specs and report breaking / non-breaking changes")
  .argument("<old>", "Old spec")
  .argument("<new>", "New spec")
  .action(diffAction);

program
  .command("postman")
  .description("List operations found in a Postman collection")
  .argument("<collection>", "Postman collection JSON file")
  .option("--json", "Print JSON")
  .action(postmanAction);

program
  .command("client")
  .description("Generate a typed TypeScript client from a spec")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--out <dir>", "Output directory", "./client")
  .option("--name <name>", "Client name")
  .action(clientAction);

program
  .command("smoke")
  .description("Generate a node:test smoke-test file for a spec")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--out <file>", "Write to a file instead of stdout")
  .option("--overlay <file>", "OpenAPI Overlay (JSON) applied before parsing")
  .action(smokeAction);

program
  .command("ui")
  .description("Browse a spec's tools in the terminal")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--tool <name>", "Show full details for one tool")
  .option("--overlay <file>", "OpenAPI Overlay (JSON) applied before parsing")
  .action(uiAction);

program
  .command("init")
  .description("Write an MCP client config entry for a spec")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--target <t>", "opencode | claude | cursor", "opencode")
  .option("--global", "Write to the global config location")
  .option("--name <name>", "Server name", "demo")
  .action(initAction);

program
  .command("use")
  .description("Save a default spec so you can omit it from other commands")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--local", "Save in the current directory instead of globally")
  .action((spec: string, options: { local?: boolean }) => {
    saveDefaultSpec(spec, !options.local);
    process.stdout.write(`✓ default spec set to ${spec}\n`);
  });

program
  .command("setup")
  .description("Auto-configure every detected MCP client (OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed)")
  .argument("[spec]", "Spec to register (or use the saved default spec)")
  .option("--name <name>", "Server name", "openapimcp")
  .option("--target <ids...>", "Only configure these clients (e.g. opencode claude cursor)")
  .option("--global", "Configure global (user-level) clients")
  .option("--project", "Also configure project-level clients")
  .option("--dry-run", "Show what would be done without writing")
  .option("--quiet", "Minimal output")
  .option("--postinstall", "Run in postinstall mode (gated by OPENAPIMCP_AUTO_SETUP=1)")
  .action(setupAction);

program
  .command("run")
  .description("Run a task against a spec by matching tool names (no AI needed)")
  .argument("[args...]", "Optional spec followed by a task description")
  .option("--spec <spec>", "Spec to use (overrides positional)")
  .option("--arg <kv...>", "Arguments as key=value (repeatable)")
  .option("--args <json>", "Tool arguments as JSON", "{}")
  .option("--fields <fields>", "Comma-separated response field allowlist")
  .option("--max-bytes <n>", "Max response bytes", "20000")
  .option("--timeout <ms>", "HTTP timeout in milliseconds", "30000")
  .option("--base-url <url>", "Override the API base URL")
  .option("-H, --header <header...>", "Extra HTTP header")
  .option("--mock", "Return mock responses from the spec (offline; no network)")
  .action(runAction);

program
  .command("discover")
  .description("Auto-discover an OpenAPI spec from a domain")
  .argument("<input>", "Domain or URL (e.g. example.com or https://api.example.com)")
  .option("--json", "Print the spec as JSON")
  .action(async (input: string, options: { json?: boolean }) => {
    const found = await discoverSpec(input);
    if (!found) fatal(`no OpenAPI spec found for "${input}"`);
    process.stderr.write(`✓ found spec at ${found.url}\n`);
    if (options.json) process.stdout.write(JSON.stringify(found.spec, null, 2) + "\n");
    else process.stdout.write(found.url + "\n");
  });

program
  .command("lint")
  .description("Lint an OpenAPI spec for quality issues")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--overlay <file>", "OpenAPI Overlay (JSON) applied before parsing")
  .action(async (spec: string, options: { overlay?: string }) => {
    const base = await loadDocument(spec);
    const doc = options.overlay ? applyOverlay(base, readJson(options.overlay)) : base;
    const result = lintSpec(doc);
    process.stdout.write(formatLint(result) + "\n");
    process.exitCode = result.summary.errors > 0 ? 1 : 0;
  });

program
  .command("marketplace")
  .description("Browse public APIs on APIs.guru")
  .argument("[query]", "Search query (optional)")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Print JSON")
  .option("--import <name>", "Print the spec URL for a named API")
  .action(async (query: string | undefined, options: { limit?: string; json?: boolean; import?: string }) => {
    if (options.import) {
      const found = await getSpecFromApisGuru(options.import);
      if (!found) fatal(`API "${options.import}" not found on APIs.guru`);
      process.stdout.write(found.url + "\n");
      return;
    }
    const apis = await searchApisGuru(query ?? "", Number(options.limit) || 20);
    if (options.json) process.stdout.write(JSON.stringify(apis, null, 2) + "\n");
    else process.stdout.write(formatMarketplaceList(apis) + "\n");
  });

program
  .command("eval")
  .description("Evaluate tool selection accuracy against test cases")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .argument("<cases>", "JSON file with [{query, expectedTool}]")
  .option("--overlay <file>", "OpenAPI Overlay (JSON) applied before parsing")
  .action(async (spec: string, cases: string, options: { overlay?: string }) => {
    const api = await loadSpec(spec, options.overlay);
    let testCases: { query: string; expectedTool: string }[];
    try {
      testCases = JSON.parse(readFileSync(cases, "utf8"));
    } catch (err) {
      fatal(`could not read cases "${cases}": ${err instanceof Error ? err.message : String(err)}`);
    }
    const report = evaluateToolSelection(api.tools, testCases);
    process.stdout.write(formatEvalReport(report) + "\n");
    process.exitCode = report.accuracy < 1 ? 1 : 0;
  });

program
  .command("memory")
  .description("Browse or search agent memory")
  .argument("<file>", "Memory file path")
  .option("--search <query>", "Search query")
  .option("--add <kv...>", "Add entries as key=value (repeatable)")
  .option("--clear", "Clear all memory")
  .action((file: string, options: { search?: string; add?: string[]; clear?: boolean }) => {
    const mem = createMemory(file);
    if (options.clear) { mem.clear(); process.stdout.write("✓ memory cleared\n"); return; }
    if (options.add?.length) {
      for (const kv of options.add) {
        const idx = kv.indexOf("=");
        if (idx === -1) { fatal(`--add "${kv}" must be key=value`); }
        const key = kv.slice(0, idx).trim();
        const value = kv.slice(idx + 1);
        const id = mem.add(key, value);
        process.stdout.write(`✓ added ${key} (${id})\n`);
      }
      return;
    }
    if (options.search) {
      const results = mem.search(options.search);
      process.stdout.write(JSON.stringify(results, null, 2) + "\n");
      return;
    }
    process.stdout.write(JSON.stringify(mem.list(), null, 2) + "\n");
  });

program
  .command("graphql")
  .description("Convert a GraphQL SDL file to MCP tool definitions (preview)")
  .argument("<sdl>", "Path to a GraphQL SDL file")
  .option("--json", "Print JSON")
  .action((sdl: string, options: { json?: boolean }) => {
    const ops = parseGraphQLSchema(readFileSync(sdl, "utf8"));
    if (options.json) {
      process.stdout.write(JSON.stringify(ops, null, 2) + "\n");
      return;
    }
    for (const op of ops) process.stdout.write(`${graphqlToToolName(op)}\t${op.type} ${op.name}\n`);
    process.stderr.write(`\n${ops.length} operation(s)\n`);
  });

program
  .command("workflow")
  .description("Run a multi-step workflow from a JSON file")
  .argument("<file>", "Workflow JSON file")
  .option("--spec <spec>", "Spec to resolve tool names against (for validation)")
  .action(async (file: string, options: { spec?: string }) => {
    let wf: any;
    try { wf = JSON.parse(readFileSync(file, "utf8")); } catch (err) { fatal(`could not read workflow "${file}": ${err instanceof Error ? err.message : String(err)}`); }
    const validation = validateWorkflow(wf);
    if (!validation.valid) { process.stderr.write("Invalid workflow:\n"); for (const e of validation.errors) process.stderr.write(`  - ${e}\n`); process.exitCode = 1; return; }
    process.stdout.write(formatWorkflow(wf) + "\n");
    if (options.spec) {
      const api = await loadSpec(options.spec);
      process.stdout.write(`\nResolved against ${api.tools.length} tools from "${api.title}"\n`);
    }
  });

program
  .command("a2a")
  .description("Generate an A2A agent card from a spec")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--name <name>", "Agent name")
  .option("--url <url>", "Agent URL", "http://localhost:3000")
  .option("--out <file>", "Write to a file instead of stdout")
  .action(async (spec: string, options: { name?: string; url?: string; out?: string }) => {
    const api = await loadSpec(spec);
    const card = buildAgentCard({ name: options.name ?? api.title, description: `${api.title} MCP agent`, url: options.url ?? "http://localhost:3000", version: api.version, skills: api.tools.map((t) => ({ id: t.name, name: t.name, description: t.description, tags: t.tags })) });
    const text = formatAgentCard(card);
    if (options.out) { mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true }); writeFileSync(options.out, text + "\n"); process.stdout.write(`✓ wrote ${options.out}\n`); }
    else process.stdout.write(text + "\n");
  });

program
  .command("compat")
  .description("Report which operations are fully/partially/unsupported by openapimcp")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--overlay <file>", "OpenAPI Overlay (JSON) applied before parsing")
  .option("--json", "Print JSON instead of text")
  .action(async (spec: string, options: { overlay?: string; json?: boolean }) => {
    const base = await loadDocument(spec);
    const doc = options.overlay ? applyOverlay(base, readJson(options.overlay)) : base;
    const report = analyzeSpecCompat(doc);
    if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    else process.stdout.write(formatCompatReport(report) + "\n");
  });

program
  .command("dry-run")
  .description("Show the exact request that would be sent (URL, headers, body) without sending it")
  .argument("[args...]", "Optional spec followed by the tool name")
  .option("--arg <kv...>", "Arguments as key=value (repeatable)")
  .option("--base-url <url>", "Override the API base URL")
  .option("-H, --header <header...>", "Extra HTTP header")
  .action(dryRunAction);

program
  .command("config")
  .description("Validate an openapimcp config file (JSON)")
  .argument("<file>", "Path to the config JSON file")
  .action((file: string) => {
    let cfg: any;
    try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch (err) { fatal(`invalid JSON in "${file}": ${err instanceof Error ? err.message : String(err)}`); }
    const { valid, issues } = validateConfig(cfg);
    process.stdout.write(formatConfigIssues(issues) + "\n");
    process.exitCode = valid ? 0 : 1;
  });

runtimeFlags(httpFlags(filterFlags(program.command("batch"))))
  .description("Call multiple tools in one shot (JSON file: [{tool, args}])")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .requiredOption("--file <calls.json>", "JSON array of {tool, args}")
  .option("--concurrency <n>", "Max concurrent calls", "5")
  .option("--batch-timeout <ms>", "Per-call timeout in milliseconds", "10000")
  .option("--json", "Print raw JSON results")
  .action(async (spec: string, rawOptions: any, command: Command) => {
    const options = withConfig(command, rawOptions);
    const raw = parseJsonFlag(options.file, "--file");
    if (!Array.isArray(raw)) fatal("--file must be a JSON array of {tool, args}");
    const calls = raw.map((entry, i) => {
      if (!entry || typeof entry.tool !== "string") fatal(`calls[${i}].tool must be a string`);
      return { tool: entry.tool as string, args: (entry.args && typeof entry.args === "object" ? entry.args : {}) as Record<string, unknown> };
    });
    const policy = loadPolicyOption(options.policy);
    const api = await loadSpec(spec!, options.overlay);
    applyTenantOptions(options);
    await maybeHideDeprecated(api, [spec!], options);
    await applyPluginInstances(options);
    await applyProxy(options);
    const opts = requestOptions(api, options, policy);
    const results = await runBatch(calls, { concurrency: Number(options.concurrency) || 5, timeoutMs: Number(options.batchTimeout) || 10000 }, async (toolName, args): Promise<BatchResult> => {
      const tool = api.tools.find((t) => t.name === toolName);
      if (!tool) return { tool: toolName, ok: false, error: `tool "${toolName}" not found` };
      try {
        const res = await callApi(tool!, args as Record<string, any>, opts);
        return { tool: toolName, ok: !res.isError, status: res.isError ? undefined : 200, body: res.data, error: res.isError ? res.text.split("\n")[0] : undefined };
      } catch (err) {
        return { tool: toolName, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
    if (options.json) {
      process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    } else {
      process.stdout.write(formatBatchResults(results) + "\n");
      const s = formatBatchSummary(results);
      process.stderr.write(`${s.ok} ok, ${s.failed} failed, ${s.total} total\n`);
    }
    process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
  });

program
  .command("history")
  .description("Show (or replay hints for) tool calls recorded via --history <file>")
  .option("--file <file>", "History JSON-lines file", "./openapimcp-history.jsonl")
  .option("--limit <n>", "Max entries to show", "20")
  .option("--clear", "Delete the history file")
  .option("--json", "Print raw JSON")
  .action((options: any) => {
    const history = createCallHistory(options.file);
    if (options.clear) {
      history.clear();
      process.stdout.write(`✓ cleared ${options.file}\n`);
      return;
    }
    const entries = history.list(Number(options.limit) || 20);
    if (options.json) {
      process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
      return;
    }
    process.stdout.write((entries.length ? formatCallList(entries) : "No calls recorded yet. Use --history <file> when calling.") + "\n");
  });

program
  .command("bundle")
  .description("Resolve external $refs and emit a self-contained spec")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .option("--out <file>", "Write bundled spec to a file (default: stdout)")
  .option("--timeout <ms>", "Fetch timeout in milliseconds", "10000")
  .action(async (spec: string, options: { out?: string; timeout: string }) => {
    const doc = await loadDocument(spec);
    const bundled = await bundleDocument(doc, async (url) => (await fetch(url)).json(), { timeoutMs: Number(options.timeout) || 10000 });
    const text = JSON.stringify(bundled, null, 2) + "\n";
    if (options.out) {
      mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
      writeFileSync(options.out, text);
      process.stdout.write(`✓ wrote ${options.out}\n`);
    } else {
      process.stdout.write(text);
    }
  });

program
  .command("pin")
  .description("Record the hash of a spec (to detect unexpected spec changes)")
  .argument("<spec>", "Path or URL to an OpenAPI/Swagger document")
  .action(async (spec: string) => {
    const pin = pinFromSpec(spec, await loadDocument(spec));
    process.stdout.write(formatPin(pin) + "\n");
  });

program
  .command("presets")
  .description("List curated API presets (petstore, pokeapi, github)")
  .action(() => { process.stdout.write(formatPresetList() + "\n"); });

program
  .command("completions")
  .description("Print a shell completion script")
  .argument("[shell]", "bash | zsh | fish | powershell")
  .action((shell?: string) => {
    const chosen = shell ?? (process.platform === "win32" ? "powershell" : process.platform === "darwin" ? "zsh" : "bash");
    if (!["bash", "zsh", "fish", "powershell"].includes(chosen)) fatal(`unknown shell "${chosen}"`);
    process.stdout.write(completionsFor(chosen as "bash") + "\n");
  });

function resolvePreset(specs: string[] | undefined, options: any): { specs: string[]; readOnly?: boolean } {
  if (specs && specs.length) return { specs };
  if (options?.preset) {
    const p = getPreset(options.preset);
    if (!p) fatal(`unknown preset "${options.preset}". Available: ${presetNames().join(", ")}`);
    return { specs: [p.specUrl], readOnly: p.readOnly };
  }
  return { specs: resolveSpecs(undefined) };
}

async function serveAction(specs: string[], rawOptions: any, command: Command): Promise<void> {
  const presetResolved = resolvePreset(specs, rawOptions);
  specs = presetResolved.specs;
  const options = withConfig(command, rawOptions);
  if (presetResolved.readOnly) options.readOnly = true;
  const log = createLogger({ json: Boolean(options.logJson) });
  const api = await loadApis(specs, options.overlay);
  if (options.mock) {
    try { options.mockSpec = options.overlay ? applyOverlay(await loadDocument(specs[0]), readJson(options.overlay)) : await loadDocument(specs[0]); } catch { /* ignore */ }
  }
  if (options.profile) {
    if (!options.profiles) fatal("--profile requires --profiles <file>");
    let profiles: Record<string, any>;
    try {
      profiles = parseProfilesFile(JSON.parse(readFileSync(options.profiles, "utf8")));
    } catch (err) {
      fatal(`could not load profiles: ${err instanceof Error ? err.message : String(err)}`);
    }
    const resolved = resolveProfile(profiles, options.profile);
    if (!resolved) fatal(`profile "${options.profile}" not found. Available: ${profileNames(profiles).join(", ")}`);
    if (resolved.baseUrl && !options.baseUrl) options.baseUrl = resolved.baseUrl;
    if (resolved.headers) {
      const merged = { ...resolved.headers };
      for (const [k, v] of Object.entries(merged)) {
        if (v.startsWith("env:")) merged[k] = process.env[v.slice(4)] ?? "";
      }
      options.header = [...(options.header ?? []), ...Object.entries(merged).map(([k, v]) => `${k}: ${v}`)];
    }
    if (resolved.readOnly) options.readOnly = true;
    if (resolved.policy && !options.policy) options.policy = resolved.policy;
  }
  applyTenantOptions(options);
  await maybeHideDeprecated(api, specs, options);
  const policy = loadPolicyOption(options.policy);
  const tools = applyFilters(api.tools, options, policy);
  if (tools.length === 0) fatal("no tools matched. Check the spec and your filters.");

  const metrics = options.http ? new Metrics() : undefined;
  if (metrics) {
    metrics.counter("openapimcp_gateway_info", { version: VERSION });
    options.metrics = metrics;
  }

  const gatewayAuth: GatewayAuthConfig | undefined =
    options.gatewayKey || options.gatewayJwtSecret
      ? { apiKey: options.gatewayKey, jwtSecret: options.gatewayJwtSecret, jwtIssuer: options.gatewayJwtIssuer, jwtAudience: options.gatewayJwtAudience }
      : undefined;

  let oauthProvider: OAuth2TokenProvider | undefined;
  if (options.oauth2TokenUrl && options.oauth2ClientId && options.oauth2ClientSecret) {
    oauthProvider = new OAuth2TokenProvider({ tokenUrl: options.oauth2TokenUrl, clientId: options.oauth2ClientId, clientSecret: options.oauth2ClientSecret, scope: options.oauth2Scope });
  } else {
    for (const scheme of Object.values(api.securitySchemes ?? {})) {
      const cfg = parseOAuth2Config(scheme);
      if (cfg) { oauthProvider = new OAuth2TokenProvider(cfg); break; }
    }
  }
  options.oauthProvider = oauthProvider;

  if (options.tamperAudit) options.tamperAuditLog = new TamperAuditLog(options.tamperAudit === true ? "./tamper-audit.jsonl" : options.tamperAudit);
  if (options.feedbackFile) options.feedbackStore = new FeedbackStore(options.feedbackFile);
  if (options.secretsProvider) {
    const spec = options.secretsProvider;
    if (spec === "env") options.secretsProviderInstance = envSecretProvider();
    else if (spec.startsWith("file:")) options.secretsProviderInstance = fileSecretProvider(spec.slice(5));
    else options.secretsProviderInstance = envSecretProvider(spec);
  }
  if (options.semanticCache) options.semanticCacheInstance = new SemanticCache();
  if (options.webhookUrl) { options.webhookEvents = options.webhookEvents?.length ? options.webhookEvents : ["tool.call"]; }

  await applyPluginInstances(options);
  await applyProxy(options);
  if (options.dispatcher) log.info(formatDispatcherPlan({ ca: options.ca, proxy: options.proxy }));

  const requestOpts = requestOptions(api, options, policy);
  const serverName = options.name ?? slug(api.title);
  const baseUrl = options.baseUrl ?? api.baseUrls[0] ?? "";

  if (options.printConfig) {
    const args = ["-y", "@asubilla/openapimcp", ...specs];
    if (options.baseUrl) args.push("--base-url", options.baseUrl);
    for (const header of options.header ?? []) args.push("-H", header);
    if (options.readOnly) args.push("--read-only");
    if (options.fields) args.push("--fields", options.fields);
    process.stdout.write(JSON.stringify({ mcpServers: { [serverName]: { command: "npx", args } } }, null, 2) + "\n");
    return;
  }

  if (options.watch) {
    const watchable = specs.filter((s) => existsSync(s));
    if (watchable.length === 0) log.warn("no local spec files to watch");
    for (const specPath of watchable) {
      const { watch } = await import("node:fs");
      watch(specPath, { persistent: true }, () => {
        log.info("spec changed, exiting for reload", { spec: specPath });
        process.exit(0);
      });
    }
  }

  const createServer = () =>
    buildServer({ ...api, tools }, { serverName, version: VERSION, toolSearch: Boolean(options.toolSearch), structuredContent: Boolean(options.structuredContent), mcpResources: Boolean(options.resources), ...requestOpts });

  if (options.http) {
    const report = checkGateway({ host: options.host ?? "127.0.0.1", port: Number(options.port) || 3000, http: true, readOnly: options.readOnly, policy: options.policy, auth: gatewayAuth, allowedHosts: options.allowedHost });
    for (const check of report.checks) {
      if (check.severity === "info") continue;
      const message = `production: ${check.message}${check.fix ? ` (fix: ${check.fix})` : ""}`;
      if (check.severity === "error") log.error(message, { id: check.id });
      else log.warn(message, { id: check.id });
    }
    await startGateway({
      port: Number(options.port) || 3000,
      host: options.host ?? "127.0.0.1",
      path: options.path ?? "/mcp",
      allowedHosts: options.allowedHost,
      allowedOrigins: options.allowedOrigin,
      serverName,
      auth: gatewayAuth,
      createServer,
      metrics,
      onListening: (url) => log.info("gateway listening", { url, tools: tools.length })
    });
    return;
  }

  log.info("serving", { tools: tools.length, api: api.title, baseUrl: baseUrl || "(relative)" });
  await serveStdio(createServer);
}

async function listAction(specs: string[], rawOptions: FilterOptions & { json?: boolean }, command: Command): Promise<void> {
  const presetResolved = resolvePreset(specs, rawOptions);
  specs = presetResolved.specs;
  const options = withConfig(command, rawOptions);
  if (presetResolved.readOnly) options.readOnly = true;
  const api = await loadApis(specs, options.overlay);
  applyTenantOptions(options);
  await maybeHideDeprecated(api, specs, options);
  const policy = loadPolicyOption(options.policy);
  const tools = applyFilters(api.tools, options, policy);
  if (options.json) {
    const payload = tools.map((t) => ({ name: t.name, description: t.description, method: t.method, path: t.path, tags: t.tags }));
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    for (const tool of tools) process.stdout.write(`${tool.name}\t${tool.method.toUpperCase()} ${tool.path}\n`);
    process.stderr.write(`\n${tools.length} tool(s) from "${api.title}"\n`);
  }
}

async function doctorAction(specs: string[], options: any): Promise<void> {
  const presetResolved = resolvePreset(specs, options);
  specs = presetResolved.specs;
  if (presetResolved.readOnly) options.readOnly = true;
  const headers = parseHeaders(options.header);
  const write = (line = "") => process.stdout.write(line + "\n");

  for (const spec of specs) {
    const api = await loadSpec(spec, options.overlay);
    const doc = options.overlay ? applyOverlay(await loadDocument(spec), readJson(options.overlay)) : await loadDocument(spec);
    const baseUrl = options.baseUrl ?? api.baseUrls[0] ?? "";
    write(`✓ spec loaded: ${api.title} v${api.version}`);
    write(`  tools:      ${api.tools.length}`);
    write(`  base url:   ${baseUrl || "(relative — set --base-url)"}`);
    write(`  auth:       ${api.schemesWithCreds.length} ready, ${api.schemesWithoutCreds.length} missing credentials`);
    for (const name of api.schemesWithCreds) write(`    ✓ ${name}`);
    for (const name of api.schemesWithoutCreds) write(`    ✗ ${name}  ->  set OPENAPIMCP_${name.toUpperCase()}`);
    const compat = analyzeSpecCompat(doc);
    write(`  compat:     ${compat.summary.supported} supported, ${compat.summary.partial} partial, ${compat.summary.unsupported} unsupported`);
    for (const e of compat.entries.filter((x) => x.status === "unsupported")) {
      write(`    ✗ ${e.operationId} — ${e.reasons.join(", ")}`);
    }
    if (baseUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Number(options.timeout) || 10000);
        const res = await fetch(baseUrl, { headers, signal: controller.signal });
        clearTimeout(timer);
        write(`  reachable:  ✓ HTTP ${res.status}`);
      } catch (err) {
        write(`  reachable:  ✗ ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    write();
  }
}

async function callAction(positional: string[] | undefined, rawOptions: any, command: Command): Promise<void> {
  const args = positional ?? [];
  let spec: string | undefined;
  let toolName: string | undefined;
  if (args.length === 0) program.help({ error: true });
  if (args.length === 1) {
    if (isSpecArg(args[0])) {
      spec = args[0];
      // tool name must be provided via --tool? no; require second positional
      fatal("missing tool name. Usage: openapimcp call <spec> <tool>  or  openapimcp call <tool> (with a default spec)");
    } else {
      toolName = args[0];
    }
  } else {
    spec = args[0];
    toolName = args[1];
  }
  if (!toolName) program.help({ error: true });
  spec = resolveSpec(spec);
  const options = withConfig(command, rawOptions);
  if (!options.oauthProvider && options.oauth2TokenUrl && options.oauth2ClientId && options.oauth2ClientSecret) {
    options.oauthProvider = new OAuth2TokenProvider({ tokenUrl: options.oauth2TokenUrl, clientId: options.oauth2ClientId, clientSecret: options.oauth2ClientSecret, scope: options.oauth2Scope });
  }
  const api = await loadSpec(spec!, options.overlay);
  if (options.mock && !options.mockSpec) {
    try { options.mockSpec = options.overlay ? applyOverlay(await loadDocument(spec!), readJson(options.overlay)) : await loadDocument(spec!); } catch { /* ignore */ }
  }
  applyTenantOptions(options);
  await maybeHideDeprecated(api, [spec!], options);
  if (!options.oauthProvider) {
    for (const scheme of Object.values(api.securitySchemes ?? {})) {
      const cfg = parseOAuth2Config(scheme);
      if (cfg) { options.oauthProvider = new OAuth2TokenProvider(cfg); break; }
    }
  }
  const tool = api.tools.find((t) => t.name === toolName);
  if (!tool) fatal(`tool "${toolName}" not found. Run: openapimcp list ${spec}`);
  if (options.readOnly && !["get", "head", "options"].includes(tool.method.toLowerCase())) {
    fatal(`blocked by --read-only: ${tool.method.toUpperCase()} ${tool.path} is a mutating operation`);
  }

  const toolArgs = buildArgs(options);
  await applyPluginInstances(options);
  await applyProxy(options);
  const result = await callApi(tool!, toolArgs, requestOptions(api, options, loadPolicyOption(options.policy)));
  process.stdout.write(result.text + "\n");
  process.exitCode = result.isError ? 1 : 0;
}

async function runAction(positional: string[], rawOptions: any, command: Command): Promise<void> {
  const options = withConfig(command, rawOptions);
  if (!options.oauthProvider && options.oauth2TokenUrl && options.oauth2ClientId && options.oauth2ClientSecret) {
    options.oauthProvider = new OAuth2TokenProvider({ tokenUrl: options.oauth2TokenUrl, clientId: options.oauth2ClientId, clientSecret: options.oauth2ClientSecret, scope: options.oauth2Scope });
  }
  let spec: string | undefined = options.spec;
  const rest = [...(positional ?? [])];
  if (!spec && rest.length && isSpecArg(rest[0])) spec = rest.shift();
  spec = resolveSpec(spec);
  const task = rest.join(" ").trim();

  const api = await loadSpec(spec, options.overlay);
  if (options.mock && !options.mockSpec) {
    try { options.mockSpec = options.overlay ? applyOverlay(await loadDocument(spec), readJson(options.overlay)) : await loadDocument(spec); } catch { /* ignore */ }
  }
  applyTenantOptions(options);
  await maybeHideDeprecated(api, [spec], options);
  if (!options.oauthProvider) {
    for (const scheme of Object.values(api.securitySchemes ?? {})) {
      const cfg = parseOAuth2Config(scheme);
      if (cfg) { options.oauthProvider = new OAuth2TokenProvider(cfg); break; }
    }
  }
  if (!task) {
    process.stdout.write(formatToolList(api.tools) + "\n");
    return;
  }

  const matches = rankTools(api.tools, task, 5);
  if (matches.length === 0) {
    process.stderr.write(`openapimcp: no tool matched "${task}". Available tools:\n`);
    process.stdout.write(formatToolList(api.tools) + "\n");
    return;
  }
  const tool = matches[0];
  process.stderr.write(`openapimcp: matched "${tool.name}" (${tool.method.toUpperCase()} ${tool.path})\n`);
  if (matches.length > 1) process.stderr.write(`  (also: ${matches.slice(1).map((t) => t.name).join(", ")})\n`);

  const toolArgs = buildArgs(options);
  await applyPluginInstances(options);
  await applyProxy(options);
  const result = await callApi(tool, toolArgs, requestOptions(api, options, loadPolicyOption(options.policy)));
  process.stdout.write(result.text + "\n");
  process.exitCode = result.isError ? 1 : 0;
}

async function dryRunAction(positional: string[] | undefined, rawOptions: any, command: Command): Promise<void> {
  const args = positional ?? [];
  let spec: string | undefined;
  let toolName: string | undefined;
  if (args.length === 0) program.help({ error: true });
  if (args.length === 1) { toolName = args[0]; } else { spec = args[0]; toolName = args[1]; }
  spec = resolveSpec(spec);
  const options = withConfig(command, rawOptions);
  const api = await loadSpec(spec, options.overlay);
  const tool = api.tools.find((t) => t.name === toolName);
  if (!tool) fatal(`tool "${toolName}" not found. Run: openapimcp list ${spec}`);
  const toolArgs = buildArgs(options);
  const result = buildDryRun(tool!, toolArgs, { baseUrl: options.baseUrl ?? api.baseUrls[0], headers: parseHeaders(options.header) });
  process.stdout.write(formatDryRun(result) + "\n");
}

async function generateAction(specs: string[], rawOptions: any, command: Command): Promise<void> {
  const presetResolved = resolvePreset(specs, rawOptions);
  specs = presetResolved.specs;
  const options = withConfig(command, rawOptions);
  if (presetResolved.readOnly) options.readOnly = true;
  applyTenantOptions(options);
  const policy = loadPolicyOption(options.policy);
  const out = path.resolve(options.out ?? "./generated");
  const specInputs: { file: string; doc: any }[] = [];
  let defaultName = "openapimcp";

  for (const spec of specs) {
    const base = await loadDocument(spec);
    const doc = options.overlay ? applyOverlay(base, readJson(options.overlay)) : base;
    const api = parseDocument(doc);
    if (options.hideDeprecated) filterDeprecatedTools(api, doc);
    if (specs.length === 1) defaultName = slug(api.title);
    const tools = applyFilters(api.tools, options, policy);
    const allowed = new Set(tools.map((t) => `${t.method.toUpperCase()} ${t.path}`));
    const file = specs.length === 1 ? "spec.json" : `specs/${slug(api.title)}.json`;
    specInputs.push({ file, doc: pruneDocument(doc, allowed) });
  }

  const files = generateProject({
    out,
    name: options.name ?? defaultName,
    version: VERSION,
    specs: specInputs,
    config: {
      baseUrl: options.baseUrl ?? "",
      headers: parseHeaders(options.header),
      fields: fieldsOf(options.fields) ?? [],
      timeoutMs: Number(options.timeout) || 30000,
      maxBytes: Number(options.maxBytes) || 20000,
      retries: Number(options.retries) || 0,
      cacheTtlMs: (Number(options.cacheTtl) || 0) * 1000,
      paginate: Boolean(options.paginate),
      maxPages: Number(options.maxPages) || 5
    }
  });

  process.stdout.write(`✓ generated ${files.length} files in ${out}\n`);
  for (const file of files) process.stdout.write(`  ${file}\n`);
  process.stdout.write(`\nnext: cd ${path.relative(process.cwd(), out) || "."} && npm install && npm start\n`);
}

async function diffAction(oldSpec: string, newSpec: string): Promise<void> {
  let oldDoc: any, newDoc: any;
  try { oldDoc = await loadDocument(oldSpec); } catch (err) { fatal(`could not load spec "${oldSpec}": ${err instanceof Error ? err.message : String(err)}`); }
  try { newDoc = await loadDocument(newSpec); } catch (err) { fatal(`could not load spec "${newSpec}": ${err instanceof Error ? err.message : String(err)}`); }
  const result = diffSpecs(oldDoc, newDoc);
  process.stdout.write(`breaking:     ${result.breaking.length}\n`);
  for (const change of result.breaking) process.stdout.write(`  ✗ [${change.kind}] ${change.method ?? ""} ${change.path ?? ""} — ${change.detail}\n`);
  process.stdout.write(`non-breaking: ${result.nonBreaking.length}\n`);
  for (const change of result.nonBreaking) process.stdout.write(`  ✓ [${change.kind}] ${change.method ?? ""} ${change.path ?? ""} — ${change.detail}\n`);
  process.exitCode = result.breaking.length > 0 ? 1 : 0;
}

function postmanAction(collection: string, options: { json?: boolean }): void {
  const operations = postmanToOperations(readJson(collection));
  if (options.json) {
    process.stdout.write(JSON.stringify(operations, null, 2) + "\n");
    return;
  }
  for (const op of operations) process.stdout.write(`${op.name}\t${op.method} ${op.path}\n`);
  process.stderr.write(`\n${operations.length} operation(s)\n`);
}

async function clientAction(spec: string, options: { out?: string; name?: string }): Promise<void> {
  const specPath = resolveSpec(spec);
  const files = generateClient(await loadDocument(specPath), { name: options.name });
  const out = path.resolve(options.out ?? "./client");
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(out, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  process.stdout.write(`✓ generated ${Object.keys(files).length} files in ${out}\n`);
  for (const file of Object.keys(files)) process.stdout.write(`  ${file}\n`);
}

async function smokeAction(spec: string, options: { out?: string; overlay?: string }): Promise<void> {
  const api = await loadSpec(resolveSpec(spec), options.overlay);
  const contents = generateSmokeTests(api);
  if (options.out) {
    mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    writeFileSync(options.out, contents);
    process.stdout.write(`✓ wrote ${options.out}\n`);
  } else {
    process.stdout.write(contents);
  }
}

async function uiAction(spec: string, options: { tool?: string; overlay?: string }): Promise<void> {
  const api = await loadSpec(resolveSpec(spec), options.overlay);
  if (options.tool) {
    const tool = api.tools.find((t) => t.name === options.tool);
    if (!tool) fatal(`tool "${options.tool}" not found`);
    process.stdout.write(formatToolDetail(tool!) + "\n");
  } else {
    process.stdout.write(formatToolList(api.tools) + "\n");
  }
}

async function initAction(spec: string, options: { target?: string; global?: boolean; name?: string }): Promise<void> {
  const name = options.name ?? "demo";
  const target = options.target ?? "opencode";
  const entry = { type: "local", command: ["npx", "-y", "openapimcp", spec] };
  let file: string;

  if (target === "opencode") {
    const base = options.global ? path.join(os.homedir(), ".config", "opencode") : process.cwd();
    file = path.join(base, "opencode.json");
    const cfg = readJsonIfExists(file) ?? { $schema: "https://opencode.ai/config.json", mcp: { servers: {} } };
    cfg.mcp ??= { servers: {} };
    cfg.mcp.servers ??= {};
    cfg.mcp.servers[name] = entry;
    writeJson(file, cfg);
  } else if (target === "claude") {
    const base = options.global
      ? process.platform === "win32"
        ? path.join(process.env.APPDATA || os.homedir(), "Claude")
        : process.platform === "darwin"
          ? path.join(os.homedir(), "Library", "Application Support", "Claude")
          : path.join(os.homedir(), ".config", "Claude")
      : process.cwd();
    file = path.join(base, "claude_desktop_config.json");
    const cfg = readJsonIfExists(file) ?? { mcpServers: {} };
    cfg.mcpServers ??= {};
    cfg.mcpServers[name] = { command: "npx", args: ["-y", "openapimcp", spec] };
    writeJson(file, cfg);
  } else if (target === "cursor") {
    const base = options.global ? path.join(os.homedir(), ".cursor") : path.join(process.cwd(), ".cursor");
    file = path.join(base, "mcp.json");
    const cfg = readJsonIfExists(file) ?? { mcpServers: {} };
    cfg.mcpServers ??= {};
    cfg.mcpServers[name] = { command: "npx", args: ["-y", "openapimcp", spec] };
    writeJson(file, cfg);
  } else {
    fatal(`unknown target "${target}". Use opencode | claude | cursor.`);
  }

  process.stdout.write(`✓ wrote "${name}" into ${file}\n`);
  process.stdout.write("  restart your client (or /reload in OpenCode) to pick it up\n");
}

async function setupAction(spec: string | undefined, options: any): Promise<void> {
  if (options.postinstall) {
    if (process.env.OPENAPIMCP_AUTO_SETUP !== "1") {
      process.stdout.write("openapimcp installed. Run `npx openapimcp setup <spec>` to auto-configure your editors (OpenCode, Claude Desktop, Cursor, Windsurf, VS Code, Continue, Zed).\n");
      return;
    }
    if (!spec) spec = process.env.OPENAPIMCP_AUTO_SETUP_SPEC;
    if (!spec) {
      process.stdout.write("openapimcp installed. Run `npx openapimcp setup <spec>` to auto-configure your editors.\n");
      return;
    }
    options.quiet = true;
  }
  const s = resolveSpec(spec);
  const result = runSetup({ spec: s, serverName: options.name, targets: options.target, global: options.global, project: Boolean(options.project), dryRun: Boolean(options.dryRun), quiet: Boolean(options.quiet) });
  if (result.errors.length) process.exitCode = 1;
}

/** Keep only the operations that survived filtering, so the bundle stays small. */
function pruneDocument(doc: any, allowed: Set<string>): any {
  const clone = structuredClone(doc);
  for (const [p, item] of Object.entries<any>(clone.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (item[method] && !allowed.has(`${method.toUpperCase()} ${p}`)) delete item[method];
    }
    if (!HTTP_METHODS.some((method) => item[method])) delete clone.paths[p];
  }
  return clone;
}

function parseJsonFlag(value: string, flag: string): any {
  const trimmed = value.trim();
  try {
    const text = (trimmed.startsWith("{") || trimmed.startsWith("[") ? value : readFileSync(value, "utf8")).replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch (err) {
    return fatal(`invalid JSON for ${flag} "${trimmed.startsWith("{") ? "(inline)" : value}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

function requestOptions(_api: ParsedApi, options: any, policy?: Policy): RequestOptions {
  const budget = options.budget ? parseBudget(parseJsonFlag(options.budget, "--budget")) : undefined;
  if (options.budget && !budget) fatal("--budget must be a JSON object like {\"maxCalls\": 10, \"maxBytes\": 100000}");
  const sigv4Raw: string | undefined = options.sigv4;
  let sigv4: { accessKeyId: string; secretAccessKey: string; region: string; service: string } | undefined;
  if (sigv4Raw) {
    const [region, service] = sigv4Raw.split(":");
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!region || !service) fatal("--sigv4 expects <region>:<service>, e.g. --sigv4 us-east-1:execute-api");
    if (!accessKeyId || !secretAccessKey) fatal("--sigv4 needs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the environment");
    sigv4 = { accessKeyId, secretAccessKey, region, service };
  }
  return {
    baseUrl: options.baseUrl,
    headers: parseHeaders(options.header),
    timeoutMs: Number(options.timeout) || 30000,
    maxBytes: Number(options.maxBytes) || 20000,
    fields: fieldsOf(options.fields),
    retries: Number(options.retries) || 0,
    cacheTtlMs: (Number(options.cacheTtl) || 0) * 1000,
    paginate: Boolean(options.paginate),
    maxPages: Number(options.maxPages) || 5,
    policy,
    redact: Boolean(options.redact),
    summarize: options.summarize ? {} : undefined,
    rateLimiter: options.rateLimit ? new RateLimiter({ ratePerSecond: Number(options.rateLimit) }) : undefined,
    breaker: options.breaker ? new CircuitBreaker() : undefined,
    diskCache: options.cacheDir ? new DiskCache(options.cacheDir) : undefined,
    audit: options.audit ? createAuditLog(options.audit) : undefined,
    metrics: options.metrics,
    oauthProvider: options.oauthProvider,
    pluginHooks: options.pluginInstances,
    dispatcher: options.dispatcher,
    sigv4,
    budgetTracker: budget ? new BudgetTracker(budget) : undefined,
    responseMap: options.responseMap ? parseMapping(parseJsonFlag(options.responseMap, "--response-map")) : undefined,
    historyFile: options.history,
    idempotency: Boolean(options.idempotency),
    costLog: options.costLog,
    costModel: options.costModel,
    async: options.async,
    asyncPollIntervalMs: Number(options.asyncPollInterval) || undefined,
    asyncMaxWaitMs: Number(options.asyncMaxWait) || undefined,
    mock: Boolean(options.mock),
    mockSpec: options.mockSpec,
    sanitize: Boolean(options.sanitize),
    contextBudget: options.contextBudget ? { maxTokens: Number(options.contextBudget) } : undefined,
    tamperAuditLog: options.tamperAuditLog,
    webhookUrl: options.webhookUrl,
    webhookEvents: options.webhookEvents,
    secretsProvider: options.secretsProviderInstance,
    semanticCache: Boolean(options.semanticCache),
    feedbackStore: options.feedbackStore,
    validateResponses: Boolean(options.validateResponses),
    conditional: options.conditional ? readJson(options.conditional) : undefined,
    abTest: Boolean(options.abTest),
    a2a: Boolean(options.a2a),
    streaming: Boolean(options.streaming),
    sampling: Boolean(options.sampling),
    serverless: Boolean(options.serverless),
    structuredContent: Boolean(options.structuredContent)
  };
}

async function applyProxy(options: any): Promise<void> {
  if (!options.ca && !options.proxy) return;
  try {
    options.dispatcher = await createDispatcher({ ca: options.ca, proxy: options.proxy });
  } catch (err) {
    fatal(err instanceof Error ? err.message : String(err));
  }
}

async function applyPluginInstances(options: any): Promise<void> {
  if (!options.plugin?.length || options.pluginInstances) return;
  const hooks = [];
  for (const pluginPath of options.plugin) {
    try {
      hooks.push(...(await loadPlugin(pluginPath)));
    } catch (err) {
      fatal(`could not load plugin "${pluginPath}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  options.pluginInstances = hooks;
}

function applyTenantOptions(options: any): void {
  if (!options.tenant) return;
  if (!options.tenants) fatal("--tenant requires --tenants <file>");
  let tenants: Record<string, any>;
  try {
    tenants = parseTenantsFile(JSON.parse(readFileSync(options.tenants, "utf8")));
  } catch (err) {
    fatal(`could not load tenants: ${err instanceof Error ? err.message : String(err)}`);
  }
  const resolved = resolveTenant(tenants, options.tenant, options.userKey);
  if (!resolved) fatal(`tenant "${options.tenant}" not found. Available: ${tenantNames(tenants).join(", ")}`);
  if (resolved.baseUrl && !options.baseUrl) options.baseUrl = resolved.baseUrl;
  if (resolved.headers) options.header = [...(options.header ?? []), ...Object.entries(resolved.headers).map(([k, v]) => `${k}: ${v}`)];
  if (resolved.readOnly) options.readOnly = true;
  if (resolved.policy && !options.policy) options.policy = resolved.policy;
}

function filterDeprecatedTools(api: ParsedApi, doc: any): void {
  if (!doc?.paths) return;
  const deprecated = new Set<string>();
  const methods = ["get", "post", "put", "patch", "delete", "head", "options"];
  for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
    for (const method of methods) {
      const op = (item as any)?.[method];
      if (op && isDeprecated(op)) deprecated.add(`${method} ${path}`);
    }
  }
  api.tools = api.tools.filter((tool) => !deprecated.has(`${tool.method.toLowerCase()} ${tool.path}`));
}

async function maybeHideDeprecated(api: ParsedApi, specs: string[], options: any): Promise<void> {
  if (!options.hideDeprecated) return;
  try {
    const base = await loadDocument(specs[0]);
    const doc = options.overlay ? applyOverlay(base, readJson(options.overlay)) : base;
    filterDeprecatedTools(api, doc);
  } catch { /* could not inspect operations — keep all tools */ }
}

function applyFilters(tools: ToolDef[], options: FilterOptions, policy?: Policy): ToolDef[] {
  const include = options.include ? new RegExp(options.include) : undefined;
  const exclude = options.exclude ? new RegExp(options.exclude) : undefined;
  const tags = options.tag && options.tag.length ? new Set(options.tag) : undefined;
  const readOnlyMethods = new Set(["get", "head", "options"]);
  return tools.filter((tool) => {
    if (include && !include.test(tool.name)) return false;
    if (exclude && exclude.test(tool.name)) return false;
    if (tags && !tool.tags.some((tag) => tags.has(tag))) return false;
    if (options.readOnly && !readOnlyMethods.has(tool.method.toLowerCase())) return false;
    if (policy && !toolAllowed(policy, tool)) return false;
    return true;
  });
}

async function loadSpec(spec: string, overlayPath?: string): Promise<ParsedApi> {
  try {
    const base = await loadDocument(spec);
    const doc = overlayPath ? applyOverlay(base, readJson(overlayPath)) : base;
    return parseDocument(doc);
  } catch (err) {
    return fatal(`could not read spec "${spec}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Load one or many specs into a single tool list, namespacing when there is more than one. */
async function loadApis(specs: string[], overlayPath?: string): Promise<ParsedApi> {
  const apis: ParsedApi[] = [];
  for (const spec of specs) apis.push(await loadSpec(spec, overlayPath));
  if (apis.length === 1) return apis[0];

  const used = new Set<string>();
  const tools: ToolDef[] = [];
  for (const api of apis) {
    const prefix = slug(api.title);
    for (const tool of api.tools) {
      let name = `${prefix}_${tool.name}`;
      while (used.has(name)) name = `${name}_2`;
      used.add(name);
      tools.push({ ...tool, name });
    }
  }

  return {
    title: apis.map((a) => a.title).join(" + "),
    version: apis[0].version,
    baseUrls: [...new Set(apis.flatMap((a) => a.baseUrls))],
    tools,
    securitySchemes: {},
    schemesWithCreds: [...new Set(apis.flatMap((a) => a.schemesWithCreds))],
    schemesWithoutCreds: [...new Set(apis.flatMap((a) => a.schemesWithoutCreds))]
  };
}

function resolveSpecs(specs: string[] | undefined): string[] {
  if (specs && specs.length) return specs;
  const def = readDefaultSpec(true) ?? readDefaultSpec(false);
  if (def) return [def];
  fatal("no spec given. Run `openapimcp use <spec>` to set a default, or pass a spec.");
}

function resolveSpec(spec: string | undefined): string {
  if (spec) return spec;
  const def = readDefaultSpec(true) ?? readDefaultSpec(false);
  if (def) return def;
  fatal("no spec given. Run `openapimcp use <spec>` to set a default, or pass a spec.");
}

function isSpecArg(value: string): boolean {
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  if (/\.(json|yaml|yml)$/i.test(value)) return true;
  if (value.includes("/") || value.includes("\\")) return true;
  if (existsSync(value)) return true;
  return false;
}

function buildArgs(options: any): Record<string, unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(options.args || "{}");
  } catch {
    fatal(`--args is not valid JSON: ${options.args}`);
  }
  for (const kv of options.arg ?? []) {
    const index = String(kv).indexOf("=");
    if (index === -1) fatal(`--arg "${kv}" must be in key=value form`);
    const key = String(kv).slice(0, index).trim();
    const raw = String(kv).slice(index + 1);
    try {
      args[key] = JSON.parse(raw);
    } catch {
      args[key] = raw;
    }
  }
  return args;
}

function withConfig(command: Command, options: any): any {
  if (options.dotenv) {
    try {
      applyDotenv(process.env, readFileSync(options.dotenv, "utf8"));
    } catch (err) {
      fatal(`could not read dotenv "${options.dotenv}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!options.config) return options;

  let config: Config;
  try {
    config = loadConfig(options.config);
  } catch (err) {
    return fatal(`could not load config "${options.config}": ${err instanceof Error ? err.message : String(err)}`);
  }
  const overrides: Config = {};
  for (const key of Object.keys(options)) {
    if (command.getOptionValueSource(key) === "cli") overrides[key] = options[key];
  }
  return mergeConfig(config, overrides);
}

function loadPolicyOption(file?: string): Policy | undefined {
  if (!file) return undefined;
  try {
    return loadPolicy(readJson(file));
  } catch (err) {
    return fatal(`could not load policy "${file}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseHeaders(list: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of list ?? []) {
    const index = raw.indexOf(":");
    if (index === -1) continue;
    headers[raw.slice(0, index).trim().toLowerCase()] = substituteEnv(raw.slice(index + 1).trim());
  }
  return headers;
}

function splitFields(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.length ? value.map(String) : undefined;
  if (typeof value === "string") {
    const fields = value.split(",").map((field) => field.trim()).filter(Boolean);
    return fields.length ? fields : undefined;
  }
  return undefined;
}

function fieldsOf(value: unknown): string[] | undefined {
  return splitFields(value);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "openapimcp"
  );
}

function fatal(message: string): never {
  process.stderr.write(`openapimcp: ${message}\n`);
  process.exit(1);
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readJsonIfExists(file: string): any | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function defaultSpecFile(global: boolean): string {
  const base = global ? os.homedir() : process.cwd();
  return path.join(base, ".openapimcp", "default");
}

function readDefaultSpec(global: boolean): string | undefined {
  const file = defaultSpecFile(global);
  if (!existsSync(file)) return undefined;
  try {
    return readFileSync(file, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function saveDefaultSpec(spec: string, global: boolean): void {
  const file = defaultSpecFile(global);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, spec + "\n");
}

// Route `openapimcp <spec>` to the default `serve` command.
const KNOWN = new Set(["serve", "list", "doctor", "call", "generate", "diff", "postman", "client", "smoke", "ui", "init", "use", "run", "setup", "discover", "lint", "marketplace", "eval", "memory", "graphql", "workflow", "a2a", "compat", "dry-run", "config", "bundle", "pin", "presets", "batch", "history", "completions", "help"]);
const argv = process.argv.slice();
const first = argv[2];
if (first && !first.startsWith("-") && !KNOWN.has(first)) argv.splice(2, 0, "serve");

await program.parseAsync(argv);
