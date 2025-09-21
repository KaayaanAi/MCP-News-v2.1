# MCP News v2.1 - Production Dockerfile
# Multi-stage build for optimized TypeScript Node.js application
# Enhanced with security hardening and performance optimizations
# LATEST VERSIONS: Node.js 22-alpine, npm latest, security updates

FROM node:22-alpine AS builder

# Update Alpine system and install latest npm
RUN apk update && apk upgrade && \
    npm install -g npm@latest

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --silent --prefer-offline

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine AS production

# Set environment variables
ENV NODE_ENV=production
ENV TZ=UTC

# Install runtime dependencies, security updates, and create user
RUN apk update && apk upgrade && \
    apk add --no-cache \
    curl=8.14.1-r1 \
    dumb-init=1.2.5-r3 \
    tini=0.19.0-r3 \
    ca-certificates=20240705-r0 \
    && npm install -g npm@10.9.2 \
    && rm -rf /var/cache/apk/* \
    && addgroup -g 1001 -S kaayaan \
    && adduser -S kaayaan -u 1001 -G kaayaan

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY --from=builder --chown=kaayaan:kaayaan /app/package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --silent --prefer-offline --no-audit

# Copy built application and health check script
COPY --from=builder --chown=kaayaan:kaayaan /app/dist ./dist
COPY --chown=kaayaan:kaayaan healthcheck.js ./

# Switch to non-root user
USER kaayaan

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["node", "healthcheck.js"]

# Expose default port
EXPOSE 4009

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application with proper signal handling
CMD ["node", "--enable-source-maps", "--max-old-space-size=512", "dist/server.js"]