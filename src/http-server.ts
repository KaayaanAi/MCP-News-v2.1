#!/usr/bin/env node

/**
 * HTTP MCP Server - n8n Compatible Implementation
 * Provides HTTP endpoint for MCP protocol with strict JSON-RPC 2.0 compliance
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';
import { config } from 'dotenv';
import process from 'process';
import { z } from 'zod';
import type { Logger, Tool, CacheService as _CacheService } from './types/index.js';
import { getLogger } from './utils/logger.js';
import { createCacheService } from './services/cache_service.js';
import { createOpenAIService } from './services/gemini_service.js';
import { createAnalyzeCryptoSentimentTool } from './tools/analyze_crypto_sentiment.js';
import { createGetMarketNewsTool } from './tools/get_market_news.js';
import { createValidateNewsSourceTool } from './tools/validate_news_source.js';

// Environment configuration schema
const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  HTTP_PORT: z.coerce.number().default(4009),
  API_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default('*'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash-exp'),
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().default(1000),
  GEMINI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  REDIS_URL: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
  ENABLE_CACHE: z.coerce.boolean().default(true),
  PRETTY_LOGS: z.coerce.boolean().default(true),
  MOCK_EXTERNAL_APIS: z.coerce.boolean().default(false),
  NEWS_API_KEY: z.string().optional(),
  CRYPTO_PANIC_API_KEY: z.string().optional(),
});

// JSON-RPC 2.0 schemas
const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
  id: z.union([z.string(), z.number(), z.null()]),
});

const _JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
  id: z.union([z.string(), z.number(), z.null()]),
});

// Standard JSON-RPC error codes
const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Server-defined errors
  AUTHENTICATION_ERROR: -32000,
  TOOL_NOT_FOUND: -32001,
  TOOL_EXECUTION_ERROR: -32002,
} as const;

interface HTTPToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  anyOf?: Array<{ required: string[] }>;
}

interface _MCPTool {
  name: string;
  description: string;
  inputSchema: HTTPToolSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export class HttpMCPServer {
  private app: Application;
  private server: HttpServer | null = null;
  private logger: Logger;
  private config: z.infer<typeof EnvSchema>;
  private cache: import('./types/index.js').CacheService | null = null;
  private tools: Map<string, Tool> = new Map();
  private isRunning = false;
  private startTime = 0;

  constructor() {
    // Load environment configuration
    config();
    this.config = EnvSchema.parse(process.env);

    // Initialize logger
    this.logger = getLogger({
      level: this.config.LOG_LEVEL,
      pretty: this.config.PRETTY_LOGS,
      service: 'http-mcp-server'
    });

    // Initialize Express app
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();

    this.logger.info('HTTP MCP Server initialized', {
      port: this.config.HTTP_PORT,
      nodeEnv: this.config.NODE_ENV,
      hasApiKey: !!this.config.API_KEY,
      corsOrigins: this.config.CORS_ORIGINS,
    });
  }

  /**
   * Get logger instance for external access
   */
  get loggerInstance(): Logger {
    return this.logger;
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable for API server
      crossOriginEmbedderPolicy: false,
    }));

    // CORS configuration
    const corsOrigins = this.config.CORS_ORIGINS === '*'
      ? true
      : this.config.CORS_ORIGINS.split(',').map(s => s.trim());

    this.app.use(cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: false,
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      this.logger.debug('HTTP request', {
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
      });
      next();
    });
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Health check endpoint (public)
    this.app.get('/health', this.handleHealthCheck.bind(this));

    // Metrics endpoint (public)
    this.app.get('/metrics', this.handleMetrics.bind(this));

    // MCP protocol endpoint (main endpoint for n8n)
    this.app.post('/mcp', this.authenticateApiKey.bind(this), this.handleMcpRequest.bind(this));

    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json(this.createJsonRpcError(null, ErrorCodes.METHOD_NOT_FOUND, 'Endpoint not found'));
    });

    // Error handling middleware
    this.app.use(this.errorHandler.bind(this));
  }

  /**
   * API key authentication middleware
   */
  private authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
    // Skip authentication if no API key is configured
    if (!this.config.API_KEY) {
      return next();
    }

    const apiKey = req.get('Authorization')?.replace('Bearer ', '') ||
                   req.get('X-API-Key') ||
                   req.query.api_key as string;

    if (!apiKey || apiKey !== this.config.API_KEY) {
      this.logger.warn('Authentication failed', {
        ip: req.ip,
        path: req.path,
        hasApiKey: !!apiKey,
      });

      res.status(401).json(this.createJsonRpcError(
        null,
        ErrorCodes.AUTHENTICATION_ERROR,
        'Invalid or missing API key'
      ));
      return;
    }

    next();
  }

  /**
   * Error handling middleware
   */
  private errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
    this.logger.error('HTTP request error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });

    res.status(500).json(this.createJsonRpcError(
      null,
      ErrorCodes.INTERNAL_ERROR,
      'Internal server error'
    ));
  }

  /**
   * Handle health check requests
   */
  private handleHealthCheck(_req: Request, res: Response): void {
    const uptime = this.isRunning ? Date.now() - this.startTime : 0;
    const memoryUsage = process.memoryUsage();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime / 1000),
      version: '2.1.0',
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      },
      tools: {
        registered: this.tools.size,
        names: Array.from(this.tools.keys()),
      },
    });
  }

  /**
   * Handle metrics requests
   */
  private handleMetrics(_req: Request, res: Response): void {
    const uptime = this.isRunning ? Date.now() - this.startTime : 0;

    res.json({
      requests: 0, // Could be implemented with metrics collection
      errors: 0,
      uptime: Math.floor(uptime / 1000),
      tools: this.tools.size,
    });
  }

  /**
   * Handle MCP protocol requests with strict JSON-RPC 2.0 compliance
   */
  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    try {
      // Validate JSON-RPC 2.0 request format
      const validationResult = JsonRpcRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json(this.createJsonRpcError(
          null,
          ErrorCodes.INVALID_REQUEST,
          'Invalid JSON-RPC 2.0 request format',
          validationResult.error.issues
        ));
        return;
      }

      const { method, params, id } = validationResult.data;

      this.logger.info('Handling MCP request', {
        method,
        id,
        hasParams: !!params,
      });

      let result: unknown;

      switch (method) {
        case 'initialize':
          result = await this.handleInitialize(params);
          break;

        case 'tools/list':
          result = await this.handleToolsList();
          break;

        case 'tools/call':
          result = await this.handleToolsCall(params);
          break;

        default:
          res.status(400).json(this.createJsonRpcError(
            id,
            ErrorCodes.METHOD_NOT_FOUND,
            `Unknown method: ${method}`
          ));
          return;
      }

      // Return successful JSON-RPC 2.0 response
      res.json({
        jsonrpc: '2.0',
        result,
        id,
      });

    } catch (error) {
      this.logger.error('MCP request handling error', {
        error: error instanceof Error ? error.message : String(error),
        requestBody: req.body,
      });

      res.status(500).json(this.createJsonRpcError(
        req.body?.id || null,
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Unknown error occurred'
      ));
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(_params?: unknown): Promise<unknown> {
    this.logger.info('Handling initialize request');

    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
      serverInfo: {
        name: 'mcp-news-server',
        version: '2.1.0',
      },
    };
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(): Promise<{ tools: unknown[] }> {
    this.logger.debug('Handling tools/list request');

    const tools = Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    return { tools };
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(params?: unknown): Promise<unknown> {
    if (!params || typeof params !== 'object' || !('name' in params)) {
      throw new Error('Missing required parameter: name');
    }

    const typedParams = params as { name: string; arguments?: Record<string, unknown> };
    const { name, arguments: args } = typedParams;
    this.logger.info('Handling tools/call request', {
      toolName: name,
      hasArguments: !!args,
    });

    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const result = await tool.execute(args || {});

      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Tool execution error', {
        toolName: name,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create JSON-RPC 2.0 error response
   */
  private createJsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): object {
    return {
      jsonrpc: '2.0',
      error: {
        code,
        message,
        ...(data ? { data } : {}),
      },
      id,
    };
  }

  /**
   * Initialize core services and tools
   */
  async initializeServices(): Promise<void> {
    this.logger.info('Initializing core services');

    // Initialize cache service
    if (this.config.ENABLE_CACHE) {
      this.cache = await createCacheService(this.config.REDIS_URL, this.logger);
      this.logger.info('Cache service initialized', {
        type: this.cache.isConnected() ? 'redis' : 'memory'
      });
    }

    // Initialize Gemini service
    const openaiService = createOpenAIService(
      {
        apiKey: this.config.GEMINI_API_KEY || '',
        model: this.config.GEMINI_MODEL,
        maxOutputTokens: this.config.GEMINI_MAX_OUTPUT_TOKENS,
        temperature: this.config.GEMINI_TEMPERATURE,
      },
      this.logger
    );

    // Test Gemini connection if key is provided
    if (this.config.GEMINI_API_KEY) {
      const healthCheck = await openaiService.testConnection();
      if (!healthCheck.success) {
        this.logger.warn('Gemini connection test failed', {
          error: healthCheck.error
        });
      } else {
        this.logger.info('Gemini connection verified');
      }
    }

    // Initialize tools
    await this.initializeTools(openaiService as any);
  }

  /**
   * Initialize and register MCP tools
   */
  private async initializeTools(openaiService: import('./types/index.js').OpenAIService): Promise<void> {
    this.logger.info('Initializing MCP tools');

    const toolCache = this.cache || await createCacheService(undefined, this.logger);

    // Initialize tools with the same schemas as the main MCP server
    const sentimentTool = createAnalyzeCryptoSentimentTool(
      openaiService as any,
      toolCache,
      this.logger,
      { cacheTtlSeconds: this.config.CACHE_TTL_SECONDS }
    );

    const newsTool = createGetMarketNewsTool(
      toolCache,
      this.logger,
      {
        cacheTtlSeconds: this.config.CACHE_TTL_SECONDS,
        mockMode: this.config.MOCK_EXTERNAL_APIS,
        newsApiKey: this.config.NEWS_API_KEY,
        cryptoPanicApiKey: this.config.CRYPTO_PANIC_API_KEY,
      }
    );

    const validationTool = createValidateNewsSourceTool(
      toolCache,
      this.logger,
      {
        cacheTtlSeconds: this.config.CACHE_TTL_SECONDS,
        mockMode: this.config.MOCK_EXTERNAL_APIS,
      }
    );

    // Register tools with complete schemas
    this.tools.set('analyze_crypto_sentiment', {
      name: 'analyze_crypto_sentiment',
      description: 'Analyze cryptocurrency market sentiment from news articles and social media posts using advanced AI sentiment analysis',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The news article content or social media post to analyze for crypto sentiment',
            minLength: 10,
            maxLength: 10000,
          },
          symbol: {
            type: 'string',
            description: 'Optional cryptocurrency symbol (e.g., BTC, ETH) to focus analysis on specific coin',
            pattern: '^[A-Z]{2,10}$',
          },
          includeScore: {
            type: 'boolean',
            description: 'Whether to include numerical sentiment score (-1 to 1) in response',
            default: true,
          },
        },
        required: ['content'],
        additionalProperties: false,
      },
      execute: async (args: unknown) => {
        const typedArgs = args as Record<string, unknown>;
        const context: import('./types/index.js').ToolExecutionContext = {
          requestId: Date.now().toString(),
          protocol: 'http',
          timestamp: Date.now()
        };
        return sentimentTool.execute(typedArgs, context);
      },
    });

    this.tools.set('get_market_news', {
      name: 'get_market_news',
      description: 'Retrieve latest cryptocurrency market news from multiple trusted sources with filtering and sorting options',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Cryptocurrency symbol to get news for (e.g., BTC, ETH, ADA)',
            pattern: '^[A-Z]{2,10}$',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of news articles to return',
            minimum: 1,
            maximum: 50,
            default: 10,
          },
          timeframe: {
            type: 'string',
            description: 'Time period for news articles',
            enum: ['1h', '24h', '7d', '30d'],
            default: '24h',
          },
          sortBy: {
            type: 'string',
            description: 'Sort news articles by specific criteria',
            enum: ['publishedAt', 'relevance', 'popularity'],
            default: 'publishedAt',
          },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (args: unknown) => {
        const typedArgs = args as Record<string, unknown>;
        const context: import('./types/index.js').ToolExecutionContext = {
          requestId: Date.now().toString(),
          protocol: 'http',
          timestamp: Date.now()
        };
        return newsTool.execute(typedArgs, context);
      },
    });

    this.tools.set('validate_news_source', {
      name: 'validate_news_source',
      description: 'Validate and analyze the credibility and reliability of cryptocurrency news sources and articles',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL of the news article or source to validate',
            format: 'uri',
            pattern: '^https?://.+',
          },
          domain: {
            type: 'string',
            description: 'Domain name of news source to validate (alternative to URL)',
            pattern: '^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
          },
          checkFactors: {
            type: 'array',
            description: 'Specific credibility factors to check',
            items: {
              type: 'string',
              enum: ['domain_authority', 'ssl_certificate', 'content_quality', 'bias_analysis', 'fact_check_rating'],
            },
            uniqueItems: true,
            maxItems: 5,
          },
        },
        required: [],
        additionalProperties: false,
        anyOf: [
          { required: ['url'] },
          { required: ['domain'] },
        ],
      },
      execute: async (args: unknown) => {
        const typedArgs = args as Record<string, unknown>;
        const context: import('./types/index.js').ToolExecutionContext = {
          requestId: Date.now().toString(),
          protocol: 'http',
          timestamp: Date.now()
        };
        return validationTool.execute(typedArgs, context);
      },
    });

    this.logger.info('MCP tools initialized', {
      toolCount: this.tools.size,
      toolNames: Array.from(this.tools.keys()),
    });
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    try {
      // Initialize services first
      await this.initializeServices();

      // Start HTTP server
      return new Promise((resolve, reject) => {
        this.server = createServer(this.app);

        this.server.listen(this.config.HTTP_PORT, () => {
          this.isRunning = true;
          this.startTime = Date.now();

          this.logger.info('HTTP MCP Server started successfully', {
            port: this.config.HTTP_PORT,
            endpoints: ['/health', '/metrics', '/mcp'],
            toolCount: this.tools.size,
            pid: process.pid,
          });

          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.logger.error('HTTP server error', error);
          reject(error);
        });
      });

    } catch (error) {
      this.logger.error('Failed to start HTTP MCP server', error);
      throw error;
    }
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.server || !this.isRunning) {
      return;
    }

    this.logger.info('Stopping HTTP MCP Server');

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          this.logger.error('Error stopping HTTP server', error);
          reject(error);
        } else {
          this.isRunning = false;
          this.logger.info('HTTP MCP Server stopped successfully');
          resolve();
        }
      });
    });
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new HttpMCPServer();

  // Setup graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  // Start the server
  server.start().catch((error) => {
    // Use server's logger if available, fallback to console for fatal startup errors
    try {
      server.loggerInstance?.error('Fatal error starting HTTP MCP server', error);
    } catch {
      console.error('Fatal error starting HTTP MCP server:', error);
    }
    process.exit(1);
  });
}

// Export handled by class declaration