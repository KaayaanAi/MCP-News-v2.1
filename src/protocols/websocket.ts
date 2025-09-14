/**
 * WebSocket MCP Protocol Handler
 * Implements real-time bidirectional MCP communication over WebSocket
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import { EventEmitter } from 'events';
import { URL } from 'url';
import type {
  ProtocolHandler,
  ProtocolType,
  MCPRequest,
  MCPResponse,
  ToolHandler,
  ToolExecutionContext,
  Logger,
  RateLimiter
} from '../types/index.js';
import {
  WebSocketMessageSchema,
  ErrorCodes,
  MCPErrorException
} from '../types/index.js';
import {
  WEBSOCKET_PONG_TIMEOUT,
  WEBSOCKET_PING_INTERVAL,
  MAX_WEBSOCKET_CONNECTIONS
} from '../config/constants.js';

interface WebSocketConfig {
  port: number;
  apiKey?: string;
  rateLimiter?: RateLimiter;
  pingInterval?: number;
  pongTimeout?: number;
  maxConnections?: number;
}

interface ClientConnection {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  lastPing: number;
  lastPong: number;
  requestCount: number;
  connectTime: number;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * WebSocket MCP protocol handler
 */
export class WebSocketProtocolHandler extends EventEmitter implements ProtocolHandler {
  private logger: Logger;
  private config: WebSocketConfig;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private _isRunning = false;
  private tools = new Map<string, ToolHandler>();
  private connections = new Map<string, ClientConnection>();
  private startTime = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: WebSocketConfig, logger: Logger) {
    super();
    this.config = {
      pingInterval: WEBSOCKET_PING_INTERVAL,
      pongTimeout: WEBSOCKET_PONG_TIMEOUT,
      maxConnections: MAX_WEBSOCKET_CONNECTIONS,
      ...config
    };
    this.logger = logger.child({ protocol: 'websocket' });
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new Error('WebSocket protocol handler is already running');
    }

    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server for WebSocket upgrade
        this.server = createServer();

        // Create WebSocket server
        this.wss = new WebSocketServer({
          server: this.server,
          path: '/mcp',
          verifyClient: this.verifyClient.bind(this)
        });

        this.setupWebSocketHandlers();
        this.startPingInterval();

        this.server.listen(this.config.port, () => {
          this._isRunning = true;
          this.startTime = Date.now();
          this.logger.info('WebSocket server started', {
            port: this.config.port,
            hasApiKey: !!this.config.apiKey,
            maxConnections: this.config.maxConnections
          });
          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.logger.error('WebSocket server error', error);
          reject(error);
        });

      } catch (error) {
        this.logger.error('Failed to start WebSocket server', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    return new Promise((resolve) => {
      this.logger.info('Stopping WebSocket server');

      // Stop ping interval
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Close all connections
      this.connections.forEach((connection) => {
        connection.socket.close(1001, 'Server shutting down');
      });
      this.connections.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close(() => {
          // Close HTTP server
          if (this.server) {
            this.server.close(() => {
              this._isRunning = false;
              this.server = null;
              this.wss = null;
              this.logger.info('WebSocket server stopped');
              resolve();
            });
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
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
    return 'websocket';
  }

  /**
   * Register a tool with the protocol handler
   */
  registerTool(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler);
    this.logger.debug('Tool registered', { toolName: name });

    // Notify connected clients about new tool
    this.broadcastToClients({
      type: 'tool_registered',
      data: { name, definition: handler.definition }
    });
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
    this.logger.debug('Tool unregistered', { toolName: name });

    // Notify connected clients about removed tool
    this.broadcastToClients({
      type: 'tool_unregistered',
      data: { name }
    });
  }

  /**
   * Verify client connection
   */
  private verifyClient(_info: { origin: string; req: import('http').IncomingMessage; secure: boolean }): boolean {
    // Check maximum connections
    if (this.connections.size >= this.config.maxConnections!) {
      this.logger.warn('Connection rejected - max connections reached', {
        currentConnections: this.connections.size,
        maxConnections: this.config.maxConnections
      });
      return false;
    }

    // Additional verification logic could go here
    return true;
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (socket: WebSocket, request) => {
      const connectionId = this.generateConnectionId();
      const ipAddress = request.socket.remoteAddress;
      const userAgent = request.headers['user-agent'];

      // Create connection object
      const connection: ClientConnection = {
        id: connectionId,
        socket,
        authenticated: !this.config.apiKey, // Auto-authenticate if no API key
        lastPing: Date.now(),
        lastPong: Date.now(),
        requestCount: 0,
        connectTime: Date.now(),
        ipAddress,
        userAgent
      };

      this.connections.set(connectionId, connection);

      this.logger.info('WebSocket client connected', {
        connectionId,
        ipAddress,
        userAgent,
        totalConnections: this.connections.size
      });

      // Check API key in connection if required
      if (this.config.apiKey) {
        const url = new URL(request.url!, `ws://localhost:${this.config.port}`);
        const apiKey = url.searchParams.get('api_key');

        if (!apiKey || apiKey !== this.config.apiKey) {
          this.logger.warn('WebSocket authentication failed', { connectionId, ipAddress });
          socket.close(1008, 'Authentication required');
          this.connections.delete(connectionId);
          return;
        }

        connection.authenticated = true;
        this.logger.debug('WebSocket client authenticated', { connectionId });
      }

      // Setup socket event handlers
      this.setupSocketHandlers(connection);

      // Send welcome message
      this.sendToClient(connection, {
        type: 'connected',
        data: {
          connectionId,
          serverInfo: {
            name: 'mcp-news-v3',
            version: '3.0.0',
            protocol: 'websocket-mcp'
          }
        }
      });

      this.emit('client_connected', { connectionId, connection });
    });

    this.wss.on('error', (error) => {
      this.logger.error('WebSocket server error', error);
    });
  }

  /**
   * Setup individual socket event handlers
   */
  private setupSocketHandlers(connection: ClientConnection): void {
    const { socket, id: connectionId } = connection;

    socket.on('message', async (data: Buffer) => {
      try {
        const message = data.toString();
        await this.handleClientMessage(connection, message);
      } catch (error) {
        this.logger.error('Error handling WebSocket message', {
          connectionId,
          error: error instanceof Error ? error.message : String(error)
        });

        this.sendError(connection, null, ErrorCodes.INTERNAL_ERROR, 'Message processing failed');
      }
    });

    socket.on('pong', () => {
      connection.lastPong = Date.now();
      this.logger.trace('Received pong from client', { connectionId });
    });

    socket.on('close', (code: number, reason: Buffer) => {
      this.logger.info('WebSocket client disconnected', {
        connectionId,
        code,
        reason: reason.toString(),
        connectionDuration: Date.now() - connection.connectTime,
        requestCount: connection.requestCount
      });

      this.connections.delete(connectionId);
      this.emit('client_disconnected', { connectionId, code, reason: reason.toString() });
    });

    socket.on('error', (error) => {
      this.logger.error('WebSocket client error', {
        connectionId,
        error: error.message
      });
    });
  }

  /**
   * Handle client message
   */
  private async handleClientMessage(connection: ClientConnection, message: string): Promise<void> {
    const { id: connectionId } = connection;

    try {
      // Parse and validate message
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch (_parseError) {
        this.sendError(connection, null, ErrorCodes.PARSE_ERROR, 'Invalid JSON');
        return;
      }

      // Validate WebSocket message format
      const validationResult = WebSocketMessageSchema.safeParse(parsed);
      if (!validationResult.success) {
        this.sendError(connection, null, ErrorCodes.INVALID_REQUEST, 'Invalid message format');
        return;
      }

      const wsMessage = validationResult.data;

      // Handle different message types
      if ('type' in wsMessage) {
        await this.handleSpecialMessage(connection, wsMessage);
      } else {
        // Handle MCP request
        await this.handleMcpMessage(connection, wsMessage as MCPRequest);
      }

      connection.requestCount++;

    } catch (error) {
      this.logger.error('Client message handling failed', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
        messagePreview: message.slice(0, 200)
      });

      this.sendError(connection, null, ErrorCodes.INTERNAL_ERROR, 'Message processing failed');
    }
  }

  /**
   * Handle special WebSocket messages (ping, etc.)
   */
  private async handleSpecialMessage(
    connection: ClientConnection,
    message: { type: string; timestamp?: number }
  ): Promise<void> {
    switch (message.type) {
      case 'ping':
        this.sendToClient(connection, {
          type: 'pong',
          timestamp: Date.now()
        });
        break;

      default:
        this.logger.debug('Unknown special message type', {
          connectionId: connection.id,
          type: message.type
        });
    }
  }

  /**
   * Handle MCP request message
   */
  private async handleMcpMessage(connection: ClientConnection, request: MCPRequest): Promise<void> {
    const { id: connectionId } = connection;

    // Check authentication for non-public methods
    if (!connection.authenticated) {
      this.sendError(connection, request.id, ErrorCodes.AUTHENTICATION_ERROR, 'Authentication required');
      return;
    }

    // Check rate limiting
    if (this.config.rateLimiter) {
      try {
        const rateLimitInfo = await this.config.rateLimiter.checkLimit(connectionId);
        if (rateLimitInfo.isBlocked) {
          this.sendError(
            connection,
            request.id,
            ErrorCodes.RATE_LIMIT_EXCEEDED,
            'Rate limit exceeded',
            { resetTime: new Date(rateLimitInfo.resetTimeMs).toISOString() }
          );
          return;
        }
      } catch (error) {
        this.logger.error('Rate limit check failed', { connectionId, error });
      }
    }

    try {
      this.logger.debug('Processing WebSocket MCP request', {
        connectionId,
        method: request.method,
        id: request.id
      });

      const response = await this.processMcpRequest(request, connection);
      this.sendToClient(connection, response);

    } catch (error) {
      this.logger.error('MCP request processing failed', {
        connectionId,
        method: request.method,
        id: request.id,
        error: error instanceof Error ? error.message : String(error)
      });

      if (error instanceof MCPErrorException) {
        this.sendError(connection, request.id, error.code, error.message, error.details);
      } else {
        this.sendError(connection, request.id, ErrorCodes.INTERNAL_ERROR, 'Request processing failed');
      }
    }
  }

  /**
   * Process MCP request
   */
  private async processMcpRequest(request: MCPRequest, connection: ClientConnection): Promise<MCPResponse> {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {
                supportsProgress: true,
                supportsParallelExecution: true,
              },
              realtime: {
                supportsNotifications: true,
                supportsPushUpdates: true,
              },
            },
            serverInfo: {
              name: 'mcp-news-v3',
              version: '3.0.0',
              description: 'Universal MCP Server for cryptocurrency news sentiment analysis',
            },
          },
        };

      case 'tools/list':
        const tools = Array.from(this.tools.values()).map(handler => handler.definition);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools,
          },
        };

      case 'tools/call':
        const params = request.params as { name?: string; arguments?: unknown };
        if (!params || !params.name) {
          throw new MCPErrorException(
            ErrorCodes.INVALID_PARAMS,
            'Tool name is required',
            'INVALID_PARAMS'
          );
        }

        const result = await this.executeToolCall(params.name, params.arguments, connection);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };

      case 'ping':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            pong: true,
            timestamp: Date.now(),
          },
        };

      default:
        throw new MCPErrorException(
          ErrorCodes.METHOD_NOT_FOUND,
          `Method not found: ${request.method}`,
          'METHOD_NOT_FOUND'
        );
    }
  }

  /**
   * Execute tool call
   */
  private async executeToolCall(
    toolName: string,
    toolArguments: unknown,
    connection: ClientConnection
  ): Promise<unknown> {
    const toolHandler = this.tools.get(toolName);
    if (!toolHandler) {
      throw new MCPErrorException(
        ErrorCodes.TOOL_NOT_FOUND,
        `Tool not found: ${toolName}`,
        'TOOL_NOT_FOUND'
      );
    }

    const context: ToolExecutionContext = {
      requestId: connection.id,
      protocol: 'websocket',
      timestamp: Date.now(),
      userAgent: connection.userAgent,
      ipAddress: connection.ipAddress,
    };

    return await toolHandler.execute(toolArguments, context);
  }

  /**
   * Send message to client
   */
  private sendToClient(connection: ClientConnection, message: unknown): void {
    try {
      if (connection.socket.readyState === WebSocket.OPEN) {
        const jsonMessage = JSON.stringify(message);
        connection.socket.send(jsonMessage);

        this.logger.trace('Sent message to WebSocket client', {
          connectionId: connection.id,
          messageSize: jsonMessage.length
        });
      }
    } catch (error) {
      this.logger.error('Failed to send message to WebSocket client', {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Send error to client
   */
  private sendError(
    connection: ClientConnection,
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown
  ): void {
    const errorResponse: MCPResponse = {
      jsonrpc: '2.0',
      id: id || 0,
      error: {
        code,
        message,
        data,
      },
    };

    this.sendToClient(connection, errorResponse);
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcastToClients(message: unknown): void {
    let sentCount = 0;

    this.connections.forEach((connection) => {
      if (connection.authenticated && connection.socket.readyState === WebSocket.OPEN) {
        this.sendToClient(connection, message);
        sentCount++;
      }
    });

    this.logger.debug('Broadcasted message to WebSocket clients', {
      sentCount,
      totalConnections: this.connections.size
    });
  }

  /**
   * Start ping interval to keep connections alive
   */
  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const deadConnections: string[] = [];

      this.connections.forEach((connection, connectionId) => {
        // Check if connection is still alive
        if (now - connection.lastPong > this.config.pongTimeout! + this.config.pingInterval!) {
          deadConnections.push(connectionId);
          return;
        }

        // Send ping
        if (connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.ping();
          connection.lastPing = now;
        }
      });

      // Clean up dead connections
      deadConnections.forEach(connectionId => {
        const connection = this.connections.get(connectionId);
        if (connection) {
          this.logger.info('Removing dead WebSocket connection', { connectionId });
          connection.socket.close(1001, 'Connection timeout');
          this.connections.delete(connectionId);
        }
      });

    }, this.config.pingInterval);
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Get current server status
   */
  getStatus(): {
    isRunning: boolean;
    port: number;
    connectionCount: number;
    toolCount: number;
    uptime: number;
    hasApiKey: boolean;
  } {
    const uptime = this._isRunning ? Date.now() - this.startTime : 0;

    return {
      isRunning: this._isRunning,
      port: this.config.port,
      connectionCount: this.connections.size,
      toolCount: this.tools.size,
      uptime: Math.floor(uptime / 1000),
      hasApiKey: !!this.config.apiKey,
    };
  }

  /**
   * Get connected clients info
   */
  getConnections(): Array<{
    id: string;
    authenticated: boolean;
    connectTime: number;
    requestCount: number;
    ipAddress?: string;
    userAgent?: string;
  }> {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      authenticated: conn.authenticated,
      connectTime: conn.connectTime,
      requestCount: conn.requestCount,
      ipAddress: conn.ipAddress,
      userAgent: conn.userAgent,
    }));
  }
}

/**
 * Create and configure WebSocket protocol handler
 */
export function createWebSocketHandler(
  config: WebSocketConfig,
  logger: Logger
): WebSocketProtocolHandler {
  return new WebSocketProtocolHandler(config, logger);
}