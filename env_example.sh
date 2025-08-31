# MCP-News v2.1 Configuration

# Server Settings
PORT=8000
ALLOWED_ORIGINS=*

# Security
API_TOKEN=your_secure_api_token_here

# AI Integration
OPENAI_API_KEY=sk-your_openai_api_key_here
# CLAUDE_API_KEY=your_claude_api_key_here  # Future use

# Redis Cache
REDIS_URL=redis://localhost:6379

# Webhook Notifications (Optional)
WEBHOOK_URL=https://your-webhook-endpoint.com/webhook
WEBHOOK_SECRET=your_webhook_secret

# Rate Limiting
RATE_LIMIT_PER_HOUR=100

# Logging
LOG_LEVEL=INFO