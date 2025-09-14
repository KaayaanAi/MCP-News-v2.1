/**
 * Comprehensive tests for crypto sentiment analysis tool
 * Tests the full tool execution pipeline with mocked dependencies
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import {
  AnalyzeCryptoSentimentTool,
  createAnalyzeCryptoSentimentTool
} from '../../src/tools/analyze_crypto_sentiment';
import type {
  CacheService,
  Logger,
  ToolExecutionContext,
  AnalyzeCryptoSentimentParams,
  ServiceResponse
} from '../../src/types/index';
import { OpenAIService } from '../../src/services/openai_service';

// Mock dependencies
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

const mockOpenAIService: jest.Mocked<OpenAIService> = {
  analyzeSentiment: jest.fn(),
  testConnection: jest.fn(),
  getHealthStatus: jest.fn(),
} as any;

const mockContext: ToolExecutionContext = {
  requestId: 'test-request-123',
  protocol: 'http',
  timestamp: Date.now(),
  userAgent: 'test-agent',
  ipAddress: '127.0.0.1',
};

describe('AnalyzeCryptoSentimentTool', () => {
  let tool: AnalyzeCryptoSentimentTool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.isConnected.mockReturnValue(true);
    tool = new AnalyzeCryptoSentimentTool(
      mockOpenAIService,
      mockCache,
      mockLogger,
      3600
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', () => {
      expect(mockLogger.child).toHaveBeenCalledWith({ tool: 'analyze_crypto_sentiment' });
    });

    it('should use default cache TTL when not specified', () => {
      const defaultTool = new AnalyzeCryptoSentimentTool(
        mockOpenAIService,
        mockCache,
        mockLogger
      );
      expect(defaultTool).toBeInstanceOf(AnalyzeCryptoSentimentTool);
    });
  });

  describe('getDefinition', () => {
    it('should return correct MCP tool definition', () => {
      const definition = tool.getDefinition();

      expect(definition).toEqual({
        name: 'analyze_crypto_sentiment',
        description: expect.stringContaining('Analyzes a news article or social media post'),
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: expect.stringContaining('text content'),
              minLength: 10,
            },
            source: {
              type: 'string',
              description: expect.stringContaining('source of the content'),
            },
            coins: {
              type: 'array',
              description: expect.stringContaining('cryptocurrency symbols'),
              items: { type: 'string' },
              minItems: 1,
            },
            analysis_depth: {
              type: 'string',
              description: expect.stringContaining('Depth of analysis'),
              enum: ['basic', 'comprehensive'],
              default: 'basic',
            },
          },
          required: ['content', 'source', 'coins'],
        },
      });
    });
  });

  describe('Parameter Validation', () => {
    it('should accept valid parameters', async () => {
      const validParams: AnalyzeCryptoSentimentParams = {
        content: 'Bitcoin price is surging to new highs!',
        source: 'Twitter',
        coins: ['BTC'],
        analysis_depth: 'basic',
      };

      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Positive',
          confidence_score: 85,
          summary: 'Bullish sentiment detected',
          affected_coins: ['BTC'],
          reasoning: 'Price surge indicates positive market sentiment',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 1000,
        },
      });

      const result = await tool.execute(validParams, mockContext);

      expect(result.impact).toBe('Positive');
      expect(result.confidence_score).toBe(85);
    });

    it('should reject parameters with missing required fields', async () => {
      const invalidParams = {
        content: 'Test content',
        source: 'Test',
        // missing coins
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.impact).toBe('Neutral');
      expect(result.confidence_score).toBe(0);
      expect(result.summary).toContain('failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Sentiment analysis failed',
        expect.objectContaining({
          error: expect.stringContaining('Invalid parameters'),
        })
      );
    });

    it('should reject content that is too short', async () => {
      const invalidParams = {
        content: 'Too short',
        source: 'Test',
        coins: ['BTC'],
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.impact).toBe('Neutral');
      expect(result.summary).toContain('failed');
    });

    it('should reject empty coins array', async () => {
      const invalidParams = {
        content: 'Valid content length for testing',
        source: 'Test',
        coins: [],
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.impact).toBe('Neutral');
      expect(result.summary).toContain('failed');
    });

    it('should reject invalid analysis_depth', async () => {
      const invalidParams = {
        content: 'Valid content length for testing',
        source: 'Test',
        coins: ['BTC'],
        analysis_depth: 'invalid_depth',
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.impact).toBe('Neutral');
      expect(result.summary).toContain('failed');
    });

    it('should use default analysis_depth when not provided', async () => {
      const paramsWithoutDepth = {
        content: 'Bitcoin adoption is increasing globally',
        source: 'CoinDesk',
        coins: ['BTC'],
      };

      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Positive',
          confidence_score: 80,
          summary: 'Positive adoption news',
          affected_coins: ['BTC'],
          reasoning: 'Adoption indicates growth',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 800,
        },
      });

      await tool.execute(paramsWithoutDepth, mockContext);

      expect(mockOpenAIService.analyzeSentiment).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisDepth: 'basic',
        })
      );
    });
  });

  describe('Cache Operations', () => {
    const validParams: AnalyzeCryptoSentimentParams = {
      content: 'Ethereum upgrade shows promising results',
      source: 'CoinDesk',
      coins: ['ETH'],
      analysis_depth: 'basic',
    };

    it('should return cached result when available', async () => {
      const cachedResult = {
        impact: 'Positive' as const,
        confidence_score: 90,
        summary: 'Cached positive sentiment',
        affected_coins: ['ETH'],
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'CoinDesk',
        },
      };

      mockCache.get.mockResolvedValue(cachedResult);

      const result = await tool.execute(validParams, mockContext);

      expect(result).toEqual(cachedResult);
      expect(mockOpenAIService.analyzeSentiment).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cache hit for sentiment analysis',
        expect.objectContaining({
          requestId: mockContext.requestId,
          cacheKey: expect.stringMatching(/^sentiment:[a-z0-9]+$/),
        })
      );
    });

    it('should cache successful analysis results', async () => {
      const analysisData = {
        impact: 'Negative' as const,
        confidence_score: 75,
        summary: 'Bearish market sentiment',
        affected_coins: ['ETH'],
        reasoning: 'Market uncertainty detected',
      };

      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: analysisData,
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 1200,
        },
      });

      const result = await tool.execute(validParams, mockContext);

      expect(result.impact).toBe('Negative');
      expect(result.confidence_score).toBe(75);

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^sentiment:[a-z0-9]+$/),
        expect.objectContaining({
          impact: 'Negative',
          confidence_score: 75,
        }),
        3600
      );
    });

    it('should generate consistent cache keys for same input', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Neutral',
          confidence_score: 50,
          summary: 'Neutral sentiment',
          affected_coins: ['ETH'],
          reasoning: 'Mixed signals',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 900,
        },
      });

      await tool.execute(validParams, mockContext);
      await tool.execute(validParams, mockContext);

      const getCalls = mockCache.get.mock.calls;
      expect(getCalls[0][0]).toBe(getCalls[1][0]);
    });

    it('should handle cache errors gracefully', async () => {
      mockCache.get.mockRejectedValue(new Error('Cache connection failed'));
      // When cache fails, the tool should return error response

      const result = await tool.execute(validParams, mockContext);

      expect(result.impact).toBe('Neutral'); // Error response
      expect(result.confidence_score).toBe(0);
      expect(result.summary).toBe('Analysis failed due to an error');
    });

    it('should handle cache set errors gracefully', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockRejectedValue(new Error('Cache write failed'));
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Positive',
          confidence_score: 80,
          summary: 'Analysis successful despite cache error',
          affected_coins: ['ETH'],
          reasoning: 'Good analysis',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 1000,
        },
      });

      const result = await tool.execute(validParams, mockContext);

      expect(result.impact).toBe('Positive');
      expect(mockOpenAIService.analyzeSentiment).toHaveBeenCalled();
      // Should still complete successfully despite cache write error
    });
  });

  describe('OpenAI Service Integration', () => {
    const validParams: AnalyzeCryptoSentimentParams = {
      content: 'DeFi protocols show strong growth potential',
      source: 'DeFi Pulse',
      coins: ['ETH', 'UNI'],
      analysis_depth: 'comprehensive',
    };

    it('should call OpenAI service with correct parameters', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Positive',
          confidence_score: 88,
          summary: 'Strong DeFi growth indicators',
          affected_coins: ['ETH', 'UNI'],
          reasoning: 'DeFi ecosystem expansion benefits both tokens',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 1500,
        },
      });

      await tool.execute(validParams, mockContext);

      expect(mockOpenAIService.analyzeSentiment).toHaveBeenCalledWith({
        content: validParams.content,
        source: validParams.source,
        coins: validParams.coins,
        analysisDepth: validParams.analysis_depth,
      });
    });

    it('should handle OpenAI service failure', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: false,
        error: 'OpenAI API rate limit exceeded',
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 500,
        },
      });

      const result = await tool.execute(validParams, mockContext);

      expect(result.impact).toBe('Neutral');
      expect(result.confidence_score).toBe(0);
      expect(result.summary).toBe('Analysis failed due to an error');
      expect(result.metadata.source).toBe('error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Sentiment analysis failed',
        expect.objectContaining({
          error: 'OpenAI API rate limit exceeded',
        })
      );
    });

    it('should handle OpenAI service returning no data', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: undefined,
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 800,
        },
      } as any);

      const result = await tool.execute(validParams, mockContext);

      expect(result.impact).toBe('Neutral');
      expect(result.confidence_score).toBe(0);
      expect(result.summary).toBe('Analysis failed due to an error');
    });

    it('should validate OpenAI response structure', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Positive',
          confidence_score: 85,
          summary: 'Valid analysis result',
          affected_coins: ['ETH', 'UNI'],
          reasoning: 'Solid technical and fundamental factors',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 1200,
        },
      });

      const result = await tool.execute(validParams, mockContext);

      // Should pass through valid data
      expect(result.impact).toBe('Positive');
      expect(result.confidence_score).toBe(85);
      expect(result.summary).toBe('Valid analysis result');
      expect(result.affected_coins).toEqual(['ETH', 'UNI']);
      expect(result.metadata.timestamp).toBeDefined();
      expect(result.metadata.source).toBe('DeFi Pulse');
    });
  });

  describe('Logging and Monitoring', () => {
    const validParams: AnalyzeCryptoSentimentParams = {
      content: 'Bitcoin ETF approval rumors circulating',
      source: 'Reuters',
      coins: ['BTC'],
      analysis_depth: 'basic',
    };

    it('should log execution details', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Positive',
          confidence_score: 82,
          summary: 'ETF approval would be bullish',
          affected_coins: ['BTC'],
          reasoning: 'Institutional adoption catalyst',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 1000,
        },
      });

      await tool.execute(validParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Executing sentiment analysis',
        {
          requestId: mockContext.requestId,
          protocol: mockContext.protocol,
          contentLength: validParams.content.length,
          source: validParams.source,
          coins: validParams.coins,
          analysisDepth: validParams.analysis_depth,
        }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sentiment analysis completed',
        expect.objectContaining({
          requestId: mockContext.requestId,
          impact: 'Positive',
          confidence: 82,
          executionTimeMs: expect.any(Number),
          cached: false,
        })
      );
    });

    it('should log cache hit information', async () => {
      const cachedResult = {
        impact: 'Negative' as const,
        confidence_score: 65,
        summary: 'Cached bearish sentiment',
        affected_coins: ['BTC'],
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'Reuters',
        },
      };

      mockCache.get.mockResolvedValue(cachedResult);

      await tool.execute(validParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cache hit for sentiment analysis',
        expect.objectContaining({
          requestId: mockContext.requestId,
          cacheKey: expect.any(String),
        })
      );
    });

    it('should log error details on failure', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockRejectedValue(
        new Error('Network timeout')
      );

      await tool.execute(validParams, mockContext);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Sentiment analysis failed',
        expect.objectContaining({
          requestId: mockContext.requestId,
          error: 'Network timeout',
          executionTimeMs: expect.any(Number),
        })
      );
    });
  });

  describe('Health Status', () => {
    it('should report healthy status when all services are working', async () => {
      mockCache.isConnected.mockReturnValue(true);
      mockOpenAIService.getHealthStatus.mockResolvedValue({
        status: 'connected',
        details: {
          model: 'gpt-4',
          lastTest: new Date().toISOString(),
        },
      });

      const health = await tool.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.details).toEqual({
        openai: 'connected',
        cache: 'connected',
        lastHealthCheck: expect.any(String),
      });
    });

    it('should report degraded status when cache is disconnected', async () => {
      mockCache.isConnected.mockReturnValue(false);
      mockOpenAIService.getHealthStatus.mockResolvedValue({
        status: 'connected',
        details: {
          model: 'gpt-4',
          lastTest: new Date().toISOString(),
        },
      });

      const health = await tool.getHealthStatus();

      expect(health.status).toBe('degraded');
      expect(health.details.cache).toBe('disconnected');
    });

    it('should report unhealthy status when OpenAI is disconnected', async () => {
      mockCache.isConnected.mockReturnValue(true);
      mockOpenAIService.getHealthStatus.mockResolvedValue({
        status: 'error',
        details: {
          error: 'API key invalid',
        },
      });

      const health = await tool.getHealthStatus();

      expect(health.status).toBe('unhealthy');
      expect(health.details.openai).toBe('error');
    });

    it('should handle health check errors', async () => {
      mockOpenAIService.getHealthStatus.mockRejectedValue(
        new Error('Health check failed')
      );

      const health = await tool.getHealthStatus();

      expect(health.status).toBe('unhealthy');
      expect(health.details.error).toBe('Health check failed');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle very long content', async () => {
      const longContent = 'Bitcoin '.repeat(1000) + 'is showing strong momentum';
      const longContentParams: AnalyzeCryptoSentimentParams = {
        content: longContent,
        source: 'Test',
        coins: ['BTC'],
        analysis_depth: 'basic',
      };

      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Positive',
          confidence_score: 60,
          summary: 'Long content processed',
          affected_coins: ['BTC'],
          reasoning: 'Overall positive despite repetitive content',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 2000,
        },
      });

      const result = await tool.execute(longContentParams, mockContext);

      expect(result.impact).toBe('Positive');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Executing sentiment analysis',
        expect.objectContaining({
          contentLength: longContent.length,
        })
      );
    });

    it('should handle multiple coins', async () => {
      const multiCoinParams: AnalyzeCryptoSentimentParams = {
        content: 'Both Bitcoin and Ethereum show strong adoption metrics',
        source: 'Crypto News',
        coins: ['BTC', 'ETH', 'ADA', 'SOL'],
        analysis_depth: 'comprehensive',
      };

      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Positive',
          confidence_score: 87,
          summary: 'Multi-asset positive sentiment',
          affected_coins: ['BTC', 'ETH', 'ADA', 'SOL'],
          reasoning: 'Broad-based adoption benefits multiple cryptocurrencies',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 1800,
        },
      });

      const result = await tool.execute(multiCoinParams, mockContext);

      expect(result.impact).toBe('Positive');
      expect(result.affected_coins).toEqual(['BTC', 'ETH', 'ADA', 'SOL']);
    });

    it('should handle non-string error objects', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockRejectedValue({
        code: 'API_ERROR',
        message: 'Service unavailable',
      });

      const result = await tool.execute({
        content: 'Test content for error handling',
        source: 'Test',
        coins: ['BTC'],
      }, mockContext);

      expect(result.impact).toBe('Neutral');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Sentiment analysis failed',
        expect.objectContaining({
          error: '[object Object]', // Non-Error objects become [object Object]
        })
      );
    });

    it('should handle malformed parameters gracefully', async () => {
      const malformedParams = {
        content: 123, // Should be string
        source: null,
        coins: 'BTC', // Should be array
      };

      const result = await tool.execute(malformedParams as any, mockContext);

      expect(result.impact).toBe('Neutral');
      expect(result.summary).toContain('failed');
    });

    it('should handle undefined context gracefully', async () => {
      mockCache.get.mockResolvedValue(null);
      mockOpenAIService.analyzeSentiment.mockResolvedValue({
        success: true,
        data: {
          impact: 'Neutral',
          confidence_score: 50,
          summary: 'Neutral sentiment',
          affected_coins: ['BTC'],
          reasoning: 'No clear direction',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: 1000,
        },
      });

      const result = await tool.execute({
        content: 'Test content with undefined context',
        source: 'Test',
        coins: ['BTC'],
      }, undefined as any);

      expect(result.impact).toBe('Neutral');
    });
  });
});

describe('createAnalyzeCryptoSentimentTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create tool with factory function', () => {
    const tool = createAnalyzeCryptoSentimentTool(
      mockOpenAIService,
      mockCache,
      mockLogger
    );

    expect(tool).toBeInstanceOf(AnalyzeCryptoSentimentTool);
  });

  it('should pass custom options to tool', () => {
    const options = { cacheTtlSeconds: 7200 };

    const tool = createAnalyzeCryptoSentimentTool(
      mockOpenAIService,
      mockCache,
      mockLogger,
      options
    );

    expect(tool).toBeInstanceOf(AnalyzeCryptoSentimentTool);
  });

  it('should work with empty options', () => {
    const tool = createAnalyzeCryptoSentimentTool(
      mockOpenAIService,
      mockCache,
      mockLogger,
      {}
    );

    expect(tool).toBeInstanceOf(AnalyzeCryptoSentimentTool);
  });

  it('should work without options parameter', () => {
    const tool = createAnalyzeCryptoSentimentTool(
      mockOpenAIService,
      mockCache,
      mockLogger
    );

    expect(tool).toBeInstanceOf(AnalyzeCryptoSentimentTool);
  });
});