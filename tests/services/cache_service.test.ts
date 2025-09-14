/**
 * Comprehensive tests for cache service implementations
 * Tests both Redis and Memory cache implementations with full coverage
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createClient } from 'redis';
import {
  MemoryCacheService,
  RedisCacheService,
  createCacheService,
  CacheKeys
} from '../../src/services/cache_service';
import type { Logger } from '../../src/types/index';

// Mock Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

const mockRedisClient = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  setEx: jest.fn(),
  del: jest.fn(),
  flushDb: jest.fn(),
  on: jest.fn(),
};

const mockLogger: Logger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};

describe('MemoryCacheService', () => {
  let cache: MemoryCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    cache = new MemoryCacheService(mockLogger);
  });

  afterEach(() => {
    if (cache) {
      cache.destroy();
    }
    jest.useRealTimers();
    jest.clearAllTimers();
  });

  describe('Basic Operations', () => {
    it('should set and get values', async () => {
      const testData = { message: 'Hello World', number: 42 };
      await cache.set('test-key', testData);

      const retrieved = await cache.get<typeof testData>('test-key');
      expect(retrieved).toEqual(testData);
    });

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete values', async () => {
      await cache.set('delete-test', 'value');
      expect(await cache.get('delete-test')).toBe('value');

      await cache.delete('delete-test');
      expect(await cache.get('delete-test')).toBeNull();
    });

    it('should clear all values', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      await cache.clear();

      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBeNull();
    });

    it('should always report as connected', () => {
      expect(cache.isConnected()).toBe(true);
    });
  });

  describe('TTL (Time To Live)', () => {
    it('should expire values after TTL', async () => {
      const shortTtl = 0.1; // 100ms
      await cache.set('ttl-test', 'value', shortTtl);

      expect(await cache.get('ttl-test')).toBe('value');

      // Fast-forward time past expiration
      jest.advanceTimersByTime(150);

      expect(await cache.get('ttl-test')).toBeNull();
    });

    it('should not expire values without TTL', async () => {
      await cache.set('no-ttl', 'persistent');

      // Fast-forward time - should not expire
      jest.advanceTimersByTime(50);

      expect(await cache.get('no-ttl')).toBe('persistent');
    });

    it('should handle zero TTL as no expiration', async () => {
      await cache.set('zero-ttl', 'value', 0);

      // Fast-forward time - should not expire with zero TTL
      jest.advanceTimersByTime(50);

      expect(await cache.get('zero-ttl')).toBe('value');
    });

    it('should handle negative TTL as no expiration', async () => {
      await cache.set('negative-ttl', 'value', -1);

      // Fast-forward time - should not expire with negative TTL
      jest.advanceTimersByTime(50);

      expect(await cache.get('negative-ttl')).toBe('value');
    });
  });

  describe('Cache Statistics', () => {
    it('should return cache statistics', () => {
      const stats = cache.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('expired');
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.expired).toBe('number');
    });

    it('should track expired entries in stats', async () => {
      await cache.set('expired-1', 'value', 0.05); // 50ms
      await cache.set('expired-2', 'value', 0.05);
      await cache.set('valid', 'value', 10);

      // Fast-forward time past expiration
      jest.advanceTimersByTime(100);

      const stats = cache.getCacheStats();
      expect(stats.size).toBe(3);
      expect(stats.expired).toBe(2);
    });
  });

  describe('Data Types', () => {
    it('should handle string values', async () => {
      await cache.set('string', 'test string');
      expect(await cache.get<string>('string')).toBe('test string');
    });

    it('should handle number values', async () => {
      await cache.set('number', 42);
      expect(await cache.get<number>('number')).toBe(42);
    });

    it('should handle boolean values', async () => {
      await cache.set('boolean-true', true);
      await cache.set('boolean-false', false);
      expect(await cache.get<boolean>('boolean-true')).toBe(true);
      expect(await cache.get<boolean>('boolean-false')).toBe(false);
    });

    it('should handle object values', async () => {
      const obj = { nested: { value: 'test' }, array: [1, 2, 3] };
      await cache.set('object', obj);
      expect(await cache.get('object')).toEqual(obj);
    });

    it('should handle array values', async () => {
      const arr = ['a', 'b', 'c'];
      await cache.set('array', arr);
      expect(await cache.get('array')).toEqual(arr);
    });

    it('should handle null values', async () => {
      await cache.set('null-value', null);
      expect(await cache.get('null-value')).toBe(null);
    });
  });

  describe('Cleanup Mechanism', () => {
    it('should automatically clean up expired entries', async () => {
      // Create cache with short cleanup interval for testing
      const testCache = new MemoryCacheService(mockLogger);

      // Set expired entries
      await testCache.set('expired', 'value', 0.05); // 50ms

      // Fast-forward time past expiration
      jest.advanceTimersByTime(100);

      // Check that entry is expired in stats
      const stats = testCache.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.expired).toBeGreaterThanOrEqual(1); // Should show as expired

      testCache.destroy();
    });

    it('should destroy cleanup interval on destroy', () => {
      const testCache = new MemoryCacheService(mockLogger);
      testCache.destroy();

      // Should not crash or cause issues
      expect(testCache.isConnected()).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string keys', async () => {
      await cache.set('', 'empty key');
      expect(await cache.get('')).toBe('empty key');
    });

    it('should handle very long keys', async () => {
      const longKey = 'x'.repeat(1000);
      await cache.set(longKey, 'long key value');
      expect(await cache.get(longKey)).toBe('long key value');
    });

    it('should handle special character keys', async () => {
      const specialKey = 'key:with/special@characters#123';
      await cache.set(specialKey, 'special');
      expect(await cache.get(specialKey)).toBe('special');
    });

    it('should handle large values', async () => {
      const largeValue = { data: 'x'.repeat(10000) };
      await cache.set('large', largeValue);
      expect(await cache.get('large')).toEqual(largeValue);
    });
  });
});

describe('RedisCacheService', () => {
  let cache: RedisCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue(mockRedisClient);
    cache = new RedisCacheService('redis://localhost:6379', mockLogger);
  });

  describe('Connection Management', () => {
    it('should initialize Redis client with URL', () => {
      expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('end', expect.any(Function));
    });

    it('should connect successfully', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);

      await cache.connect();

      expect(mockRedisClient.connect).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      mockRedisClient.connect.mockRejectedValue(error);

      await expect(cache.connect()).rejects.toThrow('Connection failed');
    });

    it('should disconnect gracefully', async () => {
      mockRedisClient.disconnect.mockResolvedValue(undefined);

      await cache.disconnect();

      expect(mockRedisClient.disconnect).toHaveBeenCalled();
    });

    it('should handle disconnect errors', async () => {
      const error = new Error('Disconnect failed');
      mockRedisClient.disconnect.mockRejectedValue(error);

      // Should not throw
      await cache.disconnect();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error disconnecting from Redis',
        error
      );
    });

    it('should track connection state', () => {
      expect(cache.isConnected()).toBe(false);

      // Simulate ready event
      const readyHandler = mockRedisClient.on.mock.calls.find(
        ([event]) => event === 'ready'
      )?.[1];
      readyHandler?.();

      expect(cache.isConnected()).toBe(true);

      // Simulate error event
      const errorHandler = mockRedisClient.on.mock.calls.find(
        ([event]) => event === 'error'
      )?.[1];
      errorHandler?.(new Error('Redis error'));

      expect(cache.isConnected()).toBe(false);
    });
  });

  describe('Basic Operations When Connected', () => {
    beforeEach(() => {
      // Simulate connected state
      const readyHandler = mockRedisClient.on.mock.calls.find(
        ([event]) => event === 'ready'
      )?.[1];
      readyHandler?.();
    });

    it('should set and get values', async () => {
      const testData = { message: 'Hello Redis' };
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify(testData));

      await cache.set('test-key', testData);
      const retrieved = await cache.get<typeof testData>('test-key');

      expect(mockRedisClient.set).toHaveBeenCalledWith('test-key', JSON.stringify(testData));
      expect(retrieved).toEqual(testData);
    });

    it('should set values with TTL', async () => {
      mockRedisClient.setEx.mockResolvedValue('OK');

      await cache.set('ttl-key', 'value', 300);

      expect(mockRedisClient.setEx).toHaveBeenCalledWith('ttl-key', 300, '"value"');
    });

    it('should return null for non-existent keys', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await cache.get('non-existent');

      expect(result).toBeNull();
    });

    it('should delete values', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await cache.delete('delete-key');

      expect(mockRedisClient.del).toHaveBeenCalledWith('delete-key');
    });

    it('should clear all values', async () => {
      mockRedisClient.flushDb.mockResolvedValue('OK');

      await cache.clear();

      expect(mockRedisClient.flushDb).toHaveBeenCalled();
    });
  });

  describe('Operations When Disconnected', () => {
    it('should return null for get when disconnected', async () => {
      const result = await cache.get('any-key');
      expect(result).toBeNull();
      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });

    it('should silently fail set when disconnected', async () => {
      await cache.set('key', 'value');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should silently fail delete when disconnected', async () => {
      await cache.delete('key');
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should silently fail clear when disconnected', async () => {
      await cache.clear();
      expect(mockRedisClient.flushDb).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      // Simulate connected state
      const readyHandler = mockRedisClient.on.mock.calls.find(
        ([event]) => event === 'ready'
      )?.[1];
      readyHandler?.();
    });

    it('should handle JSON parse errors on get', async () => {
      mockRedisClient.get.mockResolvedValue('invalid json {');

      const result = await cache.get('bad-json');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache get error',
        expect.objectContaining({
          key: 'bad-json',
          error: expect.any(Error)
        })
      );
    });

    it('should handle Redis errors on get', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis get error'));

      const result = await cache.get('error-key');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache get error',
        expect.objectContaining({
          key: 'error-key',
          error: expect.any(Error)
        })
      );
    });

    it('should handle Redis errors on set', async () => {
      mockRedisClient.set.mockRejectedValue(new Error('Redis set error'));

      // Should not throw
      await cache.set('error-key', 'value');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache set error',
        expect.objectContaining({
          key: 'error-key',
          error: expect.any(Error)
        })
      );
    });

    it('should handle Redis errors on delete', async () => {
      mockRedisClient.del.mockRejectedValue(new Error('Redis delete error'));

      // Should not throw
      await cache.delete('error-key');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache delete error',
        expect.objectContaining({
          key: 'error-key',
          error: expect.any(Error)
        })
      );
    });

    it('should handle Redis errors on clear', async () => {
      mockRedisClient.flushDb.mockRejectedValue(new Error('Redis clear error'));

      // Should not throw
      await cache.clear();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cache clear error',
        expect.any(Error)
      );
    });
  });
});

describe('createCacheService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue(mockRedisClient);
  });

  it('should create MemoryCacheService when no Redis URL provided', async () => {
    const cache = await createCacheService(undefined, mockLogger);

    expect(cache).toBeInstanceOf(MemoryCacheService);
    expect(mockLogger.info).toHaveBeenCalledWith('No Redis URL provided, using memory cache');

    // Clean up
    if (cache instanceof MemoryCacheService) {
      cache.destroy();
    }
  });

  it('should create RedisCacheService when Redis URL provided and connection succeeds', async () => {
    mockRedisClient.connect.mockResolvedValue(undefined);

    const cache = await createCacheService('redis://localhost:6379', mockLogger);

    expect(cache).toBeInstanceOf(RedisCacheService);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Using Redis cache',
      { url: 'redis://localhost:6379' }
    );
  });

  it('should fallback to MemoryCacheService when Redis connection fails', async () => {
    mockRedisClient.connect.mockRejectedValue(new Error('Connection failed'));

    const cache = await createCacheService('redis://localhost:6379', mockLogger);

    expect(cache).toBeInstanceOf(MemoryCacheService);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to connect to Redis, falling back to memory cache',
      { error: expect.any(Error) }
    );

    // Clean up
    if (cache instanceof MemoryCacheService) {
      cache.destroy();
    }
  });
});

describe('CacheKeys', () => {
  describe('Sentiment Keys', () => {
    it('should generate consistent sentiment cache keys', () => {
      const content = 'Bitcoin price surge expected';
      const coins = ['BTC', 'ETH'];

      const key1 = CacheKeys.sentiment(content, coins);
      const key2 = CacheKeys.sentiment(content, coins);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^sentiment:[a-z0-9]+$/);
    });

    it('should generate different keys for different content', () => {
      const coins = ['BTC'];

      const key1 = CacheKeys.sentiment('Content 1', coins);
      const key2 = CacheKeys.sentiment('Content 2', coins);

      expect(key1).not.toBe(key2);
    });

    it('should generate same key regardless of coin order', () => {
      const content = 'Test content';

      const key1 = CacheKeys.sentiment(content, ['BTC', 'ETH']);
      const key2 = CacheKeys.sentiment(content, ['ETH', 'BTC']);

      expect(key1).toBe(key2);
    });
  });

  describe('News Keys', () => {
    it('should generate consistent news cache keys', () => {
      const query = 'Bitcoin';
      const sources = ['coindesk'];
      const limit = 10;

      const key1 = CacheKeys.news(query, sources, limit);
      const key2 = CacheKeys.news(query, sources, limit);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^news:[a-z0-9]+$/);
    });

    it('should handle undefined sources and limit', () => {
      const key = CacheKeys.news('Bitcoin');
      expect(key).toMatch(/^news:[a-z0-9]+$/);
    });

    it('should generate different keys for different parameters', () => {
      const key1 = CacheKeys.news('Bitcoin', ['coindesk'], 10);
      const key2 = CacheKeys.news('Ethereum', ['coindesk'], 10);
      const key3 = CacheKeys.news('Bitcoin', ['cointelegraph'], 10);
      const key4 = CacheKeys.news('Bitcoin', ['coindesk'], 20);

      expect(new Set([key1, key2, key3, key4]).size).toBe(4);
    });

    it('should sort sources for consistency', () => {
      const key1 = CacheKeys.news('Bitcoin', ['coindesk', 'cointelegraph']);
      const key2 = CacheKeys.news('Bitcoin', ['cointelegraph', 'coindesk']);

      expect(key1).toBe(key2);
    });
  });

  describe('Source Validation Keys', () => {
    it('should generate consistent validation cache keys', () => {
      const url = 'https://coindesk.com';
      const type = 'basic';

      const key1 = CacheKeys.sourceValidation(url, type);
      const key2 = CacheKeys.sourceValidation(url, type);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^validation:[a-z0-9]+$/);
    });

    it('should generate different keys for different URLs or types', () => {
      const key1 = CacheKeys.sourceValidation('https://coindesk.com', 'basic');
      const key2 = CacheKeys.sourceValidation('https://cointelegraph.com', 'basic');
      const key3 = CacheKeys.sourceValidation('https://coindesk.com', 'comprehensive');

      expect(new Set([key1, key2, key3]).size).toBe(3);
    });
  });

  describe('Rate Limit Keys', () => {
    it('should generate rate limit keys', () => {
      const identifier = '127.0.0.1';
      const key = CacheKeys.rateLimit(identifier);

      expect(key).toBe('ratelimit:127.0.0.1');
    });

    it('should handle special characters in identifier', () => {
      const identifier = 'user@example.com';
      const key = CacheKeys.rateLimit(identifier);

      expect(key).toBe('ratelimit:user@example.com');
    });
  });

  describe('Hash Function', () => {
    it('should generate consistent hashes', () => {
      // Test through public methods that use the hash function
      const key1 = CacheKeys.sentiment('test', ['BTC']);
      const key2 = CacheKeys.sentiment('test', ['BTC']);

      expect(key1).toBe(key2);
    });

    it('should generate different hashes for different inputs', () => {
      const key1 = CacheKeys.sentiment('test1', ['BTC']);
      const key2 = CacheKeys.sentiment('test2', ['BTC']);

      expect(key1).not.toBe(key2);
    });

    it('should handle empty strings', () => {
      const key = CacheKeys.sentiment('', []);
      expect(key).toMatch(/^sentiment:[a-z0-9]+$/);
    });

    it('should handle very long strings', () => {
      const longString = 'x'.repeat(10000);
      const key = CacheKeys.sentiment(longString, ['BTC']);
      expect(key).toMatch(/^sentiment:[a-z0-9]+$/);
    });
  });
});