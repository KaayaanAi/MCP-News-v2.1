/**
 * Gemini service for cryptocurrency sentiment analysis
 * Handles AI-powered analysis with structured prompts and error handling
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Logger, ServiceResponse } from '../types/index.js';

interface GeminiConfig {
  apiKey?: string;
  model: string;
  maxOutputTokens: number;
  temperature: number;
  mockMode?: boolean;
}

interface SentimentAnalysisRequest {
  content: string;
  source: string;
  coins: string[];
  analysisDepth: 'basic' | 'comprehensive';
}

interface SentimentAnalysisResult {
  impact: 'Positive' | 'Negative' | 'Neutral';
  confidence_score: number;
  summary: string;
  affected_coins: string[];
  reasoning: string;
}

/**
 * Gemini service for cryptocurrency sentiment analysis
 */
export class GeminiService {
  private client: GoogleGenerativeAI | null;
  private model: any;
  private config: GeminiConfig;
  private logger: Logger;
  private mockMode: boolean;

  constructor(config: GeminiConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'GeminiService' });
    this.mockMode = config.mockMode || !config.apiKey;

    if (this.mockMode) {
      this.client = null;
      this.model = null;
      this.logger.info('Gemini service initialized in mock mode', {
        reason: config.mockMode ? 'explicitly enabled' : 'no API key provided',
        model: config.model,
      });
    } else {
      this.client = new GoogleGenerativeAI(config.apiKey!);
      this.model = this.client.getGenerativeModel({
        model: config.model,
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
        },
      });
      this.logger.info('Gemini service initialized', {
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
      });
    }
  }

  /**
   * Analyze cryptocurrency sentiment using Gemini
   */
  async analyzeSentiment(
    request: SentimentAnalysisRequest
  ): Promise<ServiceResponse<SentimentAnalysisResult>> {
    const startTime = Date.now();

    try {
      this.logger.debug('Starting sentiment analysis', {
        contentLength: request.content.length,
        source: request.source,
        coins: request.coins,
        depth: request.analysisDepth,
        mockMode: this.mockMode,
      });

      if (this.mockMode) {
        return this.generateMockAnalysis(request, startTime);
      }

      if (!this.model) {
        throw new Error('Gemini model not initialized');
      }

      const prompt = this.buildSentimentPrompt(request);

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const responseText = response.text();

      if (!responseText) {
        throw new Error('No response from Gemini');
      }

      const analysisResult = this.parseAnalysisResult(responseText);
      const responseTime = Date.now() - startTime;

      this.logger.info('Sentiment analysis completed', {
        impact: analysisResult.impact,
        confidence: analysisResult.confidence_score,
        responseTimeMs: responseTime,
      });

      return {
        success: true,
        data: analysisResult,
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error('Sentiment analysis failed', {
        error: error instanceof Error ? error.message : String(error),
        responseTimeMs: responseTime,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
        },
      };
    }
  }

  /**
   * Generate mock sentiment analysis for testing/demo purposes
   */
  private generateMockAnalysis(
    request: SentimentAnalysisRequest,
    startTime: number
  ): ServiceResponse<SentimentAnalysisResult> {
    const { content, coins } = request;

    // Simple keyword-based mock analysis
    const positiveKeywords = ['bullish', 'positive', 'growth', 'up', 'gain', 'rise', 'buy', 'strong'];
    const negativeKeywords = ['bearish', 'negative', 'drop', 'down', 'fall', 'sell', 'weak', 'crash'];

    const contentLower = content.toLowerCase();
    const positiveCount = positiveKeywords.filter(word => contentLower.includes(word)).length;
    const negativeCount = negativeKeywords.filter(word => contentLower.includes(word)).length;

    let impact: 'Positive' | 'Negative' | 'Neutral';
    let confidence: number;

    if (positiveCount > negativeCount) {
      impact = 'Positive';
      confidence = Math.min(60 + positiveCount * 10, 85);
    } else if (negativeCount > positiveCount) {
      impact = 'Negative';
      confidence = Math.min(60 + negativeCount * 10, 85);
    } else {
      impact = 'Neutral';
      confidence = 50;
    }

    const responseTime = Date.now() - startTime;

    this.logger.info('Mock sentiment analysis completed', {
      impact,
      confidence,
      responseTimeMs: responseTime,
    });

    return {
      success: true,
      data: {
        impact,
        confidence_score: confidence,
        summary: `Mock analysis: ${impact} sentiment detected in content about ${coins.join(', ')}`,
        affected_coins: coins,
        reasoning: `Mock analysis based on keyword detection (${positiveCount} positive, ${negativeCount} negative keywords found)`,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        responseTimeMs: responseTime,
      },
    };
  }

  /**
   * Test Gemini connection and availability
   */
  async testConnection(): Promise<ServiceResponse<{ status: string; model: string }>> {
    const startTime = Date.now();

    if (this.mockMode) {
      const responseTime = Date.now() - startTime;
      this.logger.info('Mock Gemini connection test', { responseTimeMs: responseTime });

      return {
        success: true,
        data: {
          status: 'mock_mode',
          model: this.config.model + ' (mock)',
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
        },
      };
    }

    if (!this.model) {
      throw new Error('Gemini model not initialized');
    }

    try {
      const result = await this.model.generateContent('Hello, please respond with "OK" if you are working correctly.');
      const response = await result.response;
      response.text(); // Just to verify we can get text

      const responseTime = Date.now() - startTime;

      this.logger.info('Gemini connection test successful', {
        responseTimeMs: responseTime,
        model: this.config.model,
      });

      return {
        success: true,
        data: {
          status: 'connected',
          model: this.config.model,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error('Gemini connection test failed', {
        error: error instanceof Error ? error.message : String(error),
        responseTimeMs: responseTime,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
        metadata: {
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
        },
      };
    }
  }

  /**
   * Build sentiment analysis prompt
   */
  private buildSentimentPrompt(request: SentimentAnalysisRequest): string {
    const { content, source, coins, analysisDepth } = request;

    const systemPrompt = this.getSystemPrompt(analysisDepth);
    const basePrompt = `
Analyze the sentiment of this cryptocurrency-related content:

**Content:** ${content}
**Source:** ${source}
**Target Cryptocurrencies:** ${coins.join(', ')}
**Analysis Depth:** ${analysisDepth}

Please analyze this content and determine its potential impact on the specified cryptocurrencies.
    `.trim();

    const fullPrompt = systemPrompt + '\n\n' + basePrompt;

    if (analysisDepth === 'comprehensive') {
      return fullPrompt + `

Consider the following factors in your comprehensive analysis:
1. Market sentiment indicators and language tone
2. Technical developments mentioned (upgrades, partnerships, regulations)
3. Market timing and context (bull/bear market conditions)
4. Source credibility and potential bias
5. Volume of social engagement if applicable
6. Historical patterns for similar news types

Provide detailed reasoning for your assessment.`;
    }

    return fullPrompt + '\n\nProvide a concise analysis focusing on the direct market impact.';
  }

  /**
   * Get system prompt based on analysis depth
   */
  private getSystemPrompt(depth: 'basic' | 'comprehensive'): string {
    const basePrompt = `You are a cryptocurrency market sentiment analysis expert. Your task is to analyze news articles, social media posts, and other content to determine their potential impact on cryptocurrency markets.

You must respond with a valid JSON object containing:
- "impact": one of "Positive", "Negative", or "Neutral"
- "confidence_score": a number between 0 and 100 representing your confidence in the analysis
- "summary": a brief summary of the analysis (max 200 characters)
- "affected_coins": an array of cryptocurrency symbols that are likely to be affected
- "reasoning": explanation of your analysis

Guidelines:
- Be objective and data-driven in your analysis
- Consider both immediate and potential long-term impacts
- Factor in market context and current trends
- Assign confidence scores based on clarity and significance of the content`;

    if (depth === 'comprehensive') {
      return basePrompt + `

For comprehensive analysis, also consider:
- Technical analysis implications
- Regulatory and compliance factors
- Market microstructure effects
- Cross-correlation with other assets
- Sentiment momentum and sustainability
- Risk factors and potential reversals

Provide more detailed reasoning and lower confidence scores for ambiguous situations.`;
    }

    return basePrompt + '\n\nFor basic analysis, focus on direct and obvious impacts with clear reasoning.';
  }

  /**
   * Parse Gemini response into structured result
   */
  private parseAnalysisResult(responseText: string): SentimentAnalysisResult {
    try {
      // Clean up the response text to extract JSON
      let jsonText = responseText.trim();

      // Remove markdown code blocks if present
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(jsonText);

      // Validate required fields
      if (!parsed.impact || !['Positive', 'Negative', 'Neutral'].includes(parsed.impact)) {
        throw new Error('Invalid impact value');
      }

      if (typeof parsed.confidence_score !== 'number' ||
          parsed.confidence_score < 0 ||
          parsed.confidence_score > 100) {
        throw new Error('Invalid confidence score');
      }

      if (!parsed.summary || typeof parsed.summary !== 'string') {
        throw new Error('Invalid summary');
      }

      if (!Array.isArray(parsed.affected_coins)) {
        throw new Error('Invalid affected_coins array');
      }

      return {
        impact: parsed.impact,
        confidence_score: Math.round(parsed.confidence_score),
        summary: parsed.summary.slice(0, 200), // Ensure max length
        affected_coins: parsed.affected_coins.map(String),
        reasoning: parsed.reasoning || 'No reasoning provided',
      };
    } catch (error) {
      this.logger.error('Failed to parse Gemini response', {
        error: error instanceof Error ? error.message : String(error),
        response: responseText.slice(0, 500),
      });

      // Return a fallback result
      return {
        impact: 'Neutral',
        confidence_score: 0,
        summary: 'Analysis failed - unable to parse response',
        affected_coins: [],
        reasoning: 'Gemini response parsing failed',
      };
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: 'connected' | 'disconnected' | 'error';
    details: Record<string, unknown>;
  }> {
    try {
      const testResult = await this.testConnection();
      return {
        status: testResult.success ? 'connected' : 'error',
        details: {
          model: this.config.model,
          mockMode: this.mockMode,
          lastTest: testResult.metadata.timestamp,
          responseTime: testResult.metadata.responseTimeMs,
          error: testResult.error,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        details: {
          error: error instanceof Error ? error.message : String(error),
          model: this.config.model,
          mockMode: this.mockMode,
        },
      };
    }
  }
}

/**
 * Create Gemini service instance
 */
export function createGeminiService(
  config: GeminiConfig,
  logger: Logger
): GeminiService {
  return new GeminiService(config, logger);
}

// Re-export types for compatibility
export type { GeminiConfig as OpenAIConfig, SentimentAnalysisRequest, SentimentAnalysisResult };
export { GeminiService as OpenAIService, createGeminiService as createOpenAIService };