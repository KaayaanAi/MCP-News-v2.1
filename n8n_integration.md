# n8n Integration Guide - Kaayaan MCP News v2.1

Complete step-by-step guide for integrating the Kaayaan MCP News server with n8n workflows.

## 🚀 Quick Start

### 1. Deploy the MCP Server

```bash
# Copy environment template
cp .env.example .env

# Edit with your credentials
nano .env

# Deploy with Docker Compose
docker compose -f docker-compose.production.yml up -d

# Verify deployment
docker logs kaayaan-mcp-news
```

### 2. Configure n8n MCP Client

1. **Open n8n Workflow Editor**
2. **Add MCP Client Node**
3. **Configure Connection:**
   - **Type:** Command Line (STDIO)
   - **Command:** `docker exec -i kaayaan-mcp-news node /app/dist/index.js`
   - **Timeout:** 30000ms
4. **Test Connection** using the health check tool

## 📋 Available Tools

### 🔍 crypto_news_analyze
Analyze single cryptocurrency news item for sentiment and market impact.

**Input Parameters:**
- `title` (required): News headline
- `summary` (required): News content
- `source` (optional): News source name

**Example Usage in n8n:**
```json
{
  "title": "Bitcoin reaches new all-time high",
  "summary": "Bitcoin price surges past $70,000 following institutional adoption news",
  "source": "CoinTelegraph"
}
```

**Output:**
```json
{
  "impact": "Positive",
  "confidence": 95,
  "affected_coins": ["BTC"],
  "summary": "Bitcoin reaches new all-time high - Positive impact (High confidence)",
  "lang": "en",
  "analysis_id": "mcp_single_143052123456",
  "timestamp": "2025-08-31T14:30:52Z"
}
```

### 📊 crypto_news_batch_analyze
Analyze multiple news items efficiently in batch.

**Input Parameters:**
- `news_items` (required): Array of news objects (max 50 items)

**Example Usage in n8n:**
```json
{
  "news_items": [
    {
      "title": "Ethereum network upgrade successful",
      "summary": "Latest upgrade reduces transaction fees by 40%",
      "source": "Ethereum Foundation"
    },
    {
      "title": "Regulatory concerns emerge",
      "summary": "New cryptocurrency regulations proposed",
      "source": "Reuters"
    }
  ]
}
```

**Output:**
```json
{
  "results": [
    {
      "impact": "Positive",
      "confidence": 88,
      "affected_coins": ["ETH"],
      "summary": "Network upgrade successful",
      "item_index": 0
    },
    {
      "impact": "Negative", 
      "confidence": 72,
      "affected_coins": [],
      "summary": "Regulatory uncertainty",
      "item_index": 1
    }
  ],
  "total_items": 2,
  "request_id": "mcp_batch_143052789012",
  "summary": {
    "positive_count": 1,
    "negative_count": 1,
    "avg_confidence": 80.0
  }
}
```

### 📈 crypto_market_sentiment
Get overall market sentiment from recent analysis.

**Input Parameters:**
- `timeframe` (optional): "1h", "6h", or "24h" (default: "24h")
- `coins` (optional): Array of specific coins to analyze

**Example Usage in n8n:**
```json
{
  "timeframe": "24h",
  "coins": ["BTC", "ETH", "ADA"]
}
```

### 🔍 crypto_impact_keywords
Extract and analyze impact keywords from text.

**Input Parameters:**
- `text` (required): Text to analyze (max 5000 chars)
- `include_weights` (optional): Include keyword weights (default: false)

**Example Usage in n8n:**
```json
{
  "text": "Bitcoin price surge continues as institutional adoption grows",
  "include_weights": true
}
```

### 💚 server_health_check
Monitor server health and performance.

**Input Parameters:** None

**Example Output:**
```json
{
  "server_name": "kaayaan-mcp-news",
  "version": "2.1.0",
  "status": "healthy",
  "components": {
    "redis_cache": "healthy",
    "webhook_manager": "healthy",
    "news_analyzer": "healthy"
  },
  "environment": {
    "mongodb_configured": true,
    "redis_configured": true,
    "openai_configured": true
  }
}
```

## 🔄 Common n8n Workflows

### Workflow 1: Real-time News Analysis
```
RSS Feed → Filter Crypto News → MCP News Analyze → Webhook/Database
```

### Workflow 2: Batch News Processing
```
Schedule Trigger → Fetch News API → Batch Analyze → Process Results → Notify
```

### Workflow 3: Market Sentiment Dashboard
```
Cron Trigger → Market Sentiment Tool → Format Data → Update Dashboard
```

### Workflow 4: Alert System
```
News Analysis → IF Condition (High Impact) → Send Alert → Log Event
```

## 🔧 Advanced Configuration

### Environment Variables

```env
# Core Configuration
MCP_SERVER_NAME=kaayaan-mcp-news
LOG_LEVEL=INFO
TZ=Asia/Kuwait

# Database Connections
MONGODB_URL=mongodb://kaayaan:kaayaan%402025@mongodb:27017/
REDIS_URL=redis://:kaayaan@2025@redis:6379
POSTGRESQL_URL=postgresql://n8n_user:kaayaan_n8n_2025@postgresql:5432/n8n_postgres_db

# WhatsApp Integration
WHATSAPP_API=https://waha.kaayaan.ai
WHATSAPP_SESSION=97008525

# AI Configuration
OPENAI_API_KEY=sk-your-key-here

# Webhook Configuration
WEBHOOK_URL=https://your-n8n-instance.com/webhook/crypto-news
WEBHOOK_SECRET=your-webhook-secret
```

### Webhook Integration

Configure automatic notifications for batch analysis results:

1. **Set up n8n Webhook Node** with unique URL
2. **Add URL to MCP server environment** as `WEBHOOK_URL`
3. **Configure secret** for security as `WEBHOOK_SECRET`
4. **Webhook payload format:**

```json
{
  "request_id": "mcp_batch_143052789012",
  "timestamp": "2025-08-31T14:30:52Z",
  "total_items": 25,
  "results": [...],
  "summary_stats": {
    "positive": 12,
    "negative": 8,
    "neutral": 5,
    "high_confidence": 18,
    "avg_confidence": 84.2
  }
}
```

## 🎯 Best Practices

### Performance Optimization

1. **Use Batch Processing:** Process multiple news items together for efficiency
2. **Cache Results:** Redis caching reduces AI API costs (12-hour default)
3. **Rate Limiting:** Respect API limits with built-in rate limiting
4. **Async Processing:** All operations are async for better performance

### Error Handling

```javascript
// n8n JavaScript Code Node example
try {
  const result = await $node["MCP Client"].json;
  if (result.error) {
    throw new Error(`MCP Error: ${result.error.message}`);
  }
  return result;
} catch (error) {
  console.error('MCP tool failed:', error);
  return { error: error.message, timestamp: new Date().toISOString() };
}
```

### Security Considerations

1. **Environment Variables:** Never hardcode credentials in workflows
2. **API Token:** Use strong tokens for MCP server authentication  
3. **Network Security:** Deploy in secure container network
4. **Log Monitoring:** Monitor logs for security events

## 🔍 Troubleshooting

### Common Issues

**1. Connection Failed**
- Check Docker container is running: `docker ps | grep kaayaan-mcp-news`
- Verify container logs: `docker logs kaayaan-mcp-news`
- Test stdio connectivity: `docker exec -i kaayaan-mcp-news echo "test"`

**2. Tool Execution Timeout**
- Increase timeout in n8n MCP Client settings (default: 30s)
- Check server health with `server_health_check` tool
- Monitor Redis connection status

**3. Analysis Quality Issues**
- Verify OpenAI API key is configured
- Check API rate limits and quotas
- Review input text quality and length

**4. Webhook Not Received**
- Verify webhook URL is accessible from container
- Check webhook secret configuration
- Review n8n webhook node settings

### Debug Commands

```bash
# Check server status
docker exec kaayaan-mcp-news node -e "
const { KaayaanMCPNewsServer } = require('./dist/index.js');
console.log('Server initialized successfully');
"

# Test application health
curl -f http://localhost:4009/health || echo 'Health check failed'

# Check logs
docker logs -f kaayaan-mcp-news
```

## 📞 Support

- **Documentation:** See README.md for detailed setup
- **Health Monitoring:** Use `server_health_check` tool regularly  
- **Logs:** Available in container at `/app/logs/`
- **Metrics:** Redis cache statistics via health check

## 🚀 Production Deployment Checklist

- [ ] Environment variables configured
- [ ] Redis connection tested
- [ ] OpenAI API key validated
- [ ] Docker container healthy
- [ ] n8n MCP Client connected
- [ ] Test workflows created
- [ ] Webhook notifications working
- [ ] Monitoring and alerts configured
- [ ] Backup procedures in place
- [ ] Security review completed

Ready for production use with Kaayaan infrastructure! 🎉