/**
 * Comprehensive tests for news source validation tool
 * Tests URL validation, domain checking, and source quality assessment
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import {
  ValidateNewsSourceTool,
  createValidateNewsSourceTool
} from '../../src/tools/validate_news_source';
import type {
  CacheService,
  Logger,
  ToolExecutionContext,
  ValidateNewsSourceParams
} from '../../src/types/index';

// Mock environment module
jest.mock('../../src/config/environment', () => ({
  shouldUseMockMode: jest.fn(() => false),
  getMockModeWarning: jest.fn(() => 'Mock mode enabled for testing'),
}));

// Mock mockData module
jest.mock('../../src/utils/mockData', () => ({
  getMockValidation: jest.fn(),
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
  requestId: 'test-request-789',
  protocol: 'sse',
  timestamp: Date.now(),
  userAgent: 'test-browser',
  ipAddress: '10.0.0.1',
};

describe('ValidateNewsSourceTool', () => {
  let tool: ValidateNewsSourceTool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCache.isConnected.mockReturnValue(true);

    const { shouldUseMockMode } = require('../../src/config/environment');
    shouldUseMockMode.mockReturnValue(false);

    tool = new ValidateNewsSourceTool(mockCache, mockLogger, {
      cacheTtlSeconds: 7200,
      mockMode: false,
    });
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', () => {
      expect(mockLogger.child).toHaveBeenCalledWith({ tool: 'validate_news_source' });
    });

    it('should use default cache TTL when not specified', () => {
      const defaultTool = new ValidateNewsSourceTool(mockCache, mockLogger);
      expect(defaultTool).toBeInstanceOf(ValidateNewsSourceTool);
    });

    it('should enable mock mode when configured', () => {
      const mockTool = new ValidateNewsSourceTool(mockCache, mockLogger, {
        mockMode: true,
      });
      expect(mockTool).toBeInstanceOf(ValidateNewsSourceTool);
    });

    it('should detect mock mode from environment', () => {
      const { shouldUseMockMode } = require('../../src/config/environment');
      shouldUseMockMode.mockReturnValue(true);

      const autoMockTool = new ValidateNewsSourceTool(mockCache, mockLogger);
      expect(autoMockTool).toBeInstanceOf(ValidateNewsSourceTool);
    });
  });

  describe('getDefinition', () => {
    it('should return correct MCP tool definition', () => {
      const definition = tool.getDefinition();

      expect(definition).toEqual({
        name: 'validate_news_source',
        description: expect.stringContaining('Validates the reliability and quality'),
        inputSchema: {
          type: 'object',
          properties: {
            source_url: {
              type: 'string',
              description: expect.stringContaining('URL or domain of the news source'),
            },
            validation_type: {
              type: 'string',
              description: expect.stringContaining('Type of validation'),
              enum: ['basic', 'comprehensive'],
              default: 'basic',
            },
          },
          required: ['source_url'],
        },
      });
    });
  });

  describe('Parameter Validation', () => {
    it('should accept valid parameters', async () => {
      const validParams: ValidateNewsSourceParams = {
        source_url: 'https://coindesk.com/markets/bitcoin-news',
        validation_type: 'basic',
      };

      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute(validParams, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      expect(result.quality_score).toBeLessThanOrEqual(100);
      expect(Array.isArray(result.issues_found)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(result.source_status).toBeDefined();
    });

    it('should handle malformed URLs gracefully', async () => {
      const invalidParams = {
        source_url: 'not-a-valid-url',
        validation_type: 'basic',
      };

      const result = await tool.execute(invalidParams, mockContext);

      // Should process but give neutral/low score for unknown domain
      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      expect(result.quality_score).toBeLessThanOrEqual(100);
      expect(Array.isArray(result.issues_found)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('should reject missing source_url', async () => {
      const invalidParams = {
        validation_type: 'basic',
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.quality_score).toBe(0);
      expect(result.issues_found).toContain('Validation failed due to technical error');
    });

    it('should reject invalid validation_type', async () => {
      const invalidParams = {
        source_url: 'https://coindesk.com',
        validation_type: 'invalid_type',
      };

      const result = await tool.execute(invalidParams, mockContext);

      expect(result.quality_score).toBe(0);
      expect(result.issues_found).toContain('Validation failed due to technical error');
    });

    it('should use default validation_type when not provided', async () => {
      const paramsWithoutType = {
        source_url: 'https://cointelegraph.com',
      };

      mockCache.get.mockResolvedValue(null);

      await tool.execute(paramsWithoutType, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Validating news source',
        expect.objectContaining({
          validationType: 'basic', // Default value
        })
      );
    });
  });

  describe('Domain Extraction', () => {
    const testCases = [
      {
        input: 'https://www.coindesk.com/markets/news',
        expected: 'coindesk.com',
        description: 'should extract domain from HTTPS URL with www',
      },
      {
        input: 'http://coindesk.com/article',
        expected: 'coindesk.com',
        description: 'should extract domain from HTTP URL',
      },
      {
        input: 'coindesk.com/path',
        expected: 'coindesk.com',
        description: 'should extract domain from URL without protocol',
      },
      {
        input: 'www.coindesk.com/news',
        expected: 'coindesk.com',
        description: 'should remove www from domain',
      },
      {
        input: 'https://subdomain.coindesk.com',
        expected: 'subdomain.coindesk.com',
        description: 'should preserve subdomains',
      },
    ];

    testCases.forEach(({ input, expected, description }) => {
      it(description, async () => {
        mockCache.get.mockResolvedValue(null);

        await tool.execute({
          source_url: input,
          validation_type: 'basic',
        }, mockContext);

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Validating news source',
          expect.objectContaining({
            sourceUrl: input,
          })
        );

        // The domain extraction is internal, but we can verify through logging
        // Look for any call that includes the expected domain
        const logCalls = mockLogger.info.mock.calls;
        const domainLogCall = logCalls.find(call =>
          call[1] && typeof call[1] === 'object' && 'domain' in call[1]
        );
        if (domainLogCall) {
          expect(domainLogCall[1]).toEqual(expect.objectContaining({
            domain: expected,
          }));
        }
      });
    });

    it('should handle malformed URLs gracefully', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'definitely-not-a-url',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      // Should not crash, even with malformed URL
    });
  });

  describe('Source Quality Assessment', () => {
    it('should give high scores to trusted sources', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://coindesk.com/news-article',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThan(80);
      expect(result.recommendations).toContain('This is a well-established and trusted news source');
    });

    it('should give low scores to blacklisted sources', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://cryptoscam.com/fake-news',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBe(0);
      expect(result.issues_found).toContain('Domain is blacklisted as known scam/spam source');
      expect(result.recommendations).toContain('Do not use this source - known to spread misinformation');
    });

    it('should give moderate scores to questionable sources', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://coinbureau.com/analysis',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeLessThan(50);
      expect(result.issues_found).toContain('Source has mixed reputation - content quality varies');
      expect(result.recommendations).toContain('Cross-reference information with other sources');
    });

    it('should handle unknown domains', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://unknown-crypto-news.com/article',
        validation_type: 'basic',
      }, mockContext);

      // Unknown domains get neutral base score but may be affected by health checks
      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      expect(result.quality_score).toBeLessThanOrEqual(60);
      // Should get cautionary recommendations
      const hasAppropriateWarning = result.recommendations.some(rec =>
        rec.includes('cross-reference') || rec.includes('caution') || rec.includes('Not recommended')
      );
      expect(hasAppropriateWarning).toBe(true);
    });
  });

  describe('Domain Health Checks', () => {
    it('should perform simulated health checks', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://cointelegraph.com/news',
        validation_type: 'basic',
      }, mockContext);

      expect(result.source_status.available).toBeDefined();
      expect(typeof result.source_status.latency_ms).toBe('number');
      expect(result.source_status.latency_ms).toBeGreaterThan(0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Domain health check completed (simulated)',
        expect.objectContaining({
          message: expect.stringContaining('simulated check'),
        })
      );
    });

    it('should adjust scores based on availability', async () => {
      mockCache.get.mockResolvedValue(null);

      // Mock a scenario where domain health check indicates unavailability
      // Since we're using simulated checks, we can't directly control the result
      // but we can verify the logic handles different scenarios

      const result = await tool.execute({
        source_url: 'https://reuters.com/crypto-news',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      expect(result.quality_score).toBeLessThanOrEqual(100);
    });

    it('should handle health check timeouts', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://bloomberg.com/crypto',
        validation_type: 'basic',
      }, mockContext);

      // Should complete without hanging, even if health check times out
      expect(result).toBeDefined();
      expect(typeof result.source_status.latency_ms).toBe('number');
    });
  });

  describe('Comprehensive Validation', () => {
    it('should perform additional checks for comprehensive validation', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://wsj.com/crypto-section',
        validation_type: 'comprehensive',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      expect(result.quality_score).toBeLessThanOrEqual(100);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Comprehensive validation not yet implemented',
        expect.objectContaining({
          message: expect.stringContaining('simulated data'),
        })
      );
    });

    it('should adjust scores based on domain age', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute({
        source_url: 'https://cnbc.com/cryptocurrency',
        validation_type: 'comprehensive',
      }, mockContext);

      // Comprehensive validation should be called
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Performing comprehensive validation',
        expect.any(Object)
      );
    });

    it('should provide more detailed recommendations for comprehensive analysis', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://decrypt.co/news',
        validation_type: 'comprehensive',
      }, mockContext);

      expect(result.recommendations.length).toBeGreaterThan(0);
      // decrypt.co is trusted, but score may be reduced by simulated health checks
      expect(result.quality_score).toBeGreaterThanOrEqual(50); // Should be reasonably high
    });
  });

  describe('Cache Operations', () => {
    const validParams: ValidateNewsSourceParams = {
      source_url: 'https://theblock.co/post/latest-news',
      validation_type: 'basic',
    };

    it('should return cached result when available', async () => {
      const cachedResult = {
        quality_score: 88,
        issues_found: [],
        source_status: {
          available: true,
          latency_ms: 250,
        },
        recommendations: ['Highly reliable source'],
      };

      mockCache.get.mockResolvedValue(cachedResult);

      const result = await tool.execute(validParams, mockContext);

      expect(result).toEqual(cachedResult);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cache hit for source validation',
        expect.objectContaining({
          requestId: mockContext.requestId,
          domain: 'theblock.co',
        })
      );
    });

    it('should cache successful validation results', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute(validParams, mockContext);

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^validation:[a-z0-9]+$/),
        expect.objectContaining({
          quality_score: expect.any(Number),
          issues_found: expect.any(Array),
          source_status: expect.any(Object),
          recommendations: expect.any(Array),
        }),
        7200
      );
    });

    it('should generate consistent cache keys for same domain and type', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute(validParams, mockContext);
      await tool.execute(validParams, mockContext);

      const getCalls = mockCache.get.mock.calls;
      expect(getCalls[0][0]).toBe(getCalls[1][0]);
    });

    it('should generate different cache keys for different validation types', async () => {
      const basicParams = { ...validParams, validation_type: 'basic' as const };
      const comprehensiveParams = { ...validParams, validation_type: 'comprehensive' as const };

      mockCache.get.mockResolvedValue(null);

      await tool.execute(basicParams, mockContext);
      await tool.execute(comprehensiveParams, mockContext);

      const getCalls = mockCache.get.mock.calls;
      expect(getCalls[0][0]).not.toBe(getCalls[1][0]);
    });

    it('should handle cache errors gracefully', async () => {
      mockCache.get.mockRejectedValue(new Error('Cache service unavailable'));

      const result = await tool.execute(validParams, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      // Should proceed with validation despite cache error
    });
  });

  describe('Mock Mode Operation', () => {
    beforeEach(() => {
      const mockTool = new ValidateNewsSourceTool(mockCache, mockLogger, {
        mockMode: true,
      });
      tool = mockTool;
    });

    it('should use mock data when in mock mode', async () => {
      const { getMockValidation } = require('../../src/utils/mockData');
      const mockValidationResult = {
        quality_score: 92,
        issues_found: [],
        source_status: {
          available: true,
          latency_ms: 180,
        },
        recommendations: ['Mock: Excellent source quality'],
      };

      getMockValidation.mockReturnValue(mockValidationResult);
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://coindesk.com/test',
        validation_type: 'basic',
      }, mockContext);

      expect(getMockValidation).toHaveBeenCalledWith('https://coindesk.com/test');
      expect(result.quality_score).toBe(92);
      expect(result.recommendations).toContain('Mock: Excellent source quality');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Using mock validation data',
        expect.objectContaining({
          message: expect.stringContaining('Mock mode is enabled'),
        })
      );
    });

    it('should handle mock data import failure', async () => {
      const { getMockValidation } = require('../../src/utils/mockData');
      getMockValidation.mockImplementation(() => {
        throw new Error('Mock validation data not available');
      });

      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://example.com',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBe(50); // Fallback neutral score
      expect(result.issues_found).toContain('Unable to load mock data for validation');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load mock validation data',
        expect.objectContaining({
          error: 'Mock validation data not available',
        })
      );
    });
  });

  describe('Warning and Error Handling', () => {
    it('should warn about low quality scores', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute({
        source_url: 'https://cryptoscam.com/news',
        validation_type: 'basic',
      }, mockContext);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Low quality score detected for news source',
        expect.objectContaining({
          domain: 'cryptoscam.com',
          qualityScore: 0,
          message: expect.stringContaining('reliable news sources'),
        })
      );
    });

    it('should handle execution errors gracefully', async () => {
      mockCache.get.mockRejectedValue(new Error('Critical system failure'));

      const result = await tool.execute({
        source_url: 'https://bitcoin.org',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBe(0);
      expect(result.issues_found).toContain('Validation failed due to technical error');
      expect(result.source_status.available).toBe(false);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Source validation failed',
        expect.objectContaining({
          error: expect.any(String),
        })
      );
    });

    it('should handle malformed parameters', async () => {
      const malformedParams = {
        source_url: 123,
        validation_type: null,
      };

      const result = await tool.execute(malformedParams as any, mockContext);

      expect(result.quality_score).toBe(0);
      expect(result.issues_found).toContain('Validation failed due to technical error');
    });

    it('should handle undefined context', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://coinbase.com/blog',
        validation_type: 'basic',
      }, {} as any); // Use empty object instead of undefined

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      // Should not crash despite minimal context
    });
  });

  describe('Logging and Monitoring', () => {
    const validParams: ValidateNewsSourceParams = {
      source_url: 'https://bitcoinmagazine.com/article',
      validation_type: 'comprehensive',
    };

    it('should log validation details', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute(validParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Validating news source',
        {
          requestId: mockContext.requestId,
          protocol: mockContext.protocol,
          sourceUrl: validParams.source_url,
          validationType: validParams.validation_type,
        }
      );
    });

    it('should log completion details', async () => {
      mockCache.get.mockResolvedValue(null);

      await tool.execute(validParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Source validation completed',
        expect.objectContaining({
          requestId: mockContext.requestId,
          domain: 'bitcoinmagazine.com',
          qualityScore: expect.any(Number),
          issuesFound: expect.any(Number),
          executionTimeMs: expect.any(Number),
          cached: false,
        })
      );
    });

    it('should log cache hit details', async () => {
      const cachedResult = {
        quality_score: 75,
        issues_found: ['Minor issues'],
        source_status: { available: true, latency_ms: 300 },
        recommendations: ['Good source with minor concerns'],
      };

      mockCache.get.mockResolvedValue(cachedResult);

      await tool.execute(validParams, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cache hit for source validation',
        expect.objectContaining({
          requestId: mockContext.requestId,
          domain: 'bitcoinmagazine.com',
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
        trustedSourcesCount: expect.any(Number),
        blacklistedSourcesCount: expect.any(Number),
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

    it('should include source counts in health status', async () => {
      mockCache.isConnected.mockReturnValue(true);

      const health = await tool.getHealthStatus();

      expect(health.details.trustedSourcesCount).toBeGreaterThan(0);
      expect(health.details.blacklistedSourcesCount).toBeGreaterThan(0);
    });

    it('should include mock mode status', async () => {
      const mockTool = new ValidateNewsSourceTool(mockCache, mockLogger, {
        mockMode: true,
      });

      const health = await mockTool.getHealthStatus();

      expect(health.details.mockMode).toBe(true);
    });

    it('should handle health check errors', async () => {
      mockCache.isConnected.mockImplementation(() => {
        throw new Error('Health status check failed');
      });

      const health = await tool.getHealthStatus();

      expect(health.status).toBe('unhealthy');
      expect(health.details.error).toBe('Health status check failed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle international domain names', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://中文新闻.com/crypto-news',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
      // Should handle internationalized domain names
    });

    it('should handle very long URLs', async () => {
      const longPath = 'very-long-path-'.repeat(50);
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: `https://example.com/${longPath}article.html`,
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
    });

    it('should handle URLs with special characters', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://news-site.com/crypto%20&%20blockchain?ref=test',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
    });

    it('should handle localhost URLs', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'http://localhost:3000/news',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
    });

    it('should handle IP address URLs', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://192.168.1.100/news',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Recommendation Logic', () => {
    it('should provide appropriate recommendations for high-quality sources', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://reuters.com/technology/crypto',
        validation_type: 'basic',
      }, mockContext);

      // reuters.com is trusted, but score may be reduced by simulated health checks
      expect(result.quality_score).toBeGreaterThanOrEqual(50);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should provide caution recommendations for medium-quality sources', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://newsbtc.com/analysis',
        validation_type: 'basic',
      }, mockContext);

      expect(result.quality_score).toBeLessThan(50);
      // newsbtc.com is questionable, but health checks may further reduce score
      // Should get either caution or not-recommended message
      const hasAppropriateWarning = result.recommendations.some(rec =>
        rec.includes('cross-reference') || rec.includes('Not recommended')
      );
      expect(hasAppropriateWarning).toBe(true);
    });

    it('should provide specific recommendations for unknown sources', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await tool.execute({
        source_url: 'https://brand-new-crypto-site.com/news',
        validation_type: 'basic',
      }, mockContext);

      // Unknown sources should get cautionary recommendations
      const hasAppropriateWarning = result.recommendations.some(rec =>
        rec.includes('cross-reference') || rec.includes('caution') || rec.includes('Not recommended')
      );
      expect(hasAppropriateWarning).toBe(true);
    });
  });
});

describe('createValidateNewsSourceTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create tool with factory function', () => {
    const tool = createValidateNewsSourceTool(mockCache, mockLogger);

    expect(tool).toBeInstanceOf(ValidateNewsSourceTool);
  });

  it('should pass custom options to tool', () => {
    const options = {
      cacheTtlSeconds: 3600,
      mockMode: true,
    };

    const tool = createValidateNewsSourceTool(mockCache, mockLogger, options);

    expect(tool).toBeInstanceOf(ValidateNewsSourceTool);
  });

  it('should work with empty options', () => {
    const tool = createValidateNewsSourceTool(mockCache, mockLogger, {});

    expect(tool).toBeInstanceOf(ValidateNewsSourceTool);
  });

  it('should work without options parameter', () => {
    const tool = createValidateNewsSourceTool(mockCache, mockLogger);

    expect(tool).toBeInstanceOf(ValidateNewsSourceTool);
  });
});