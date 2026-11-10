// Public library API for openapimcp.
export { loadDocument, parseDocument, parseSpec } from "./openapi.js";
export type { ParseOptions } from "./openapi.js";
export { buildServer } from "./server.js";
export type { BuildServerOptions } from "./server.js";
export { callApi, renderBody, clearCache } from "./http.js";
export type { RequestOptions, ApiResult } from "./http.js";
export { startGateway } from "./gateway.js";
export type { GatewayOptions } from "./gateway.js";

// Security & policy
export { loadPolicy, toolAllowed, hostAllowed, checkRequest } from "./policy.js";
export type { Policy } from "./policy.js";
export { redact, redactText, type RedactOptions } from "./redact.js";
export { stripControlChars, wrapUntrusted, isUntrusted } from "./sanitize.js";
export { summarizeJson, type SummarizeOptions } from "./summarize.js";
export { validateAgainstSchema } from "./validate.js";

// Observability
export { createLogger, type Logger, type LogLevel, type LoggerOptions } from "./logger.js";
export { AuditLog, createAuditLog, type AuditEntry } from "./audit.js";
export { Metrics, healthPayload } from "./metrics.js";
export { recordToolCall } from "./telemetry.js";

// Reliability
export { RateLimiter, CircuitBreaker } from "./ratelimit.js";
export { DiskCache, cacheKey, etagOf } from "./cache.js";
export { exampleFromSchema, mockResponse } from "./mock.js";

// Auth
export { resolveToolSecurity, schemeAuth, substituteEnv, envKey } from "./auth.js";

// Introspection & tooling
export { rankTools, describeProgressiveTools, TOOL_SEARCH_NAME, TOOL_CALL_NAME } from "./toolsearch.js";
export { toOutputSchema, structuredContent } from "./output.js";
export { ToolKit, formatToolList, formatToolDetail } from "./toolkit.js";

// Spec utilities
export { diffSpecs, type Change } from "./diff.js";
export { applyOverlay } from "./overlay.js";
export { postmanToOperations, type PostmanOperation } from "./postman.js";
export { generateClient, sanitizeMethodName } from "./clientgen.js";
export { generateSmokeTests, sampleArgs } from "./testing.js";
export { jsonSchemaToZod } from "./schema.js";
export { filterFields } from "./filter.js";

// Config
export { loadConfig, mergeConfig, type Config } from "./config.js";
export { parseDotenv, applyDotenv } from "./env.js";
export { completionsFor } from "./completions.js";

// Project generation
export { generateProject } from "./generate.js";
export type { GenerateInput, GenerateSpec } from "./generate.js";
export { serveStdio } from "@modelcontextprotocol/server/stdio";
export type { ParsedApi, ToolDef, Param, ParamLocation, ToolAnnotations, ToolSecurity } from "./types.js";
