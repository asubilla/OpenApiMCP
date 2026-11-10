#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadDocument, parseDocument, parseSpec } from "./openapi.js";
import { buildServer } from "./server.js";
import { callApi, type RequestOptions } from "./http.js";
import { substituteEnv } from "./auth.js";
import { generateProject } from "./generate.js";
import { startGateway } from "./gateway.js";
import { loadPolicy, toolAllowed, type Policy } from "./policy.js";
import type { ParsedApi, ToolDef } from "./types.js";

const VERSION = "1.0.0";
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
  .action(serveAction);

filterFlags(program.command("list"))
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
  .option("--timeout <ms>", "HTTP timeout in milliseconds", "10000")
  .action(doctorAction);

httpFlags(
  program
    .command("call")
    .description("Call a single tool from the terminal")
    .argument("[spec]", "Path or URL to an OpenAPI/Swagger document")
    .argument("[tool]", "Tool (operationId) to call")
).option("--args <json>", "Tool arguments as JSON", "{}").action(callAction);

httpFlags(filterFlags(program.command("generate")))
  .description("Generate a standalone, offline MCP server project")
  .argument("<specs...>", "Paths or URLs to OpenAPI/Swagger documents")
  .option("--out <dir>", "Output directory", "./generated")
  .option("--name <name>", "Project name (default: slug of the spec title)")
  .action(generateAction);

async function serveAction(specs: string[], options: any): Promise<void> {
  if (!specs?.length) program.help({ error: true });
  const policy = loadPolicyOption(options.policy);
  const api = await loadApis(specs);
  const tools = applyFilters(api.tools, options, policy);
  if (tools.length === 0) fatal("no tools matched. Check the spec and your filters.");

  const baseUrl = options.baseUrl ?? api.baseUrls[0] ?? "";
  const requestOpts = requestOptions(api, options, policy);
  const serverName = options.name ?? slug(api.title);

  if (options.printConfig) {
    const args = ["-y", "openapimcp", ...specs];
    if (options.baseUrl) args.push("--base-url", options.baseUrl);
    for (const header of options.header ?? []) args.push("-H", header);
    if (options.readOnly) args.push("--read-only");
    if (options.fields) args.push("--fields", options.fields);
    process.stdout.write(JSON.stringify({ mcpServers: { [serverName]: { command: "npx", args } } }, null, 2) + "\n");
    return;
  }

  const createServer = () => buildServer({ ...api, tools }, { serverName, version: VERSION, ...requestOpts });

  if (options.http) {
    await startGateway({
      port: Number(options.port) || 3000,
      host: options.host ?? "127.0.0.1",
      path: options.path ?? "/mcp",
      allowedHosts: options.allowedHost,
      allowedOrigins: options.allowedOrigin,
      createServer,
      onListening: (url) => process.stderr.write(`openapimcp: gateway listening on ${url} (${tools.length} tools)\n`)
    });
    return;
  }

  process.stderr.write(`openapimcp: ${tools.length} tool(s) from "${api.title}" -> ${baseUrl || "(relative URL)"}\n`);
  await serveStdio(createServer);
}

async function listAction(specs: string[], options: FilterOptions & { json?: boolean }): Promise<void> {
  if (!specs?.length) program.help({ error: true });
  const policy = loadPolicyOption(options.policy);
  const api = await loadApis(specs);
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
    const api = await loadSpec(spec);
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

async function callAction(spec: string | undefined, toolName: string | undefined, options: any): Promise<void> {
  if (!spec || !toolName) program.help({ error: true });
  const api = await loadSpec(spec!);
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

async function generateAction(specs: string[], options: any): Promise<void> {
  if (!specs?.length) program.help({ error: true });
  const policy = loadPolicyOption(options.policy);
  const out = path.resolve(options.out ?? "./generated");
  const specInputs: { file: string; doc: any }[] = [];
  let defaultName = "openapimcp";

  for (const spec of specs) {
    const doc = await loadDocument(spec);
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
      fields: splitFields(options.fields) ?? [],
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

function requestOptions(api: ParsedApi, options: any, policy?: Policy): RequestOptions {
  return {
    baseUrl: options.baseUrl,
    headers: parseHeaders(options.header),
    timeoutMs: Number(options.timeout) || 30000,
    maxBytes: Number(options.maxBytes) || 20000,
    fields: splitFields(options.fields),
    retries: Number(options.retries) || 0,
    cacheTtlMs: (Number(options.cacheTtl) || 0) * 1000,
    paginate: Boolean(options.paginate),
    maxPages: Number(options.maxPages) || 5,
    policy
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

async function loadSpec(spec: string): Promise<ParsedApi> {
  try {
    return await parseSpec(spec);
  } catch (err) {
    return fatal(`could not read spec "${spec}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Load one or many specs into a single tool list, namespacing when there is more than one. */
async function loadApis(specs: string[]): Promise<ParsedApi> {
  const apis: ParsedApi[] = [];
  for (const spec of specs) apis.push(await loadSpec(spec));
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

function loadPolicyOption(file?: string): Policy | undefined {
  if (!file) return undefined;
  try {
    return loadPolicy(JSON.parse(readFileSync(file, "utf8")));
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

function splitFields(value?: string): string[] | undefined {
  if (!value) return undefined;
  const fields = value.split(",").map((field) => field.trim()).filter(Boolean);
  return fields.length ? fields : undefined;
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
const KNOWN = new Set(["serve", "list", "doctor", "call", "generate", "help"]);
const argv = process.argv.slice();
const first = argv[2];
if (first && !first.startsWith("-") && !KNOWN.has(first)) argv.splice(2, 0, "serve");

await program.parseAsync(argv);
