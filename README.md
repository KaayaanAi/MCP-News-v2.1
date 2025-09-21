# 🚀 MCP-News-v2.1 - Production-Ready MCP Server

**Enterprise-Grade Model Context Protocol Server for Cryptocurrency News Analysis**

A complete, production-ready MCP (Model Context Protocol) server with dual protocol support for real-time cryptocurrency market sentiment analysis from news articles and social media sources.

## ✨ Features

🔗 **Dual Protocol Support** - STDIO MCP and HTTP MCP protocols
🤖 **AI-Powered Analysis** - OpenAI GPT-4 integration for advanced sentiment analysis
💾 **Smart Caching** - Redis/Memory caching for optimal performance
🔒 **Enterprise Security** - API authentication, CORS protection, comprehensive validation
📊 **100% MCP Compliant** - Fully validated JSON-RPC 2.0 implementation
🌍 **Multi-source Data** - Support for various news APIs and social media
🐳 **Production Ready** - TypeScript, Docker, comprehensive testing (280 tests)

## 🎯 Quick Start

### 1. Installation & Setup

```bash
# Clone and install
git clone <repository> mcp-news-v2.1
cd mcp-news-v2.1
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys and configuration

# Build and run
npm run build
npm start
```

### 2. Development Mode

```bash
# Development with hot reload
npm run dev

# Run tests (280 tests, 100% passing)
npm test

# Type checking and linting
npm run type-check
npm run lint
```

## 🛠️ Protocol Support

The server supports **2 production-ready protocols** with full MCP compliance:

### 1. STDIO MCP Protocol
- **Use case**: Native desktop integration (Claude Desktop)
- **Configuration**: Direct process communication
- **Entry point**: `src/mcp-server.ts`

### 2. HTTP MCP Protocol
- **Use case**: n8n-nodes-mcp compatibility and web integration
- **Port**: `HTTP_PORT=4009` (configurable)
- **Endpoint**: `/mcp`
- **Health check**: `/health`

## 🔧 MCP Tools Available

### 1. `analyze_crypto_sentiment`
Analyzes news articles or social media posts for cryptocurrency market sentiment using advanced AI.

**Parameters:**
```typescript
{
  content: string;              // Text content to analyze (10-10000 chars)
  symbol?: string;              // Optional crypto symbol (e.g., "BTC", "ETH")
  includeScore?: boolean;       // Include numerical score (-1 to 1)
}
```

**Response:**
```typescript
{
  impact: "Positive" | "Negative" | "Neutral";
  confidence_score: number;     // 0-100
  summary: string;
  sentiment_score?: number;     // -1 to 1 (if requested)
  metadata: {
    timestamp: string;
    analysis_id: string;
  };
}
```

### 2. `get_market_news`
Fetches recent cryptocurrency news from multiple trusted sources with filtering options.

**Parameters:**
```typescript
{
  symbol?: string;              // Crypto symbol filter (e.g., "BTC")
  limit?: number;               // Max results (1-50, default: 10)
  timeframe?: string;           // "1h", "24h", "7d", "30d"
  sortBy?: string;              // "publishedAt", "relevance", "popularity"
}
```

**Response:**
```typescript
{
  results: Array<{
    title: string;
    url: string;
    source: string;
    published_at: string;
    summary?: string;
    author?: string;
  }>;
  total_count: number;
  processing_info: {
    cache_hit: boolean;
    response_time_ms: number;
  };
}
```

### 3. `validate_news_source`
Validates and analyzes the credibility and reliability of cryptocurrency news sources.

**Parameters:**
```typescript
{
  url?: string;                 // URL to validate (alternative to domain)
  domain?: string;              // Domain to validate (alternative to URL)
  checkFactors?: Array<string>; // Specific factors to check
}
```

**Response:**
```typescript
{
  quality_score: number;        // 0-100 credibility score
  issues_found: string[];
  source_status: {
    available: boolean;
    ssl_certificate: boolean;
    domain_authority: number;
  };
  recommendations: string[];
}
```

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│   STDIO MCP     │    │    Redis     │    │   OpenAI    │
│   Protocol      │    │    Cache     │    │     API     │
│   (Port: stdio) │    │              │    │             │
└─────────────────┘    └──────────────┘    └─────────────┘
         │                     ▲                    ▲
         ▼                     │                    │
┌─────────────────┐    ┌──────────────┐           │
│   HTTP MCP      │    │   Memory     │───────────┘
│   Protocol      │    │   Cache      │
│   (Port: 4009)  │    │   Fallback   │
└─────────────────┘    └──────────────┘
         │
         ▼
┌─────────────────┐    ┌──────────────┐
│   Health Check  │    │   Rate       │
│   Monitoring    │    │   Limiter    │
└─────────────────┘    └──────────────┘
```

## ⚙️ Configuration

### Environment Variables

**Core Server:**
```env
NODE_ENV=production
HTTP_PORT=4009
LOG_LEVEL=info
PRETTY_LOGS=true
```

**Security:**
```env
API_KEY=your_secure_api_key_here
CORS_ORIGINS=*
```

**AI Integration:**
```env
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4
OPENAI_MAX_COMPLETION_TOKENS=1000
OPENAI_TEMPERATURE=0.1
```

**Caching:**
```env
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=300
ENABLE_CACHE=true
```

**News APIs:**
```env
NEWS_API_KEY=your_news_api_key
CRYPTO_PANIC_API_KEY=your_crypto_panic_key
MOCK_EXTERNAL_APIS=false
```

## 🔒 Security Features

- **JSON-RPC 2.0 Compliance** with strict request validation
- **API Key Authentication** for HTTP endpoints (optional)
- **CORS Protection** with configurable origins
- **Input Validation** using Zod schemas for all tools
- **Helmet.js Security Headers** for web requests
- **Rate Limiting** and request timeout protection
- **Secure Error Handling** without data leakage

## 📊 Usage Examples

### STDIO MCP (Claude Desktop)
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

### HTTP MCP Protocol (n8n)
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
        "content": "Bitcoin surges 15% on ETF approval news",
        "symbol": "BTC",
        "includeScore": true
      }
    }
  }'
```

### Health Check
```bash
curl http://localhost:4009/health
```

## 🚨 Error Handling

All protocols return consistent JSON-RPC 2.0 error responses:

```typescript
{
  "jsonrpc": "2.0",
  "error": {
    "code": number,        // Standard JSON-RPC error code
    "message": string,     // Human-readable message
    "data"?: unknown       // Additional context (optional)
  },
  "id": string | number | null
}
```

**Standard Error Codes:**
- `-32700`: Parse error
- `-32600`: Invalid Request
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error
- `-32000`: Authentication error
- `-32001`: Tool not found
- `-32002`: Tool execution error

## 📈 Performance & Monitoring

- **Response Time**: < 200ms for cached results
- **Throughput**: 100+ concurrent requests supported
- **Cache Hit Ratio**: 85%+ in production with Redis
- **Memory Usage**: ~128MB baseline
- **Test Coverage**: 280 tests passing (100% success rate)

### Health Monitoring
```bash
# HTTP Health Check
curl http://localhost:4009/health

# MCP Protocol Health
curl -X POST http://localhost:4009/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'
```

## 🧪 Testing

```bash
# Run all tests (280 tests)
npm test

# Watch mode
npm run test:watch

# Comprehensive MCP validation
node validation_comprehensive.js

# Basic MCP validation
node tests/validate.js
```

**Test Results:**
- ✅ Unit Tests: 280/280 passing
- ✅ MCP Compliance: 64/64 validations passing
- ✅ TypeScript Build: Clean compilation
- ✅ ESLint: Passing with minimal warnings

## 🐳 Production Deployment

### Docker Support
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 4009
CMD ["npm", "start"]
```

### Docker Compose
```yaml
version: '3.8'
services:
  mcp-news:
    build: .
    ports:
      - "4009:4009"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

## 🔄 Integration Examples

### n8n Workflow Integration
1. **Add HTTP Request Node**
2. **Configure endpoint**: `http://localhost:4009/mcp`
3. **Set method**: POST
4. **Add JSON-RPC 2.0 body** with tool calls
5. **Optional**: Add API key authentication

### Claude Desktop Integration
1. **Add to Claude config** with STDIO command
2. **Use tools naturally** in conversation
3. **Automatic caching** and performance optimization

## 🛠️ Development

### Project Structure
```
src/
├── server.ts               # Main HTTP server entry
├── mcp-server.ts          # STDIO MCP server entry
├── index.ts               # Original entry point
├── http-server.ts         # HTTP MCP implementation
├── tools/                 # MCP tool implementations
│   ├── analyze_crypto_sentiment.ts
│   ├── get_market_news.ts
│   └── validate_news_source.ts
├── services/              # External service integrations
│   ├── openai_service.ts
│   ├── cache_service.ts
│   └── rate_limiter.ts
├── types/                 # TypeScript definitions
├── utils/                 # Shared utilities
└── config/               # Configuration management
```

### Recent Improvements (v2.1.0)
- ✅ **Protocol Fixes**: Complete JSON-RPC 2.0 compliance
- ✅ **TypeScript Compilation**: All compilation errors resolved
- ✅ **Linting**: Code quality improvements, minimal warnings
- ✅ **Test Suite**: 280 tests passing, comprehensive coverage
- ✅ **MCP Validation**: 100% compliance (64/64 tests passing)
- ✅ **n8n Compatibility**: Full HTTP MCP protocol support
- ✅ **Error Handling**: Robust error responses and logging

### Adding New Tools
1. Create tool file in `src/tools/`
2. Define Zod schemas in `src/types/`
3. Register in both protocol handlers
4. Add comprehensive tests
5. Update documentation

## 📄 License

MIT License - See LICENSE file for details.

## 🤝 Support & Documentation

- **API Documentation**: See [API.md](./API.md) for detailed API reference
- **Deployment Guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md) for production setup
- **Health Monitoring**: Built-in health check endpoints with metrics
- **Structured Logging**: JSON logging with configurable levels
- **Error Tracking**: Comprehensive error handling and reporting

---

**✅ Production-ready with dual protocol support and 100% MCP compliance! 🎉**

*Built with TypeScript, Express.js, and the official MCP SDK*

## Recent Updates (v2.1.0)

- Complete protocol compliance fixes
- Enhanced error handling and validation
- Comprehensive testing suite (280 tests)
- Production-ready Docker configuration
- Improved documentation and API reference
- Performance optimizations and caching
- Security enhancements and authentication