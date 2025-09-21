#!/usr/bin/env node

/**
 * MCP-NEWS-V2.1 - Simplified MCP Compliant Server
 * Focus on HTTP endpoint for n8n compatibility with strict JSON-RPC 2.0
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';
import { config } from 'dotenv';
import process from 'process';
import { z } from 'zod';
import { getLogger } from './utils/logger.js';
import type { Logger } from './types/index.js';
import { createCacheService } from './services/cache_service.js';
import { createOpenAIService } from './services/openai_service.js';
import { createAnalyzeCryptoSentimentTool } from './tools/analyze_crypto_sentiment.js';
import { createGetMarketNewsTool } from './tools/get_market_news.js';
import { createValidateNewsSourceTool } from './tools/validate_news_source.js';

// Environment configuration
const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  HTTP_PORT: z.coerce.number().default(4009),
  API_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default('*'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4'),
  OPENAI_MAX_COMPLETION_TOKENS: z.coerce.number().default(1000),
  OPENAI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
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

// Standard JSON-RPC error codes
const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  AUTHENTICATION_ERROR: -32000,
  TOOL_NOT_FOUND: -32001,
  TOOL_EXECUTION_ERROR: -32002,
} as const;

export class MCPNewsServer {
  private app: Application;
  private server: HttpServer | null = null;
  private logger: Logger;
  private config: z.infer<typeof EnvSchema>;
  private cache: import('./types/index.js').CacheService | null = null;
  private tools: Map<string, import('./types/index.js').Tool> = new Map();
  private isRunning = false;
  private startTime = 0;

  constructor() {
    config();
    this.config = EnvSchema.parse(process.env);

    this.logger = getLogger({
      level: this.config.LOG_LEVEL,
      pretty: this.config.PRETTY_LOGS,
      service: 'mcp-news-server'
    });

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();

    this.logger.info('MCP News Server initialized', {
      port: this.config.HTTP_PORT,
      nodeEnv: this.config.NODE_ENV,
    });
  }

  private setupMiddleware(): void {
    this.app.use(helmet({ contentSecurityPolicy: false }));

    const corsOrigins = this.config.CORS_ORIGINS === '*'
      ? true
      : this.config.CORS_ORIGINS.split(',').map(s => s.trim());

    this.app.use(cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    }));

    this.app.use(express.json({ limit: '10mb' }));
  }

  private setupRoutes(): void {
    this.app.get('/health', this.handleHealthCheck.bind(this));
    this.app.get('/metrics', this.handleMetrics.bind(this));
    this.app.post('/mcp', this.authenticateApiKey.bind(this), this.handleMcpRequest.bind(this));
    this.app.use(this.errorHandler.bind(this));
  }

  private authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
    if (!this.config.API_KEY) return next();

    const apiKey = req.get('Authorization')?.replace('Bearer ', '') ||
                   req.get('X-API-Key') ||
                   req.query.api_key as string;

    if (!apiKey || apiKey !== this.config.API_KEY) {
      res.status(401).json(this.createJsonRpcError(
        null, ErrorCodes.AUTHENTICATION_ERROR, 'Invalid or missing API key'
      ));
      return;
    }
    next();
  }

  private errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
    this.logger.error('HTTP request error', { error: err.message });
    res.status(500).json(this.createJsonRpcError(
      null, ErrorCodes.INTERNAL_ERROR, 'Internal server error'
    ));
  }

  private handleHealthCheck(_req: Request, res: Response): void {
    const uptime = this.isRunning ? Date.now() - this.startTime : 0;

    // Ensure CORS headers are set
    res.set({
      'Access-Control-Allow-Origin': this.config.CORS_ORIGINS === '*' ? '*' : this.config.CORS_ORIGINS,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    });

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime / 1000),
      version: '2.1.0',
      tools: { registered: this.tools.size, names: Array.from(this.tools.keys()) },
    });
  }

  private handleMetrics(_req: Request, res: Response): void {
    const uptime = this.isRunning ? Date.now() - this.startTime : 0;
    res.json({
      requests: 0,
      errors: 0,
      uptime: Math.floor(uptime / 1000),
      tools: this.tools.size,
    });
  }

  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    try {
      const validationResult = JsonRpcRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json(this.createJsonRpcError(
          null, ErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request format'
        ));
        return;
      }

      const { method, params, id } = validationResult.data;

      let result: unknown;
      switch (method) {
        case 'initialize':
          result = await this.handleInitialize();
          break;
        case 'tools/list':
          result = await this.handleToolsList();
          break;
        case 'tools/call':
          result = await this.handleToolsCall(params);
          break;
        default:
          res.status(400).json(this.createJsonRpcError(
            id, ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${method}`
          ));
          return;
      }

      res.json({ jsonrpc: '2.0', result, id });
    } catch (error) {
      this.logger.error('MCP request error', { error });
      res.status(500).json(this.createJsonRpcError(
        req.body?.id || null, ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Unknown error'
      ));
    }
  }

  private async handleInitialize(): Promise<object> {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
      serverInfo: { name: 'mcp-news-server', version: '2.1.0' },
    };
  }

  private async handleToolsList(): Promise<{ tools: unknown[] }> {
    const tools = Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    return { tools };
  }

  private async handleToolsCall(params?: unknown): Promise<unknown> {
    if (!params || typeof params !== 'object' || !('name' in params)) {
      throw new Error('Missing required parameter: name');
    }

    const { name, arguments: args } = params as { name: string; arguments?: unknown };
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    try {
      const result = await tool.execute(args || {});
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        }],
      };
    } catch (error) {
      throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private createJsonRpcError(id: string | number | null, code: number, message: string): object {
    return { jsonrpc: '2.0', error: { code, message }, id };
  }

  async initializeServices(): Promise<void> {
    this.logger.info('Initializing services');

    if (this.config.ENABLE_CACHE) {
      this.cache = await createCacheService(this.config.REDIS_URL, this.logger);
    }

    const openaiService = createOpenAIService({
      apiKey: this.config.OPENAI_API_KEY,
      model: this.config.OPENAI_MODEL,
      maxCompletionTokens: this.config.OPENAI_MAX_COMPLETION_TOKENS,
      temperature: this.config.OPENAI_TEMPERATURE,
      mockMode: this.config.MOCK_EXTERNAL_APIS || !this.config.OPENAI_API_KEY,
    }, this.logger);

    const healthCheck = await openaiService.testConnection();
    if (healthCheck.success) {
      this.logger.info('OpenAI service initialized', {
        status: healthCheck.data?.status,
        model: healthCheck.data?.model
      });
    } else {
      this.logger.warn('OpenAI service initialization warning', { error: healthCheck.error });
    }

    await this.initializeTools(openaiService);
  }

  private async initializeTools(openaiService: any): Promise<void> {
    const toolCache = this.cache || await createCacheService(undefined, this.logger) as import('./types/index.js').CacheService;

    const sentimentTool = createAnalyzeCryptoSentimentTool(
      openaiService, toolCache, this.logger,
      { cacheTtlSeconds: this.config.CACHE_TTL_SECONDS }
    );

    const newsTool = createGetMarketNewsTool(toolCache, this.logger, {
      cacheTtlSeconds: this.config.CACHE_TTL_SECONDS,
      mockMode: this.config.MOCK_EXTERNAL_APIS,
      newsApiKey: this.config.NEWS_API_KEY,
      cryptoPanicApiKey: this.config.CRYPTO_PANIC_API_KEY,
    });

    const validationTool = createValidateNewsSourceTool(toolCache, this.logger, {
      cacheTtlSeconds: this.config.CACHE_TTL_SECONDS,
      mockMode: this.config.MOCK_EXTERNAL_APIS,
    });

    // Register tools with complete MCP schemas
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
      execute: (params: unknown) => sentimentTool.execute(params, {
        requestId: Date.now(),
        protocol: 'http',
        timestamp: Date.now()
      }),
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
      execute: (params: unknown) => newsTool.execute(params, {
        requestId: Date.now(),
        protocol: 'http',
        timestamp: Date.now()
      }),
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
      execute: (params: unknown) => validationTool.execute(params, {
        requestId: Date.now(),
        protocol: 'http',
        timestamp: Date.now()
      }),
    });

    this.logger.info('MCP tools initialized', {
      toolCount: this.tools.size,
      toolNames: Array.from(this.tools.keys()),
    });
  }

  async start(): Promise<void> {
    try {
      await this.initializeServices();

      return new Promise((resolve, reject) => {
        this.server = createServer(this.app);
        this.server.listen(this.config.HTTP_PORT, () => {
          this.isRunning = true;
          this.startTime = Date.now();
          this.logger.info('MCP News Server started successfully', {
            port: this.config.HTTP_PORT,
            endpoints: ['/health', '/metrics', '/mcp'],
            toolCount: this.tools.size,
          });
          resolve();
        });

        this.server.on('error', reject);
      });
    } catch (error) {
      this.logger.error('Failed to start server', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.server || !this.isRunning) return;

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          this.logger.error('Error stopping server', error);
          reject(error);
        } else {
          this.isRunning = false;
          this.logger.info('MCP News Server stopped');
          resolve();
        }
      });
    });
  }
}

// Start the server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new MCPNewsServer();

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  server.start().catch((error) => {
    console.error('Fatal error starting server:', error);
    process.exit(1);
  });
}