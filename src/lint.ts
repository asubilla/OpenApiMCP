/**
 * Lightweight, dependency-free linter for OpenAPI/Swagger documents.
 *
 * Returns a list of issues with severity, a 0-100 score, and a summary.
 */

export interface LintIssue {
  severity: "error" | "warning" | "info";
  rule: string;
  path: string;
  message: string;
}

export interface LintResult {
  issues: LintIssue[];
  score: number;
  summary: { errors: number; warnings: number; infos: number };
}

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

function addIssue(
  issues: LintIssue[],
  severity: LintIssue["severity"],
  rule: string,
  path: string,
  message: string
): void {
  issues.push({ severity, rule, path, message });
}

function isPlainObject(value: any): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: any): string {
  return typeof value === "string" ? value : "";
}

function hasText(value: any): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function is2xx(code: string): boolean {
  return /^2\d\d$/i.test(code) || /^2xx$/i.test(code);
}

/** Main lint entry point. */
export function lintSpec(spec: any): LintResult {
  const issues: LintIssue[] = [];

  const info = isPlainObject(spec?.info) ? spec.info : undefined;

  // 1. Missing info.title or info.version
  if (!hasText(info?.title)) {
    addIssue(issues, "error", "missing-info-title", "info.title", "Missing info.title");
  }
  if (!hasText(info?.version)) {
    addIssue(issues, "error", "missing-info-version", "info.version", "Missing info.version");
  }

  // 8. No paths defined
  const paths = isPlainObject(spec?.paths) ? spec.paths : undefined;
  const pathKeys = paths ? Object.keys(paths) : [];
  if (!paths || pathKeys.length === 0) {
    addIssue(issues, "error", "no-paths", "paths", "No paths defined");
  }

  // 2. No servers defined
  const servers = spec?.servers;
  const hasServers = Array.isArray(servers) && servers.length > 0;
  const hasHost = typeof spec?.host === "string" && spec.host.trim().length > 0;
  if (!hasServers && !hasHost) {
    addIssue(issues, "warning", "no-servers", "servers", "No servers defined");
  }

  // Operation-level rules
  const seenOperationIds = new Map<string, string>();

  if (paths) {
    for (const pathKey of pathKeys) {
      const pathItem = paths[pathKey];
      if (!isPlainObject(pathItem)) continue;

      const commonParams: any[] = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

      for (const method of Object.keys(pathItem)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) continue;
        const op = pathItem[method];
        if (!isPlainObject(op)) continue;

        const opPath = `paths.${pathKey}.${method.toLowerCase()}`;

        // 3. Operation missing summary and description
        if (!hasText(op.summary) && !hasText(op.description)) {
          addIssue(
            issues,
            "warning",
            "missing-summary-and-description",
            opPath,
            "Operation missing summary and description"
          );
        }

        // 4. Operation missing operationId
        if (!hasText(op.operationId)) {
          addIssue(issues, "warning", "missing-operation-id", opPath, "Operation missing operationId");
        } else {
          // 9. Duplicate operationId
          const id = String(op.operationId).trim();
          if (seenOperationIds.has(id)) {
            addIssue(
              issues,
              "error",
              "duplicate-operation-id",
              opPath,
              `Duplicate operationId "${id}" (first seen at ${seenOperationIds.get(id)})`
            );
          } else {
            seenOperationIds.set(id, opPath);
          }
        }

        // Parameters: combine path-level and operation-level, dedup by in+name
        const paramList: any[] = [];
        const seenParams = new Set<string>();
        const addParams = (list: any): void => {
          if (!Array.isArray(list)) return;
          for (const p of list) {
            if (!isPlainObject(p)) continue;
            const key = `${p.in ?? "query"}:${p.name ?? ""}`;
            if (seenParams.has(key)) continue;
            seenParams.add(key);
            paramList.push(p);
          }
        };
        addParams(commonParams);
        addParams(op.parameters);

        for (let i = 0; i < paramList.length; i++) {
          const param = paramList[i];
          if (!hasText(param.description)) {
            addIssue(
              issues,
              "info",
              "missing-parameter-description",
              `${opPath}.parameters`,
              `Parameter "${param.name ?? i}" missing description`
            );
          }
        }

        // Responses
        const responses = isPlainObject(op.responses) ? op.responses : {};
        const responseCodes = Object.keys(responses);
        let has2xx = false;
        for (const code of responseCodes) {
          if (is2xx(code)) has2xx = true;
          const resp = responses[code];
          if (!isPlainObject(resp)) continue;
          // $ref responses have no description; treat as missing? Usually deref. Skip refs.
          if (resp.$ref) continue;
          if (!hasText(resp.description)) {
            addIssue(
              issues,
              "info",
              "missing-response-description",
              `${opPath}.responses.${code}`,
              `Response ${code} missing description`
            );
          }
        }
        if (responseCodes.length > 0 && !has2xx) {
          addIssue(
            issues,
            "warning",
            "missing-2xx-response",
            `${opPath}.responses`,
            "Missing 2xx response"
          );
        }
        // If no responses at all? Missing 2xx warning? Rule says missing 2xx response. If no responses, arguably missing. Add warning.
        if (responseCodes.length === 0) {
          addIssue(
            issues,
            "warning",
            "missing-2xx-response",
            `${opPath}.responses`,
            "Missing 2xx response"
          );
        }
      }
    }
  }

  // Schema property missing type: recursive walk
  walkSchemas(spec, "", issues);

  // Score
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  const raw = 100 - (errors * 10 + warnings * 3 + infos * 1);
  const score = Math.max(0, raw);

  return { issues, score, summary: { errors, warnings, infos } };
}

function walkSchemas(node: any, path: string, issues: LintIssue[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkSchemas(item, `${path}[${index}]`, issues));
    return;
  }

  const skipKeys = new Set(["example", "examples", "default"]);

  // If this node is a schema with properties, check each property.
  if (isPlainObject(node.properties)) {
    for (const [key, prop] of Object.entries<any>(node.properties)) {
      const propPath = path ? `${path}.properties.${key}` : `properties.${key}`;
      if (isPlainObject(prop) && missingType(prop)) {
        addIssue(
          issues,
          "warning",
          "missing-schema-property-type",
          propPath,
          `Schema property "${key}" missing type`
        );
      }
      // recurse into property schema
      walkSchemas(prop, propPath, issues);
    }
  }

  // additionalProperties
  if (isPlainObject(node.additionalProperties)) {
    const apPath = path ? `${path}.additionalProperties` : "additionalProperties";
    walkSchemas(node.additionalProperties, apPath, issues);
  }

  // items
  if (isPlainObject(node.items) || Array.isArray(node.items)) {
    const itemsPath = path ? `${path}.items` : "items";
    walkSchemas(node.items, itemsPath, issues);
  }

  // allOf/anyOf/oneOf
  for (const combo of ["allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(node[combo])) {
      node[combo].forEach((s: any, index: number) => {
        walkSchemas(s, `${path}.${combo}[${index}]`, issues);
      });
    }
  }

  // Traverse other keys to find nested schemas in containers.
  for (const [key, value] of Object.entries<any>(node)) {
    if (skipKeys.has(key)) continue;
    if (key === "properties" || key === "items" || key === "additionalProperties") continue;
    if (key === "allOf" || key === "anyOf" || key === "oneOf") continue;
    const childPath = path ? `${path}.${key}` : key;
    walkSchemas(value, childPath, issues);
  }
}

function missingType(prop: any): boolean {
  if (!isPlainObject(prop)) return false;
  if (prop.$ref) return false;
  if (typeof prop.type === "string") return false;
  if (Array.isArray(prop.type)) return false;
  if (prop.allOf || prop.anyOf || prop.oneOf) return false;
  return true;
}

export function formatLint(result: LintResult): string {
  const lines: string[] = [];
  lines.push(`Lint Score: ${result.score}/100`);
  lines.push("");
  lines.push(`Summary: ${result.summary.errors} error(s), ${result.summary.warnings} warning(s), ${result.summary.infos} info(s)`);
  lines.push("");

  const groups: Array<{ severity: LintIssue["severity"]; label: string }> = [
    { severity: "error", label: "Errors" },
    { severity: "warning", label: "Warnings" },
    { severity: "info", label: "Info" },
  ];

  for (const group of groups) {
    const items = result.issues.filter((i) => i.severity === group.severity);
    lines.push(`${group.label} (${items.length}):`);
    if (items.length === 0) {
      lines.push("  (none)");
    } else {
      for (const issue of items) {
        lines.push(`  - [${issue.rule}] ${issue.path}: ${issue.message}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

