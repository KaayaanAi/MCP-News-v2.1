#!/usr/bin/env node

/**
 * MCP-NEWS-V3 - Universal MCP Server
 * Main entry point that initializes and runs all protocols simultaneously
 */

import { config } from 'dotenv';
import process from 'process';
import type {
  ServerConfig,
  Logger,
  CacheService,
  RateLimiter,
  ProtocolHandler,
  HealthCheckResponse,
  ToolHandler
} from './types/index.js';
import { EnvSchema } from './types/index.js';
import { getLogger } from './utils/logger.js';
import { createCacheService } from './services/cache_service.js';
import { initializeRateLimiter } from './services/rate_limiter.js';
import { createOpenAIService } from './services/openai_service.js';
import { createAnalyzeCryptoSentimentTool } from './tools/analyze_crypto_sentiment.js';
import { createGetMarketNewsTool } from './tools/get_market_news.js';
import { createValidateNewsSourceTool } from './tools/validate_news_source.js';
import { createStdioHandler } from './protocols/stdio.js';
import { createHttpHandler } from './protocols/http.js';
import { createWebSocketHandler } from './protocols/websocket.js';
import { createSSEHandler } from './protocols/sse.js';

/**
 * Universal MCP Server class
 */
class UniversalMCPServer {
  private logger: Logger;
  private config: ServerConfig;
  private cache: CacheService | null = null;
  private rateLimiter: RateLimiter | null = null;
  private protocolHandlers: Map<string, ProtocolHandler> = new Map();
  private isRunning = false;
  private startTime = 0;

  constructor() {
    // Load environment configuration
    config();

    // Parse and validate environment variables
    const env = EnvSchema.parse(process.env);

    this.config = {
      nodeEnv: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
      httpPort: env.HTTP_PORT,
      websocketPort: env.WEBSOCKET_PORT,
      ssePort: env.SSE_PORT,
      stdioEnabled: env.STDIO_ENABLED,
      apiKey: env.API_KEY,
      corsOrigins: env.CORS_ORIGINS.split(',').map(s => s.trim()),
      rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
      rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
      openaiApiKey: env.OPENAI_API_KEY,
      openaiModel: env.OPENAI_MODEL,
      openaiMaxCompletionTokens: env.OPENAI_MAX_COMPLETION_TOKENS,
      openaiTemperature: env.OPENAI_TEMPERATURE,
      redisUrl: env.REDIS_URL,
      cacheTtlSeconds: env.CACHE_TTL_SECONDS,
      enableCache: env.ENABLE_CACHE,
      prettyLogs: env.PRETTY_LOGS,
      mockExternalApis: env.MOCK_EXTERNAL_APIS,
    };

    // Initialize logger
    this.logger = getLogger({
      level: this.config.logLevel,
      pretty: this.config.prettyLogs,
      service: 'mcp-news-v3'
    });

    this.logger.info('Universal MCP Server initializing', {
      nodeEnv: this.config.nodeEnv,
      protocols: this.getEnabledProtocols(),
      hasOpenAI: !!this.config.openaiApiKey,
      hasRedis: !!this.config.redisUrl,
    });
  }

  /**
   * Start the server with all enabled protocols
   */
  async start(): Promise<void> {
    try {
      this.startTime = Date.now();

      // Initialize core services
      await this.initializeServices();

      // Initialize tools
      await this.initializeTools();

      // Start protocol handlers
      await this.startProtocols();

      this.isRunning = true;

      this.logger.info('Universal MCP Server started successfully', {
        protocols: Array.from(this.protocolHandlers.keys()),
        uptime: 0,
        pid: process.pid,
      });

      // Setup graceful shutdown
      this.setupGracefulShutdown();

    } catch (error) {
      this.logger.error('Failed to start server', error);
      await this.stop();
      process.exit(1);
    }
  }

  /**
   * Stop the server and all protocols
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Universal MCP Server');

    try {
      // Stop all protocol handlers
      const stopPromises = Array.from(this.protocolHandlers.values()).map(handler =>
        handler.stop().catch(error =>
          this.logger.error(`Error stopping ${handler.getType()} protocol`, error)
        )
      );

      await Promise.all(stopPromises);

      // Cleanup services
      // Note: Cache service cleanup would go here if needed

      this.isRunning = false;
      const uptime = Date.now() - this.startTime;

      this.logger.info('Universal MCP Server stopped', {
        uptime: Math.floor(uptime / 1000),
      });

    } catch (error) {
      this.logger.error('Error during server shutdown', error);
    }
  }

  /**
   * Initialize core services (cache, rate limiter, etc.)
   */
  private async initializeServices(): Promise<void> {
    this.logger.info('Initializing core services');

    // Initialize cache service
    if (this.config.enableCache) {
      this.cache = await createCacheService(this.config.redisUrl, this.logger);
      this.logger.info('Cache service initialized', {
        type: this.cache.isConnected() ? 'redis' : 'memory'
      });
    }

    // Initialize rate limiter
    if (this.cache) {
      this.rateLimiter = initializeRateLimiter(
        this.cache,
        this.logger,
        {
          windowMs: this.config.rateLimitWindowMs,
          maxRequests: this.config.rateLimitMaxRequests,
        }
      );
      this.logger.info('Rate limiter initialized');
    }
  }

  /**
   * Initialize and register MCP tools
   */
  private async initializeTools(): Promise<void> {
    this.logger.info('Initializing MCP tools');

    if (!this.config.openaiApiKey) {
      this.logger.warn('OpenAI API key not provided - tools will have limited functionality');
    }

    // Initialize OpenAI service
    const openaiService = createOpenAIService(
      {
        apiKey: this.config.openaiApiKey || '',
        model: this.config.openaiModel,
        maxCompletionTokens: this.config.openaiMaxCompletionTokens,
        temperature: this.config.openaiTemperature,
      },
      this.logger
    );

    // Test OpenAI connection if key is provided
    if (this.config.openaiApiKey) {
      const healthCheck = await openaiService.testConnection();
      if (!healthCheck.success) {
        this.logger.warn('OpenAI connection test failed', {
          error: healthCheck.error
        });
      } else {
        this.logger.info('OpenAI connection verified');
      }
    }

    // Initialize tools
    const tools = [
      {
        name: 'analyze_crypto_sentiment',
        handler: createAnalyzeCryptoSentimentTool(
          openaiService,
          this.cache || await createCacheService(undefined, this.logger),
          this.logger,
          { cacheTtlSeconds: this.config.cacheTtlSeconds }
        )
      },
      {
        name: 'get_market_news',
        handler: createGetMarketNewsTool(
          this.cache || await createCacheService(undefined, this.logger),
          this.logger,
          {
            cacheTtlSeconds: this.config.cacheTtlSeconds,
            mockMode: this.config.mockExternalApis,
            newsApiKey: process.env.NEWS_API_KEY,
            cryptoPanicApiKey: process.env.CRYPTO_PANIC_API_KEY,
          }
        )
      },
      {
        name: 'validate_news_source',
        handler: createValidateNewsSourceTool(
          this.cache || await createCacheService(undefined, this.logger),
          this.logger,
          {
            cacheTtlSeconds: this.config.cacheTtlSeconds,
            mockMode: this.config.mockExternalApis,
          }
        )
      }
    ];

    // Register tools with all protocol handlers
    this.tools = new Map(tools.map(tool => [
      tool.name,
      {
        definition: tool.handler.getDefinition(),
        execute: tool.handler.execute.bind(tool.handler)
      }
    ]));

    this.logger.info('MCP tools initialized', {
      toolCount: tools.length,
      toolNames: tools.map(t => t.name)
    });
  }

  private tools = new Map<string, ToolHandler>();

  /**
   * Start all enabled protocol handlers
   */
  private async startProtocols(): Promise<void> {
    this.logger.info('Starting protocol handlers');

    const protocolPromises: Promise<void>[] = [];

    // STDIO Protocol (if enabled)
    if (this.config.stdioEnabled) {
      const stdioHandler = createStdioHandler(this.logger);

      // Register tools
      this.tools.forEach((toolHandler, name) => {
        stdioHandler.registerTool(name, toolHandler);
      });

      protocolPromises.push(
        stdioHandler.start().then(() => {
          this.protocolHandlers.set('stdio', stdioHandler);
          this.logger.info('STDIO protocol started');
        })
      );
    }

    // HTTP Protocol (if port is set)
    if (this.config.httpPort > 0) {
      const httpHandler = createHttpHandler(
        {
          port: this.config.httpPort,
          corsOrigins: this.config.corsOrigins,
          apiKey: this.config.apiKey,
          rateLimiter: this.rateLimiter || undefined,
        },
        this.logger
      );

      // Register tools
      this.tools.forEach((toolHandler, name) => {
        httpHandler.registerTool(name, toolHandler);
      });

      protocolPromises.push(
        httpHandler.start().then(() => {
          this.protocolHandlers.set('http', httpHandler);
          this.logger.info('HTTP protocol started', { port: this.config.httpPort });
        })
      );
    }

    // WebSocket Protocol (if port is set)
    if (this.config.websocketPort > 0) {
      const wsHandler = createWebSocketHandler(
        {
          port: this.config.websocketPort,
          apiKey: this.config.apiKey,
          rateLimiter: this.rateLimiter || undefined,
        },
        this.logger
      );

      // Register tools
      this.tools.forEach((toolHandler, name) => {
        wsHandler.registerTool(name, toolHandler);
      });

      protocolPromises.push(
        wsHandler.start().then(() => {
          this.protocolHandlers.set('websocket', wsHandler);
          this.logger.info('WebSocket protocol started', { port: this.config.websocketPort });
        })
      );
    }

    // SSE Protocol (if port is set)
    if (this.config.ssePort > 0) {
      const sseHandler = createSSEHandler(
        {
          port: this.config.ssePort,
          corsOrigins: this.config.corsOrigins,
          apiKey: this.config.apiKey,
          rateLimiter: this.rateLimiter || undefined,
        },
        this.logger
      );

      protocolPromises.push(
        sseHandler.start().then(() => {
          this.protocolHandlers.set('sse', sseHandler);
          this.logger.info('SSE protocol started', { port: this.config.ssePort });
        })
      );
    }

    // Wait for all protocols to start
    await Promise.all(protocolPromises);
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

    signals.forEach(signal => {
      process.on(signal, async () => {
        this.logger.info(`Received ${signal}, initiating graceful shutdown`);
        await this.stop();
        process.exit(0);
      });
    });

    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception', error);
      await this.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      this.logger.error('Unhandled rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        promise: String(promise)
      });
      await this.stop();
      process.exit(1);
    });
  }

  /**
   * Get list of enabled protocols
   */
  private getEnabledProtocols(): string[] {
    const protocols: string[] = [];

    if (this.config.stdioEnabled) protocols.push('stdio');
    if (this.config.httpPort > 0) protocols.push('http');
    if (this.config.websocketPort > 0) protocols.push('websocket');
    if (this.config.ssePort > 0) protocols.push('sse');

    return protocols;
  }

  /**
   * Get current server health status
   */
  async getHealthStatus(): Promise<HealthCheckResponse> {
    const uptime = this.isRunning ? Date.now() - this.startTime : 0;
    const memoryUsage = process.memoryUsage();

    // Check protocol statuses
    const protocolStatuses: Record<string, boolean> = {};
    this.protocolHandlers.forEach((handler, name) => {
      protocolStatuses[name] = handler.isRunning();
    });

    // Check service statuses
    const openaiStatus = this.config.openaiApiKey ? 'connected' : 'disconnected';
    const cacheStatus = this.cache?.isConnected() ? 'connected' : 'disconnected';

    return {
      status: this.isRunning ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime / 1000),
      version: '3.0.0',
      protocols: {
        stdio: this.config.stdioEnabled && (protocolStatuses.stdio || false),
        http: this.config.httpPort > 0 && (protocolStatuses.http || false),
        websocket: this.config.websocketPort > 0 && (protocolStatuses.websocket || false),
        sse: this.config.ssePort > 0 && (protocolStatuses.sse || false),
      },
      services: {
        openai: openaiStatus as 'connected' | 'disconnected' | 'error',
        cache: cacheStatus as 'connected' | 'disconnected' | 'error',
      },
      performance: {
        memoryUsageMB: Math.round(memoryUsage.rss / 1024 / 1024),
        cacheHitRatio: undefined, // Could be implemented with cache statistics
        averageResponseTimeMs: undefined, // Could be implemented with metrics collection
      },
    };
  }

  /**
   * Get current server status info
   */
  getStatus(): {
    isRunning: boolean;
    uptime: number;
    protocols: Record<string, boolean>;
    toolCount: number;
    config: Partial<ServerConfig>;
  } {
    const uptime = this.isRunning ? Date.now() - this.startTime : 0;

    return {
      isRunning: this.isRunning,
      uptime: Math.floor(uptime / 1000),
      protocols: {
        stdio: this.protocolHandlers.has('stdio'),
        http: this.protocolHandlers.has('http'),
        websocket: this.protocolHandlers.has('websocket'),
        sse: this.protocolHandlers.has('sse'),
      },
      toolCount: this.tools.size,
      config: {
        nodeEnv: this.config.nodeEnv,
        httpPort: this.config.httpPort,
        websocketPort: this.config.websocketPort,
        ssePort: this.config.ssePort,
        stdioEnabled: this.config.stdioEnabled,
        apiKey: this.config.apiKey,
        corsOrigins: this.config.corsOrigins,
      },
    };
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    const server = new UniversalMCPServer();
    await server.start();

    // Keep the process alive
    process.stdin.resume();

  } catch (error) {
    // Fatal error during server startup - create minimal logger for error reporting
    const logger = getLogger({ level: 'error', pretty: true, service: 'mcp-news-v3' });
    logger.error('Fatal error starting server', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Unhandled error in main - create minimal logger for error reporting
    const logger = getLogger({ level: 'error', pretty: true, service: 'mcp-news-v3' });
    logger.error('Unhandled error in main', error);
    process.exit(1);
  });
}

export { UniversalMCPServer };