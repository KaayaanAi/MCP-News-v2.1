#!/bin/bash
set -e

echo "🚀 Starting MCP News Server v2.1"
echo "⏰ Timezone: $(date '+%Z %z')"
echo "🌍 Location: Kuwait"
echo "🟢 Node.js TypeScript Application"

# Validate critical environment variables
echo "🔍 Validating environment..."

# Check Node.js version
NODE_VERSION=$(node --version)
echo "✅ Node.js version: $NODE_VERSION"

# Check Redis connection
if [ -z "$REDIS_URL" ]; then
    echo "⚠️  Warning: REDIS_URL not set - using in-memory cache"
else
    echo "✅ Redis URL configured"
fi

# Check AI configuration
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Error: OPENAI_API_KEY required for sentiment analysis"
    exit 1
else
    echo "✅ OpenAI API key configured"
fi

# Set environment variables
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-4009}
export LOG_LEVEL=${LOG_LEVEL:-info}
export TZ=Asia/Kuwait

echo "🕐 Timezone set to: $TZ"
echo "🚀 Node environment: $NODE_ENV"
echo "🔌 Port: $PORT"
echo "📊 Log level: $LOG_LEVEL"

# Create logs directory with proper permissions
mkdir -p /app/logs
chown -R kaayaan:kaayaan /app/logs 2>/dev/null || true
echo "📁 Logs directory ready"

# Test Node.js application and dependencies
echo "🔧 Testing application startup..."
if ! node -e "console.log('Node.js ready')"; then
    echo "❌ Node.js test failed"
    exit 1
fi

# Test if application can be imported
echo "🔧 Testing application imports..."
if ! node -e "import('./dist/index.js').catch(() => process.exit(1))"; then
    echo "❌ Application import test failed"
    exit 1
fi

# Performance optimizations
echo "⚡ Setting performance optimizations..."
export UV_THREADPOOL_SIZE=16
export NODE_OPTIONS="${NODE_OPTIONS:-} --enable-source-maps --max-old-space-size=1024"

echo ""
echo "🎯 Environment validation complete!"
echo "🔄 Starting TypeScript MCP server..."
echo "📡 Supports multiple protocols: stdio, HTTP, WebSocket, SSE"
echo "🛡️  Security: Non-root user, rate limiting, CORS protection"
echo "⚡ Performance: Redis caching, connection pooling, memory management"
echo ""

# Start the MCP server
exec node /app/dist/index.js