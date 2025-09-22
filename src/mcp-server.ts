#!/usr/bin/env node

/**
 * MCP-NEWS-V2.1 - Official MCP SDK Implementation
 * Fully compliant with MCP protocol specification and n8n compatibility
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';
import process from 'process';
import { z } from 'zod';
import type { Logger, Tool as _MCPTool, OpenAIService, CacheService } from './types/index.js';
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

export class MCPNewsServer {
  private server: Server;
  private logger: Logger;
  private config: z.infer<typeof EnvSchema>;
  private cache: CacheService | null = null;
  private tools: Map<string, Tool> = new Map();

  constructor() {
    // Load environment configuration
    config();
    this.config = EnvSchema.parse(process.env);

    // Initialize logger
    this.logger = getLogger({
      level: this.config.LOG_LEVEL,
      pretty: this.config.PRETTY_LOGS,
      service: 'mcp-news-server'
    });

    // Initialize MCP server with proper configuration
    this.server = new Server(
      {
        name: 'mcp-news-server',
        version: '2.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {},
        },
      }
    );

    this.setupHandlers();
    this.logger.info('MCP News Server initialized', {
      version: '2.1.0',
      nodeEnv: this.config.NODE_ENV,
      hasGemini: !!this.config.GEMINI_API_KEY,
      hasRedis: !!this.config.REDIS_URL,
    });
  }

  /**
   * Get logger instance for external access
   */
  get loggerInstance(): Logger {
    return this.logger;
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    // Initialize handler
    this.server.setRequestHandler(
      InitializeRequestSchema,
      async (request) => {
        this.logger.info('Handling initialize request', {
          requestId: (request as { id?: string }).id || 'unknown'
        });

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
    );

    // List tools handler
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => {
        this.logger.debug('Handling tools/list request');

        const toolsList: Tool[] = Array.from(this.tools.values()).map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));

        return {
          tools: toolsList,
        };
      }
    );

    // Call tool handler
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const { name, arguments: args } = request.params;
        this.logger.info('Handling tools/call request', {
          toolName: name,
          hasArguments: !!args
        });

        const tool = this.tools.get(name);
        if (!tool) {
          throw new Error(`Unknown tool: ${name}`);
        }

        try {
          const result = await (tool.execute as (params: unknown) => Promise<unknown>)(args || {});

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
            error: error instanceof Error ? error.message : String(error)
          });

          throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
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

    // Initialize tools with proper MCP schemas
    await this.initializeTools(openaiService as any);
  }

  /**
   * Initialize and register MCP tools with proper schemas
   */
  private async initializeTools(openaiService: any): Promise<void> {
    this.logger.info('Initializing MCP tools');

    // Create cache service for tools if not already available
    const toolCache = this.cache || await createCacheService(undefined, this.logger);

    // Initialize analyze_crypto_sentiment tool
    const sentimentTool = createAnalyzeCryptoSentimentTool(
      openaiService as any,
      toolCache,
      this.logger,
      { cacheTtlSeconds: this.config.CACHE_TTL_SECONDS }
    );

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
      execute: sentimentTool.execute.bind(sentimentTool),
    });

    // Initialize get_market_news tool
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
      execute: newsTool.execute.bind(newsTool),
    });

    // Initialize validate_news_source tool
    const validationTool = createValidateNewsSourceTool(
      toolCache,
      this.logger,
      {
        cacheTtlSeconds: this.config.CACHE_TTL_SECONDS,
        mockMode: this.config.MOCK_EXTERNAL_APIS,
      }
    );

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
      execute: validationTool.execute.bind(validationTool),
    });

    this.logger.info('MCP tools initialized', {
      toolCount: this.tools.size,
      toolNames: Array.from(this.tools.keys()),
    });
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    try {
      // Initialize services first
      await this.initializeServices();

      // Connect to STDIO transport
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      this.logger.info('MCP News Server started successfully', {
        transport: 'stdio',
        toolCount: this.tools.size,
        pid: process.pid,
      });

    } catch (error) {
      this.logger.error('Failed to start MCP server', error);
      process.exit(1);
    }
  }

  /**
   * Stop the server gracefully
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping MCP News Server');

    try {
      await this.server.close();
      this.logger.info('MCP News Server stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping MCP server', error);
    }
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new MCPNewsServer();

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
      server.loggerInstance?.error('Fatal error starting MCP server', error);
    } catch {
      console.error('Fatal error starting MCP server:', error);
    }
    process.exit(1);
  });
}

// Export handled by class declaration