/**
 * Cache service supporting both Redis and in-memory caching
 * Automatically falls back to memory cache if Redis is unavailable
 */

import { createClient, RedisClientType } from 'redis';
import type { CacheService, Logger } from '../types/index.js';

/**
 * Redis-based cache service
 */
class RedisCacheService implements CacheService {
  private client: RedisClientType;
  private connected = false;
  private logger: Logger;

  constructor(redisUrl: string, logger: Logger) {
    this.logger = logger.child({ component: 'RedisCache' });
    this.client = createClient({ url: redisUrl });

    // Setup Redis event handlers
    this.client.on('connect', () => {
      this.logger.info('Redis client connecting...');
    });

    this.client.on('ready', () => {
      this.connected = true;
      this.logger.info('Redis client ready');
    });

    this.client.on('error', (err) => {
      this.connected = false;
      this.logger.error('Redis client error', err);
    });

    this.client.on('end', () => {
      this.connected = false;
      this.logger.info('Redis client connection ended');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.error('Failed to connect to Redis', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
      this.connected = false;
    } catch (error) {
      this.logger.error('Error disconnecting from Redis', error);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.connected) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (value === null) {
        return null;
      }

      const parsed = JSON.parse(value) as T;
      this.logger.debug('Cache hit', { key });
      return parsed;
    } catch (error) {
      this.logger.error('Cache get error', { key, error });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      const serialized = JSON.stringify(value);

      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.setEx(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }

      this.logger.debug('Cache set', { key, ttl: ttlSeconds });
    } catch (error) {
      this.logger.error('Cache set error', { key, error });
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.client.del(key);
      this.logger.debug('Cache delete', { key });
    } catch (error) {
      this.logger.error('Cache delete error', { key, error });
    }
  }

  async clear(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.client.flushDb();
      this.logger.info('Cache cleared');
    } catch (error) {
      this.logger.error('Cache clear error', error);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * In-memory cache service with TTL support
 */
class MemoryCacheService implements CacheService {
  private cache = new Map<string, { value: unknown; expires?: number }>();
  private logger: Logger;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'MemoryCache' });

    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 5 * 60 * 1000);

    this.logger.info('Memory cache initialized');
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expires && Date.now() > entry.expires) {
      this.cache.delete(key);
      this.logger.debug('Cache entry expired', { key });
      return null;
    }

    this.logger.debug('Cache hit', { key });
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expires = ttlSeconds && ttlSeconds > 0
      ? Date.now() + (ttlSeconds * 1000)
      : undefined;

    this.cache.set(key, { value, expires });
    this.logger.debug('Cache set', { key, ttl: ttlSeconds });
  }

  async delete(key: string): Promise<void> {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.logger.debug('Cache delete', { key });
    }
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.logger.info('Cache cleared');
  }

  isConnected(): boolean {
    return true; // Memory cache is always "connected"
  }


  private cleanupExpired(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires && now > entry.expires) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug('Cleaned up expired cache entries', { count: cleanedCount });
    }
  }

}

/**
 * Cache service factory that automatically chooses between Redis and Memory cache
 */
export async function createCacheService(
  redisUrl: string | undefined,
  logger: Logger
): Promise<CacheService> {
  // If no Redis URL provided, use memory cache
  if (!redisUrl) {
    logger.info('No Redis URL provided, using memory cache');
    return new MemoryCacheService(logger);
  }

  // Try to connect to Redis
  try {
    const redisCache = new RedisCacheService(redisUrl, logger);
    await redisCache.connect();
    logger.info('Using Redis cache', { url: redisUrl });
    return redisCache;
  } catch (error) {
    logger.warn('Failed to connect to Redis, falling back to memory cache', { error });
    return new MemoryCacheService(logger);
  }
}

/**
 * Cache key generator utilities
 */
export class CacheKeys {
  static sentiment(content: string, coins: string[]): string {
    const hash = this.hash(content + coins.sort().join(','));
    return `sentiment:${hash}`;
  }

  static news(query: string, sources?: string[], limit?: number): string {
    const key = `${query}:${sources?.sort().join(',') || 'all'}:${limit || 10}`;
    const hash = this.hash(key);
    return `news:${hash}`;
  }

  static sourceValidation(url: string, type: string): string {
    const hash = this.hash(url + type);
    return `validation:${hash}`;
  }

  static rateLimit(identifier: string): string {
    return `ratelimit:${identifier}`;
  }

  private static hash(input: string): string {
    // Simple hash function for cache keys
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

export { RedisCacheService, MemoryCacheService };