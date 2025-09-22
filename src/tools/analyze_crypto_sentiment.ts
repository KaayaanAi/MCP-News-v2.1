/**
 * MCP Tool: analyze_crypto_sentiment
 * Analyzes cryptocurrency news sentiment using AI and caching
 */

import { z } from 'zod';
import type {
  AnalyzeCryptoSentimentParams,
  AnalyzeCryptoSentimentResponse,
  ToolExecutionContext,
  Logger,
  CacheService,
  MCPTool
} from '../types/index.js';
import {
  AnalyzeCryptoSentimentParamsSchema,
  AnalyzeCryptoSentimentResponseSchema
} from '../types/index.js';
import { OpenAIService } from '../services/gemini_service.js';
import { CacheKeys } from '../services/cache_service.js';

/**
 * Tool implementation for cryptocurrency sentiment analysis
 */
export class AnalyzeCryptoSentimentTool {
  private openaiService: OpenAIService;
  private cache: CacheService;
  private logger: Logger;
  private cacheTtlSeconds: number;

  constructor(
    openaiService: OpenAIService,
    cache: CacheService,
    logger: Logger,
    cacheTtlSeconds = 3600
  ) {
    this.openaiService = openaiService;
    this.cache = cache;
    this.logger = logger.child({ tool: 'analyze_crypto_sentiment' });
    this.cacheTtlSeconds = cacheTtlSeconds;
  }

  /**
   * Get MCP tool definition
   */
  getDefinition(): MCPTool {
    return {
      name: 'analyze_crypto_sentiment',
      description: 'Analyzes a news article or social media post to determine its sentiment (positive, negative, neutral) and potential market impact on specified cryptocurrencies.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The text content of the article or post to analyze',
            minLength: 10,
          },
          source: {
            type: 'string',
            description: 'The source of the content (e.g., "Twitter", "CoinDesk", "Reddit")',
          },
          coins: {
            type: 'array',
            description: 'Array of cryptocurrency symbols to analyze impact for (e.g., ["BTC", "ETH"])',
            items: {
              type: 'string',
            },
            minItems: 1,
          },
          analysis_depth: {
            type: 'string',
            description: 'Depth of analysis to perform',
            enum: ['basic', 'comprehensive'],
            default: 'basic',
          },
        },
        required: ['content', 'source', 'coins'],
      },
    };
  }

  /**
   * Execute the sentiment analysis tool
   */
  async execute(
    params: unknown,
    context: ToolExecutionContext
  ): Promise<AnalyzeCryptoSentimentResponse> {
    const startTime = Date.now();

    try {
      // Validate input parameters
      const validatedParams = this.validateParams(params);

      this.logger.info('Executing sentiment analysis', {
        requestId: context?.requestId,
        protocol: context?.protocol,
        contentLength: validatedParams.content.length,
        source: validatedParams.source,
        coins: validatedParams.coins,
        analysisDepth: validatedParams.analysis_depth,
      });

      // Check cache first
      const cacheKey = CacheKeys.sentiment(
        validatedParams.content,
        validatedParams.coins
      );

      const cachedResult = await this.cache.get<AnalyzeCryptoSentimentResponse>(cacheKey);
      if (cachedResult) {
        this.logger.info('Cache hit for sentiment analysis', {
          requestId: context?.requestId,
          cacheKey,
        });

        return cachedResult;
      }

      // Perform sentiment analysis using OpenAI
      const analysisResult = await this.openaiService.analyzeSentiment({
        content: validatedParams.content,
        source: validatedParams.source,
        coins: validatedParams.coins,
        analysisDepth: validatedParams.analysis_depth,
      });

      if (!analysisResult.success || !analysisResult.data) {
        throw new Error(analysisResult.error || 'Sentiment analysis failed');
      }

      // Build response
      const response: AnalyzeCryptoSentimentResponse = {
        impact: analysisResult.data.impact,
        confidence_score: analysisResult.data.confidence_score,
        summary: analysisResult.data.summary,
        affected_coins: analysisResult.data.affected_coins,
        metadata: {
          timestamp: new Date().toISOString(),
          source: validatedParams.source,
        },
      };

      // Validate response structure
      const validatedResponse = AnalyzeCryptoSentimentResponseSchema.parse(response);

      // Cache the result (don't fail if caching fails)
      try {
        await this.cache.set(cacheKey, validatedResponse, this.cacheTtlSeconds);
      } catch (cacheError) {
        this.logger.warn('Failed to cache sentiment analysis result', {
          requestId: context?.requestId,
          error: cacheError instanceof Error ? cacheError.message : String(cacheError),
        });
      }

      const executionTime = Date.now() - startTime;
      this.logger.info('Sentiment analysis completed', {
        requestId: context?.requestId,
        impact: response.impact,
        confidence: response.confidence_score,
        executionTimeMs: executionTime,
        cached: false,
      });

      return validatedResponse;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error('Sentiment analysis failed', {
        requestId: context?.requestId,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: executionTime,
      });

      // Return a neutral response with error details in development
      const errorResponse: AnalyzeCryptoSentimentResponse = {
        impact: 'Neutral',
        confidence_score: 0,
        summary: 'Analysis failed due to an error',
        affected_coins: [],
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'error',
        },
      };

      return errorResponse;
    }
  }

  /**
   * Validate input parameters using Zod schema
   */
  private validateParams(params: unknown): AnalyzeCryptoSentimentParams {
    try {
      return AnalyzeCryptoSentimentParamsSchema.parse(params);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(issue =>
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        throw new Error(`Invalid parameters: ${issues}`);
      }
      throw new Error('Parameter validation failed');
    }
  }



  /**
   * Get tool health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, unknown>;
  }> {
    try {
      // Test OpenAI service
      const openaiHealth = await this.openaiService.getHealthStatus();

      // Test cache service
      const cacheConnected = this.cache.isConnected();

      const isHealthy = openaiHealth.status === 'connected' && cacheConnected;
      const isDegraded = openaiHealth.status === 'connected' && !cacheConnected;

      return {
        status: isHealthy ? 'healthy' : isDegraded ? 'degraded' : 'unhealthy',
        details: {
          openai: openaiHealth.status,
          cache: cacheConnected ? 'connected' : 'disconnected',
          lastHealthCheck: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : String(error),
          lastHealthCheck: new Date().toISOString(),
        },
      };
    }
  }
}

/**
 * Create and configure the sentiment analysis tool
 */
export function createAnalyzeCryptoSentimentTool(
  openaiService: OpenAIService,
  cache: CacheService,
  logger: Logger,
  options: {
    cacheTtlSeconds?: number;
  } = {}
): AnalyzeCryptoSentimentTool {
  return new AnalyzeCryptoSentimentTool(
    openaiService,
    cache,
    logger,
    options.cacheTtlSeconds
  );
}