/**
 * Comprehensive tests for OpenAI service implementation
 * Tests sentiment analysis with mocked OpenAI responses
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import OpenAI from 'openai';
import { OpenAIService, createOpenAIService } from '../../src/services/openai_service';
import type { Logger } from '../../src/types/index';

// Mock OpenAI
jest.mock('openai');

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

const mockLogger: Logger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};

const defaultConfig = {
  apiKey: 'test-api-key',
  model: 'gpt-4',
  maxCompletionTokens: 1000,
  temperature: 0.1,
};

describe('OpenAIService', () => {
  let openaiService: OpenAIService;
  let mockOpenAIInstance: jest.Mocked<OpenAI>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockOpenAIInstance = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    } as any;

    MockedOpenAI.mockImplementation(() => mockOpenAIInstance);

    openaiService = new OpenAIService(defaultConfig, mockLogger);
  });

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(MockedOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
      });

      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'OpenAIService' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'OpenAI service initialized',
        {
          model: 'gpt-4',
          maxCompletionTokens: 1000,
          temperature: 0.1,
        }
      );
    });

    it('should throw error when API key is missing', () => {
      expect(() => {
        new OpenAIService({ ...defaultConfig, apiKey: '' }, mockLogger);
      }).toThrow('OpenAI API key is required');
    });

    it('should handle gpt-5-nano model temperature override', () => {
      const nanoConfig = { ...defaultConfig, model: 'gpt-5-nano' };
      new OpenAIService(nanoConfig, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'OpenAI service initialized',
        expect.objectContaining({
          model: 'gpt-5-nano',
        })
      );
    });
  });

  describe('analyzeSentiment', () => {
    const sampleRequest = {
      content: 'Bitcoin price is surging to new all-time highs!',
      source: 'Twitter',
      coins: ['BTC'],
      analysisDepth: 'basic' as const,
    };

    it('should analyze sentiment successfully', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 85,
              summary: 'Very bullish sentiment about Bitcoin price',
              affected_coins: ['BTC'],
              reasoning: 'Price surge indicates strong market sentiment',
            }),
          },
        }],
        usage: {
          total_tokens: 150,
        },
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.analyzeSentiment(sampleRequest);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        impact: 'Positive',
        confidence_score: 85,
        summary: 'Very bullish sentiment about Bitcoin price',
        affected_coins: ['BTC'],
        reasoning: 'Price surge indicates strong market sentiment',
      });
      expect(result.metadata.timestamp).toBeDefined();
      expect(result.metadata.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should call OpenAI with correct parameters for basic analysis', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Neutral',
              confidence_score: 50,
              summary: 'Mixed signals',
              affected_coins: ['BTC'],
              reasoning: 'Unclear market direction',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      await openaiService.analyzeSentiment(sampleRequest);

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: expect.stringContaining('cryptocurrency market sentiment analysis expert'),
          },
          {
            role: 'user',
            content: expect.stringContaining('Bitcoin price is surging'),
          },
        ],
        max_completion_tokens: 1000,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });
    });

    it('should call OpenAI with correct parameters for comprehensive analysis', async () => {
      const comprehensiveRequest = {
        ...sampleRequest,
        analysisDepth: 'comprehensive' as const,
      };

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 90,
              summary: 'Strong bullish indicators across multiple factors',
              affected_coins: ['BTC'],
              reasoning: 'Comprehensive analysis shows sustained positive momentum',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      await openaiService.analyzeSentiment(comprehensiveRequest);

      const call = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
      expect(call.messages[0].content).toContain('comprehensive analysis');
      expect(call.messages[1].content).toContain('Consider the following factors');
    });

    it('should handle gpt-5-nano temperature override', async () => {
      const nanoService = new OpenAIService(
        { ...defaultConfig, model: 'gpt-5-nano' },
        mockLogger
      );

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 80,
              summary: 'Positive sentiment',
              affected_coins: ['BTC'],
              reasoning: 'Good news',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      await nanoService.analyzeSentiment(sampleRequest);

      const call = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
      expect(call.temperature).toBe(1);
    });

    it('should handle multiple coins in request', async () => {
      const multiCoinRequest = {
        ...sampleRequest,
        content: 'Both Bitcoin and Ethereum show strong performance',
        coins: ['BTC', 'ETH'],
      };

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 88,
              summary: 'Both cryptocurrencies showing strength',
              affected_coins: ['BTC', 'ETH'],
              reasoning: 'Correlated positive movement',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.analyzeSentiment(multiCoinRequest);

      expect(result.success).toBe(true);
      expect(result.data?.affected_coins).toEqual(['BTC', 'ETH']);

      const call = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
      expect(call.messages[1].content).toContain('BTC, ETH');
    });

    it('should log analysis details', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Negative',
              confidence_score: 75,
              summary: 'Bearish sentiment detected',
              affected_coins: ['BTC'],
              reasoning: 'Regulatory concerns',
            }),
          },
        }],
        usage: {
          total_tokens: 200,
        },
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      await openaiService.analyzeSentiment(sampleRequest);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Starting sentiment analysis',
        {
          contentLength: sampleRequest.content.length,
          source: sampleRequest.source,
          coins: sampleRequest.coins,
          depth: sampleRequest.analysisDepth,
        }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sentiment analysis completed',
        expect.objectContaining({
          impact: 'Negative',
          confidence: 75,
          responseTimeMs: expect.any(Number),
          tokensUsed: 200,
        })
      );
    });
  });

  describe('Error Handling', () => {
    const sampleRequest = {
      content: 'Test content',
      source: 'Test',
      coins: ['BTC'],
      analysisDepth: 'basic' as const,
    };

    it('should handle OpenAI API errors', async () => {
      const apiError = new Error('API rate limit exceeded');
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(apiError);

      const result = await openaiService.analyzeSentiment(sampleRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
      expect(result.metadata.responseTimeMs).toBeGreaterThanOrEqual(0);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Sentiment analysis failed',
        expect.objectContaining({
          error: 'API rate limit exceeded',
          responseTimeMs: expect.any(Number),
        })
      );
    });

    it('should handle empty response from OpenAI', async () => {
      const mockResponse = {
        choices: [],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.analyzeSentiment(sampleRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No response from OpenAI');
    });

    it('should handle null message content', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: null,
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.analyzeSentiment(sampleRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No response from OpenAI');
    });

    it('should handle invalid JSON in response', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'invalid json content',
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.analyzeSentiment(sampleRequest);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        impact: 'Neutral',
        confidence_score: 0,
        summary: 'Analysis failed - unable to parse response',
        affected_coins: [],
        reasoning: 'OpenAI response parsing failed',
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to parse OpenAI response',
        expect.objectContaining({
          error: expect.any(String),
          response: 'invalid json content',
        })
      );
    });

    it('should validate response fields and provide fallbacks', async () => {
      const invalidResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'InvalidImpact',
              confidence_score: 150,
              summary: null,
              affected_coins: 'not an array',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(invalidResponse as any);

      const result = await openaiService.analyzeSentiment(sampleRequest);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        impact: 'Neutral',
        confidence_score: 0,
        summary: 'Analysis failed - unable to parse response',
        affected_coins: [],
        reasoning: 'OpenAI response parsing failed',
      });
    });

    it('should handle partial valid response data', async () => {
      const partialResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 85,
              summary: 'Valid summary',
              affected_coins: ['BTC'],
              // missing reasoning
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(partialResponse as any);

      const result = await openaiService.analyzeSentiment(sampleRequest);

      expect(result.success).toBe(true);
      expect(result.data?.reasoning).toBe('No reasoning provided');
    });

    it('should truncate overly long summaries', async () => {
      const longSummary = 'x'.repeat(300);
      const responseWithLongSummary = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 80,
              summary: longSummary,
              affected_coins: ['BTC'],
              reasoning: 'Good news',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(responseWithLongSummary as any);

      const result = await openaiService.analyzeSentiment(sampleRequest);

      expect(result.success).toBe(true);
      expect(result.data?.summary.length).toBe(200);
    });
  });

  describe('testConnection', () => {
    it('should test connection successfully', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'OK',
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.testConnection();

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        status: 'connected',
        model: 'gpt-4',
      });

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: [{
          role: 'user',
          content: 'Hello, please respond with "OK" if you are working correctly.',
        }],
        max_completion_tokens: 10,
        temperature: 0.1,
      });
    });

    it('should handle connection test failure', async () => {
      const error = new Error('Connection failed');
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(error);

      const result = await openaiService.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'OpenAI connection test failed',
        expect.objectContaining({
          error: 'Connection failed',
          responseTimeMs: expect.any(Number),
        })
      );
    });

    it('should use temperature 1 for gpt-5-nano in connection test', async () => {
      const nanoService = new OpenAIService(
        { ...defaultConfig, model: 'gpt-5-nano' },
        mockLogger
      );

      const mockResponse = {
        choices: [{
          message: {
            content: 'OK',
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      await nanoService.testConnection();

      const call = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
      expect(call.temperature).toBe(1);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when connection test passes', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'OK' } }],
      } as any);

      const health = await openaiService.getHealthStatus();

      expect(health.status).toBe('connected');
      expect(health.details).toEqual({
        model: 'gpt-4',
        lastTest: expect.any(String),
        responseTime: expect.any(Number),
        error: undefined,
      });
    });

    it('should return error status when connection test fails', async () => {
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(
        new Error('Service unavailable')
      );

      const health = await openaiService.getHealthStatus();

      expect(health.status).toBe('error');
      expect(health.details.error).toBe('Service unavailable');
    });

    it('should handle unexpected errors in health check', async () => {
      // Mock testConnection to throw unexpected error
      const originalTestConnection = openaiService.testConnection;
      openaiService.testConnection = jest.fn().mockRejectedValue(
        new Error('Unexpected error')
      );

      const health = await openaiService.getHealthStatus();

      expect(health.status).toBe('error');
      expect(health.details.error).toBe('Unexpected error');

      // Restore original method
      openaiService.testConnection = originalTestConnection;
    });
  });

  describe('Prompt Building', () => {
    const sampleRequest = {
      content: 'Bitcoin adoption is increasing globally',
      source: 'CoinDesk',
      coins: ['BTC', 'ETH'],
      analysisDepth: 'basic' as const,
    };

    it('should build basic analysis prompt correctly', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 80,
              summary: 'Positive adoption news',
              affected_coins: ['BTC'],
              reasoning: 'Good news',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      await openaiService.analyzeSentiment(sampleRequest);

      const call = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
      const userMessage = call.messages[1].content;

      expect(userMessage).toContain('Bitcoin adoption is increasing globally');
      expect(userMessage).toContain('CoinDesk');
      expect(userMessage).toContain('BTC, ETH');
      expect(userMessage).toContain('basic');
      expect(userMessage).toContain('concise analysis focusing on the direct market impact');
    });

    it('should build comprehensive analysis prompt correctly', async () => {
      const comprehensiveRequest = {
        ...sampleRequest,
        analysisDepth: 'comprehensive' as const,
      };

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 85,
              summary: 'Comprehensive positive analysis',
              affected_coins: ['BTC', 'ETH'],
              reasoning: 'Multiple positive factors',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      await openaiService.analyzeSentiment(comprehensiveRequest);

      const call = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
      const userMessage = call.messages[1].content;
      const systemMessage = call.messages[0].content;

      expect(userMessage).toContain('comprehensive');
      expect(userMessage).toContain('Market sentiment indicators');
      expect(userMessage).toContain('Technical developments');
      expect(userMessage).toContain('detailed reasoning');

      expect(systemMessage).toContain('comprehensive analysis');
      expect(systemMessage).toContain('Technical analysis implications');
      expect(systemMessage).toContain('Regulatory and compliance factors');
    });

    it('should include all required fields in system prompt', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Neutral',
              confidence_score: 50,
              summary: 'Neutral analysis',
              affected_coins: [],
              reasoning: 'No clear direction',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      await openaiService.analyzeSentiment(sampleRequest);

      const call = mockOpenAIInstance.chat.completions.create.mock.calls[0][0];
      const systemMessage = call.messages[0].content;

      expect(systemMessage).toContain('cryptocurrency market sentiment analysis expert');
      expect(systemMessage).toContain('"impact": one of "Positive", "Negative", or "Neutral"');
      expect(systemMessage).toContain('"confidence_score": a number between 0 and 100');
      expect(systemMessage).toContain('"summary": a brief summary');
      expect(systemMessage).toContain('"affected_coins": an array');
      expect(systemMessage).toContain('"reasoning": explanation');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long content', async () => {
      const longContent = 'Bitcoin news '.repeat(1000);
      const longContentRequest = {
        content: longContent,
        source: 'Test',
        coins: ['BTC'],
        analysisDepth: 'basic' as const,
      };

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Neutral',
              confidence_score: 30,
              summary: 'Long content analyzed',
              affected_coins: ['BTC'],
              reasoning: 'Content too repetitive for clear analysis',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.analyzeSentiment(longContentRequest);

      expect(result.success).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Starting sentiment analysis',
        expect.objectContaining({
          contentLength: longContent.length,
        })
      );
    });

    it('should handle empty coins array', async () => {
      const noCoinRequest = {
        content: 'General crypto market news',
        source: 'News',
        coins: [],
        analysisDepth: 'basic' as const,
      };

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Neutral',
              confidence_score: 40,
              summary: 'General market sentiment',
              affected_coins: [],
              reasoning: 'No specific coins mentioned',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.analyzeSentiment(noCoinRequest);

      expect(result.success).toBe(true);
      expect(result.data?.affected_coins).toEqual([]);
    });

    it('should handle special characters in content', async () => {
      const specialCharRequest = {
        content: 'Bitcoin 🚀 to the moon! $BTC #crypto @elonmusk',
        source: 'Twitter',
        coins: ['BTC'],
        analysisDepth: 'basic' as const,
      };

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              impact: 'Positive',
              confidence_score: 70,
              summary: 'Bullish social media sentiment',
              affected_coins: ['BTC'],
              reasoning: 'Positive emojis and moon references',
            }),
          },
        }],
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiService.analyzeSentiment(specialCharRequest);

      expect(result.success).toBe(true);
      expect(result.data?.impact).toBe('Positive');
    });
  });
});

describe('createOpenAIService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockedOpenAI.mockImplementation(() => ({} as any));
  });

  it('should create OpenAI service with factory function', () => {
    const service = createOpenAIService(defaultConfig, mockLogger);

    expect(service).toBeInstanceOf(OpenAIService);
  });

  it('should pass configuration to service', () => {
    const customConfig = {
      ...defaultConfig,
      model: 'gpt-3.5-turbo',
      maxCompletionTokens: 2000,
      temperature: 0.5,
    };

    createOpenAIService(customConfig, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'OpenAI service initialized',
      expect.objectContaining({
        model: 'gpt-3.5-turbo',
        maxCompletionTokens: 2000,
        temperature: 0.5,
      })
    );
  });
});