/**
 * Minimal proto3 (.proto) parsing and gRPC tool generation utilities.
 *
 * Dependency-free: uses regex-based parsing and brace matching only.
 * This is a single-file reader for the common proto3 subset — it does NOT
 * implement (and intentionally does not attempt) the full protobuf grammar.
 * Not supported, for example: imports/includes resolution, options with
 * arbitrary nested bodies deeper than a couple of brace levels, `map` values
 * that are themselves maps, enum value semantics, and `oneof` grouping
 * (fields inside a `oneof` are reported as regular fields). Default values
 * and field numbers are ignored. Keep your .proto files simple and this
 * reader will do the right thing.
 */

export interface ProtoField {
  name: string;
  type: string;
}

export interface ProtoMethod {
  name: string;
  inputType: string;
  outputType: string;
  serverStreaming: boolean;
  clientStreaming: boolean;
}

export interface ProtoService {
  name: string;
  methods: ProtoMethod[];
}

export interface ProtoPackage {
  name: string;
  services: ProtoService[];
}

/** Internal shape: package objects produced by {@link parseProto} also carry their message map. */
interface ParsedProtoPackage extends ProtoPackage {
  /** Fully-qualified message name (package prefix + dotted nesting path) -> direct fields. */
  messages: Map<string, ProtoField[]>;
}

interface RawBlock {
  name: string;
  body: string;
  start: number;
  end: number;
}

/** Remove `//` line comments and `/* ... *​/` block comments, keeping string literals intact. */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\" && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Collect top-level `keyword <Name> { ... }` blocks with brace matching.
 * Nested blocks of the same keyword are NOT returned here; callers recurse
 * into block bodies instead (this keeps nesting paths straight).
 */
function collectBlocks(text: string, keyword: "message" | "service"): RawBlock[] {
  const re = new RegExp(`\\b${keyword}\\s+([A-Za-z_]\\w*)\\s*\\{`, "g");
  const blocks: RawBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const braceStart = text.indexOf("{", match.index);
    let depth = 0;
    let i = braceStart;
    let inString = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    blocks.push({ name: match[1], body: text.slice(braceStart + 1, i - 1), start: match.index, end: i });
    re.lastIndex = i; // skip the block contents (nested same-keyword blocks handled by recursion)
  }
  return blocks;
}

const TYPE_TOKEN = `(?:map\\s*<[^>]*>|\\.?[A-Za-z_][\\w.]*)`;
const FIELD_RE = new RegExp(
  `(?:\\b(repeated|optional|required)\\s+)?(${TYPE_TOKEN})\\s+([A-Za-z_]\\w*)\\s*=\\s*\\d+|\\b(${TYPE_TOKEN})\\s+([A-Za-z_]\\w*)\\s*=\\s*\\d+`,
  "g",
);
const SKIPPED_TYPES = new Set(["option", "reserved"]);

/** Parse the direct (non-nested) fields of a message body. */
function parseMessageFields(body: string): ProtoField[] {
  // Blank out nested message blocks so their fields are not attributed to the parent.
  let rest = body;
  const nested = collectBlocks(body, "message");
  for (const b of [...nested].sort((a, b) => b.start - a.start)) {
    rest = rest.slice(0, b.start) + " ".repeat(b.end - b.start) + rest.slice(b.end);
  }
  const fields: ProtoField[] = [];
  FIELD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_RE.exec(rest)) !== null) {
    const type = (m[2] ?? m[4]).trim();
    const name = m[3] ?? m[5];
    if (SKIPPED_TYPES.has(type)) continue;
    fields.push({ name, type });
  }
  return fields;
}

/** Recursively register a message block and its nested messages under dotted full names. */
function registerMessage(map: Map<string, ProtoField[]>, block: RawBlock, prefix: string): void {
  const fullName = prefix + block.name;
  map.set(fullName, parseMessageFields(block.body));
  for (const nested of collectBlocks(block.body, "message")) {
    registerMessage(map, nested, `${fullName}.`);
  }
}

const RPC_RE = new RegExp(
  `\\brpc\\s+([A-Za-z_]\\w*)\\s*\\(\\s*(stream\\s+)?(\\.?[A-Za-z_][\\w.]*)\\s*\\)` +
    `\\s*returns\\s*\\(\\s*(stream\\s+)?(\\.?[A-Za-z_][\\w.]*)\\s*\\)` +
    `\\s*(?:\\{(?:[^{}]|\\{[^{}]*\\})*\\}|;)`,
  "g",
);

function parseServiceBlock(block: RawBlock): ProtoService {
  const methods: ProtoMethod[] = [];
  RPC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RPC_RE.exec(block.body)) !== null) {
    methods.push({
      name: m[1],
      inputType: m[3],
      outputType: m[5],
      clientStreaming: Boolean(m[2]),
      serverStreaming: Boolean(m[4]),
    });
  }
  return { name: block.name, methods };
}

/**
 * Parse a proto3 document. `package <name>;` declarations are honored; each
 * top-level message/service block is attributed to the nearest preceding
 * package declaration (or to an implicit package with an empty name when the
 * file declares none). Returned package objects additionally carry an
 * internal `messages` map used by {@link grpcTools}; hand-constructed
 * `ProtoPackage` values without that map simply yield empty `params`.
 */
export function parseProto(text: string): ProtoPackage[] {
  const clean = stripComments(text);

  const pkgDecls = [...clean.matchAll(/\bpackage\s+([\w.]+)\s*;/g)].map((m) => ({
    name: m[1],
    index: m.index ?? 0,
  }));
  const packageAt = (index: number): string => {
    let name = "";
    for (const decl of pkgDecls) {
      if (decl.index < index) name = decl.name;
      else break;
    }
    return name;
  };

  const groups = new Map<string, ParsedProtoPackage>();
  const ensure = (name: string): ParsedProtoPackage => {
    let g = groups.get(name);
    if (!g) {
      g = { name, services: [], messages: new Map() };
      groups.set(name, g);
    }
    return g;
  };

  const topBlocks = [
    ...collectBlocks(clean, "message").map((b) => ({ kind: "message" as const, block: b })),
    ...collectBlocks(clean, "service").map((b) => ({ kind: "service" as const, block: b })),
  ].sort((a, b) => a.block.start - b.block.start);

  for (const { kind, block } of topBlocks) {
    const pkgName = packageAt(block.start);
    const g = ensure(pkgName);
    if (kind === "message") {
      registerMessage(g.messages, block, pkgName ? `${pkgName}.` : "");
    } else {
      g.services.push(parseServiceBlock(block));
    }
  }

  return [...groups.values()];
}

/** One row per service, across all packages. */
export function listServices(packages: ProtoPackage[]): { package: string; service: string; methods: number }[] {
  const rows: { package: string; service: string; methods: number }[] = [];
  for (const pkg of packages) {
    for (const service of pkg.services) {
      rows.push({ package: pkg.name, service: service.name, methods: service.methods.length });
    }
  }
  return rows;
}

interface GrpcToolParam {
  argName: string;
  location: "path" | "query" | "body";
  required: boolean;
  type: string;
}

interface GrpcTool {
  name: string;
  description: string;
  method: string;
  path: string;
  params: GrpcToolParam[];
}

function snakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z0-9])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function getMessages(pkg: ProtoPackage): Map<string, ProtoField[]> | undefined {
  return (pkg as ParsedProtoPackage).messages;
}

/** Resolve a method's input type against the parsed messages, tolerating leading dots and nesting. */
function findMessageFields(
  packages: ProtoPackage[],
  pkg: ProtoPackage,
  inputType: string,
): ProtoField[] | undefined {
  const t = inputType.replace(/^\./, "");
  const candidates = pkg.name ? [t, `${pkg.name}.${t}`] : [t];
  const maps = packages.map((p) => getMessages(p));
  for (const c of candidates) {
    for (const p of packages) {
      const m = getMessages(p);
      if (m?.has(c)) return m.get(c);
    }
  }
  // Fallback: match on a trailing dotted segment (e.g. "Author.Contact" against "lib.v1.Author.Contact").
  for (const m of maps) {
    if (!m) continue;
    for (const [key, fields] of m) {
      if (key === t || key.endsWith(`.${t}`)) return fields;
    }
  }
  return undefined;
}

/**
 * Generate one HTTP-ish tool per RPC method. Names are the snake_case union of
 * service and method; every tool is a POST to `/<package>.<Service>/<Method>`
 * (or `/<Service>/<Method>` for files with no package). The input message's
 * direct fields become `body` params with the proto `type` strings passed
 * through untouched. Proto3 has no field presence, so all params are marked
 * `required: false`. `opts.describe` overrides the generated description.
 */
export function grpcTools(
  packages: ProtoPackage[],
  opts?: { describe?: (info: { packageName: string; serviceName: string; methodName: string; method: ProtoMethod }) => string },
): { name: string; description: string; method: string; path: string; params: { argName: string; location: "path" | "query" | "body"; required: boolean; type: string }[] }[] {
  const tools: GrpcTool[] = [];
  for (const pkg of packages) {
    for (const service of pkg.services) {
      for (const method of service.methods) {
        const streaming = method.clientStreaming && method.serverStreaming
          ? "bidi streaming"
          : method.clientStreaming
            ? "client streaming"
            : method.serverStreaming
              ? "server streaming"
              : undefined;
        const prefix = pkg.name ? `${pkg.name}.` : "";
        const path = `/${prefix}${service.name}/${method.name}`;
        const description = opts?.describe
          ? opts.describe({ packageName: pkg.name, serviceName: service.name, methodName: method.name, method })
          : `gRPC ${service.name}.${method.name} (package ${pkg.name || "default"})${streaming ? ` [${streaming}]` : ""}`;
        const fields = findMessageFields(packages, pkg, method.inputType) ?? [];
        tools.push({
          name: `${snakeCase(service.name)}_${snakeCase(method.name)}`,
          description,
          method: "POST",
          path,
          params: fields.map((f) => ({ argName: f.name, location: "body" as const, required: false, type: f.type })),
        });
      }
    }
  }
  return tools;
}

/** One line per tool: `<name> (gRPC <Service>.<Method>)`. */
export function formatGrpcTools(tools: ReturnType<typeof grpcTools>): string {
  return tools
    .map((tool) => {
      // path is `/<package>.<Service>/<Method>` or `/<Service>/<Method>` when no package exists.
      const m = tool.path.match(/^\/([^/]+)\/([^/]+)$/);
      let serviceMethod = tool.path.replace(/^\//, "");
      if (m) {
        const pkgAndService = m[1];
        const service = pkgAndService.slice(pkgAndService.lastIndexOf(".") + 1);
        serviceMethod = `${service}.${m[2]}`;
      }
      return `${tool.name} (gRPC ${serviceMethod})`;
    })
    .join("\n");
}
