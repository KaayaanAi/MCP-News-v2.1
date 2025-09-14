/**
 * Mock data utilities for testing MCP News tools
 * This file contains all mock data generation functions for testing purposes
 */

interface NewsArticle {
  title: string;
  url: string;
  source: string;
  published_at: string;
  summary?: string;
  author?: string;
  category?: string;
}

interface MockNewsParams {
  query: string;
  sources?: string[];
  limit?: number;
}

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

interface MockValidationParams {
  source_url: string;
  validation_type?: 'basic' | 'comprehensive';
}

// Known reliable crypto news sources for testing
const TRUSTED_SOURCES = new Set([
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

// Known unreliable or questionable sources for testing
const QUESTIONABLE_SOURCES = new Set([
  'coinbureau.com',
  'cryptoslate.com',
  'newsbtc.com',
]);

// Blacklisted sources for testing
const BLACKLISTED_SOURCES = new Set([
  'cryptoscam.com',
  'fakecrypto.news',
  'ponzicoin.info',
]);

/**
 * Generate mock news articles for testing
 */
export function getMockNews(params: MockNewsParams): NewsArticle[] {
  const mockArticles: NewsArticle[] = [
    {
      title: `${params.query} Sees Major Development in Latest Market Update`,
      url: 'https://coindesk.com/markets/2024/03/15/crypto-news-1',
      source: 'CoinDesk',
      published_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 minutes ago
      summary: `Latest developments regarding ${params.query} show significant market interest.`,
      author: 'John Crypto',
      category: 'Market Analysis',
    },
    {
      title: `Analysis: ${params.query} Market Sentiment Remains Strong`,
      url: 'https://cointelegraph.com/news/crypto-analysis-2024',
      source: 'CoinTelegraph',
      published_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
      summary: `Market analysts are bullish on ${params.query} following recent developments.`,
      author: 'Jane Market',
      category: 'Analysis',
    },
    {
      title: `Breaking: ${params.query} Partnership Announced`,
      url: 'https://decrypt.co/breaking/partnership-news',
      source: 'Decrypt',
      published_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), // 4 hours ago
      summary: `Major partnership announcement could impact ${params.query} price action.`,
      author: 'Alex News',
      category: 'Breaking News',
    },
    {
      title: `${params.query} Technical Analysis: Key Levels to Watch`,
      url: 'https://theblock.co/technical-analysis/levels',
      source: 'The Block',
      published_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), // 6 hours ago
      summary: `Technical indicators suggest important price levels for ${params.query}.`,
      author: 'Mike Technical',
      category: 'Technical Analysis',
    },
    {
      title: `Regulatory Update Affects ${params.query} Trading`,
      url: 'https://coindesk.com/policy/regulatory-news',
      source: 'CoinDesk',
      published_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(), // 8 hours ago
      summary: `New regulatory guidance impacts ${params.query} market dynamics.`,
      author: 'Sarah Regulatory',
      category: 'Regulation',
    },
    {
      title: `DeFi Protocol Update: ${params.query} Integration`,
      url: 'https://theblock.co/defi/protocol-updates',
      source: 'The Block',
      published_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), // 12 hours ago
      summary: `New DeFi protocol features ${params.query} integration capabilities.`,
      author: 'Tom DeFi',
      category: 'DeFi',
    },
    {
      title: `Institutional Interest in ${params.query} Grows`,
      url: 'https://decrypt.co/institutional/interest-grows',
      source: 'Decrypt',
      published_at: new Date(Date.now() - 1000 * 60 * 60 * 16).toISOString(), // 16 hours ago
      summary: `Major institutions showing increased interest in ${params.query} investments.`,
      author: 'Lisa Institutional',
      category: 'Institutional',
    },
  ];

  // Filter by sources if specified
  if (params.sources?.length) {
    const sourcesLower = params.sources.map(s => s.toLowerCase());
    return mockArticles.filter(article =>
      sourcesLower.some(source =>
        article.source.toLowerCase().includes(source)
      )
    );
  }

  return mockArticles;
}

/**
 * Extract domain from URL for testing
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase().replace(/^www\./, '');
  } catch (error) {
    // If URL parsing fails, try to extract domain manually
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/i);
    return match?.[1]?.toLowerCase() || url.toLowerCase();
  }
}

/**
 * Generate mock validation results for testing
 */
export function getMockValidation(params: MockValidationParams): SourceValidationResult {
  const domain = extractDomain(params.source_url);

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
        'Highly reliable source - minimal cross-referencing needed',
      ],
      domain_info: {
        age_days: 2847,
        ssl_valid: true,
        reputation_score: 92,
      },
    };
  }

  // Mock validation for blacklisted sources
  if (BLACKLISTED_SOURCES.has(domain)) {
    return {
      quality_score: 5,
      issues_found: [
        'Domain is blacklisted as known scam/spam source',
        'History of spreading misinformation',
        'No editorial oversight detected',
      ],
      source_status: {
        available: true,
        latency_ms: 1200,
      },
      recommendations: [
        'Do not use this source - known to spread misinformation',
        'Seek information from established and verified news outlets',
        'Not recommended - seek information from established sources',
      ],
    };
  }

  // Mock validation for questionable sources
  if (QUESTIONABLE_SOURCES.has(domain)) {
    return {
      quality_score: 42,
      issues_found: [
        'Source has mixed reputation - content quality varies',
        'Limited editorial oversight',
      ],
      source_status: {
        available: true,
        latency_ms: 650,
      },
      recommendations: [
        'Cross-reference information with other sources',
        'Use with caution - always cross-reference with trusted sources',
        'Verify author credentials and publication standards',
      ],
      domain_info: {
        age_days: 892,
        ssl_valid: true,
        reputation_score: 58,
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
      'Generally reliable - consider cross-referencing for important news',
    ],
    domain_info: {
      age_days: 456,
      ssl_valid: true,
      reputation_score: 72,
    },
  };
}

/**
 * Generate mock sentiment analysis data for testing
 */
export function getMockSentimentAnalysis(text: string): {
  sentiment_score: number;
  sentiment_label: 'positive' | 'negative' | 'neutral';
  confidence: number;
  key_phrases: string[];
} {
  // Simple mock sentiment based on text content
  const positiveWords = ['bullish', 'rise', 'gain', 'profit', 'moon', 'pump', 'breakthrough'];
  const negativeWords = ['bearish', 'fall', 'loss', 'dump', 'crash', 'decline', 'scam'];

  const textLower = text.toLowerCase();
  const positiveCount = positiveWords.filter(word => textLower.includes(word)).length;
  const negativeCount = negativeWords.filter(word => textLower.includes(word)).length;

  let sentiment_score = 0;
  let sentiment_label: 'positive' | 'negative' | 'neutral' = 'neutral';

  if (positiveCount > negativeCount) {
    sentiment_score = 0.3 + (positiveCount * 0.2);
    sentiment_label = 'positive';
  } else if (negativeCount > positiveCount) {
    sentiment_score = -0.3 - (negativeCount * 0.2);
    sentiment_label = 'negative';
  } else {
    sentiment_score = (Math.random() - 0.5) * 0.4; // -0.2 to 0.2
  }

  // Clamp sentiment score between -1 and 1
  sentiment_score = Math.max(-1, Math.min(1, sentiment_score));

  return {
    sentiment_score,
    sentiment_label,
    confidence: 0.7 + Math.random() * 0.25, // 70-95% confidence
    key_phrases: [
      `${text.split(' ')[0]} market`,
      'price action',
      'market sentiment',
      'trading volume',
    ].slice(0, 2 + Math.floor(Math.random() * 3)),
  };
}

/**
 * Create mock WebSocket message for testing
 */
export function createMockWebSocketMessage(type: string, data: any): string {
  return JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    data,
    mock: true,
  });
}

/**
 * Generate mock rate limit data for testing
 */
export function getMockRateLimitInfo(): {
  requests_remaining: number;
  reset_time: string;
  requests_per_minute: number;
} {
  return {
    requests_remaining: Math.floor(Math.random() * 100) + 50,
    reset_time: new Date(Date.now() + 60 * 1000).toISOString(),
    requests_per_minute: 150,
  };
}

// Export sets for use in tests
export {
  TRUSTED_SOURCES,
  QUESTIONABLE_SOURCES,
  BLACKLISTED_SOURCES,
};