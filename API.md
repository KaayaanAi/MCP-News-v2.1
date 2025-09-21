# API Documentation - MCP-News-v2.1

**Complete API reference for the MCP-News-v2.1 server with dual protocol support**

## 🚀 Overview

MCP-News-v2.1 provides a production-ready Model Context Protocol (MCP) server with two protocol implementations:

1. **STDIO MCP Protocol** - For desktop applications like Claude Desktop
2. **HTTP MCP Protocol** - For web integrations and n8n workflows

Both protocols expose the same three powerful tools for cryptocurrency news analysis.

## 📋 Quick Reference

| Tool | Purpose | Input Required | Output |
|------|---------|----------------|--------|
| `analyze_crypto_sentiment` | AI sentiment analysis | `content` | Sentiment + confidence |
| `get_market_news` | Fetch crypto news | None (all optional) | News articles array |
| `validate_news_source` | Source credibility | `url` OR `domain` | Quality score + issues |

## 🔧 Protocol Implementations

### STDIO MCP Protocol

**For**: Claude Desktop, MCP-compatible applications
**Transport**: Process stdio communication
**Entry Point**: `src/mcp-server.ts`

**Claude Desktop Configuration:**
```json
{
  "mcpServers": {
    "mcp-news-v2.1": {
      "command": "node",
      "args": ["/path/to/mcp-news-v2.1/dist/server.js"]
    }
  }
}
```

### HTTP MCP Protocol

**For**: n8n workflows, web applications, API integrations
**Transport**: HTTP with JSON-RPC 2.0
**Base URL**: `http://localhost:4009`
**Endpoint**: `/mcp`

**Authentication**: Optional API key via header or query parameter

## 🛠️ MCP Tools

### 1. analyze_crypto_sentiment

Analyzes text content for cryptocurrency market sentiment using advanced AI.

#### Parameters

```typescript
{
  content: string;              // Required: Text to analyze (10-10000 chars)
  symbol?: string;              // Optional: Crypto symbol (e.g., "BTC", "ETH")
  includeScore?: boolean;       // Optional: Include numerical score (default: true)
}
```

#### Parameter Details

- **`content`** (required)
  - Type: `string`
  - Constraints: 10-10,000 characters
  - Description: News article, tweet, or any text content to analyze
  - Example: `"Bitcoin reaches new all-time high of $70,000"`

- **`symbol`** (optional)
  - Type: `string`
  - Pattern: `^[A-Z]{2,10}$`
  - Description: Focus analysis on specific cryptocurrency
  - Example: `"BTC"`, `"ETH"`, `"ADA"`

- **`includeScore`** (optional)
  - Type: `boolean`
  - Default: `true`
  - Description: Whether to include numerical sentiment score (-1 to 1)

#### Response Schema

```typescript
{
  impact: "Positive" | "Negative" | "Neutral";
  confidence_score: number;     // 0-100
  summary: string;              // Brief analysis summary
  sentiment_score?: number;     // -1 to 1 (if includeScore: true)
  metadata: {
    timestamp: string;          // ISO 8601 timestamp
    analysis_id: string;        // Unique analysis identifier
    model_used?: string;        // AI model information
  };
}
```

#### Example Usage

**HTTP Request:**
```bash
curl -X POST http://localhost:4009/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "analyze_crypto_sentiment",
      "arguments": {
        "content": "Bitcoin ETF approval drives massive institutional adoption",
        "symbol": "BTC",
        "includeScore": true
      }
    }
  }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"impact\":\"Positive\",\"confidence_score\":95,\"summary\":\"Strong positive sentiment driven by institutional adoption news\",\"sentiment_score\":0.8,\"metadata\":{\"timestamp\":\"2025-09-21T15:30:00Z\",\"analysis_id\":\"sentiment_12345\"}}"
    }]
  },
  "id": 1
}
```

### 2. get_market_news

Fetches recent cryptocurrency news from multiple trusted sources with advanced filtering.

#### Parameters

```typescript
{
  symbol?: string;              // Optional: Crypto symbol filter
  limit?: number;               // Optional: Max results (1-50, default: 10)
  timeframe?: string;           // Optional: "1h", "24h", "7d", "30d"
  sortBy?: string;              // Optional: "publishedAt", "relevance", "popularity"
}
```

#### Parameter Details

- **`symbol`** (optional)
  - Type: `string`
  - Pattern: `^[A-Z]{2,10}$`
  - Description: Filter news for specific cryptocurrency
  - Example: `"BTC"`, `"ETH"`, `"DOGE"`

- **`limit`** (optional)
  - Type: `number`
  - Range: 1-50
  - Default: 10
  - Description: Maximum number of articles to return

- **`timeframe`** (optional)
  - Type: `string`
  - Options: `"1h"`, `"24h"`, `"7d"`, `"30d"`
  - Default: `"24h"`
  - Description: Time period for news articles

- **`sortBy`** (optional)
  - Type: `string`
  - Options: `"publishedAt"`, `"relevance"`, `"popularity"`
  - Default: `"publishedAt"`
  - Description: Sort criteria for results

#### Response Schema

```typescript
{
  results: Array<{
    title: string;              // Article headline
    url: string;                // Article URL
    source: string;             // Publisher name
    published_at: string;       // ISO 8601 timestamp
    summary?: string;           // Article summary/excerpt
    author?: string;            // Article author
    category?: string;          // News category
  }>;
  total_count: number;          // Total articles found
  processing_info: {
    cache_hit: boolean;         // Whether result was cached
    response_time_ms: number;   // Processing time
    sources_queried: string[];  // News sources used
  };
}
```

#### Example Usage

**HTTP Request:**
```bash
curl -X POST http://localhost:4009/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_market_news",
      "arguments": {
        "symbol": "BTC",
        "limit": 5,
        "timeframe": "24h",
        "sortBy": "relevance"
      }
    }
  }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"results\":[{\"title\":\"Bitcoin Surges Past $70K on ETF News\",\"url\":\"https://example-news.com/btc-surge\",\"source\":\"CoinDesk\",\"published_at\":\"2025-09-21T14:30:00Z\",\"summary\":\"Bitcoin reaches new highs following ETF approval\"}],\"total_count\":1,\"processing_info\":{\"cache_hit\":false,\"response_time_ms\":245,\"sources_queried\":[\"coindesk\",\"cointelegraph\"]}}"
    }]
  },
  "id": 2
}
```

### 3. validate_news_source

Validates and analyzes the credibility and reliability of cryptocurrency news sources.

#### Parameters

```typescript
{
  url?: string;                 // Optional: Full URL to validate
  domain?: string;              // Optional: Domain name to validate
  checkFactors?: Array<string>; // Optional: Specific validation factors
}
```

**Note**: Either `url` OR `domain` must be provided.

#### Parameter Details

- **`url`** (optional, alternative to domain)
  - Type: `string`
  - Format: Valid URL
  - Pattern: `^https?://.+`
  - Description: Complete URL of article or source to validate
  - Example: `"https://www.coindesk.com/markets/2024/01/15/bitcoin-price-analysis"`

- **`domain`** (optional, alternative to url)
  - Type: `string`
  - Pattern: `^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$`
  - Description: Domain name to validate
  - Example: `"coindesk.com"`, `"cointelegraph.com"`

- **`checkFactors`** (optional)
  - Type: `Array<string>`
  - Options: `["domain_authority", "ssl_certificate", "content_quality", "bias_analysis", "fact_check_rating"]`
  - Max items: 5
  - Description: Specific credibility factors to analyze

#### Response Schema

```typescript
{
  quality_score: number;        // 0-100 overall credibility score
  issues_found: string[];       // Array of identified issues
  source_status: {
    available: boolean;         // Whether source is accessible
    ssl_certificate: boolean;   // SSL certificate validity
    domain_authority: number;   // Domain authority score (0-100)
    response_time_ms: number;   // Server response time
  };
  credibility_factors: {
    fact_check_rating?: string; // Third-party fact-check rating
    bias_rating?: string;       // Political/editorial bias rating
    transparency_score?: number; // Editorial transparency (0-100)
  };
  recommendations: string[];    // Improvement suggestions
  metadata: {
    checked_at: string;         // ISO 8601 timestamp
    validation_id: string;      // Unique validation identifier
  };
}
```

#### Example Usage

**HTTP Request:**
```bash
curl -X POST http://localhost:4009/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "validate_news_source",
      "arguments": {
        "domain": "coindesk.com",
        "checkFactors": ["domain_authority", "ssl_certificate", "bias_analysis"]
      }
    }
  }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"quality_score\":85,\"issues_found\":[],\"source_status\":{\"available\":true,\"ssl_certificate\":true,\"domain_authority\":78,\"response_time_ms\":156},\"credibility_factors\":{\"bias_rating\":\"Center\",\"transparency_score\":82},\"recommendations\":[\"Consider cross-referencing with multiple sources\"],\"metadata\":{\"checked_at\":\"2025-09-21T15:45:00Z\",\"validation_id\":\"validation_67890\"}}"
    }]
  },
  "id": 3
}
```

## 🔗 Protocol Methods

### Core MCP Methods

#### initialize

Initialize the MCP connection and get server capabilities.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {},
      "resources": {},
      "prompts": {},
      "logging": {}
    },
    "serverInfo": {
      "name": "mcp-news-server",
      "version": "2.1.1"
    }
  },
  "id": 1
}
```

#### tools/list

Get list of available tools with their schemas.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "analyze_crypto_sentiment",
        "description": "Analyze cryptocurrency market sentiment from news articles and social media posts",
        "inputSchema": {
          "type": "object",
          "properties": {
            "content": {
              "type": "string",
              "description": "Text content to analyze",
              "minLength": 10,
              "maxLength": 10000
            },
            "symbol": {
              "type": "string",
              "description": "Optional cryptocurrency symbol",
              "pattern": "^[A-Z]{2,10}$"
            },
            "includeScore": {
              "type": "boolean",
              "description": "Include numerical sentiment score",
              "default": true
            }
          },
          "required": ["content"],
          "additionalProperties": false
        }
      }
      // ... other tools
    ]
  },
  "id": 2
}
```

#### tools/call

Execute a specific tool with parameters.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {
      // tool-specific parameters
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "tool execution result"
      }
    ]
  },
  "id": 3
}
```

## 🚨 Error Handling

All errors follow JSON-RPC 2.0 specification with consistent error codes.

### Standard Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Invalid JSON-RPC format |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Invalid parameters |
| -32603 | Internal error | Server error |
| -32000 | Authentication error | Invalid API key |
| -32001 | Tool not found | Unknown tool name |
| -32002 | Tool execution error | Tool failed to execute |

### Error Response Format

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "parameter": "content",
      "issue": "Content must be at least 10 characters",
      "received": "Hi"
    }
  },
  "id": 1
}
```

### Common Error Examples

#### Authentication Error
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Invalid or missing API key"
  },
  "id": null
}
```

#### Tool Not Found
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Unknown tool: invalid_tool_name"
  },
  "id": 1
}
```

#### Invalid Parameters
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "issues": [
        {
          "path": ["content"],
          "message": "String must contain at least 10 character(s)"
        }
      ]
    }
  },
  "id": 1
}
```

## 🔒 Authentication

### HTTP Protocol Authentication

Authentication is optional but recommended for production deployments.

#### API Key Methods

1. **Authorization Header** (Recommended)
```bash
curl -H "Authorization: Bearer your_api_key_here" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:4009/mcp
```

2. **X-API-Key Header**
```bash
curl -H "X-API-Key: your_api_key_here" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:4009/mcp
```

3. **Query Parameter**
```bash
curl -X POST "http://localhost:4009/mcp?api_key=your_api_key_here" \
     -H "Content-Type: application/json"
```

### STDIO Protocol

No authentication required - secured by process isolation.

## 🏥 Health Monitoring

### Health Check Endpoint

**Endpoint**: `GET /health`
**Purpose**: Monitor server status and performance

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-09-21T15:30:00Z",
  "uptime": 3600,
  "version": "2.1.1",
  "memory": {
    "rss": 128,
    "heapUsed": 64,
    "heapTotal": 96
  },
  "tools": {
    "registered": 3,
    "names": ["analyze_crypto_sentiment", "get_market_news", "validate_news_source"]
  },
  "cache": {
    "type": "redis",
    "connected": true,
    "hit_ratio": 0.85
  },
  "external_services": {
    "openai": "connected",
    "news_apis": "partial"
  }
}
```

### Metrics Endpoint

**Endpoint**: `GET /metrics`
**Purpose**: Operational metrics for monitoring

**Response:**
```json
{
  "requests": 1250,
  "errors": 3,
  "uptime": 3600,
  "tools": 3,
  "cache_hits": 1062,
  "cache_misses": 188,
  "avg_response_time_ms": 245
}
```

## 📊 Performance Guidelines

### Response Times

- **Cached results**: < 50ms
- **AI analysis**: 500-2000ms
- **News fetching**: 200-1000ms
- **Source validation**: 300-800ms

### Rate Limits

Default limits (configurable):
- **HTTP requests**: 100 per minute per IP
- **Tool executions**: No limit (controlled by processing time)
- **OpenAI API**: Respects OpenAI rate limits

### Optimization Tips

1. **Use caching**: Enable Redis for better performance
2. **Batch requests**: Group multiple tool calls when possible
3. **Filter results**: Use specific parameters to reduce processing time
4. **Monitor health**: Regular health checks for optimal performance

## 🔧 Development & Testing

### Testing Tools

```bash
# Test HTTP MCP endpoint
curl -X POST http://localhost:4009/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# Test health endpoint
curl http://localhost:4009/health

# Run comprehensive validation
node validation_comprehensive.js

# Run basic validation
node tests/validate.js
```

### Development Server

```bash
# Start development server with hot reload
npm run dev

# Start production server
npm start

# Run all tests
npm test
```

## 📚 Additional Resources

- **[README.md](./README.md)** - General overview and setup
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Production deployment guide
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history and changes

---

**For technical support or API questions, check the health endpoints and server logs for detailed error information.**