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

// Advanced MCP protocol
export { buildElicitationRequest, validateElicitationResponse, formatElicitationRequest, type ElicitationField, type ElicitationRequest } from "./elicitation.js";
export { CancellationToken, CancellationRegistry, withCancellation } from "./cancellation.js";
export { ProgressTracker, formatProgress, createProgressTracker, type ProgressEvent } from "./progress.js";
export { isAsyncAccepted, findStatusUrl, parseJobResult, pollUntilDone, buildAsyncConfig, type AsyncJobConfig, type JobPollResult } from "./async-jobs.js";
export { boundary, buildMultipartBody, parseMultipartFields, type MultipartFile, type MultipartBody } from "./multipart.js";
export { buildDryRun, formatDryRun, redactHeaderValue, type DryRunResult, type DryRunOptions } from "./dry-run.js";
export { parseProfilesFile, resolveProfile, profileNames, formatProfile, type Profile, type ProfilesFile } from "./env-profiles.js";
export { extractRequestId, extractRetryAfter, redactSecrets, formatUpstreamError, type EnrichedError } from "./redact-errors.js";
export { KNOWN_KEYS, validateConfig, formatConfigIssues, type ConfigIssue } from "./config-validate.js";
export { applyMapping, parseMapping, formatMapping, type ResponseMapping } from "./response-map.js";
export { BudgetTracker, parseBudget, formatBudget, type BudgetConfig } from "./budget.js";
export { API_PRESETS, getPreset, presetNames, formatPresetList, type ApiPreset } from "./presets.js";
export { runBeforeRequest, runAfterResponse, validatePlugin, loadPlugin, type PluginHook, type HookRequest, type HookResponse } from "./plugin-hooks.js";
export { runBatch, formatBatchResults, formatBatchSummary, type BatchCall, type BatchResult } from "./batch.js";
export { buildProxyEnv, planProxyTls, formatProxyTls, type ProxyTlsOptions, type ProxyTlsPlan } from "./proxy-tls.js";
export { parseProto, listServices, grpcTools, formatGrpcTools, type ProtoField, type ProtoMethod, type ProtoService, type ProtoPackage } from "./grpc.js";
export { InMemoryEventStore, type EventStore, type EventId, type StreamId } from "./event-store.js";
export { UserRateLimiter, parseUserRateLimit, userKeyFromHeaders, formatUserRateLimit, type UserRateLimitConfig } from "./user-ratelimit.js";
export { responseSchemaForOperation, toolOutputSchema, collectResponseSchemas, formatOutputSchemaSummary } from "./spec-output.js";
export { EXAMPLE_CONFIGS, formatExamples, type ExampleConfig } from "./examples.js";
export { stableStringifyCycles, stringifyCycles } from "./json-safe.js";

// Wave C — more features
export { createCallHistory, formatCallList, replayArgs, type CallRecord } from "./call-history.js";
export { generateIdempotencyKey, IDEMPOTENCY_HEADER, isIdempotencyHeader, resolveIdempotencyKey, stripIdempotencyArg, withIdempotency } from "./idempotency.js";
export { bundleDocument, extractExternalRefs, rewriteRelativeRefs, type BundleOptions } from "./spec-bundle.js";
export { createPin, formatPin, hashDocument, pinFromSpec, verifyPin, type SpecPin } from "./spec-pin.js";
export { canonicalUri, normalizeHeaders, sha256Hex, signRequest, type SigV4Config, type SignableRequest } from "./sigv4.js";
export { annotateTools, extractDeprecation, filterDeprecated, formatDeprecationWarnings, isDeprecated, warnInactive, type DeprecationInfo } from "./deprecation.js";
export { formatOpConfig, opConfigFor, parseOpConfig, resolveRetries, resolveTimeoutMs, type OpConfig } from "./op-config.js";
export { buildSpecResources, formatResourcesSummary, listResourceUris, type McpResource } from "./mcp-resources.js";
export { checkGateway, formatProductionReport, isProductionOk, type ProductionCheck, type ProductionReport } from "./production-defaults.js";
export { formatTenant, parseTenantsFile, resolveTenant, tenantNames, type TenantConfig, type TenantsFile, type UserCreds } from "./tenant.js";

// Semantic routing
export { createSemanticRouter, cosineSimilarity, defaultEmbedding, type SemanticRouter, type EmbeddingFn } from "./semantic.js";

// Spec discovery & marketplace
export { searchApisGuru, getSpecFromApisGuru, formatMarketplaceList, type MarketplaceApi } from "./marketplace.js";

// Future-proof: A2A, serverless, streaming, semantic cache, federation, webhooks
export { buildAgentCard, createTask, updateTaskStatus, formatAgentCard, type AgentCard, type A2ATask } from "./a2a.js";
export { createFetchHandler, toLambdaHandler, toVercelHandler, type ServerlessRequest, type ServerlessResponse, type McpHandler } from "./serverless.js";
export { chunkText, formatSSE, parseSSE, mergeChunks, type StreamChunk } from "./streaming.js";
export { cosineSimilarity as cacheCosineSimilarity, textToVector, SemanticCache, type SemanticEntry } from "./semantic-cache.js";
export { namespaceTools, mergeServers, findTool, type FederatedServer } from "./federation.js";
export { signPayload, verifySignature, buildWebhookRequest, shouldTrigger, type WebhookConfig, type WebhookPayload } from "./webhook.js";

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
