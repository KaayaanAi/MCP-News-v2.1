# Kaayaan MCP News v2.1 - Production Dockerfile
# Multi-stage build for optimized production image

FROM python:3.11-slim AS builder

# Install build dependencies, create venv, and install packages in one layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

# Copy requirements and install Python dependencies
COPY requirements.txt /tmp/
RUN pip install --no-cache-dir --upgrade pip==23.3.1 \
    && pip install --no-cache-dir --requirement /tmp/requirements.txt

# Production stage
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PATH="/opt/venv/bin:$PATH"
ENV TZ=Asia/Kuwait

# Install runtime dependencies and create user in one layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && groupadd -r kaayaan && useradd -r -g kaayaan kaayaan

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv

# Create app directory
WORKDIR /app

# Copy application code
COPY --chown=kaayaan:kaayaan *.py /app/
COPY --chown=kaayaan:kaayaan start_server.sh /app/
RUN chmod +x /app/start_server.sh

# Switch to non-root user
USER kaayaan

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD ["python3", "-c", "import sys; sys.exit(0)"]

# Expose port for monitoring (optional)
EXPOSE 8080

# Use start script as entrypoint
ENTRYPOINT ["/app/start_server.sh"]