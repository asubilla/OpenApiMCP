// Public library API for openapimcp.
export { loadDocument, parseDocument, parseSpec } from "./openapi.js";
export type { ParseOptions } from "./openapi.js";
export { buildServer } from "./server.js";
export type { BuildServerOptions } from "./server.js";
export { callApi, renderBody, clearCache } from "./http.js";
export type { RequestOptions, ApiResult } from "./http.js";
export { startGateway } from "./gateway.js";
export type { GatewayOptions } from "./gateway.js";
export { portalHtml } from "./portal.js";

// Security & policy
export { loadPolicy, toolAllowed, hostAllowed, checkRequest } from "./policy.js";
export type { Policy } from "./policy.js";
export { authenticateRequest, authMiddleware, createJwt, validateApiKey, verifyJwt, type AuthResult, type GatewayAuthConfig } from "./gateway-auth.js";
export { OAuth2TokenProvider, parseOAuth2Config, buildTokenRequest, type OAuth2Config, type TokenResponse } from "./oauth.js";
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

// Spec discovery
export { discoverSpec, isValidSpec, normalizeDomain, SPEC_PATHS } from "./discovery.js";

// Cost tracking
export { CostTracker, computeCost, estimateTokens, formatCost, lookupPrice, MODEL_PRICING } from "./cost.js";
export type { CostEntry, ModelPricing } from "./cost.js";

// Spec discovery & marketplace
export { searchApisGuru, getSpecFromApisGuru, formatMarketplaceList, type MarketplaceApi } from "./marketplace.js";

// Context budget
export { estimateTokens as estimateContextTokens, fitsInBudget, trimToBudget, budgetReport, type BudgetOptions } from "./context-budget.js";

// Feedback
export { FeedbackStore, createFeedbackStore, type FeedbackEntry } from "./feedback.js";

// Evaluation
export { evaluateToolSelection, formatEvalReport, type EvalCase, type EvalResult, type EvalReport } from "./eval.js";

// Agent memory
export { AgentMemory, createMemory, type MemoryEntry } from "./memory.js";

// Workflow engine
export { createWorkflowContext, resolveArgs, validateWorkflow, formatWorkflow, type Workflow, type WorkflowStep, type WorkflowContext } from "./workflow.js";

// Spec linting
export { lintSpec, formatLint, type LintIssue, type LintResult } from "./lint.js";

// MCP sampling
export { buildSamplingRequest, validateSamplingRequest, formatSamplingRequest, type SamplingMessage, type SamplingRequest } from "./sampling.js";

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
