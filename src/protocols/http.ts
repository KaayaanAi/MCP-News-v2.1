/**
 * HTTP Protocol Handler
 * Implements both REST API and HTTP MCP protocol endpoints
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer, Server } from 'http';
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
  MCPRequestSchema,
  ErrorCodes,
  MCPErrorException
} from '../types/index.js';
import { createRateLimitMiddleware } from '../services/rate_limiter.js';

interface HttpConfig {
  port: number;
  corsOrigins: string[];
  apiKey?: string;
  rateLimiter?: RateLimiter;
}

/**
 * HTTP protocol handler supporting both REST API and MCP protocol
 */
export class HttpProtocolHandler implements ProtocolHandler {
  private logger: Logger;
  private config: HttpConfig;
  private app: Application;
  private server: Server | null = null;
  private _isRunning = false;
  private tools = new Map<string, ToolHandler>();
  private startTime = 0;

  constructor(config: HttpConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ protocol: 'http' });
    this.app = express();

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new Error('HTTP protocol handler is already running');
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = createServer(this.app);

        this.server.listen(this.config.port, () => {
          this._isRunning = true;
          this.startTime = Date.now();
          this.logger.info('HTTP server started', {
            port: this.config.port,
            corsOrigins: this.config.corsOrigins,
            hasApiKey: !!this.config.apiKey
          });
          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.logger.error('HTTP server error', error);
          reject(error);
        });

      } catch (error) {
        this.logger.error('Failed to start HTTP server', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.server || !this._isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          this.logger.error('Error stopping HTTP server', error);
          reject(error);
        } else {
          this._isRunning = false;
          this.server = null;
          this.logger.info('HTTP server stopped');
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
    return 'http';
  }

  /**
   * Register a tool with the protocol handler
   */
  registerTool(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler);
    this.logger.debug('Tool registered', { toolName: name });
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
    this.logger.debug('Tool unregistered', { toolName: name });
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS
    this.app.use(cors({
      origin: this.config.corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: true,
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, _res, next) => {
      const requestId = Math.random().toString(36).substring(7);
      req.requestId = requestId;

      this.logger.debug('HTTP request received', {
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
            this.logger.warn('Rate limit exceeded', {
              ip: req.ip,
              path: req.path,
              limit: rateLimitInfo.totalRequests,
            });
          },
        }
      );

      this.app.use(rateLimitMiddleware);
    }

    // API key authentication middleware (for protected endpoints)
    this.app.use('/api', this.authenticateApiKey.bind(this));
    this.app.use('/mcp', this.authenticateApiKey.bind(this));
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    // Health check endpoint (public)
    this.app.get('/health', this.handleHealthCheck.bind(this));

    // MCP protocol endpoints
    this.app.post('/mcp', this.handleMcpRequest.bind(this));
    this.app.get('/mcp/tools', this.handleMcpToolsList.bind(this));
    this.app.post('/mcp/tools/call', this.handleMcpToolCall.bind(this));

    // REST API endpoints
    this.app.get('/api/tools', this.handleRestToolsList.bind(this));
    this.app.post('/api/tools/:toolName', this.handleRestToolCall.bind(this));

    // Server info endpoint
    this.app.get('/api/info', this.handleServerInfo.bind(this));

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

    // Error handling middleware (must be registered AFTER all routes)
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
      this.logger.warn('Authentication failed', {
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
    this.logger.error('HTTP request error', {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });

    if (err instanceof MCPErrorException) {
      res.status(400).json({
        error: {
          code: err.code,
          message: err.message,
          type: err.type,
          details: err.details,
        },
      });
      return;
    }

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
    const memoryUsage = process.memoryUsage();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime / 1000),
      version: '3.0.0',
      protocols: {
        http: true,
      },
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      },
      tools: {
        registered: this.tools.size,
        names: Array.from(this.tools.keys()),
      },
    });
  }

  /**
   * Handle MCP protocol requests
   */
  private async handleMcpRequest(req: Request, res: Response): Promise<void> {
    try {
      // Validate MCP request format
      const validationResult = MCPRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json(this.createMcpError(
          null,
          ErrorCodes.INVALID_REQUEST,
          'Invalid MCP request format'
        ));
        return;
      }

      const mcpRequest = validationResult.data;
      const response = await this.processMcpRequest(mcpRequest, req);

      res.json(response);

    } catch (error) {
      this.logger.error('MCP request processing failed', {
        requestId: req.requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json(this.createMcpError(
        null,
        ErrorCodes.INTERNAL_ERROR,
        'Request processing failed'
      ));
    }
  }

  /**
   * Handle MCP tools list requests
   */
  private handleMcpToolsList(_req: Request, res: Response): void {
    const tools = Array.from(this.tools.values()).map(handler => handler.definition);

    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools,
      },
    };

    res.json(response);
  }

  /**
   * Handle MCP tool call requests
   */
  private async handleMcpToolCall(req: Request, res: Response): Promise<void> {
    try {
      const { name, arguments: toolArguments } = req.body;

      if (!name) {
        res.status(400).json(this.createMcpError(
          1,
          ErrorCodes.INVALID_PARAMS,
          'Tool name is required'
        ));
        return;
      }

      const result = await this.executeToolCall(name, toolArguments, req);

      const response: MCPResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };

      res.json(response);

    } catch (error) {
      this.logger.error('MCP tool call failed', {
        requestId: req.requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof MCPErrorException) {
        res.status(400).json(this.createMcpError(1, error.code, error.message, error.details));
      } else {
        res.status(500).json(this.createMcpError(
          1,
          ErrorCodes.TOOL_EXECUTION_ERROR,
          'Tool execution failed'
        ));
      }
    }
  }

  /**
   * Handle REST API tools list requests
   */
  private handleRestToolsList(_req: Request, res: Response): void {
    const tools = Array.from(this.tools.values()).map(handler => ({
      name: handler.definition.name,
      description: handler.definition.description,
      parameters: handler.definition.inputSchema,
    }));

    res.json({
      success: true,
      data: {
        tools,
        count: tools.length,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        protocol: 'http-rest',
      },
    });
  }

  /**
   * Handle REST API tool call requests
   */
  private async handleRestToolCall(req: Request, res: Response): Promise<void> {
    try {
      const toolName = req.params.toolName;
      if (!toolName) {
        res.status(400).json({
          success: false,
          error: 'Tool name is required',
        });
        return;
      }
      const toolArguments = req.body;

      const result = await this.executeToolCall(toolName, toolArguments, req);

      res.json({
        success: true,
        data: result,
        metadata: {
          timestamp: new Date().toISOString(),
          toolName,
          protocol: 'http-rest',
        },
      });

    } catch (error) {
      this.logger.error('REST tool call failed', {
        requestId: req.requestId,
        toolName: req.params.toolName,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof MCPErrorException) {
        res.status(400).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            type: error.type,
            details: error.details,
          },
          metadata: {
            timestamp: new Date().toISOString(),
            protocol: 'http-rest',
          },
        });
      } else {
        res.status(500).json({
          success: false,
          error: {
            code: ErrorCodes.TOOL_EXECUTION_ERROR,
            message: 'Tool execution failed',
            type: 'TOOL_EXECUTION_ERROR',
          },
          metadata: {
            timestamp: new Date().toISOString(),
            protocol: 'http-rest',
          },
        });
      }
    }
  }

  /**
   * Handle server info requests
   */
  private handleServerInfo(_req: Request, res: Response): void {
    const uptime = Date.now() - this.startTime;

    res.json({
      name: 'mcp-news-v3',
      version: '3.0.0',
      description: 'Universal MCP Server for cryptocurrency news sentiment analysis',
      protocols: ['http-rest', 'http-mcp'],
      uptime: Math.floor(uptime / 1000),
      tools: {
        count: this.tools.size,
        names: Array.from(this.tools.keys()),
      },
      features: {
        rateLimiting: !!this.config.rateLimiter,
        authentication: !!this.config.apiKey,
        cors: this.config.corsOrigins.length > 0,
      },
    });
  }

  /**
   * Process MCP request
   */
  private async processMcpRequest(request: MCPRequest, httpReq: Request): Promise<MCPResponse> {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {
                supportsProgress: false,
                supportsParallelExecution: true,
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

        const result = await this.executeToolCall(params.name, params.arguments, httpReq);
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
    httpReq: Request
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
      requestId: httpReq.requestId || 'unknown',
      protocol: 'http',
      timestamp: Date.now(),
      userAgent: httpReq.get('User-Agent'),
      ipAddress: httpReq.ip,
    };

    return await toolHandler.execute(toolArguments, context);
  }

  /**
   * Create MCP error response
   */
  private createMcpError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown
  ): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: id || 0,
      error: {
        code,
        message,
        data,
      },
    };
  }

  /**
   * Get current server status
   */
  getStatus(): {
    isRunning: boolean;
    port: number;
    toolCount: number;
    uptime: number;
    hasApiKey: boolean;
    corsOrigins: string[];
  } {
    const uptime = this._isRunning ? Date.now() - this.startTime : 0;

    return {
      isRunning: this._isRunning,
      port: this.config.port,
      toolCount: this.tools.size,
      uptime: Math.floor(uptime / 1000),
      hasApiKey: !!this.config.apiKey,
      corsOrigins: this.config.corsOrigins,
    };
  }
}

/**
 * Extend Express Request interface
 */
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Create and configure HTTP protocol handler
 */
export function createHttpHandler(
  config: HttpConfig,
  logger: Logger
): HttpProtocolHandler {
  return new HttpProtocolHandler(config, logger);
}