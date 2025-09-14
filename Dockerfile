# MCP News v2.1 - Production Dockerfile
# Multi-stage build for optimized TypeScript Node.js application
# Enhanced with security hardening and performance optimizations

FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --silent --prefer-offline --no-audit

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Set environment variables
ENV NODE_ENV=production
ENV TZ=Asia/Kuwait

# Install runtime dependencies, security updates, and create user
RUN apk update && apk upgrade && \
    apk add --no-cache \
    curl=8.5.0-r0 \
    dumb-init=1.2.5-r2 \
    tini=0.19.0-r1 \
    && rm -rf /var/cache/apk/* \
    && addgroup -g 1001 -S kaayaan \
    && adduser -S kaayaan -u 1001 -G kaayaan

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY --from=builder --chown=kaayaan:kaayaan /app/package.json ./

# Install only production dependencies
RUN npm ci --only=production --silent --prefer-offline --no-audit

# Copy built application
COPY --from=builder --chown=kaayaan:kaayaan /app/dist ./dist

# Switch to non-root user
USER kaayaan

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD ["sh", "-c", "curl -f http://localhost:${PORT:-4009}/health || exit 1"]

# Expose default port
EXPOSE 4009

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application with proper signal handling
CMD ["node", "--enable-source-maps", "--max-old-space-size=512", "dist/index.js"]