/**
 * Environment configuration for MCP News Server
 * Handles environment variables and configuration validation
 */

import { z } from 'zod';

// Environment variable schema
const EnvironmentSchema = z.object({
  // Server configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('localhost'),

  // Mock mode configuration
  MOCK_MODE: z.coerce.boolean().default(false),

  // API Keys (optional, will disable corresponding integrations if not provided)
  NEWS_API_KEY: z.string().optional(),
  CRYPTO_PANIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Redis configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Cache configuration
  CACHE_TTL_SECONDS: z.coerce.number().default(1800), // 30 minutes
  NEWS_CACHE_TTL_SECONDS: z.coerce.number().default(1800),
  VALIDATION_CACHE_TTL_SECONDS: z.coerce.number().default(7200), // 2 hours

  // Rate limiting
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().default(150),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000), // 1 minute

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(true),

  // OpenAI configuration
  OPENAI_MODEL: z.string().default('gpt-3.5-turbo'),
  OPENAI_MAX_TOKENS: z.coerce.number().default(1000),
  OPENAI_TEMPERATURE: z.coerce.number().default(0.3),
});

type EnvironmentConfig = z.infer<typeof EnvironmentSchema>;

/**
 * Parse and validate environment configuration
 */
function parseEnvironmentConfig(): EnvironmentConfig {
  try {
    return EnvironmentSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue =>
        `${issue.path.join('.')}: ${issue.message}`
      ).join('\n');
      throw new Error(`Environment configuration validation failed:\n${issues}`);
    }
    throw new Error('Failed to parse environment configuration');
  }
}

// Parse configuration on module load
export const config = parseEnvironmentConfig();

/**
 * Check if mock mode should be enabled
 * Mock mode is enabled if:
 * 1. MOCK_MODE environment variable is true, OR
 * 2. NODE_ENV is 'test', OR
 * 3. No API keys are configured and NODE_ENV is 'development'
 */
export function shouldUseMockMode(): boolean {
  if (config.MOCK_MODE) {
    return true;
  }

  if (config.NODE_ENV === 'test') {
    return true;
  }

  // Auto-enable mock mode in development if no API keys are configured
  if (config.NODE_ENV === 'development') {
    const hasApiKeys = !!(config.NEWS_API_KEY || config.CRYPTO_PANIC_API_KEY);
    return !hasApiKeys;
  }

  return false;
}

/**
 * Get configured news API sources
 */
export function getConfiguredNewsSources(): {
  newsApi: boolean;
  cryptoPanic: boolean;
  coinDesk: boolean;
} {
  return {
    newsApi: !!config.NEWS_API_KEY,
    cryptoPanic: !!config.CRYPTO_PANIC_API_KEY,
    coinDesk: true, // CoinDesk is always available (no API key required for basic RSS)
  };
}

/**
 * Validate that required configuration is present for production
 */
export function validateProductionConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.NODE_ENV === 'production') {
    // In production, we should have at least one API key configured
    if (!config.NEWS_API_KEY && !config.CRYPTO_PANIC_API_KEY) {
      errors.push('No news API keys configured for production deployment');
    }

    // OpenAI key should be configured for sentiment analysis
    if (!config.OPENAI_API_KEY) {
      errors.push('OPENAI_API_KEY not configured for production deployment');
    }

    // Mock mode should not be enabled in production
    if (shouldUseMockMode()) {
      errors.push('Mock mode is enabled in production environment');
    }

    // Redis should be properly configured
    if (!config.REDIS_URL && (!config.REDIS_HOST || !config.REDIS_PORT)) {
      errors.push('Redis configuration incomplete for production deployment');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get mock mode warning message
 */
export function getMockModeWarning(): string | null {
  if (!shouldUseMockMode()) {
    return null;
  }

  const reasons = [];

  if (config.MOCK_MODE) {
    reasons.push('MOCK_MODE environment variable is enabled');
  }

  if (config.NODE_ENV === 'test') {
    reasons.push('running in test environment');
  }

  if (config.NODE_ENV === 'development' && !config.NEWS_API_KEY && !config.CRYPTO_PANIC_API_KEY) {
    reasons.push('no API keys configured in development');
  }

  return `🧪 Mock mode is enabled (${reasons.join(', ')}). Set API keys and MOCK_MODE=false for real data.`;
}

// Export configuration for use throughout the application
export default config;