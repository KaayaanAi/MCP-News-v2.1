/**
 * Server-Sent Events (SSE) Protocol Handler
 * Implements real-time streaming updates from server to client
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import { createServer, Server } from 'http';
import { EventEmitter } from 'events';
import helmet from 'helmet';
import cors from 'cors';
import type {
  ProtocolHandler,
  ProtocolType,
  Logger,
  SSEEvent,
  RateLimiter
} from '../types/index.js';
import {
  ErrorCodes
} from '../types/index.js';
import { createRateLimitMiddleware } from '../services/rate_limiter.js';
import {
  HEARTBEAT_INTERVAL,
  CONNECTION_TIMEOUT
} from '../config/constants.js';

interface SSEConfig {
  port: number;
  corsOrigins: string[];
  apiKey?: string;
  rateLimiter?: RateLimiter;
  heartbeatInterval?: number;
  maxConnections?: number;
  connectionTimeout?: number;
}

interface SSEConnection {
  id: string;
  response: Response;
  request: Request;
  authenticated: boolean;
  connectTime: number;
  lastHeartbeat: number;
  eventCount: number;
  ipAddress?: string;
  userAgent?: string;
  subscriptions: Set<string>;
}

interface StreamData {
  type: 'market_update' | 'news_alert' | 'sentiment_change' | 'system_notification' | 'heartbeat';
  data: unknown;
  timestamp: number;
  id?: string;
  retry?: number;
}

/**
 * Server-Sent Events protocol handler
 */
export class SSEProtocolHandler extends EventEmitter implements ProtocolHandler {
  private logger: Logger;
  private config: SSEConfig;
  private app: Application;
  private server: Server | null = null;
  private _isRunning = false;
  private connections = new Map<string, SSEConnection>();
  private startTime = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private eventIdCounter = 0;

  constructor(config: SSEConfig, logger: Logger) {
    super();
    this.config = {
      heartbeatInterval: HEARTBEAT_INTERVAL,
      maxConnections: 200,
      connectionTimeout: CONNECTION_TIMEOUT,
      ...config
    };
    this.logger = logger.child({ protocol: 'sse' });
    this.app = express();

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Start the SSE server
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new Error('SSE protocol handler is already running');
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = createServer(this.app);

        this.server.listen(this.config.port, () => {
          this._isRunning = true;
          this.startTime = Date.now();
          this.startHeartbeat();

          this.logger.info('SSE server started', {
            port: this.config.port,
            corsOrigins: this.config.corsOrigins,
            hasApiKey: !!this.config.apiKey,
            maxConnections: this.config.maxConnections
          });
          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.logger.error('SSE server error', error);
          reject(error);
        });

      } catch (error) {
        this.logger.error('Failed to start SSE server', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the SSE server
   */
  async stop(): Promise<void> {
    if (!this.server || !this._isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.logger.info('Stopping SSE server');

      // Stop heartbeat
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Close all connections
      this.connections.forEach((connection) => {
        this.closeConnection(connection, 'Server shutting down');
      });
      this.connections.clear();

      this.server!.close((error) => {
        if (error) {
          this.logger.error('Error stopping SSE server', error);
          reject(error);
        } else {
          this._isRunning = false;
          this.server = null;
          this.logger.info('SSE server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Check if the handler is running
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get protocol type
   */
  getType(): ProtocolType {
    return 'sse';
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security headers (modified for SSE)
    this.app.use(helmet({
      contentSecurityPolicy: false, // SSE requires relaxed CSP
      crossOriginEmbedderPolicy: false,
    }));

    // CORS with SSE-specific headers
    this.app.use(cors({
      origin: this.config.corsOrigins,
      methods: ['GET', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Cache-Control'],
      credentials: true,
    }));

    // Request logging
    this.app.use((req, _res, next) => {
      const requestId = Math.random().toString(36).substring(7);
      req.requestId = requestId;

      this.logger.debug('SSE request received', {
        requestId,
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
      });

      next();
    });

    // Rate limiting
    if (this.config.rateLimiter) {
      const rateLimitMiddleware = createRateLimitMiddleware(
        this.config.rateLimiter,
        {
          keyGenerator: (req) => req.ip || 'anonymous',
          skip: (req) => req.path === '/health',
          onLimitReached: (req, rateLimitInfo) => {
            this.logger.warn('SSE rate limit exceeded', {
              ip: req.ip,
              path: req.path,
              limit: rateLimitInfo.totalRequests,
            });
          },
        }
      );

      this.app.use('/events', rateLimitMiddleware);
    }

    // API key authentication middleware
    this.app.use('/events', this.authenticateApiKey.bind(this));
  }

  /**
   * Setup SSE routes
   */
  private setupRoutes(): void {
    // Health check endpoint (public)
    this.app.get('/health', this.handleHealthCheck.bind(this));

    // Main SSE event stream endpoint
    this.app.get('/events', this.handleEventStream.bind(this));

    // Subscription management endpoints
    this.app.get('/events/subscribe/:channel', this.handleSubscribe.bind(this));
    this.app.get('/events/unsubscribe/:channel', this.handleUnsubscribe.bind(this));

    // Server info endpoint
    this.app.get('/info', this.handleServerInfo.bind(this));

    // 404 handler
    this.app.use((_req, res) => {
      res.status(404).json({
        error: {
          code: ErrorCodes.METHOD_NOT_FOUND,
          message: 'Endpoint not found',
          type: 'NOT_FOUND',
        },
      });
    });

    // Error handling middleware (must be last)
    this.app.use(this.errorHandler.bind(this));
  }

  /**
   * API key authentication middleware
   */
  private authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
    // Skip authentication if no API key is configured
    if (!this.config.apiKey) {
      return next();
    }

    const apiKey = req.get('Authorization')?.replace('Bearer ', '') ||
                   req.get('X-API-Key') ||
                   req.query.api_key as string;

    if (!apiKey || apiKey !== this.config.apiKey) {
      this.logger.warn('SSE authentication failed', {
        ip: req.ip,
        path: req.path,
        hasApiKey: !!apiKey,
      });

      res.status(401).json({
        error: {
          code: ErrorCodes.AUTHENTICATION_ERROR,
          message: 'Invalid or missing API key',
          type: 'AUTHENTICATION_ERROR',
        },
      });
      return;
    }

    next();
  }

  /**
   * Error handling middleware
   */
  private errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
    this.logger.error('SSE request error', {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });

    res.status(500).json({
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Internal server error',
        type: 'INTERNAL_ERROR',
      },
    });
  }

  /**
   * Handle health check requests
   */
  private handleHealthCheck(_req: Request, res: Response): void {
    const uptime = Date.now() - this.startTime;

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime / 1000),
      version: '3.0.0',
      protocol: 'sse',
      connections: {
        active: this.connections.size,
        max: this.config.maxConnections,
      },
      features: {
        heartbeat: !!this.config.heartbeatInterval,
        authentication: !!this.config.apiKey,
        rateLimiting: !!this.config.rateLimiter,
      },
    });
  }

  /**
   * Handle main event stream connection
   */
  private handleEventStream(req: Request, res: Response): void {
    // Check connection limit
    if (this.connections.size >= this.config.maxConnections!) {
      this.logger.warn('SSE connection rejected - max connections reached', {
        currentConnections: this.connections.size,
        maxConnections: this.config.maxConnections,
        ip: req.ip
      });

      res.status(503).json({
        error: {
          code: ErrorCodes.SERVICE_UNAVAILABLE,
          message: 'Maximum connections reached',
          type: 'SERVICE_UNAVAILABLE',
        },
      });
      return;
    }

    const connectionId = this.generateConnectionId();

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': req.get('Origin') || '*',
      'Access-Control-Allow-Credentials': 'true',
      'X-Connection-ID': connectionId,
    });

    // Create connection object
    const connection: SSEConnection = {
      id: connectionId,
      response: res,
      request: req,
      authenticated: true, // Already authenticated by middleware
      connectTime: Date.now(),
      lastHeartbeat: Date.now(),
      eventCount: 0,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      subscriptions: new Set(['general']), // Default subscription
    };

    this.connections.set(connectionId, connection);

    this.logger.info('SSE client connected', {
      connectionId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      totalConnections: this.connections.size
    });

    // Send initial connection event
    this.sendEvent(connection, {
      type: 'system_notification',
      data: {
        message: 'Connected to MCP-NEWS-V3 SSE stream',
        connectionId,
        availableChannels: ['general', 'market_updates', 'news_alerts', 'sentiment_changes']
      },
      timestamp: Date.now(),
    });

    // Handle client disconnect
    req.on('close', () => {
      this.handleClientDisconnect(connectionId);
    });

    req.on('error', (error) => {
      this.logger.error('SSE client error', {
        connectionId,
        error: error.message
      });
      this.handleClientDisconnect(connectionId);
    });

    this.emit('client_connected', { connectionId, connection });
  }

  /**
   * Handle subscription to specific channel
   */
  private handleSubscribe(req: Request, res: Response): void {
    const channel = req.params.channel;
    const connectionId = req.get('X-Connection-ID') || req.query.connection_id as string;

    if (!channel) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Channel is required',
          type: 'INVALID_PARAMS',
        },
      });
      return;
    }

    if (!connectionId || !this.connections.has(connectionId)) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Valid connection ID required',
          type: 'INVALID_PARAMS',
        },
      });
      return;
    }

    const connection = this.connections.get(connectionId)!;
    connection.subscriptions.add(channel!);

    this.logger.debug('Client subscribed to channel', {
      connectionId,
      channel,
      totalSubscriptions: connection.subscriptions.size
    });

    // Send confirmation event
    this.sendEvent(connection, {
      type: 'system_notification',
      data: {
        message: `Subscribed to channel: ${channel}`,
        channel,
        subscriptions: Array.from(connection.subscriptions)
      },
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      data: {
        channel,
        subscriptions: Array.from(connection.subscriptions)
      }
    });
  }

  /**
   * Handle unsubscription from specific channel
   */
  private handleUnsubscribe(req: Request, res: Response): void {
    const channel = req.params.channel;
    const connectionId = req.get('X-Connection-ID') || req.query.connection_id as string;

    if (!channel) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Channel is required',
          type: 'INVALID_PARAMS',
        },
      });
      return;
    }

    if (!connectionId || !this.connections.has(connectionId)) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Valid connection ID required',
          type: 'INVALID_PARAMS',
        },
      });
      return;
    }

    const connection = this.connections.get(connectionId)!;
    connection.subscriptions.delete(channel!);

    this.logger.debug('Client unsubscribed from channel', {
      connectionId,
      channel,
      totalSubscriptions: connection.subscriptions.size
    });

    res.json({
      success: true,
      data: {
        channel,
        subscriptions: Array.from(connection.subscriptions)
      }
    });
  }

  /**
   * Handle server info requests
   */
  private handleServerInfo(_req: Request, res: Response): void {
    const uptime = Date.now() - this.startTime;

    res.json({
      name: 'mcp-news-v3',
      version: '3.0.0',
      description: 'Universal MCP Server - SSE Protocol',
      protocol: 'sse',
      uptime: Math.floor(uptime / 1000),
      connections: {
        active: this.connections.size,
        max: this.config.maxConnections,
      },
      channels: ['general', 'market_updates', 'news_alerts', 'sentiment_changes'],
      features: {
        heartbeat: true,
        subscriptions: true,
        authentication: !!this.config.apiKey,
        rateLimiting: !!this.config.rateLimiter,
      },
    });
  }

  /**
   * Send event to specific connection
   */
  public sendEvent(connection: SSEConnection, eventData: StreamData): void {
    try {
      const eventId = this.generateEventId();
      const event: SSEEvent = {
        id: eventId,
        event: eventData.type,
        data: JSON.stringify({
          data: eventData.data,
          timestamp: eventData.timestamp,
        }),
        retry: eventData.retry,
      };

      const eventString = this.formatSSEEvent(event);
      connection.response.write(eventString);

      connection.eventCount++;
      connection.lastHeartbeat = Date.now();

      this.logger.trace('Sent SSE event', {
        connectionId: connection.id,
        eventType: eventData.type,
        eventId,
        eventCount: connection.eventCount
      });

    } catch (error) {
      this.logger.error('Failed to send SSE event', {
        connectionId: connection.id,
        eventType: eventData.type,
        error: error instanceof Error ? error.message : String(error)
      });

      this.handleClientDisconnect(connection.id);
    }
  }

  /**
   * Broadcast event to all connections subscribed to a channel
   */
  public broadcastToChannel(channel: string, eventData: StreamData): void {
    let sentCount = 0;

    this.connections.forEach((connection) => {
      if (connection.authenticated && connection.subscriptions.has(channel)) {
        this.sendEvent(connection, eventData);
        sentCount++;
      }
    });

    this.logger.debug('Broadcasted SSE event to channel', {
      channel,
      eventType: eventData.type,
      sentCount,
      totalConnections: this.connections.size
    });
  }

  /**
   * Broadcast event to all authenticated connections
   */
  public broadcastToAll(eventData: StreamData): void {
    let sentCount = 0;

    this.connections.forEach((connection) => {
      if (connection.authenticated) {
        this.sendEvent(connection, eventData);
        sentCount++;
      }
    });

    this.logger.debug('Broadcasted SSE event to all connections', {
      eventType: eventData.type,
      sentCount,
      totalConnections: this.connections.size
    });
  }

  /**
   * Format SSE event according to specification
   */
  private formatSSEEvent(event: SSEEvent): string {
    let formatted = '';

    if (event.id) {
      formatted += `id: ${event.id}\n`;
    }

    if (event.event) {
      formatted += `event: ${event.event}\n`;
    }

    if (event.retry) {
      formatted += `retry: ${event.retry}\n`;
    }

    // Handle multi-line data
    const dataLines = event.data.split('\n');
    dataLines.forEach(line => {
      formatted += `data: ${line}\n`;
    });

    formatted += '\n'; // End with empty line

    return formatted;
  }

  /**
   * Handle client disconnect
   */
  private handleClientDisconnect(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.logger.info('SSE client disconnected', {
      connectionId,
      connectionDuration: Date.now() - connection.connectTime,
      eventsSent: connection.eventCount,
      subscriptions: Array.from(connection.subscriptions)
    });

    this.connections.delete(connectionId);
    this.emit('client_disconnected', { connectionId });
  }

  /**
   * Close connection with message
   */
  private closeConnection(connection: SSEConnection, reason: string): void {
    try {
      // Send final message
      this.sendEvent(connection, {
        type: 'system_notification',
        data: { message: reason, closing: true },
        timestamp: Date.now(),
      });

      // End the response
      connection.response.end();
    } catch (error) {
      this.logger.error('Error closing SSE connection', {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const deadConnections: string[] = [];

      this.connections.forEach((connection, connectionId) => {
        // Check for stale connections
        if (now - connection.lastHeartbeat > this.config.connectionTimeout!) {
          deadConnections.push(connectionId);
          return;
        }

        // Send heartbeat
        this.sendEvent(connection, {
          type: 'heartbeat',
          data: {
            timestamp: now,
            connectionId,
            uptime: now - connection.connectTime,
          },
          timestamp: now,
        });
      });

      // Clean up dead connections
      deadConnections.forEach(connectionId => {
        this.logger.info('Removing stale SSE connection', { connectionId });
        this.handleClientDisconnect(connectionId);
      });

    }, this.config.heartbeatInterval);
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `sse_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    this.eventIdCounter = (this.eventIdCounter + 1) % 1000000;
    return `${Date.now()}_${this.eventIdCounter}`;
  }

  /**
   * Get current server status
   */
  getStatus(): {
    isRunning: boolean;
    port: number;
    connectionCount: number;
    uptime: number;
    hasApiKey: boolean;
    corsOrigins: string[];
  } {
    const uptime = this._isRunning ? Date.now() - this.startTime : 0;

    return {
      isRunning: this._isRunning,
      port: this.config.port,
      connectionCount: this.connections.size,
      uptime: Math.floor(uptime / 1000),
      hasApiKey: !!this.config.apiKey,
      corsOrigins: this.config.corsOrigins,
    };
  }

  /**
   * Get connected clients info
   */
  getConnections(): Array<{
    id: string;
    connectTime: number;
    eventCount: number;
    subscriptions: string[];
    ipAddress?: string;
    userAgent?: string;
  }> {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      connectTime: conn.connectTime,
      eventCount: conn.eventCount,
      subscriptions: Array.from(conn.subscriptions),
      ipAddress: conn.ipAddress,
      userAgent: conn.userAgent,
    }));
  }
}

/**
 * Extend Express Request interface for SSE
 */
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Create and configure SSE protocol handler
 */
export function createSSEHandler(
  config: SSEConfig,
  logger: Logger
): SSEProtocolHandler {
  return new SSEProtocolHandler(config, logger);
}