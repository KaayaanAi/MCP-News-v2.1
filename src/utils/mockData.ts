/**
 * Internal mock data utilities for development mode
 * This file contains simplified mock data generation for development testing
 */

import type { NewsArticle, GetMarketNewsParams } from '../types/index.js';

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

// Known reliable crypto news sources
const TRUSTED_SOURCES = new Set([
  'coindesk.com',
  'cointelegraph.com',
  'decrypt.co',
  'theblock.co',
  'bitcoinmagazine.com',
  'coinbase.com',
  'binance.com',
  'reuters.com',
  'bloomberg.com',
]);

/**
 * Generate mock news articles for development testing
 */
export function getMockNews(params: GetMarketNewsParams): NewsArticle[] {
  const mockArticles: NewsArticle[] = [
    {
      title: `${params.query} Sees Major Development in Latest Market Update`,
      url: 'https://coindesk.com/markets/2024/03/15/crypto-news-1',
      source: 'CoinDesk',
      published_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      summary: `Latest developments regarding ${params.query} show significant market interest.`,
      author: 'John Crypto',
      category: 'Market Analysis',
    },
    {
      title: `Analysis: ${params.query} Market Sentiment Remains Strong`,
      url: 'https://cointelegraph.com/news/crypto-analysis-2024',
      source: 'CoinTelegraph',
      published_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      summary: `Market analysts are bullish on ${params.query} following recent developments.`,
      author: 'Jane Market',
      category: 'Analysis',
    },
    {
      title: `Breaking: ${params.query} Partnership Announced`,
      url: 'https://decrypt.co/breaking/partnership-news',
      source: 'Decrypt',
      published_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      summary: `Major partnership announcement could impact ${params.query} price action.`,
      author: 'Alex News',
      category: 'Breaking News',
    },
  ];

  // Filter by sources if specified
  if (params.sources?.length) {
    const sourcesLower = params.sources.map(s => s.toLowerCase());
    return mockArticles
      .filter(article =>
        sourcesLower.some(source =>
          article.source.toLowerCase().includes(source)
        )
      )
      .slice(0, params.limit || 10);
  }

  return mockArticles.slice(0, params.limit || 10);
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_error) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/i);
    return match?.[1]?.toLowerCase() || url.toLowerCase();
  }
}

/**
 * Generate mock validation results
 */
export function getMockValidation(source_url: string): SourceValidationResult {
  const domain = extractDomain(source_url);

  // Mock validation for trusted sources
  if (TRUSTED_SOURCES.has(domain)) {
    return {
      quality_score: 88,
      issues_found: [],
      source_status: {
        available: true,
        latency_ms: 245,
      },
      recommendations: [
        'This is a well-established and trusted cryptocurrency news source',
        'Content is generally reliable with good editorial standards',
      ],
      domain_info: {
        age_days: 2847,
        ssl_valid: true,
        reputation_score: 92,
      },
    };
  }

  // Default mock validation for unknown domains
  return {
    quality_score: 65,
    issues_found: [
      'Limited information available about source credibility',
    ],
    source_status: {
      available: true,
      latency_ms: 890,
    },
    recommendations: [
      'Consider cross-referencing information with established sources',
      'Verify author credentials and publication standards',
    ],
    domain_info: {
      age_days: 456,
      ssl_valid: true,
      reputation_score: 72,
    },
  };
}