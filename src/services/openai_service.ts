/**
 * OpenAI service for cryptocurrency sentiment analysis
 * Handles AI-powered analysis with structured prompts and error handling
 */

import OpenAI from 'openai';
import type { Logger, ServiceResponse } from '../types/index.js';

interface OpenAIConfig {
  apiKey: string;
  model: string;
  maxCompletionTokens: number;
  temperature: number;
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
 * OpenAI service for cryptocurrency sentiment analysis
 */
export class OpenAIService {
  private client: OpenAI;
  private config: OpenAIConfig;
  private logger: Logger;

  constructor(config: OpenAIConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'OpenAIService' });

    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
    });

    this.logger.info('OpenAI service initialized', {
      model: config.model,
      maxCompletionTokens: config.maxCompletionTokens,
      temperature: config.temperature,
    });
  }

  /**
   * Analyze cryptocurrency sentiment using OpenAI
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
      });

      const prompt = this.buildSentimentPrompt(request);

      const completion = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(request.analysisDepth),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_completion_tokens: this.config.maxCompletionTokens,
        temperature: this.config.model.includes('gpt-5-nano') ? 1 : this.config.temperature,
        response_format: { type: 'json_object' },
      });

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) {
        throw new Error('No response from OpenAI');
      }

      const result = this.parseAnalysisResult(responseText);
      const responseTime = Date.now() - startTime;

      this.logger.info('Sentiment analysis completed', {
        impact: result.impact,
        confidence: result.confidence_score,
        responseTimeMs: responseTime,
        tokensUsed: completion.usage?.total_tokens,
      });

      return {
        success: true,
        data: result,
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
   * Test OpenAI connection and availability
   */
  async testConnection(): Promise<ServiceResponse<{ status: string; model: string }>> {
    const startTime = Date.now();

    try {
      await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: 'user',
            content: 'Hello, please respond with "OK" if you are working correctly.',
          },
        ],
        max_completion_tokens: 10,
        temperature: this.config.model.includes('gpt-5-nano') ? 1 : this.config.temperature,
      });

      const responseTime = Date.now() - startTime;

      this.logger.info('OpenAI connection test successful', {
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
      this.logger.error('OpenAI connection test failed', {
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

    const basePrompt = `
Analyze the sentiment of this cryptocurrency-related content:

**Content:** ${content}
**Source:** ${source}
**Target Cryptocurrencies:** ${coins.join(', ')}
**Analysis Depth:** ${analysisDepth}

Please analyze this content and determine its potential impact on the specified cryptocurrencies.
    `.trim();

    if (analysisDepth === 'comprehensive') {
      return basePrompt + `

Consider the following factors in your comprehensive analysis:
1. Market sentiment indicators and language tone
2. Technical developments mentioned (upgrades, partnerships, regulations)
3. Market timing and context (bull/bear market conditions)
4. Source credibility and potential bias
5. Volume of social engagement if applicable
6. Historical patterns for similar news types

Provide detailed reasoning for your assessment.`;
    }

    return basePrompt + '\n\nProvide a concise analysis focusing on the direct market impact.';
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
   * Parse OpenAI response into structured result
   */
  private parseAnalysisResult(responseText: string): SentimentAnalysisResult {
    try {
      const parsed = JSON.parse(responseText);

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
      this.logger.error('Failed to parse OpenAI response', {
        error: error instanceof Error ? error.message : String(error),
        response: responseText.slice(0, 500),
      });

      // Return a fallback result
      return {
        impact: 'Neutral',
        confidence_score: 0,
        summary: 'Analysis failed - unable to parse response',
        affected_coins: [],
        reasoning: 'OpenAI response parsing failed',
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
        },
      };
    }
  }
}

/**
 * Create OpenAI service instance
 */
export function createOpenAIService(
  config: OpenAIConfig,
  logger: Logger
): OpenAIService {
  return new OpenAIService(config, logger);
}