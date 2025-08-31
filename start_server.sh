#!/bin/bash
set -e

echo "🚀 Starting Kaayaan MCP News Server v2.1"
echo "⏰ Timezone: $(date '+%Z %z')"
echo "🌍 Location: Kuwait"

# Validate critical environment variables
echo "🔍 Validating environment..."

# Check MongoDB connection
if [ -z "$MONGODB_URL" ]; then
    echo "⚠️  Warning: MONGODB_URL not set"
else
    echo "✅ MongoDB URL configured"
fi

# Check Redis connection
if [ -z "$REDIS_URL" ]; then
    echo "❌ Error: REDIS_URL required for caching"
    exit 1
else
    echo "✅ Redis URL configured"
fi

# Check AI configuration
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  Warning: OPENAI_API_KEY not set - keyword analysis only"
else
    echo "✅ OpenAI API key configured"
fi

# Check WhatsApp configuration
if [ -z "$WHATSAPP_API" ]; then
    echo "⚠️  Warning: WHATSAPP_API not set"
else
    echo "✅ WhatsApp API configured: $WHATSAPP_API"
fi

# Create logs directory
mkdir -p /app/logs
echo "📁 Logs directory ready"

# Set proper timezone for Kuwait
export TZ=Asia/Kuwait
echo "🕐 Timezone set to: $TZ"

# Test Python imports
echo "🔧 Testing Python dependencies..."
python3 -c "
import sys
try:
    from news_analyzer import CryptoNewsAnalyzer
    from cache_manager import CacheManager  
    from webhook_manager import WebhookManager
    print('✅ All core modules imported successfully')
except ImportError as e:
    print(f'❌ Import error: {e}')
    sys.exit(1)
"

# Test Redis connectivity if configured
if [ ! -z "$REDIS_URL" ]; then
    echo "🔗 Testing Redis connection..."
    python3 -c "
import asyncio
import sys
from cache_manager import CacheManager

async def test_redis():
    try:
        cache = CacheManager()
        await cache.connect()
        await cache.disconnect()
        print('✅ Redis connection test passed')
    except Exception as e:
        print(f'❌ Redis connection failed: {e}')
        sys.exit(1)

asyncio.run(test_redis())
"
fi

echo ""
echo "🎯 Environment validation complete!"
echo "🔄 Starting MCP server with stdio protocol..."
echo "📡 Ready for n8n MCP Client connections"
echo ""

# Start the MCP server
exec python3 /app/mcp_server.py