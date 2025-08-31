# MCP-News v2.1

AI-powered cryptocurrency news sentiment analysis server with MCP (Model Context Protocol) compatibility.

## Features

- **Hybrid AI Analysis**: Keyword filtering + LLM confirmation for cost efficiency
- **Batch Processing**: Analyze multiple news items simultaneously
- **Redis Caching**: 12-hour cache reduces costs and improves response time
- **Webhook Notifications**: Real-time results delivery to n8n, Telegram, Discord
- **Multi-language Support**: English and Arabic news analysis
- **Production Ready**: Docker, health checks, rate limiting, structured logging

## Quick Start

```bash
git clone <repo_url> /opt/mcp-news-v2.1
cd /opt/mcp-news-v2.1
cp .env.example .env
# Edit .env with your API keys
docker compose up -d --build
```

## API Endpoints

### MCP JSON-RPC 2.0
```bash
POST /mcp
```

**Single News Analysis:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "news_analysis",
    "arguments": {
      "title": "Bitcoin surges after ETF approval",
      "summary": "SEC approves first Bitcoin spot ETF, boosting investor confidence."
    }
  }
}
```

**Batch Analysis:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "news_analysis",
    "arguments": {
      "news": [
        {"title": "Bitcoin surges 12%", "summary": "ETF approval drives price up"},
        {"title": "Ethereum network halt", "summary": "Technical issues disrupt DeFi"}
      ]
    }
  }
}
```

### REST API (n8n Compatible)
```bash
POST /analyze
Content-Type: application/json
Authorization: Bearer your_api_token

{
  "news": [
    {"title": "Bitcoin news", "summary": "Market update"}
  ]
}
```

### Health Check
```bash
GET /health
```

### Metrics
```bash
GET /metrics
```

## Environment Variables

```bash
# Required
API_TOKEN=your_secure_token
OPENAI_API_KEY=sk-your_key_here

# Optional
WEBHOOK_URL=https://webhook.site/unique-url
WEBHOOK_SECRET=webhook_secret
ALLOWED_ORIGINS=https://yourdomain.com
REDIS_URL=redis://localhost:6379
```

## Response Format

```json
{
  "impact": "Positive|Negative|Neutral",
  "confidence": 85,
  "affected_coins": ["BTC", "ETH"],
  "summary": "Bitcoin rises 12% after ETF approval, strong bullish sentiment.",
  "lang": "en",
  "low_confidence": false,
  "error": null
}
```

## MCP Client Integration

### Claude Desktop
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mcp-news": {
      "command": "curl",
      "args": ["-X", "POST", "http://localhost:8000/mcp", "-H", "Content-Type: application/json", "-H", "Authorization: Bearer YOUR_TOKEN"]
    }
  }
}
```

### n8n Workflow
Use HTTP Request node:
- Method: POST
- URL: `http://localhost:8000/analyze`
- Headers: `Authorization: Bearer YOUR_TOKEN`
- Body: JSON with news array

## Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│   FastAPI       │    │    Redis     │    │   OpenAI    │
│   MCP Server    │◄──►│    Cache     │    │     API     │
└─────────────────┘    └──────────────┘    └─────────────┘
         │                                         ▲
         ▼                                         │
┌─────────────────┐    ┌──────────────┐           │
│   Webhook       │    │   Keyword    │───────────┘
│   Notifications │    │   Analysis   │
└─────────────────┘    └──────────────┘
```

## Docker Deployment

Production deployment with auto-restart and health monitoring:

```yaml
version: '3.8'
services:
  mcp-news:
    build: .
    ports: ["8000:8000"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    depends_on: [redis]
  redis:
    image: redis:7-alpine
    restart: unless-stopped
```

## Monitoring

- **Health**: `GET /health` - Service status and uptime
- **Metrics**: `GET /metrics` - Cache stats and performance
- **Logs**: `./logs/mcp-news-v2.1.log` - Structured logging with request tracing

## Cost Optimization

1. **Hybrid Analysis**: Keywords first, LLM only when needed
2. **Redis Caching**: 12-hour cache for repeated news
3. **Batch Processing**: Multiple items per LLM call
4. **Fallback Mode**: Continue service if LLM fails

## Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run locally
uvicorn mcp_news_main:app --reload --port 8000

# Run tests
python -m pytest tests/
```

## License

MIT License - See LICENSE file for details.