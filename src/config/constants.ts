/**
 * Application Constants
 * Centralized configuration values for MCP-News v2.1
 *
 * This file contains hardcoded values that were extracted from various
 * parts of the codebase to improve maintainability and configuration
 * management.
 */

// WebSocket Configuration
export const WEBSOCKET_PONG_TIMEOUT = 5000; // milliseconds
export const WEBSOCKET_PING_INTERVAL = 30000; // milliseconds

// Validation Configuration
export const VALIDATION_TIMEOUT = 5000; // milliseconds
export const HIGH_LATENCY_THRESHOLD = 5000; // milliseconds
export const HIGH_QUALITY_SCORE_THRESHOLD = 80; // percentage

// Network Configuration
export const DEFAULT_HTTP_PORT = 4008;

// Cache Configuration
export const DEFAULT_CACHE_TTL_SECONDS = 1800; // 30 minutes
export const NEWS_CACHE_TTL_SECONDS = 1800; // 30 minutes
export const VALIDATION_CACHE_TTL_SECONDS = 7200; // 2 hours

// Quality Score Thresholds
export const QUALITY_SCORE_THRESHOLDS = {
  EXCELLENT: 80,
  GOOD: 60,
  ACCEPTABLE: 40,
  POOR: 0
} as const;

// Connection Limits
export const MAX_WEBSOCKET_CONNECTIONS = 100;
export const CONNECTION_TIMEOUT = 300000; // 5 minutes
export const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// HTTP Timeouts
export const DEFAULT_HTTP_TIMEOUT = 5000; // milliseconds
export const DOMAIN_CHECK_TIMEOUT = 5000; // milliseconds

// Mock Data Configuration
export const MOCK_LATENCY_MIN = 200; // milliseconds
export const MOCK_LATENCY_MAX = 1200; // milliseconds
export const MOCK_SUCCESS_RATE = 0.9; // 90% success rate

export default {
  // WebSocket
  WEBSOCKET_PONG_TIMEOUT,
  WEBSOCKET_PING_INTERVAL,

  // Validation
  VALIDATION_TIMEOUT,
  HIGH_LATENCY_THRESHOLD,
  HIGH_QUALITY_SCORE_THRESHOLD,

  // Network
  DEFAULT_HTTP_PORT,

  // Cache
  DEFAULT_CACHE_TTL_SECONDS,
  NEWS_CACHE_TTL_SECONDS,
  VALIDATION_CACHE_TTL_SECONDS,

  // Quality Thresholds
  QUALITY_SCORE_THRESHOLDS,

  // Connection Limits
  MAX_WEBSOCKET_CONNECTIONS,
  CONNECTION_TIMEOUT,
  HEARTBEAT_INTERVAL,

  // HTTP
  DEFAULT_HTTP_TIMEOUT,
  DOMAIN_CHECK_TIMEOUT,

  // Mock Data
  MOCK_LATENCY_MIN,
  MOCK_LATENCY_MAX,
  MOCK_SUCCESS_RATE,
} as const;