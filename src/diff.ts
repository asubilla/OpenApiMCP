/**
 * Structural diff between two OpenAPI documents, focused on `paths` and the
 * operations declared under them. Changes are split into breaking (safe to
 * reject) and non-breaking (safe to apply) buckets, each deterministically
 * ordered so tooling output is stable.
 */

export interface Change {
  kind: string;
  method?: string;
  path?: string;
  detail: string;
}

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

interface PathEntry {
  item: any;
  ops: Map<string, any>;
}

/** Compare two specs and bucket their differences. */
export function diffSpecs(a: any, b: any): { breaking: Change[]; nonBreaking: Change[] } {
  const breaking: Change[] = [];
  const nonBreaking: Change[] = [];

  const aPaths = collectPaths(a);
  const bPaths = collectPaths(b);

  const allPaths = [...new Set([...aPaths.keys(), ...bPaths.keys()])].sort();

  for (const path of allPaths) {
    const aEntry = aPaths.get(path);
    const bEntry = bPaths.get(path);

    if (aEntry && !bEntry) {
      breaking.push({ kind: "path-removed", path, detail: `path ${path} was removed` });
      continue;
    }
    if (!aEntry && bEntry) {
      nonBreaking.push({ kind: "path-added", path, detail: `path ${path} was added` });
      continue;
    }
    if (!aEntry || !bEntry) continue;

    const methods = [...new Set([...aEntry.ops.keys(), ...bEntry.ops.keys()])].sort();
    for (const method of methods) {
      const aOp = aEntry.ops.get(method);
      const bOp = bEntry.ops.get(method);
      if (aOp && !bOp) {
        breaking.push({ kind: "operation-removed", method, path, detail: `${method.toUpperCase()} ${path} was removed` });
        continue;
      }
      if (!aOp && bOp) {
        nonBreaking.push({ kind: "operation-added", method, path, detail: `${method.toUpperCase()} ${path} was added` });
        continue;
      }
      if (!aOp || !bOp) continue;
      diffOperation(path, method, aEntry, bEntry, aOp, bOp, breaking, nonBreaking);
    }
  }

  breaking.sort(compareChanges);
  nonBreaking.sort(compareChanges);
  return { breaking, nonBreaking };
}

function diffOperation(
  path: string,
  method: string,
  aEntry: PathEntry,
  bEntry: PathEntry,
  aOp: any,
  bOp: any,
  breaking: Change[],
  nonBreaking: Change[]
): void {
  let structural = false;
  const label = `${method.toUpperCase()} ${path}`;

  const aParams = paramMap(aEntry.item, aOp);
  const bParams = paramMap(bEntry.item, bOp);

  for (const [key, bParam] of bParams) {
    if (aParams.has(key)) continue;
    const required = bParam.in === "path" || bParam.required === true;
    const change: Change = {
      kind: required ? "parameter-added-required" : "parameter-added-optional",
      method,
      path,
      detail: `${required ? "required" : "optional"} ${bParam.in ?? "query"} parameter "${bParam.name}" added to ${label}`
    };
    (required ? breaking : nonBreaking).push(change);
    structural = true;
  }

  for (const [key, aParam] of aParams) {
    const bParam = bParams.get(key);
    if (!bParam) continue;
    const aSchema = schemaOf(aParam);
    const bSchema = schemaOf(bParam);

    const aType = schemaType(aSchema);
    const bType = schemaType(bSchema);
    if (aType !== bType) {
      breaking.push({
        kind: "parameter-type-changed",
        method,
        path,
        detail: `type of ${key} changed from ${aType ?? "any"} to ${bType ?? "any"} in ${label}`
      });
      structural = true;
      continue;
    }

    const aEnum = Array.isArray(aSchema?.enum) ? aSchema.enum : undefined;
    const bEnum = Array.isArray(bSchema?.enum) ? bSchema.enum : undefined;
    if (bEnum && (!aEnum || isStrictSubset(bEnum, aEnum))) {
      breaking.push({
        kind: "parameter-enum-narrowed",
        method,
        path,
        detail: `enum of ${key} narrowed in ${label}`
      });
      structural = true;
    }
  }

  const aResp = responsesOf(aOp);
  const bResp = responsesOf(bOp);
  for (const code of Object.keys(aResp)) {
    if (!(code in bResp)) {
      breaking.push({ kind: "response-removed", method, path, detail: `response ${code} removed from ${label}` });
      structural = true;
    }
  }
  for (const code of Object.keys(bResp)) {
    if (!(code in aResp)) {
      nonBreaking.push({ kind: "response-added", method, path, detail: `response ${code} added to ${label}` });
      structural = true;
    }
  }

  if (!structural && textChanged(aOp, bOp)) {
    nonBreaking.push({ kind: "description-changed", method, path, detail: `description changed for ${label}` });
  }
}

function collectPaths(spec: any): Map<string, PathEntry> {
  const out = new Map<string, PathEntry>();
  const paths = spec && typeof spec === "object" ? spec.paths : undefined;
  if (!paths || typeof paths !== "object") return out;

  for (const path of Object.keys(paths)) {
    const item = (paths as Record<string, any>)[path];
    const ops = new Map<string, any>();
    if (item && typeof item === "object") {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (op && typeof op === "object") ops.set(method, op);
      }
    }
    out.set(path, { item, ops });
  }
  return out;
}

function paramMap(item: any, op: any): Map<string, any> {
  const out = new Map<string, any>();
  const add = (list: any): void => {
    if (!Array.isArray(list)) return;
    for (const param of list) {
      if (!param || typeof param !== "object" || !param.name) continue;
      out.set(`${param.in ?? "query"}:${param.name}`, param);
    }
  };
  add(item?.parameters);
  add(op?.parameters);
  return out;
}

function responsesOf(op: any): Record<string, any> {
  return op && typeof op.responses === "object" && op.responses !== null ? op.responses : {};
}

/** Swagger 2.0 puts type info directly on the parameter; OpenAPI 3.x nests it under `schema`. */
function schemaOf(param: any): any {
  return param?.schema ?? param;
}

function schemaType(schema: any): string | undefined {
  const type = schema?.type;
  if (Array.isArray(type)) return [...type].sort().join("|");
  return typeof type === "string" ? type : undefined;
}

function isStrictSubset(sub: any[], superSet: any[]): boolean {
  const big = new Set(superSet.map((value) => JSON.stringify(value)));
  const small = new Set(sub.map((value) => JSON.stringify(value)));
  if (small.size >= big.size) return false;
  for (const value of small) if (!big.has(value)) return false;
  return true;
}

function textChanged(a: any, b: any): boolean {
  return (a?.summary ?? "") !== (b?.summary ?? "") || (a?.description ?? "") !== (b?.description ?? "");
}

function compareChanges(x: Change, y: Change): number {
  const kx = changeKey(x);
  const ky = changeKey(y);
  return kx < ky ? -1 : kx > ky ? 1 : 0;
}

function changeKey(change: Change): string {
  return [change.path ?? "", change.method ?? "", change.kind, change.detail].join("\u0000");
}
