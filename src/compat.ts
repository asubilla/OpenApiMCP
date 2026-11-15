export interface CompatEntry {
  operationId: string;
  method: string;
  path: string;
  status: "supported" | "partial" | "unsupported";
  reasons: string[];
}

export interface CompatReport {
  entries: CompatEntry[];
  summary: { supported: number; partial: number; unsupported: number };
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/** Analyze how well an OpenAPI document is supported by openapimcp. */
export function analyzeSpecCompat(spec: any): CompatReport {
  const paths = spec?.paths ?? {};
  const entries: CompatEntry[] = [];

  for (const [path, item] of Object.entries<any>(paths)) {
    const common = Array.isArray(item?.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;

      const reasons: string[] = [];

      // Body content types we can't pass through (we only forward JSON).
      const content = op.requestBody?.content;
      if (content) {
        for (const ct of Object.keys(content)) {
          if (!/json/i.test(ct)) reasons.push(`non-JSON body: ${ct}`);
        }
      }

      // Exotic schema constructs.
      const raw = JSON.stringify(op);
      for (const kw of ['"oneOf"', '"anyOf"', '"allOf"', '"not"', '"discriminator"', '"unevaluatedProperties"', '"x-nullable"']) {
        if (raw.includes(kw)) reasons.push(`exotic schema: ${kw.slice(1, -1)}`);
      }

      if (op.callbacks) reasons.push("callbacks");

      // Required header params (outside security schemes are awkward).
      for (const p of [...common, ...(op.parameters ?? [])]) {
        if (p?.in === "header" && p?.required) reasons.push(`required header: ${p.name}`);
        if (p?.in === "cookie") reasons.push("cookie parameter");
      }

      if (op.deprecated) reasons.push("deprecated operation");

      const status = reasons.some((r) => r.startsWith("non-JSON"))
        ? "unsupported"
        : reasons.length > 0
          ? "partial"
          : "supported";

      entries.push({
        operationId: op.operationId || `${method}_${path}`,
        method,
        path,
        status,
        reasons
      });
    }
  }

  const supported = entries.filter((e) => e.status === "supported").length;
  const partial = entries.filter((e) => e.status === "partial").length;
  const unsupported = entries.filter((e) => e.status === "unsupported").length;
  return { entries, summary: { supported, partial, unsupported } };
}

/** Human-readable compatibility report. */
export function formatCompatReport(report: CompatReport): string {
  const lines: string[] = [];
  const { supported, partial, unsupported } = report.summary;
  lines.push(`openapimcp compatibility report`);
  lines.push(`  supported:   ${supported}`);
  lines.push(`  partial:     ${partial}`);
  lines.push(`  unsupported: ${unsupported}`);
  lines.push(`  total:       ${report.entries.length}`);
  lines.push("");
  for (const e of report.entries) {
    const marker = e.status === "supported" ? "✓" : e.status === "partial" ? "~" : "✗";
    lines.push(`${marker} ${e.operationId} (${e.method.toUpperCase()} ${e.path})${e.reasons.length ? " — " + e.reasons.join(", ") : ""}`);
  }
  return lines.join("\n");
}
