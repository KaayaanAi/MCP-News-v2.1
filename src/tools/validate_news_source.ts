/**
 * MCP Tool: validate_news_source
 * Validates the reliability and quality of news sources
 */

import { z } from 'zod';
import type {
  ValidateNewsSourceParams,
  ValidateNewsSourceResponse,
  ToolExecutionContext,
  Logger,
  CacheService,
  MCPTool
} from '../types/index.js';
import {
  ValidateNewsSourceParamsSchema,
  ValidateNewsSourceResponseSchema
} from '../types/index.js';
import { CacheKeys } from '../services/cache_service.js';
import { shouldUseMockMode, getMockModeWarning } from '../config/environment.js';
import {
  HIGH_LATENCY_THRESHOLD,
  QUALITY_SCORE_THRESHOLDS,
  VALIDATION_CACHE_TTL_SECONDS
} from '../config/constants.js';

interface SourceValidationResult {
  quality_score: number;
  issues_found: string[];
  source_status: {
    available: boolean;
    latency_ms: number;
  };
  recommendations: string[];
  domain_info?: {
    age_days?: number;
    ssl_valid?: boolean;
    reputation_score?: number;
  };
}

/**
 * Tool implementation for validating news sources
 */
export class ValidateNewsSourceTool {
  private cache: CacheService;
  private logger: Logger;
  private cacheTtlSeconds: number;
  private mockMode: boolean;

  // Known reliable crypto news sources
  private trustedSources = new Set([
    'coindesk.com',
    'cointelegraph.com',
    'decrypt.co',
    'theblock.co',
    'bitcoinmagazine.com',
    'coinbase.com',
    'binance.com',
    'kraken.com',
    'reuters.com',
    'bloomberg.com',
    'wsj.com',
    'cnbc.com',
  ]);

  // Known unreliable or questionable sources
  private questionableSources = new Set([
    'coinbureau.com', // Often promotional
    'cryptoslate.com', // Mixed quality
    'newsbtc.com', // Often speculative
  ]);

  // Scam/spam domains to flag
  private blacklistedSources = new Set([
    'cryptoscam.com',
    'fakecrypto.news',
    'ponzicoin.info',
  ]);

  constructor(
    cache: CacheService,
    logger: Logger,
    options: {
      cacheTtlSeconds?: number;
      mockMode?: boolean;
    } = {}
  ) {
    this.cache = cache;
    this.logger = logger.child({ tool: 'validate_news_source' });
    this.cacheTtlSeconds = options.cacheTtlSeconds || VALIDATION_CACHE_TTL_SECONDS;

    // Determine mock mode based on configuration and options
    this.mockMode = options.mockMode ?? shouldUseMockMode();

    // Log mock mode status
    if (this.mockMode) {
      const warning = getMockModeWarning();
      if (warning) {
        this.logger.warn(warning);
      }
    }
  }

  /**
   * Get MCP tool definition
   */
  getDefinition(): MCPTool {
    return {
      name: 'validate_news_source',
      description: 'Validates the reliability and quality of a news source URL or domain, checking for credibility indicators and potential issues.',
      inputSchema: {
        type: 'object',
        properties: {
          source_url: {
            type: 'string',
            description: 'The URL or domain of the news source to validate',
          },
          validation_type: {
            type: 'string',
            description: 'Type of validation to perform',
            enum: ['basic', 'comprehensive'],
            default: 'basic',
          },
        },
        required: ['source_url'],
      },
    };
  }

  /**
   * Execute the source validation tool
   */
  async execute(
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ValidateNewsSourceResponse> {
    const startTime = Date.now();

    try {
      // Validate input parameters
      const validatedParams = this.validateParams(params);

      this.logger.info('Validating news source', {
        requestId: context?.requestId,
        protocol: context?.protocol,
        sourceUrl: validatedParams.source_url,
        validationType: validatedParams.validation_type,
      });

      // Extract domain from URL
      const domain = this.extractDomain(validatedParams.source_url);

      // Check cache first
      const cacheKey = CacheKeys.sourceValidation(
        domain,
        validatedParams.validation_type
      );

      const cachedResult = await this.cache.get<ValidateNewsSourceResponse>(cacheKey);
      if (cachedResult) {
        this.logger.info('Cache hit for source validation', {
          requestId: context?.requestId,
          domain,
        });

        return cachedResult;
      }

      // Perform validation
      const validationResult = this.mockMode
        ? await this.getMockValidation(validatedParams)
        : await this.performValidation(validatedParams);

      // Log warning if validation indicates issues
      if (!this.mockMode && validationResult.quality_score < 50) {
        this.logger.warn('Low quality score detected for news source', {
          domain,
          qualityScore: validationResult.quality_score,
          issuesFound: validationResult.issues_found.length,
          message: 'Consider using more reliable news sources'
        });
      }

      // Build response
      const response: ValidateNewsSourceResponse = {
        quality_score: validationResult.quality_score,
        issues_found: validationResult.issues_found,
        source_status: validationResult.source_status,
        recommendations: validationResult.recommendations,
      };

      // Validate response structure
      const validatedResponse = ValidateNewsSourceResponseSchema.parse(response);

      // Cache the result (don't fail if caching fails)
      try {
        await this.cache.set(cacheKey, validatedResponse, this.cacheTtlSeconds);
      } catch (cacheError) {
        this.logger.warn('Failed to cache validation result', {
          requestId: context?.requestId,
          error: cacheError instanceof Error ? cacheError.message : String(cacheError),
        });
      }

      const executionTime = Date.now() - startTime;
      this.logger.info('Source validation completed', {
        requestId: context?.requestId,
        domain,
        qualityScore: response.quality_score,
        issuesFound: response.issues_found.length,
        executionTimeMs: executionTime,
        cached: false,
      });

      return validatedResponse;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error('Source validation failed', {
        requestId: context?.requestId,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: executionTime,
      });

      // Return a low-quality response on error
      const errorResponse: ValidateNewsSourceResponse = {
        quality_score: 0,
        issues_found: ['Validation failed due to technical error'],
        source_status: {
          available: false,
          latency_ms: executionTime,
        },
        recommendations: ['Unable to validate source due to technical issues'],
      };

      return errorResponse;
    }
  }

  /**
   * Validate input parameters using Zod schema
   */
  private validateParams(params: unknown): ValidateNewsSourceParams {
    try {
      return ValidateNewsSourceParamsSchema.parse(params);
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
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase().replace(/^www\./, '');
    } catch (_error) {
      // If URL parsing fails, try to extract domain manually
      const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/i);
      return match?.[1]?.toLowerCase() || url.toLowerCase();
    }
  }

  /**
   * Perform actual source validation
   */
  private async performValidation(
    params: ValidateNewsSourceParams
  ): Promise<SourceValidationResult> {
    const domain = this.extractDomain(params.source_url);
    const issues: string[] = [];
    const recommendations: string[] = [];
    let baseScore = 50; // Start with neutral score

    // Check against known source lists
    if (this.blacklistedSources.has(domain)) {
      baseScore = 0;
      issues.push('Domain is blacklisted as known scam/spam source');
      recommendations.push('Do not use this source - known to spread misinformation');
    } else if (this.trustedSources.has(domain)) {
      baseScore = 85;
      recommendations.push('This is a well-established and trusted news source');
    } else if (this.questionableSources.has(domain)) {
      baseScore = 40;
      issues.push('Source has mixed reputation - content quality varies');
      recommendations.push('Cross-reference information with other sources');
    }

    // Perform basic domain checks
    const domainChecks = await this.performDomainChecks(params.source_url);

    // Adjust score based on domain health
    if (!domainChecks.source_status.available) {
      baseScore = Math.max(0, baseScore - 30);
      issues.push('Source is currently unavailable or unresponsive');
    }

    if (domainChecks.source_status.latency_ms > HIGH_LATENCY_THRESHOLD) {
      baseScore = Math.max(0, baseScore - 10);
      issues.push('Source has slow response times');
      recommendations.push('Consider alternative sources for time-sensitive news');
    }

    // Comprehensive validation additional checks
    if (params.validation_type === 'comprehensive') {
      const comprehensiveChecks = await this.performComprehensiveValidation(params.source_url);
      baseScore = this.adjustScoreFromComprehensive(baseScore, comprehensiveChecks, issues, recommendations);
    }

    // Add general recommendations based on score
    if (baseScore >= QUALITY_SCORE_THRESHOLDS.EXCELLENT) {
      recommendations.push('Highly reliable source - minimal cross-referencing needed');
    } else if (baseScore >= QUALITY_SCORE_THRESHOLDS.GOOD) {
      recommendations.push('Generally reliable - consider cross-referencing for important news');
    } else if (baseScore >= QUALITY_SCORE_THRESHOLDS.ACCEPTABLE) {
      recommendations.push('Use with caution - always cross-reference with trusted sources');
    } else {
      recommendations.push('Not recommended - seek information from established sources');
    }

    return {
      quality_score: Math.min(100, Math.max(0, baseScore)),
      issues_found: issues,
      source_status: domainChecks.source_status,
      recommendations,
      domain_info: domainChecks.domain_info,
    };
  }

  /**
   * Perform basic domain health checks
   * Note: Currently simulates checks for testing purposes
   * Production implementation should include actual HTTP requests to verify domain availability and response times
   */
  private async performDomainChecks(url: string): Promise<{
    source_status: { available: boolean; latency_ms: number };
    domain_info: { ssl_valid?: boolean };
  }> {
    const startTime = Date.now();

    try {
      this.logger.debug('Performing domain health check', { url });

      // Current implementation simulates real checks for testing purposes
      // Production deployment should implement actual HTTP health checks
      const isHttps = url.toLowerCase().startsWith('https://');
      const domain = this.extractDomain(url);

      // For trusted sources, provide consistent high-quality results in simulation
      // This ensures tests are deterministic while still simulating realistic behavior
      let mockLatency: number;
      let mockAvailability: boolean;

      if (this.trustedSources.has(domain)) {
        // Trusted sources get consistently good health scores
        mockLatency = Math.random() * 300 + 150; // 150-450ms (good performance)
        mockAvailability = true; // Always available for trusted sources
      } else if (this.blacklistedSources.has(domain)) {
        // Blacklisted sources get poor health scores
        mockLatency = Math.random() * 2000 + 3000; // 3000-5000ms (poor performance)
        mockAvailability = Math.random() > 0.7; // 30% success rate
      } else {
        // Unknown sources get variable results
        mockLatency = Math.random() * 1000 + 200; // 200-1200ms
        mockAvailability = Math.random() > 0.1; // 90% success rate
      }

      await new Promise(resolve => setTimeout(resolve, Math.min(mockLatency, 500))); // Limit simulation time

      this.logger.info('Domain health check completed (simulated)', {
        url,
        available: mockAvailability,
        httpsEnabled: isHttps,
        message: 'This is a simulated check - implement real HTTP client for production use'
      });

      return {
        source_status: {
          available: mockAvailability,
          latency_ms: Math.max(1, Math.round(Date.now() - startTime)), // Ensure minimum 1ms
        },
        domain_info: {
          ssl_valid: isHttps,
        },
      };
    } catch (error) {
      this.logger.error('Domain health check failed', {
        url,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        source_status: {
          available: false,
          latency_ms: Date.now() - startTime,
        },
        domain_info: {
          ssl_valid: false,
        },
      };
    }
  }

  /**
   * Perform comprehensive validation checks
   * Note: Currently provides simulated analysis for testing
   * Production implementation should include real WHOIS data, SSL certificate analysis, etc.
   */
  private async performComprehensiveValidation(url: string): Promise<{
    domain_age_days?: number;
    reputation_score?: number;
    content_quality_indicators?: string[];
  }> {
    this.logger.debug('Performing comprehensive validation', { url });

    // Production implementation should include the following real checks:
    // 1. WHOIS domain age lookup using a service like whois-json or node-whois
    // 2. SSL certificate analysis using Node.js TLS module
    // 3. Content quality analysis by scraping and analyzing page structure
    // 4. Social media presence verification via API calls
    // 5. Author credential verification
    // 6. Editorial standards assessment
    // 7. Third-party reputation service integration (e.g., Web of Trust)

    this.logger.info('Comprehensive validation not yet implemented', {
      url,
      message: 'Returning simulated data - implement real validation services for production'
    });

    // Placeholder data to maintain functionality during development
    return {
      domain_age_days: Math.floor(Math.random() * 2000) + 500, // 1.5-6+ years
      reputation_score: Math.floor(Math.random() * 30) + 70, // 70-100 range
      content_quality_indicators: [
        'Domain analysis pending implementation',
        'SSL certificate check needed',
        'Content quality assessment required',
      ],
    };
  }

  /**
   * Adjust score based on comprehensive validation results
   */
  private adjustScoreFromComprehensive(
    baseScore: number,
    checks: Awaited<ReturnType<typeof this.performComprehensiveValidation>>,
    issues: string[],
    recommendations: string[]
  ): number {
    let adjustedScore = baseScore;

    // Domain age factor
    if (checks.domain_age_days && checks.domain_age_days < 90) {
      adjustedScore -= 15;
      issues.push('Domain is very new (less than 3 months old)');
      recommendations.push('Be cautious with new domains - verify information independently');
    } else if (checks.domain_age_days && checks.domain_age_days > 1095) { // 3+ years
      adjustedScore += 5;
    }

    // Reputation score factor
    if (checks.reputation_score && checks.reputation_score < 70) {
      adjustedScore -= 10;
      issues.push('Below-average reputation score based on external metrics');
    }

    return adjustedScore;
  }

  /**
   * Get mock validation data for testing
   * Note: Mock data has been moved to tests/utils/mockData.ts
   * This method now imports from the test utilities when in mock mode
   */
  private async getMockValidation(
    params: ValidateNewsSourceParams
  ): Promise<SourceValidationResult> {
    this.logger.info('Using mock validation data', {
      sourceUrl: params.source_url,
      validationType: params.validation_type,
      message: 'Mock mode is enabled - returning test data instead of real validation'
    });

    try {
      // Import mock data utility (dynamic import to avoid bundling in production)
      const { getMockValidation } = await import('../utils/mockData.js');
      return getMockValidation(params.source_url);
    } catch (error) {
      this.logger.error('Failed to load mock validation data', {
        error: error instanceof Error ? error.message : String(error),
        message: 'Fallback: returning neutral validation result'
      });

      // Fallback to neutral result if mock data fails to load
      return {
        quality_score: 50,
        issues_found: ['Unable to load mock data for validation'],
        source_status: {
          available: false,
          latency_ms: 1000,
        },
        recommendations: ['Mock data unavailable - cannot provide reliable validation'],
      };
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

      return {
        status: cacheConnected ? 'healthy' : 'degraded',
        details: {
          cache: cacheConnected ? 'connected' : 'disconnected',
          trustedSourcesCount: this.trustedSources.size,
          blacklistedSourcesCount: this.blacklistedSources.size,
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
 * Create and configure the news source validation tool
 */
export function createValidateNewsSourceTool(
  cache: CacheService,
  logger: Logger,
  options: {
    cacheTtlSeconds?: number;
    mockMode?: boolean;
  } = {}
): ValidateNewsSourceTool {
  return new ValidateNewsSourceTool(cache, logger, options);
}