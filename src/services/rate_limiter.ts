/**
 * Rate limiter service with sliding window algorithm
 * Supports both Redis and in-memory storage
 */

import type { RateLimiter, RateLimitInfo, CacheService, Logger } from '../types/index.js';
import { CacheKeys } from './cache_service.js';

/**
 * Sliding window rate limiter implementation
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private cache: CacheService;
  private logger: Logger;
  private windowMs: number;
  private maxRequests: number;

  constructor(
    cache: CacheService,
    logger: Logger,
    options: {
      windowMs: number;
      maxRequests: number;
    }
  ) {
    this.cache = cache;
    this.logger = logger.child({ component: 'RateLimiter' });
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;

    this.logger.info('Rate limiter initialized', {
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
    });
  }

  async checkLimit(identifier: string): Promise<RateLimitInfo> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const cacheKey = CacheKeys.rateLimit(identifier);

    try {
      // Get current request timestamps
      const requestTimestamps = await this.cache.get<number[]>(cacheKey) || [];

      // Filter out old requests outside the current window
      const validRequests = requestTimestamps.filter(timestamp => timestamp > windowStart);

      // Check if limit exceeded
      const isBlocked = validRequests.length >= this.maxRequests;
      const resetTimeMs = validRequests.length > 0
        ? Math.min(...validRequests) + this.windowMs
        : now + this.windowMs;

      // Add current request if not blocked
      if (!isBlocked) {
        validRequests.push(now);
        await this.cache.set(cacheKey, validRequests, Math.ceil(this.windowMs / 1000));

        this.logger.debug('Request allowed', {
          identifier,
          totalRequests: validRequests.length,
          remainingRequests: Math.max(0, this.maxRequests - validRequests.length),
        });
      } else {
        this.logger.warn('Rate limit exceeded', {
          identifier,
          totalRequests: validRequests.length,
          maxRequests: this.maxRequests,
        });
      }

      return {
        totalRequests: validRequests.length,
        remainingRequests: isBlocked ? 0 : Math.max(0, this.maxRequests - validRequests.length),
        resetTimeMs,
        isBlocked,
      };
    } catch (error) {
      this.logger.error('Rate limit check failed', { identifier, error });

      // Fail open - allow request if rate limiter is broken
      return {
        totalRequests: 0,
        remainingRequests: this.maxRequests,
        resetTimeMs: now + this.windowMs,
        isBlocked: false,
      };
    }
  }

  async resetLimit(identifier: string): Promise<void> {
    const cacheKey = CacheKeys.rateLimit(identifier);

    try {
      await this.cache.delete(cacheKey);
      this.logger.info('Rate limit reset', { identifier });
    } catch (error) {
      this.logger.error('Failed to reset rate limit', { identifier, error });
    }
  }

  /**
   * Get current rate limit status without incrementing
   */
  async getStatus(identifier: string): Promise<RateLimitInfo> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const cacheKey = CacheKeys.rateLimit(identifier);

    try {
      const requestTimestamps = await this.cache.get<number[]>(cacheKey) || [];
      const validRequests = requestTimestamps.filter(timestamp => timestamp > windowStart);

      const isBlocked = validRequests.length >= this.maxRequests;
      const resetTimeMs = validRequests.length > 0
        ? Math.min(...validRequests) + this.windowMs
        : now + this.windowMs;

      return {
        totalRequests: validRequests.length,
        remainingRequests: Math.max(0, this.maxRequests - validRequests.length),
        resetTimeMs,
        isBlocked,
      };
    } catch (error) {
      this.logger.error('Failed to get rate limit status', { identifier, error });

      return {
        totalRequests: 0,
        remainingRequests: this.maxRequests,
        resetTimeMs: now + this.windowMs,
        isBlocked: false,
      };
    }
  }
}


/**
 * Rate limiter middleware factory for Express
 */
export function createRateLimitMiddleware(
  rateLimiter: RateLimiter,
  options: {
    keyGenerator?: (req: import('express').Request) => string;
    skip?: (req: import('express').Request) => boolean;
    onLimitReached?: (req: import('express').Request, rateLimitInfo: RateLimitInfo) => void;
  } = {}
) {
  const {
    keyGenerator = (req) => req.ip || 'anonymous',
    skip = () => false,
    onLimitReached
  } = options;

  return async (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    // Skip rate limiting if specified
    if (skip(req)) {
      return next();
    }

    const identifier = keyGenerator(req);

    try {
      const rateLimitInfo = await rateLimiter.checkLimit(identifier);

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': rateLimitInfo.totalRequests.toString(),
        'X-RateLimit-Remaining': rateLimitInfo.remainingRequests.toString(),
        'X-RateLimit-Reset': new Date(rateLimitInfo.resetTimeMs).toISOString(),
      });

      if (rateLimitInfo.isBlocked) {
        if (onLimitReached) {
          onLimitReached(req, rateLimitInfo);
        }

        return res.status(429).json({
          error: {
            code: -32003,
            message: 'Rate limit exceeded',
            type: 'RATE_LIMIT_EXCEEDED',
            details: {
              limit: rateLimitInfo.totalRequests,
              resetTime: new Date(rateLimitInfo.resetTimeMs).toISOString(),
            },
          },
        });
      }

      next();
    } catch (_error) {
      // Log error but don't block request if rate limiter fails
      // In production, this should be handled by the application's error logging system
      // For now, we silently fail open to avoid blocking requests when rate limiter fails
      next();
    }
  };
}

