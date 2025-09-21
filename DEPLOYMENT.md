# Production Deployment Guide - MCP-News-v2.1

**Complete guide for deploying MCP-News-v2.1 in production environments**

## 🎯 Overview

This guide covers production deployment of MCP-News-v2.1, a production-ready MCP server with dual protocol support (STDIO MCP and HTTP MCP). The server provides cryptocurrency news sentiment analysis with enterprise-grade security and performance.

## 📋 Pre-Deployment Checklist

### System Requirements

- **Node.js**: 20.0.0 or higher
- **Memory**: Minimum 512MB, recommended 1GB
- **CPU**: 1 core minimum, 2 cores recommended
- **Storage**: 1GB free space for logs and cache
- **Network**: Outbound HTTPS access for OpenAI and news APIs

### Required Services

- **Redis** (recommended): For caching and performance
- **OpenAI API**: For sentiment analysis functionality
- **News APIs** (optional): NewsAPI.org, CryptoPanic for real news data

### Security Considerations

- [ ] API keys secured and rotated regularly
- [ ] Network access restricted to necessary endpoints
- [ ] Logs configured to exclude sensitive data
- [ ] CORS origins properly configured
- [ ] SSL/TLS termination configured (for HTTP protocol)

## 🚀 Deployment Methods

### Method 1: Docker Deployment (Recommended)

#### Step 1: Prepare Environment

```bash
# Clone repository
git clone <repository-url> mcp-news-v2.1
cd mcp-news-v2.1

# Create environment file
cp .env.example .env
```

#### Step 2: Configure Environment

Edit `.env` file with production values:

```env
# Core Configuration
NODE_ENV=production
HTTP_PORT=4009
LOG_LEVEL=info
PRETTY_LOGS=false

# Security
API_KEY=your_secure_production_api_key_here
CORS_ORIGINS=https://your-domain.com,https://n8n.your-domain.com

# AI Integration
OPENAI_API_KEY=sk-your-production-openai-key
OPENAI_MODEL=gpt-4
OPENAI_MAX_COMPLETION_TOKENS=1000
OPENAI_TEMPERATURE=0.1

# Caching
REDIS_URL=redis://your-redis-host:6379
CACHE_TTL_SECONDS=300
ENABLE_CACHE=true

# News APIs (optional)
NEWS_API_KEY=your_news_api_key
CRYPTO_PANIC_API_KEY=your_crypto_panic_key
MOCK_EXTERNAL_APIS=false
```

#### Step 3: Deploy with Docker Compose

```bash
# Build and start services
docker-compose -f docker-compose.production.yml up -d

# Verify deployment
docker-compose ps
docker logs mcp-news-v2.1

# Test health endpoint
curl http://localhost:4009/health
```

#### Step 4: Verify MCP Functionality

```bash
# Test MCP protocol
curl -X POST http://localhost:4009/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'

# Run comprehensive validation
docker exec mcp-news-v2.1 node validation_comprehensive.js
```

### Method 2: Direct Node.js Deployment

#### Step 1: System Setup

```bash
# Install Node.js 20+ (using NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Create application user
sudo useradd -m -s /bin/bash mcp-news
sudo mkdir -p /opt/mcp-news
sudo chown mcp-news:mcp-news /opt/mcp-news
```

#### Step 2: Application Deployment

```bash
# Switch to application user
sudo su - mcp-news

# Deploy application
cd /opt/mcp-news
git clone <repository-url> .
npm ci --only=production

# Build application
npm run build

# Configure environment
cp .env.example .env
# Edit .env with production values
```

#### Step 3: Process Management with PM2

```bash
# Install PM2 globally
npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'mcp-news-v2.1',
    script: 'dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      HTTP_PORT: 4009
    },
    log_file: '/opt/mcp-news/logs/combined.log',
    out_file: '/opt/mcp-news/logs/out.log',
    error_file: '/opt/mcp-news/logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '512M',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '60s'
  }]
};
EOF

# Start application
pm2 start ecosystem.config.js

# Configure auto-startup
pm2 startup
pm2 save
```

#### Step 4: Reverse Proxy (Nginx)

```nginx
# /etc/nginx/sites-available/mcp-news
server {
    listen 443 ssl http2;
    server_name mcp-api.your-domain.com;

    # SSL configuration
    ssl_certificate /path/to/ssl/certificate.crt;
    ssl_certificate_key /path/to/ssl/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=mcp_api:10m rate=10r/s;
    limit_req zone=mcp_api burst=20 nodelay;

    location / {
        proxy_pass http://127.0.0.1:4009;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    # Health check endpoint (public)
    location /health {
        proxy_pass http://127.0.0.1:4009/health;
        access_log off;
    }
}

# HTTP redirect
server {
    listen 80;
    server_name mcp-api.your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

Enable and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/mcp-news /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 🔧 External Services Setup

### Redis Configuration

#### Option 1: Docker Redis
```yaml
# Already included in docker-compose.production.yml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  volumes:
    - redis_data:/data
  command: redis-server --appendonly yes
```

#### Option 2: Managed Redis (AWS ElastiCache, Redis Cloud)
```env
REDIS_URL=rediss://username:password@your-redis-cluster.cache.amazonaws.com:6380
```

#### Option 3: Self-hosted Redis
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install redis-server

# Configure Redis
sudo nano /etc/redis/redis.conf
# Set: bind 127.0.0.1
# Set: requirepass your_secure_password

sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### OpenAI API Setup

1. **Get API Key**: Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. **Set Usage Limits**: Configure monthly spending limits
3. **Monitor Usage**: Set up billing alerts

**Recommended Settings:**
```env
OPENAI_API_KEY=sk-your-production-key-here
OPENAI_MODEL=gpt-4  # or gpt-3.5-turbo for cost savings
OPENAI_MAX_COMPLETION_TOKENS=1000
OPENAI_TEMPERATURE=0.1  # Lower for consistent analysis
```

### News APIs Setup

#### NewsAPI.org (Optional)
1. Register at [NewsAPI.org](https://newsapi.org/)
2. Get free or paid API key
3. Configure in environment:
```env
NEWS_API_KEY=your_newsapi_key_here
```

#### CryptoPanic (Optional)
1. Register at [CryptoPanic](https://cryptopanic.com/developers/api/)
2. Get API key
3. Configure in environment:
```env
CRYPTO_PANIC_API_KEY=your_cryptopanic_key_here
```

## 📊 Monitoring & Logging

### Application Monitoring

#### Health Checks
```bash
# Basic health check
curl https://mcp-api.your-domain.com/health

# Detailed MCP validation
curl -X POST https://mcp-api.your-domain.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

#### PM2 Monitoring
```bash
# View process status
pm2 status

# View logs
pm2 logs mcp-news-v2.1

# Monitor resources
pm2 monit

# Restart application
pm2 restart mcp-news-v2.1
```

#### Docker Monitoring
```bash
# View container status
docker-compose ps

# View logs
docker-compose logs -f mcp-news

# Monitor resources
docker stats mcp-news-v2.1

# Restart services
docker-compose restart mcp-news
```

### Log Management

#### Log Configuration
```env
# Environment variables for logging
LOG_LEVEL=info        # error, warn, info, debug
PRETTY_LOGS=false     # false for production
```

#### Log Rotation (Logrotate)
```bash
# Create logrotate configuration
sudo nano /etc/logrotate.d/mcp-news

# Content:
/opt/mcp-news/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 mcp-news mcp-news
    postrotate
        pm2 reloadLogs
    endscript
}
```

### Performance Monitoring

#### Key Metrics to Monitor
- **Response Time**: Health endpoint should respond < 200ms
- **Memory Usage**: Should stay below 512MB
- **CPU Usage**: Should be < 50% under normal load
- **Cache Hit Ratio**: Should be > 80% with Redis
- **Error Rate**: Should be < 1%

#### Alerting Setup (Example with curl)
```bash
#!/bin/bash
# health-check.sh - Add to cron for monitoring

HEALTH_URL="https://mcp-api.your-domain.com/health"
WEBHOOK_URL="https://hooks.slack.com/your-webhook-url"

response=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $response -ne 200 ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data '{"text":"🚨 MCP-News health check failed: HTTP '$response'"}' \
        $WEBHOOK_URL
fi
```

## 🔒 Security Best Practices

### API Key Management

```bash
# Use environment variables, never hardcode
export OPENAI_API_KEY="sk-your-key-here"

# Rotate keys regularly
# Set up key rotation schedule (monthly/quarterly)

# Use different keys for different environments
# production-key, staging-key, development-key
```

### Network Security

```bash
# Firewall configuration (UFW example)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Block direct access to application port
sudo ufw deny 4009/tcp
```

### SSL/TLS Configuration

```bash
# Use Let's Encrypt for free SSL certificates
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d mcp-api.your-domain.com

# Test SSL configuration
sudo certbot renew --dry-run
```

### Access Control

```env
# Restrict CORS origins
CORS_ORIGINS=https://your-domain.com,https://n8n.your-domain.com

# Use strong API keys
API_KEY=use_a_long_random_secure_api_key_here_min_32_chars
```

## 🔧 Maintenance & Updates

### Regular Maintenance Tasks

#### Daily
- [ ] Check application logs for errors
- [ ] Monitor resource usage (CPU, memory, disk)
- [ ] Verify health endpoint response

#### Weekly
- [ ] Review and rotate log files
- [ ] Check for security updates
- [ ] Monitor API usage and costs
- [ ] Backup configuration files

#### Monthly
- [ ] Update dependencies (after testing)
- [ ] Rotate API keys
- [ ] Review and update monitoring alerts
- [ ] Performance optimization review

### Update Procedure

```bash
# 1. Backup current deployment
sudo tar -czf mcp-news-backup-$(date +%Y%m%d).tar.gz /opt/mcp-news

# 2. Test new version in staging
git checkout main
git pull origin main
npm ci
npm run build
npm test

# 3. Deploy to production
pm2 stop mcp-news-v2.1
cp -r dist dist.backup
npm run build
pm2 start mcp-news-v2.1

# 4. Verify deployment
curl https://mcp-api.your-domain.com/health
node validation_comprehensive.js

# 5. Monitor for issues
pm2 logs mcp-news-v2.1 --lines 100
```

### Rollback Procedure

```bash
# If issues occur, rollback quickly
pm2 stop mcp-news-v2.1
rm -rf dist
mv dist.backup dist
pm2 start mcp-news-v2.1

# Verify rollback
curl https://mcp-api.your-domain.com/health
```

## 🚨 Troubleshooting

### Common Issues

#### Application Won't Start
```bash
# Check logs
pm2 logs mcp-news-v2.1

# Check environment variables
pm2 show mcp-news-v2.1

# Verify Node.js version
node --version  # Should be 20+

# Check file permissions
ls -la /opt/mcp-news
```

#### High Memory Usage
```bash
# Monitor memory usage
pm2 monit

# Restart application
pm2 restart mcp-news-v2.1

# Check for memory leaks in logs
grep -i "memory\|heap" /opt/mcp-news/logs/*.log
```

#### API Errors
```bash
# Test OpenAI connection
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
     https://api.openai.com/v1/models

# Test Redis connection
redis-cli ping

# Check API rate limits
grep -i "rate\|limit" /opt/mcp-news/logs/*.log
```

#### Performance Issues
```bash
# Check cache hit ratio
curl https://mcp-api.your-domain.com/health | jq '.cache'

# Monitor response times
curl -w "@curl-format.txt" -s -o /dev/null \
     https://mcp-api.your-domain.com/health

# Check system resources
top
df -h
```

### Emergency Contacts

- **System Administrator**: [Your contact info]
- **API Provider Support**: OpenAI Support
- **Hosting Provider**: [Your hosting provider]

## 📚 Additional Resources

- **[README.md](./README.md)** - Project overview and setup
- **[API.md](./API.md)** - Complete API documentation
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history
- **Health Endpoint**: `https://your-domain.com/health`
- **Comprehensive Validation**: Run `node validation_comprehensive.js`

---

**For production support, monitor the health endpoints and check application logs for detailed error information.**