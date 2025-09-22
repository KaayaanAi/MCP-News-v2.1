/**
 * Core TypeScript types and Zod schemas for MCP-NEWS-V3
 * All data validation schemas for tools, protocols, and services
 */

import { z } from 'zod';

// ===================================
// MCP Protocol Types
// ===================================

export const MCPRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const MCPResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
});

export const MCPErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  type: z.string(),
  details: z.unknown().optional(),
});

export type MCPRequest = z.infer<typeof MCPRequestSchema>;
export type MCPResponse = z.infer<typeof MCPResponseSchema>;
export type MCPError = z.infer<typeof MCPErrorSchema>;

// ===================================
// Tool Parameter & Response Schemas
// ===================================

// Tool 1: analyze_crypto_sentiment
export const AnalyzeCryptoSentimentParamsSchema = z.object({
  content: z.string().min(10, 'Content must be at least 10 characters'),
  source: z.string().min(1, 'Source is required'),
  coins: z.array(z.string().min(1)).min(1, 'At least one coin is required'),
  analysis_depth: z.enum(['basic', 'comprehensive']).default('basic'),
});

export const AnalyzeCryptoSentimentResponseSchema = z.object({
  impact: z.enum(['Positive', 'Negative', 'Neutral']),
  confidence_score: z.number().min(0).max(100),
  summary: z.string(),
  affected_coins: z.array(z.string()),
  metadata: z.object({
    timestamp: z.string().datetime(),
    source: z.string(),
  }),
});

// Tool 2: get_market_news
export const GetMarketNewsParamsSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  sources: z.array(z.string()).optional(),
  limit: z.number().min(1).max(50).default(10),
});

export const NewsArticleSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  source: z.string(),
  published_at: z.string().datetime(),
  summary: z.string().optional(),
  author: z.string().optional(),
  category: z.string().optional(),
});

export const GetMarketNewsResponseSchema = z.object({
  results: z.array(NewsArticleSchema),
  total_count: z.number(),
  processing_info: z.object({
    cache_hit: z.boolean(),
    response_time_ms: z.number(),
  }),
});

// Tool 3: validate_news_source
export const ValidateNewsSourceParamsSchema = z.object({
  source_url: z.string().min(1, 'Source URL is required'),
  validation_type: z.enum(['basic', 'comprehensive']).default('basic'),
});

export const ValidateNewsSourceResponseSchema = z.object({
  quality_score: z.number().min(0).max(100),
  issues_found: z.array(z.string()),
  source_status: z.object({
    available: z.boolean(),
    latency_ms: z.number(),
  }),
  recommendations: z.array(z.string()),
});

// Export parameter and response types
export type AnalyzeCryptoSentimentParams = z.infer<typeof AnalyzeCryptoSentimentParamsSchema>;
export type AnalyzeCryptoSentimentResponse = z.infer<typeof AnalyzeCryptoSentimentResponseSchema>;
export type GetMarketNewsParams = z.infer<typeof GetMarketNewsParamsSchema>;
export type GetMarketNewsResponse = z.infer<typeof GetMarketNewsResponseSchema>;
export type NewsArticle = z.infer<typeof NewsArticleSchema>;
export type ValidateNewsSourceParams = z.infer<typeof ValidateNewsSourceParamsSchema>;
export type ValidateNewsSourceResponse = z.infer<typeof ValidateNewsSourceResponseSchema>;

// ===================================
// MCP Tool Definition Types
// ===================================

export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

export type MCPTool = z.infer<typeof MCPToolSchema>;

// Tool handler interface for execution
export interface ToolHandler {
  definition: MCPTool;
  execute: (params: unknown, context: ToolExecutionContext) => Promise<unknown>;
}

// ===================================
// Server Configuration Types
// ===================================

export const ServerConfigSchema = z.object({
  // Core server settings
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Protocol ports
  httpPort: z.number().min(1024).max(65535).default(3000),
  websocketPort: z.number().min(1024).max(65535).default(3001),
  ssePort: z.number().min(1024).max(65535).default(3002),
  stdioEnabled: z.boolean().default(true),

  // Security
  apiKey: z.string().optional(),
  corsOrigins: z.array(z.string()).default(['http://localhost:3000']),
  rateLimitWindowMs: z.number().default(60000),
  rateLimitMaxRequests: z.number().default(100),

  // External services
  geminiApiKey: z.string().optional(),
  geminiModel: z.string().default('gemini-2.0-flash'),
  geminiMaxOutputTokens: z.number().default(1000),
  geminiTemperature: z.number().min(0).max(2).default(0.1),

  // Redis/Cache
  redisUrl: z.string().optional(),
  cacheTtlSeconds: z.number().default(3600),
  enableCache: z.boolean().default(true),

  // Development
  prettyLogs: z.boolean().default(false),
  mockExternalApis: z.boolean().default(false),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ===================================
// Service Response Types
// ===================================

export const ServiceResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  metadata: z.object({
    timestamp: z.string().datetime(),
    responseTimeMs: z.number(),
    cacheHit: z.boolean().optional(),
  }),
});

export type ServiceResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  metadata: {
    timestamp: string;
    responseTimeMs: number;
    cacheHit?: boolean;
  };
};

// ===================================
// Cache Service Types
// ===================================

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  isConnected(): boolean;
}

// ===================================
// OpenAI Service Types
// ===================================

export interface OpenAIService {
  analyzeSentiment: (request: {
    content: string;
    source: string;
    coins: string[];
    analysisDepth: 'basic' | 'comprehensive';
  }) => Promise<ServiceResponse<{
    impact: 'Positive' | 'Negative' | 'Neutral';
    confidence_score: number;
    summary: string;
    affected_coins: string[];
    reasoning: string;
  }>>;
  testConnection: () => Promise<ServiceResponse<{ status: string; model: string }>>;
  getHealthStatus: () => Promise<{
    status: 'connected' | 'disconnected' | 'error';
    details: Record<string, unknown>;
  }>;
  // Add the missing properties that GeminiService has
  client?: any;
  model?: any;
  config?: any;
  logger?: any;
}

// ===================================
// Tool Types
// ===================================

export interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  execute: (params: unknown) => Promise<unknown>;
}

// ===================================
// Rate Limiter Types
// ===================================

export interface RateLimitInfo {
  totalRequests: number;
  remainingRequests: number;
  resetTimeMs: number;
  isBlocked: boolean;
}

export interface RateLimiter {
  checkLimit(identifier: string): Promise<RateLimitInfo>;
  resetLimit(identifier: string): Promise<void>;
}

// ===================================
// Logger Types
// ===================================

export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): Logger;
}

// ===================================
// WebSocket Message Types
// ===================================

export const WebSocketMessageSchema = z.union([
  MCPRequestSchema,
  MCPResponseSchema,
  z.object({
    type: z.literal('ping'),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('pong'),
    timestamp: z.number(),
  }),
]);

export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;

// ===================================
// SSE Event Types
// ===================================

export const SSEEventSchema = z.object({
  id: z.string().optional(),
  event: z.string().optional(),
  data: z.string(),
  retry: z.number().optional(),
});

export type SSEEvent = z.infer<typeof SSEEventSchema>;

// ===================================
// Health Check Types
// ===================================

export const HealthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  timestamp: z.string().datetime(),
  uptime: z.number(),
  version: z.string(),
  protocols: z.object({
    stdio: z.boolean(),
    http: z.boolean(),
    websocket: z.boolean(),
    sse: z.boolean(),
  }),
  services: z.object({
    openai: z.enum(['connected', 'disconnected', 'error']),
    cache: z.enum(['connected', 'disconnected', 'error']),
  }),
  performance: z.object({
    memoryUsageMB: z.number(),
    cpuUsagePercent: z.number().optional(),
    cacheHitRatio: z.number().optional(),
    averageResponseTimeMs: z.number().optional(),
  }),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

// ===================================
// Error Types
// ===================================

export class MCPErrorException extends Error {
  constructor(
    public code: number,
    message: string,
    public type: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'MCPErrorException';
  }
}

export const ErrorCodes = {
  // Standard JSON-RPC errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // MCP-specific errors
  TOOL_NOT_FOUND: -32000,
  TOOL_EXECUTION_ERROR: -32001,
  AUTHENTICATION_ERROR: -32002,
  RATE_LIMIT_EXCEEDED: -32003,
  SERVICE_UNAVAILABLE: -32004,
  VALIDATION_ERROR: -32005,
} as const;

// ===================================
// Utility Types
// ===================================

export type ProtocolType = 'stdio' | 'http' | 'websocket' | 'sse';

export interface ProtocolHandler {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getType(): ProtocolType;
}

// ===================================
// Tool Execution Context
// ===================================

export interface ToolExecutionContext {
  requestId: string | number;
  protocol: ProtocolType;
  timestamp: number;
  userAgent?: string;
  ipAddress?: string;
  rateLimitInfo?: RateLimitInfo;
}

// ===================================
// Environment Variables Schema
// ===================================

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  HTTP_PORT: z.coerce.number().default(3000),
  WEBSOCKET_PORT: z.coerce.number().default(3001),
  SSE_PORT: z.coerce.number().default(3002),
  STDIO_ENABLED: z.coerce.boolean().default(true),
  API_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().default(1000),
  GEMINI_TEMPERATURE: z.coerce.number().default(0.1),
  REDIS_URL: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().default(3600),
  ENABLE_CACHE: z.coerce.boolean().default(true),
  PRETTY_LOGS: z.coerce.boolean().default(false),
  MOCK_EXTERNAL_APIS: z.coerce.boolean().default(false),
});

export type EnvConfig = z.infer<typeof EnvSchema>;