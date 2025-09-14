/**
 * MCP Tool: get_market_news
 * Fetches recent cryptocurrency news from multiple sources
 */

import { z } from 'zod';
import type {
  GetMarketNewsParams,
  GetMarketNewsResponse,
  ToolExecutionContext,
  Logger,
  CacheService,
  MCPTool
} from '../types/index.js';
import {
  GetMarketNewsParamsSchema,
  GetMarketNewsResponseSchema
} from '../types/index.js';
import { CacheKeys } from '../services/cache_service.js';
import { shouldUseMockMode, getMockModeWarning } from '../config/environment.js';
import { NEWS_CACHE_TTL_SECONDS } from '../config/constants.js';

interface NewsSource {
  name: string;
  baseUrl: string;
  apiKey?: string;
  endpoints: {
    search: string;
    top: string;
  };
}

interface NewsArticle {
  title: string;
  url: string;
  source: string;
  published_at: string;
  summary?: string;
  author?: string;
  category?: string;
}

/**
 * Tool implementation for fetching cryptocurrency market news
 */
export class GetMarketNewsTool {
  private cache: CacheService;
  private logger: Logger;
  private cacheTtlSeconds: number;
  private mockMode: boolean;
  private newsSources: Map<string, NewsSource>;

  constructor(
    cache: CacheService,
    logger: Logger,
    options: {
      cacheTtlSeconds?: number;
      mockMode?: boolean;
      newsApiKey?: string;
      cryptoPanicApiKey?: string;
    } = {}
  ) {
    this.cache = cache;
    this.logger = logger.child({ tool: 'get_market_news' });
    this.cacheTtlSeconds = options.cacheTtlSeconds || NEWS_CACHE_TTL_SECONDS;

    // Determine mock mode based on configuration and options
    this.mockMode = options.mockMode ?? shouldUseMockMode();

    // Log mock mode status
    if (this.mockMode) {
      const warning = getMockModeWarning();
      if (warning) {
        this.logger.warn(warning);
      }
    }

    // Initialize news sources
    this.newsSources = new Map();
    this.initializeNewsSources(options.newsApiKey, options.cryptoPanicApiKey);
  }

  /**
   * Get MCP tool definition
   */
  getDefinition(): MCPTool {
    return {
      name: 'get_market_news',
      description: 'Fetches recent news articles or social media posts related to a specific cryptocurrency or the market in general.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for news (e.g., "Bitcoin ETF", "Ethereum upgrade", "DeFi")',
            minLength: 1,
          },
          sources: {
            type: 'array',
            description: 'Optional array of specific news sources to search (e.g., ["CoinDesk", "CoinTelegraph"])',
            items: {
              type: 'string',
            },
          },
          limit: {
            type: 'number',
            description: 'Maximum number of articles to return',
            minimum: 1,
            maximum: 50,
            default: 10,
          },
        },
        required: ['query'],
      },
    };
  }

  /**
   * Execute the market news fetching tool
   */
  async execute(
    params: unknown,
    context: ToolExecutionContext
  ): Promise<GetMarketNewsResponse> {
    const startTime = Date.now();

    try {
      // Validate input parameters
      const validatedParams = this.validateParams(params);

      this.logger.info('Fetching market news', {
        requestId: context.requestId,
        protocol: context.protocol,
        query: validatedParams.query,
        sources: validatedParams.sources,
        limit: validatedParams.limit,
      });

      // Check cache first
      const cacheKey = CacheKeys.news(
        validatedParams.query,
        validatedParams.sources,
        validatedParams.limit
      );

      const cachedResult = await this.cache.get<GetMarketNewsResponse>(cacheKey);
      if (cachedResult) {
        this.logger.info('Cache hit for market news', {
          requestId: context.requestId,
          cacheKey,
          resultCount: cachedResult.results.length,
        });

        // Update processing info with cache hit
        cachedResult.processing_info.cache_hit = true;
        cachedResult.processing_info.response_time_ms = Date.now() - startTime;

        return cachedResult;
      }

      // Fetch news from sources
      const newsResults = this.mockMode
        ? await this.getMockNews(validatedParams)
        : await this.fetchNewsFromSources(validatedParams);

      // Log warning if no results and not in mock mode
      if (!this.mockMode && newsResults.length === 0) {
        this.logger.warn('No news results returned from any source', {
          query: validatedParams.query,
          sourcesConfigured: this.newsSources.size,
          message: 'Consider implementing API integrations or enabling mock mode for testing'
        });
      }

      // Build response
      const response: GetMarketNewsResponse = {
        results: newsResults.slice(0, validatedParams.limit),
        total_count: newsResults.length,
        processing_info: {
          cache_hit: false,
          response_time_ms: Date.now() - startTime,
        },
      };

      // Validate response structure
      const validatedResponse = GetMarketNewsResponseSchema.parse(response);

      // Cache the result
      await this.cache.set(cacheKey, validatedResponse, this.cacheTtlSeconds);

      const executionTime = Date.now() - startTime;
      this.logger.info('Market news fetching completed', {
        requestId: context.requestId,
        resultCount: response.results.length,
        totalFound: response.total_count,
        executionTimeMs: executionTime,
        cached: false,
      });

      return validatedResponse;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error('Market news fetching failed', {
        requestId: context.requestId,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: executionTime,
      });

      // Return empty results on error
      const errorResponse: GetMarketNewsResponse = {
        results: [],
        total_count: 0,
        processing_info: {
          cache_hit: false,
          response_time_ms: executionTime,
        },
      };

      return errorResponse;
    }
  }

  /**
   * Validate input parameters using Zod schema
   */
  private validateParams(params: unknown): GetMarketNewsParams {
    try {
      return GetMarketNewsParamsSchema.parse(params);
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
   * Initialize news sources configuration
   */
  private initializeNewsSources(newsApiKey?: string, cryptoPanicApiKey?: string): void {
    // NewsAPI.org configuration
    if (newsApiKey) {
      this.newsSources.set('newsapi', {
        name: 'NewsAPI',
        baseUrl: 'https://newsapi.org/v2',
        apiKey: newsApiKey,
        endpoints: {
          search: '/everything',
          top: '/top-headlines',
        },
      });
    }

    // CryptoPanic API configuration
    if (cryptoPanicApiKey) {
      this.newsSources.set('cryptopanic', {
        name: 'CryptoPanic',
        baseUrl: 'https://cryptopanic.com/api/v1',
        apiKey: cryptoPanicApiKey,
        endpoints: {
          search: '/posts/',
          top: '/posts/',
        },
      });
    }

    // Free sources (no API key required)
    this.newsSources.set('coindesk', {
      name: 'CoinDesk',
      baseUrl: 'https://api.coindesk.com/v1',
      endpoints: {
        search: '/news/search',
        top: '/news/top',
      },
    });

    this.logger.info('Initialized news sources', {
      sources: Array.from(this.newsSources.keys()),
    });
  }

  /**
   * Fetch news from configured sources
   */
  private async fetchNewsFromSources(params: GetMarketNewsParams): Promise<NewsArticle[]> {
    const allResults: NewsArticle[] = [];
    const sourcesToUse = params.sources?.length
      ? params.sources.map(s => s.toLowerCase())
      : Array.from(this.newsSources.keys());

    if (sourcesToUse.length === 0) {
      this.logger.warn('No news sources configured or available');
      return [];
    }

    const fetchPromises = sourcesToUse.map(async (sourceKey) => {
      const source = this.newsSources.get(sourceKey);
      if (!source) {
        this.logger.warn('Unknown news source requested', { source: sourceKey });
        return [];
      }

      try {
        return await this.fetchFromSource(source, params.query, params.limit);
      } catch (error) {
        this.logger.error('Failed to fetch from source', {
          source: sourceKey,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      } else {
        this.logger.error('News source fetch promise rejected', {
          source: sourcesToUse[index],
          error: result.reason,
        });
      }
    });

    // Sort by published date (most recent first)
    return allResults.sort((a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  }

  /**
   * Fetch news from a specific source
   */
  private async fetchFromSource(
    source: NewsSource,
    query: string,
    limit: number
  ): Promise<NewsArticle[]> {
    // This is a simplified implementation
    // In production, you would implement specific API integrations for each source

    switch (source.name) {
      case 'NewsAPI':
        return this.fetchFromNewsAPI(source, query, limit);
      case 'CryptoPanic':
        return this.fetchFromCryptoPanic(source, query, limit);
      case 'CoinDesk':
        return this.fetchFromCoinDesk(source, query, limit);
      default:
        this.logger.warn('Unsupported news source', { source: source.name });
        return [];
    }
  }

  /**
   * Fetch from NewsAPI.org
   * Note: Currently simulated for testing - implement real API integration for production
   * Required: NEWS_API_KEY environment variable
   * API Documentation: https://newsapi.org/docs
   */
  private async fetchFromNewsAPI(
    source: NewsSource,
    query: string,
    limit: number
  ): Promise<NewsArticle[]> {
    if (!source.apiKey) {
      this.logger.warn('NewsAPI key not configured - skipping NewsAPI source');
      return [];
    }

    this.logger.info('NewsAPI integration not yet implemented', {
      query,
      limit,
      message: 'This feature requires implementation of NewsAPI.org HTTP client with proper error handling, rate limiting, and response parsing'
    });

    return [];
  }

  /**
   * Fetch from CryptoPanic API
   * Note: Currently simulated for testing - implement real API integration for production
   * Required: CRYPTO_PANIC_API_KEY environment variable
   * API Documentation: https://cryptopanic.com/developers/api/
   */
  private async fetchFromCryptoPanic(
    source: NewsSource,
    query: string,
    limit: number
  ): Promise<NewsArticle[]> {
    if (!source.apiKey) {
      this.logger.warn('CryptoPanic API key not configured - skipping CryptoPanic source');
      return [];
    }

    this.logger.info('CryptoPanic API integration not yet implemented', {
      query,
      limit,
      message: 'This feature requires implementation of CryptoPanic API client with proper authentication, filtering, and response mapping'
    });

    return [];
  }

  /**
   * Fetch from CoinDesk API
   * Note: Currently simulated for testing - implement real integration for production
   * CoinDesk may not have a public API - consider web scraping or RSS feeds
   * Alternative: Use RSS feed at https://www.coindesk.com/arc/outboundfeeds/rss/
   */
  private async fetchFromCoinDesk(
    _source: NewsSource,
    query: string,
    limit: number
  ): Promise<NewsArticle[]> {
    this.logger.info('CoinDesk API integration not yet implemented', {
      query,
      limit,
      message: 'This feature requires implementation of either CoinDesk API client or RSS feed parser with content filtering'
    });

    return [];
  }

  /**
   * Get mock news data for testing
   * Note: Mock data has been moved to tests/utils/mockData.ts
   * This method now imports from the test utilities when in mock mode
   */
  private async getMockNews(params: GetMarketNewsParams): Promise<NewsArticle[]> {
    this.logger.info('Using mock news data', {
      query: params.query,
      sources: params.sources,
      limit: params.limit,
      message: 'Mock mode is enabled - returning test data instead of real API calls'
    });

    try {
      // Import internal mock data utility
      const { getMockNews } = await import('../utils/mockData.js');
      return getMockNews(params);
    } catch (error) {
      this.logger.error('Failed to load mock data', {
        error: error instanceof Error ? error.message : String(error),
        message: 'Fallback: returning empty array'
      });
      return [];
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
      const cacheConnected = this.cache.isConnected();
      const sourcesConfigured = this.newsSources.size;

      const isHealthy = cacheConnected && sourcesConfigured > 0;

      return {
        status: isHealthy ? 'healthy' : 'degraded',
        details: {
          cache: cacheConnected ? 'connected' : 'disconnected',
          sourcesConfigured,
          mockMode: this.mockMode,
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
 * Create and configure the market news tool
 */
export function createGetMarketNewsTool(
  cache: CacheService,
  logger: Logger,
  options: {
    cacheTtlSeconds?: number;
    mockMode?: boolean;
    newsApiKey?: string;
    cryptoPanicApiKey?: string;
  } = {}
): GetMarketNewsTool {
  return new GetMarketNewsTool(cache, logger, options);
}