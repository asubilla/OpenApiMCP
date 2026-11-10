#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { Metrics } from "./metrics.js";
import { diffSpecs } from "./diff.js";
import { applyOverlay } from "./overlay.js";
import { postmanToOperations } from "./postman.js";
import { generateClient } from "./clientgen.js";
import { generateSmokeTests } from "./testing.js";
import { formatToolDetail, formatToolList } from "./toolkit.js";
import { loadConfig, mergeConfig, type Config } from "./config.js";
import { applyDotenv } from "./env.js";
import { completionsFor } from "./completions.js";
import type { ParsedApi, ToolDef } from "./types.js";

const VERSION = "1.1.0";
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
    .option("--policy <file>", "JSON policy file (allow/deny tools, methods, outbound hosts)");

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
    .option("--tool-search", "Expose search_tools + call_tool instead of every operation");

runtimeFlags(
  httpFlags(filterFlags(program.command("serve")))
    .description("Run an MCP server for one or more specs (the default command)")
    .argument("[specs...]", "Paths or URLs to OpenAPI/Swagger documents")
    .option("--name <name>", "MCP server name (default: slug of the spec title)")
    .option("--print-config", "Print an MCP client config snippet, then exit")
    .option("--http", "Serve over Streamable HTTP instead of stdio")
    .option("--port <n>", "HTTP port", "3000")
    .option("--host <addr>", "HTTP bind address", "127.0.0.1")
    .option("--path <path>", "HTTP endpoint path", "/mcp")
    .option("--allowed-host <host...>", "Allowed Host headers for the HTTP gateway")
    .option("--allowed-origin <origin...>", "Allowed Origin headers for the HTTP gateway")
).action(serveAction);

runtimeFlags(filterFlags(program.command("list")))
  .description("List the tools the specs would expose")
  .argument("[specs...]", "Paths or URLs to OpenAPI/Swagger documents")
  .option("--json", "Print JSON")
  .action(listAction);

program
  .command("doctor")
  .description("Validate specs, show tool counts, and check auth + connectivity")
  .argument("[specs...]", "Paths or URLs to OpenAPI/Swagger documents")
  .option("--base-url <url>", "Override the API base URL")
  .option("-H, --header <header...>", "Extra HTTP header for the connectivity check")
  .option("--overlay <file>", "OpenAPI Overlay (JSON) applied before parsing")
  .option("--timeout <ms>", "HTTP timeout in milliseconds", "10000")
  .action(doctorAction);

runtimeFlags(
  httpFlags(
    program
      .command("call")
      .description("Call a single tool from the terminal")
      .argument("[spec]", "Path or URL to an OpenAPI/Swagger document")
      .argument("[tool]", "Tool (operationId) to call")
  )
).option("--args <json>", "Tool arguments as JSON", "{}").action(callAction);

runtimeFlags(httpFlags(filterFlags(program.command("generate"))))
  .description("Generate a standalone, offline MCP server project")
  .argument("<specs...>", "Paths or URLs to OpenAPI/Swagger documents")
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
  .command("completions")
  .description("Print a shell completion script")
  .argument("[shell]", "bash | zsh | fish | powershell")
  .action((shell?: string) => {
    const chosen = shell ?? (process.platform === "win32" ? "powershell" : process.platform === "darwin" ? "zsh" : "bash");
    if (!["bash", "zsh", "fish", "powershell"].includes(chosen)) fatal(`unknown shell "${chosen}"`);
    process.stdout.write(completionsFor(chosen as "bash") + "\n");
  });

async function serveAction(specs: string[], rawOptions: any, command: Command): Promise<void> {
  if (!specs?.length) program.help({ error: true });
  const options = withConfig(command, rawOptions);
  const log = createLogger({ json: Boolean(options.logJson) });
  const policy = loadPolicyOption(options.policy);
  const api = await loadApis(specs, options.overlay);
  const tools = applyFilters(api.tools, options, policy);
  if (tools.length === 0) fatal("no tools matched. Check the spec and your filters.");

  const metrics = options.http ? new Metrics() : undefined;
  if (metrics) options.metrics = metrics;
  const requestOpts = requestOptions(api, options, policy);
  const serverName = options.name ?? slug(api.title);
  const baseUrl = options.baseUrl ?? api.baseUrls[0] ?? "";

  if (options.printConfig) {
    const args = ["-y", "openapimcp", ...specs];
    if (options.baseUrl) args.push("--base-url", options.baseUrl);
    for (const header of options.header ?? []) args.push("-H", header);
    if (options.readOnly) args.push("--read-only");
    if (options.fields) args.push("--fields", options.fields);
    process.stdout.write(JSON.stringify({ mcpServers: { [serverName]: { command: "npx", args } } }, null, 2) + "\n");
    return;
  }

  const createServer = () =>
    buildServer({ ...api, tools }, { serverName, version: VERSION, toolSearch: Boolean(options.toolSearch), ...requestOpts });

  if (options.http) {
    await startGateway({
      port: Number(options.port) || 3000,
      host: options.host ?? "127.0.0.1",
      path: options.path ?? "/mcp",
      allowedHosts: options.allowedHost,
      allowedOrigins: options.allowedOrigin,
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
  if (!specs?.length) program.help({ error: true });
  const options = withConfig(command, rawOptions);
  const policy = loadPolicyOption(options.policy);
  const api = await loadApis(specs, options.overlay);
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
  if (!specs?.length) program.help({ error: true });
  const headers = parseHeaders(options.header);
  const write = (line = "") => process.stdout.write(line + "\n");

  for (const spec of specs) {
    const api = await loadSpec(spec, options.overlay);
    const baseUrl = options.baseUrl ?? api.baseUrls[0] ?? "";
    write(`✓ spec loaded: ${api.title} v${api.version}`);
    write(`  tools:      ${api.tools.length}`);
    write(`  base url:   ${baseUrl || "(relative — set --base-url)"}`);
    write(`  auth:       ${api.schemesWithCreds.length} ready, ${api.schemesWithoutCreds.length} missing credentials`);
    for (const name of api.schemesWithCreds) write(`    ✓ ${name}`);
    for (const name of api.schemesWithoutCreds) write(`    ✗ ${name}  ->  set OPENAPIMCP_${name.toUpperCase()}`);
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

async function callAction(spec: string | undefined, toolName: string | undefined, rawOptions: any, command: Command): Promise<void> {
  if (!spec || !toolName) program.help({ error: true });
  const options = withConfig(command, rawOptions);
  const api = await loadSpec(spec!, options.overlay);
  const tool = api.tools.find((t) => t.name === toolName);
  if (!tool) fatal(`tool "${toolName}" not found. Run: openapimcp list ${spec}`);

  let args: Record<string, any>;
  try {
    args = JSON.parse(options.args || "{}");
  } catch {
    fatal(`--args is not valid JSON: ${options.args}`);
  }

  const result = await callApi(tool!, args!, requestOptions(api, options, loadPolicyOption(options.policy)));
  process.stdout.write(result.text + "\n");
  process.exitCode = result.isError ? 1 : 0;
}

async function generateAction(specs: string[], rawOptions: any, command: Command): Promise<void> {
  if (!specs?.length) program.help({ error: true });
  const options = withConfig(command, rawOptions);
  const policy = loadPolicyOption(options.policy);
  const out = path.resolve(options.out ?? "./generated");
  const specInputs: { file: string; doc: any }[] = [];
  let defaultName = "openapimcp";

  for (const spec of specs) {
    const base = await loadDocument(spec);
    const doc = options.overlay ? applyOverlay(base, readJson(options.overlay)) : base;
    const api = parseDocument(doc);
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
  const result = diffSpecs(await loadDocument(oldSpec), await loadDocument(newSpec));
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
  const files = generateClient(await loadDocument(spec), { name: options.name });
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
  const api = await loadSpec(spec, options.overlay);
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
  const api = await loadSpec(spec, options.overlay);
  if (options.tool) {
    const tool = api.tools.find((t) => t.name === options.tool);
    if (!tool) fatal(`tool "${options.tool}" not found`);
    process.stdout.write(formatToolDetail(tool!) + "\n");
  } else {
    process.stdout.write(formatToolList(api.tools) + "\n");
  }
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

function requestOptions(_api: ParsedApi, options: any, policy?: Policy): RequestOptions {
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
    metrics: options.metrics
  };
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

/** Apply --dotenv then merge a --config file under explicitly-passed CLI flags. */
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

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
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

function fieldsOf(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.length ? value.map(String) : undefined;
  if (typeof value === "string") {
    const fields = value.split(",").map((field) => field.trim()).filter(Boolean);
    return fields.length ? fields : undefined;
  }
  return undefined;
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

// Route `openapimcp <spec>` to the default `serve` command.
const KNOWN = new Set(["serve", "list", "doctor", "call", "generate", "diff", "postman", "client", "smoke", "ui", "completions", "help"]);
const argv = process.argv.slice();
const first = argv[2];
if (first && !first.startsWith("-") && !KNOWN.has(first)) argv.splice(2, 0, "serve");

await program.parseAsync(argv);
