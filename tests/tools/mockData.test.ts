/**
 * Test file to verify mock data extraction and API implementation handling
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { getMockNews, getMockValidation, TRUSTED_SOURCES, BLACKLISTED_SOURCES } from '../utils/mockData';

describe('Mock Data Utilities', () => {
  describe('getMockNews', () => {
    it('should generate mock news articles based on query', () => {
      const params = {
        query: 'Bitcoin',
        limit: 5,
      };

      const result = getMockNews(params);

      expect(result).toHaveLength(7); // Default mock data has 7 articles
      expect(result[0].title).toContain('Bitcoin');
      expect(result[0].url).toMatch(/^https:\/\/[^/]+\//); // Real URLs, not example.com
      expect(result[0].published_at).toBeTruthy();
      expect(result[0].source).toBeTruthy();
    });

    it('should filter by sources when specified', () => {
      const params = {
        query: 'Ethereum',
        sources: ['coindesk'],
        limit: 10,
      };

      const result = getMockNews(params);

      // Should only include articles from CoinDesk
      result.forEach(article => {
        expect(article.source.toLowerCase()).toContain('coindesk');
      });
    });

    it('should include realistic article metadata', () => {
      const params = {
        query: 'DeFi',
        limit: 3,
      };

      const result = getMockNews(params);

      result.forEach(article => {
        expect(article).toHaveProperty('title');
        expect(article).toHaveProperty('url');
        expect(article).toHaveProperty('source');
        expect(article).toHaveProperty('published_at');
        expect(article).toHaveProperty('summary');
        expect(article).toHaveProperty('author');
        expect(article).toHaveProperty('category');

        // Verify URL structure
        expect(article.url).toMatch(/^https:\/\/[a-zA-Z0-9.-]+\//);
        expect(article.url).not.toContain('example.com');

        // Verify date format
        expect(new Date(article.published_at).getTime()).toBeLessThan(Date.now());
      });
    });
  });

  describe('getMockValidation', () => {
    it('should return high scores for trusted sources', () => {
      const params = {
        source_url: 'https://coindesk.com/news/article',
        validation_type: 'basic' as const,
      };

      const result = getMockValidation(params);

      expect(result.quality_score).toBeGreaterThan(80);
      expect(result.issues_found).toHaveLength(0);
      expect(result.recommendations).toContain('Highly reliable source - minimal cross-referencing needed');
      expect(result.source_status.available).toBe(true);
      expect(result.domain_info?.ssl_valid).toBe(true);
    });

    it('should return low scores for blacklisted sources', () => {
      const params = {
        source_url: 'https://cryptoscam.com/fake-news',
        validation_type: 'comprehensive' as const,
      };

      const result = getMockValidation(params);

      expect(result.quality_score).toBeLessThan(10);
      expect(result.issues_found.length).toBeGreaterThan(0);
      expect(result.recommendations).toContain('Do not use this source - known to spread misinformation');
      expect(result.recommendations).toContain('Not recommended - seek information from established sources');
    });

    it('should return moderate scores for unknown domains', () => {
      const params = {
        source_url: 'https://unknown-crypto-news.com/article',
        validation_type: 'basic' as const,
      };

      const result = getMockValidation(params);

      expect(result.quality_score).toBeGreaterThan(50);
      expect(result.quality_score).toBeLessThan(80);
      expect(result.issues_found).toContain('Limited information available about source credibility');
      expect(result.recommendations).toContain('Consider cross-referencing information with established sources');
    });

    it('should handle URL parsing correctly', () => {
      const testUrls = [
        'https://coindesk.com/markets/news',
        'http://coindesk.com/article',
        'coindesk.com/path',
        'www.coindesk.com/news',
      ];

      testUrls.forEach(url => {
        const result = getMockValidation({
          source_url: url,
          validation_type: 'basic',
        });

        expect(result.quality_score).toBeGreaterThan(80); // All should be recognized as CoinDesk
      });
    });
  });

  describe('Source Lists', () => {
    it('should have trusted sources configured', () => {
      expect(TRUSTED_SOURCES.size).toBeGreaterThan(0);
      expect(TRUSTED_SOURCES.has('coindesk.com')).toBe(true);
      expect(TRUSTED_SOURCES.has('cointelegraph.com')).toBe(true);
    });

    it('should have blacklisted sources configured', () => {
      expect(BLACKLISTED_SOURCES.size).toBeGreaterThan(0);
      expect(BLACKLISTED_SOURCES.has('cryptoscam.com')).toBe(true);
    });

    it('should not have overlap between trusted and blacklisted sources', () => {
      const trustedArray = Array.from(TRUSTED_SOURCES);
      const blacklistedArray = Array.from(BLACKLISTED_SOURCES);

      trustedArray.forEach(trusted => {
        expect(BLACKLISTED_SOURCES.has(trusted)).toBe(false);
      });

      blacklistedArray.forEach(blacklisted => {
        expect(TRUSTED_SOURCES.has(blacklisted)).toBe(false);
      });
    });
  });

  describe('Data Quality', () => {
    it('should not contain example.com URLs', () => {
      const newsResult = getMockNews({ query: 'test', limit: 10 });

      newsResult.forEach(article => {
        expect(article.url).not.toContain('example.com');
        expect(article.url).toMatch(/^https:\/\/[^/]+\//);
      });
    });

    it('should generate reasonable timestamps', () => {
      const newsResult = getMockNews({ query: 'test', limit: 5 });

      const now = Date.now();
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

      newsResult.forEach(article => {
        const publishedTime = new Date(article.published_at).getTime();
        expect(publishedTime).toBeLessThan(now);
        expect(publishedTime).toBeGreaterThan(twentyFourHoursAgo);
      });
    });

    it('should generate realistic validation scores', () => {
      const testDomains = [
        'coindesk.com',
        'unknown-site.com',
        'cryptoscam.com',
      ];

      testDomains.forEach(domain => {
        const result = getMockValidation({
          source_url: `https://${domain}/article`,
          validation_type: 'basic',
        });

        expect(result.quality_score).toBeGreaterThanOrEqual(0);
        expect(result.quality_score).toBeLessThanOrEqual(100);
        expect(typeof result.source_status.latency_ms).toBe('number');
        expect(result.source_status.latency_ms).toBeGreaterThan(0);
      });
    });
  });
});

describe('Mock Data Integration', () => {
  it('should be importable from production code', async () => {
    // This test verifies that the mock data can be dynamically imported
    // as it would be from the production tools
    const mockData = await import('../utils/mockData');

    expect(mockData.getMockNews).toBeInstanceOf(Function);
    expect(mockData.getMockValidation).toBeInstanceOf(Function);
    expect(mockData.TRUSTED_SOURCES).toBeInstanceOf(Set);
  });

  it('should handle import errors gracefully', async () => {
    // This test simulates what happens when mock data import fails
    try {
      await import('../utils/nonexistentMockData');
      // Should not reach here
      fail('Expected import to throw an error');
    } catch (error) {
      // Check that it's an error-like object (has message property)
      expect(error).toHaveProperty('message');
      expect(typeof (error as any).message).toBe('string');
      // Production code should handle this gracefully
    }
  });
});