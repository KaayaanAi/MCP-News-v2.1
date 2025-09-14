/**
 * Comprehensive tests for market news fetching tool
 * Tests news fetching with mocked external APIs and cache
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import {
  GetMarketNewsTool,
  createGetMarketNewsTool
} from '../../src/tools/get_market_news';
import type {
  CacheService,
  Logger,
  ToolExecutionContext,
  GetMarketNewsParams,
  NewsArticle
} from '../../src/types/index';

// Mock environment module
jest.mock('../../src/config/environment', () => ({
  shouldUseMockMode: jest.fn(() => false),
  getMockModeWarning: jest.fn(() => 'Mock mode enabled for testing'),
}));

// Mock mockData module
jest.mock('../../src/utils/mockData', () => ({
  getMockNews: jest.fn(),
}));

const mockCache: jest.Mocked<CacheService> = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  clear: jest.fn(),
  isConnected: jest.fn(),
};

const mockLogger: Logger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};

const mockContext: ToolExecutionContext = {
  requestId: 'test-request-456',
  protocol: 'websocket',
  timestamp: Date.now(),
  userAgent: 'test-client',
  ipAddress: '192.168.1.1',
};

const sampleNewsArticle: NewsArticle = {
  title: 'Bitcoin Reaches New All-Time High',
  url: 'https://coindesk.com/bitcoin-ath-2024',
  source: 'CoinDesk',
  published_at: new Date().toISOString(),
  summary: 'Bitcoin surpasses previous records amid institutional adoption',
  author: 'Crypto Reporter',
  category: 'Markets',
};

describe('GetMarketNewsTool', () => {
  let tool: GetMarketNewsTool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.isConnected.mockReturnValue(true);

    const { shouldUseMockMode } = require('../../src/config/environment');
    shouldUseMockMode.mockReturnValue(false);

    tool = new GetMarketNewsTool(mockCache, mockLogger, {
      cacheTtlSeconds: 1800,
      mockMode: false,
      newsApiKey: 'test-news-api-key',
      cryptoPanicApiKey: 'test-crypto-panic-key',
    });
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', () => {
      expect(mockLogger.child).toHaveBeenCalledWith({ tool: 'get_market_news' });
    });

    it('should use default cache TTL when not specified', () => {
      const defaultTool = new GetMarketNewsTool(mockCache, mockLogger);
      expect(defaultTool).toBeInstanceOf(GetMarketNewsTool);
    });

    it('should enable mock mode when configured', () => {
      const mockTool = new GetMarketNewsTool(mockCache, mockLogger, {
        mockMode: true,
      });
      expect(mockTool).toBeInstanceOf(GetMarketNewsTool);
    });

    it('should detect mock mode from environment', () => {
      const { shouldUseMockMode } = require('../../src/config/environment');
      shouldUseMockMode.mockReturnValue(true);

      const autoMockTool = new GetMarketNewsTool(mockCache, mockLogger);
      expect(autoMockTool).toBeInstanceOf(GetMarketNewsTool);
    });
  });

  describe('getDefinition', () => {
    it('should return correct MCP tool definition', () => {
      const definition = tool.getDefinition();

      expect(definition).toEqual({
        name: 'get_market_news',
        description: expect.stringContaining('Fetches recent news articles'),
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: expect.stringContaining('Search query for news'),
              minLength: 1,
            },
            sources: {
              type: 'array',
              description: expect.stringContaining('specific news sources'),
              items: { type: 'string' },
            },
            limit: {
              type: 'number',
              description: expect.stringContaining('Maximum number of articles'),
              minimum: 1,
              maximum: 50,
              default: 10,
            },
          },
          required: ['query'],
        },
      });
    });
  });

  describe('Parameter Validation', () => {
    it('should accept valid parameters', async () => {
      const validParams: GetMarketNewsParams = {
        query: 'Bitcoin',
        sources: ['coindesk'],
        limit: 5,
      };

      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute(validParams, mockContext);

      expect(result.results).toBeDefined();
      expect(result.total_count).toBeDefined();
      expect(result.processing_info).toBeDefined();
    });

    it('should reject empty query', async () => {
      const invalidParams = {
        query: '',
        limit: 10,
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Market news fetching failed',
        expect.objectContaining({
          error: expect.stringContaining('Invalid parameters'),
        })
      );
    });

    it('should reject limit below minimum', async () => {
      const invalidParams = {
        query: 'Bitcoin',
        limit: 0,
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);
    });

    it('should reject limit above maximum', async () => {
      const invalidParams = {
        query: 'Bitcoin',
        limit: 100,
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);
    });

    it('should use default limit when not provided', async () => {
      const paramsWithoutLimit = {
        query: 'Ethereum',
      };

      mockCache.get.mockResolvedValue(null);

      await tool.execute(paramsWithoutLimit, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Fetching market news',
        expect.objectContaining({
          limit: 10, // Default value
        })
      );
    });

    it('should handle invalid parameter types', async () => {
      const invalidParams = {
        query: 123,
        sources: 'not-an-array',
        limit: 'not-a-number',
      };

      const result = await tool.execute(invalidParams as any, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);
    });
  });

  describe('Cache Operations', () => {
    const validParams: GetMarketNewsParams = {
      query: 'DeFi',
      sources: ['coindesk', 'cointelegraph'],
      limit: 15,
    };

    it('should return cached result when available', async () => {
      const cachedResult = {
        results: [sampleNewsArticle],
        total_count: 1,
        processing_info: {
          cache_hit: false,
          response_time_ms: 500,
        },
      };

      mockCache.get.mockResolvedValue(cachedResult);

      const result = await tool.execute(validParams, mockContext);

      expect(result).toEqual({
        ...cachedResult,
        processing_info: {
          cache_hit: true,
          response_time_ms: expect.any(Number),
        },
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cache hit for market news',
        expect.objectContaining({
          requestId: mockContext.requestId,
          cacheKey: expect.stringMatching(/^news:[a-z0-9]+$/),
          resultCount: 1,
        })
      );
    });

    it('should cache successful results', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute(validParams, mockContext);

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^news:[a-z0-9]+$/),
        expect.objectContaining({
          results: expect.any(Array),
          total_count: expect.any(Number),
        }),
        1800
      );
    });

    it('should generate consistent cache keys', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute(validParams, mockContext);
      await tool.execute(validParams, mockContext);

      const getCalls = mockCache.get.mock.calls;
      expect(getCalls[0][0]).toBe(getCalls[1][0]);
    });

    it('should handle cache errors gracefully', async () => {
      mockCache.get.mockRejectedValue(new Error('Cache connection lost'));

      const result = await tool.execute(validParams, mockContext);

      expect(result.results).toBeDefined();
      // Should proceed with fetching despite cache error
    });
  });

  describe('Mock Mode Operation', () => {
    beforeEach(() => {
      const mockTool = new GetMarketNewsTool(mockCache, mockLogger, {
        mockMode: true,
      });
      tool = mockTool;
    });

    it('should use mock data when in mock mode', async () => {
      const { getMockNews } = require('../../src/utils/mockData');
      const mockArticles = [
        { ...sampleNewsArticle, title: 'Mock Bitcoin News 1' },
        { ...sampleNewsArticle, title: 'Mock Bitcoin News 2' },
      ];

      getMockNews.mockReturnValue(mockArticles);
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        query: 'Bitcoin',
        limit: 10,
      }, mockContext);

      expect(getMockNews).toHaveBeenCalledWith({
        query: 'Bitcoin',
        limit: 10,
      });

      expect(result.results).toEqual(mockArticles);
      expect(result.total_count).toBe(2);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Using mock news data',
        expect.objectContaining({
          query: 'Bitcoin',
          limit: 10,
          message: expect.stringContaining('Mock mode is enabled'),
        })
      );
    });

    it('should handle mock data import failure', async () => {
      const { getMockNews } = require('../../src/utils/mockData');
      getMockNews.mockImplementation(() => {
        throw new Error('Mock data import failed');
      });

      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        query: 'Ethereum',
        limit: 5,
      }, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load mock data',
        expect.objectContaining({
          error: 'Mock data import failed',
        })
      );
    });
  });

  describe('News Source Integration', () => {
    const validParams: GetMarketNewsParams = {
      query: 'cryptocurrency regulation',
      limit: 10,
    };

    it('should handle no configured sources gracefully', async () => {
      const noSourceTool = new GetMarketNewsTool(mockCache, mockLogger, {
        mockMode: false,
        // No API keys provided
      });

      mockCache.get.mockResolvedValue(null);

      const result = await noSourceTool.execute(validParams, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No news results returned from any source',
        expect.objectContaining({
          query: validParams.query,
          sourcesConfigured: expect.any(Number),
        })
      );
    });

    it('should filter by specific sources when provided', async () => {
      const sourceFilterParams = {
        ...validParams,
        sources: ['coindesk'],
      };

      mockCache.get.mockResolvedValue(null);

      await tool.execute(sourceFilterParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Fetching market news',
        expect.objectContaining({
          sources: ['coindesk'],
        })
      );
    });

    it('should handle unknown sources', async () => {
      const unknownSourceParams = {
        ...validParams,
        sources: ['unknown-source'],
      };

      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute(unknownSourceParams, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);
    });

    it('should log API integration status', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute(validParams, mockContext);

      // Should log that API integrations are not yet implemented
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('integration not yet implemented'),
        expect.any(Object)
      );
    });
  });

  describe('Response Processing', () => {
    it('should limit results to requested limit', async () => {
      const { getMockNews } = require('../../src/utils/mockData');
      const manyArticles = Array.from({ length: 20 }, (_, i) => ({
        ...sampleNewsArticle,
        title: `Article ${i + 1}`,
        url: `https://example.com/article-${i + 1}`,
      }));

      getMockNews.mockReturnValue(manyArticles);
      mockCache.get.mockResolvedValue(null);

      const mockTool = new GetMarketNewsTool(mockCache, mockLogger, {
        mockMode: true,
      });

      const result = await mockTool.execute({
        query: 'Bitcoin',
        limit: 5,
      }, mockContext);

      expect(result.results).toHaveLength(5);
      expect(result.total_count).toBe(20); // Original count before limiting
    });

    it('should include processing information', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        query: 'NFT',
        limit: 3,
      }, mockContext);

      expect(result.processing_info).toEqual({
        cache_hit: false,
        response_time_ms: expect.any(Number),
      });

      expect(result.processing_info.response_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should validate response structure', async () => {
      const { getMockNews } = require('../../src/utils/mockData');
      getMockNews.mockReturnValue([sampleNewsArticle]);

      const mockTool = new GetMarketNewsTool(mockCache, mockLogger, {
        mockMode: true,
      });

      mockCache.get.mockResolvedValue(null);

      const result = await mockTool.execute({
        query: 'Solana',
        limit: 5,
      }, mockContext);

      // Result should match GetMarketNewsResponse schema
      expect(result).toMatchObject({
        results: expect.any(Array),
        total_count: expect.any(Number),
        processing_info: {
          cache_hit: expect.any(Boolean),
          response_time_ms: expect.any(Number),
        },
      });

      // Each article should match NewsArticle schema
      result.results.forEach(article => {
        expect(article).toMatchObject({
          title: expect.any(String),
          url: expect.any(String),
          source: expect.any(String),
          published_at: expect.any(String),
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle execution errors gracefully', async () => {
      mockCache.get.mockRejectedValue(new Error('Database connection failed'));

      const result = await tool.execute({
        query: 'Bitcoin',
        limit: 10,
      }, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);
      expect(result.processing_info.cache_hit).toBe(false);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Market news fetching failed',
        expect.objectContaining({
          error: expect.any(String),
          executionTimeMs: expect.any(Number),
        })
      );
    });

    it('should handle malformed parameters', async () => {
      const malformedParams = {
        query: null,
        sources: 'not-an-array',
        limit: -5,
      };

      const result = await tool.execute(malformedParams as any, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total_count).toBe(0);
    });

    it('should handle undefined context', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        query: 'Cardano',
        limit: 3,
      }, {} as any); // Use empty object instead of undefined

      expect(result.results).toBeDefined();
      // Should not crash despite minimal context
    });
  });

  describe('Logging and Monitoring', () => {
    const validParams: GetMarketNewsParams = {
      query: 'blockchain technology',
      sources: ['coindesk'],
      limit: 8,
    };

    it('should log execution details', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute(validParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Fetching market news',
        {
          requestId: mockContext.requestId,
          protocol: mockContext.protocol,
          query: validParams.query,
          sources: validParams.sources,
          limit: validParams.limit,
        }
      );
    });

    it('should log completion details', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute(validParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Market news fetching completed',
        expect.objectContaining({
          requestId: mockContext.requestId,
          resultCount: expect.any(Number),
          totalFound: expect.any(Number),
          executionTimeMs: expect.any(Number),
          cached: false,
        })
      );
    });

    it('should log cache hit details', async () => {
      const cachedResult = {
        results: [sampleNewsArticle],
        total_count: 1,
        processing_info: { cache_hit: false, response_time_ms: 100 },
      };

      mockCache.get.mockResolvedValue(cachedResult);

      await tool.execute(validParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cache hit for market news',
        expect.objectContaining({
          requestId: mockContext.requestId,
          resultCount: 1,
        })
      );
    });
  });

  describe('Health Status', () => {
    it('should report healthy status when cache is connected', async () => {
      mockCache.isConnected.mockReturnValue(true);

      const health = await tool.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.details).toEqual({
        cache: 'connected',
        sourcesConfigured: expect.any(Number),
        mockMode: false,
        lastHealthCheck: expect.any(String),
      });
    });

    it('should report degraded status when cache is disconnected', async () => {
      mockCache.isConnected.mockReturnValue(false);

      const health = await tool.getHealthStatus();

      expect(health.status).toBe('degraded');
      expect(health.details.cache).toBe('disconnected');
    });

    it('should include mock mode status in health check', async () => {
      const mockTool = new GetMarketNewsTool(mockCache, mockLogger, {
        mockMode: true,
      });

      const health = await mockTool.getHealthStatus();

      expect(health.details.mockMode).toBe(true);
    });

    it('should handle health check errors', async () => {
      mockCache.isConnected.mockImplementation(() => {
        throw new Error('Health check failed');
      });

      const health = await tool.getHealthStatus();

      expect(health.status).toBe('unhealthy');
      expect(health.details.error).toBe('Health check failed');
    });
  });

  describe('Source Configuration', () => {
    it('should initialize with API keys when provided', () => {
      const configuredTool = new GetMarketNewsTool(mockCache, mockLogger, {
        newsApiKey: 'news-api-test-key',
        cryptoPanicApiKey: 'crypto-panic-test-key',
      });

      expect(configuredTool).toBeInstanceOf(GetMarketNewsTool);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initialized news sources',
        expect.objectContaining({
          sources: expect.arrayContaining(['newsapi', 'cryptopanic', 'coindesk']),
        })
      );
    });

    it('should handle missing API keys gracefully', () => {
      const noKeyTool = new GetMarketNewsTool(mockCache, mockLogger, {
        // No API keys provided
      });

      expect(noKeyTool).toBeInstanceOf(GetMarketNewsTool);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initialized news sources',
        expect.objectContaining({
          sources: expect.arrayContaining(['coindesk']),
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long queries', async () => {
      const longQuery = 'Bitcoin cryptocurrency '.repeat(100);
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        query: longQuery,
        limit: 5,
      }, mockContext);

      expect(result.results).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Fetching market news',
        expect.objectContaining({
          query: longQuery,
        })
      );
    });

    it('should handle special characters in query', async () => {
      const specialQuery = 'Bitcoin & Ethereum: $BTC vs $ETH 🚀';
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        query: specialQuery,
        limit: 3,
      }, mockContext);

      expect(result.results).toBeDefined();
    });

    it('should handle empty sources array', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        query: 'DeFi',
        sources: [],
        limit: 5,
      }, mockContext);

      expect(result.results).toBeDefined();
    });

    it('should handle maximum limit edge case', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        query: 'Altcoins',
        limit: 50, // Maximum allowed
      }, mockContext);

      expect(result.results).toBeDefined();
    });
  });
});

describe('createGetMarketNewsTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create tool with factory function', () => {
    const tool = createGetMarketNewsTool(mockCache, mockLogger);

    expect(tool).toBeInstanceOf(GetMarketNewsTool);
  });

  it('should pass custom options to tool', () => {
    const options = {
      cacheTtlSeconds: 3600,
      mockMode: true,
      newsApiKey: 'test-key',
    };

    const tool = createGetMarketNewsTool(mockCache, mockLogger, options);

    expect(tool).toBeInstanceOf(GetMarketNewsTool);
  });

  it('should work with empty options', () => {
    const tool = createGetMarketNewsTool(mockCache, mockLogger, {});

    expect(tool).toBeInstanceOf(GetMarketNewsTool);
  });

  it('should work without options parameter', () => {
    const tool = createGetMarketNewsTool(mockCache, mockLogger);

    expect(tool).toBeInstanceOf(GetMarketNewsTool);
  });
});