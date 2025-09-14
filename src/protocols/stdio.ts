/**
 * STDIO MCP Protocol Handler
 * Implements MCP protocol over stdin/stdout for native desktop integration
 */

import { EventEmitter } from 'events';
import type {
  ProtocolHandler,
  ProtocolType,
  MCPRequest,
  MCPResponse,
  ToolHandler,
  ToolExecutionContext,
  Logger
} from '../types/index.js';
import {
  MCPRequestSchema,
  ErrorCodes,
  MCPErrorException
} from '../types/index.js';

/**
 * STDIO MCP protocol handler
 */
export class StdioProtocolHandler extends EventEmitter implements ProtocolHandler {
  private logger: Logger;
  private _isRunning = false;
  private tools = new Map<string, ToolHandler>();
  private inputBuffer = '';

  constructor(logger: Logger) {
    super();
    this.logger = logger.child({ protocol: 'stdio' });
  }

  /**
   * Start the STDIO protocol handler
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new Error('STDIO protocol handler is already running');
    }

    try {
      this.logger.info('Starting STDIO MCP protocol handler');

      // Set up stdin/stdout handling
      this.setupStdioHandlers();

      this._isRunning = true;
      this.logger.info('STDIO MCP protocol handler started successfully');

    } catch (error) {
      this.logger.error('Failed to start STDIO protocol handler', error);
      throw error;
    }
  }

  /**
   * Stop the STDIO protocol handler
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    try {
      this.logger.info('Stopping STDIO MCP protocol handler');

      // Remove stdin listeners
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');

      this._isRunning = false;
      this.logger.info('STDIO MCP protocol handler stopped');

    } catch (error) {
      this.logger.error('Error stopping STDIO protocol handler', error);
    }
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
    return 'stdio';
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
   * Setup stdin/stdout handlers for MCP communication
   */
  private setupStdioHandlers(): void {
    // Configure stdin for non-TTY mode
    if (process.stdin.isTTY) {
      this.logger.warn('STDIO handler running in TTY mode - this may not work correctly');
    }

    process.stdin.setEncoding('utf8');

    // Handle incoming data
    process.stdin.on('data', (chunk: string) => {
      this.inputBuffer += chunk;
      this.processInputBuffer();
    });

    // Handle stdin end
    process.stdin.on('end', () => {
      this.logger.debug('STDIN ended');
      this.stop();
    });

    // Handle stdin errors
    process.stdin.on('error', (error) => {
      this.logger.error('STDIN error', error);
    });

    // Handle process signals for graceful shutdown
    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT, shutting down gracefully');
      this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM, shutting down gracefully');
      this.stop();
      process.exit(0);
    });
  }

  /**
   * Process the input buffer for complete JSON messages
   */
  private processInputBuffer(): void {
    const lines = this.inputBuffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.inputBuffer = lines.pop() || '';

    // Process complete lines
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        this.processMessage(trimmedLine);
      }
    }
  }

  /**
   * Process a single MCP message
   */
  private async processMessage(message: string): Promise<void> {
    try {
      this.logger.trace('Processing STDIO message', { message: message.slice(0, 200) });

      // Parse JSON message
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch (_parseError) {
        this.sendError(null, ErrorCodes.PARSE_ERROR, 'Invalid JSON');
        return;
      }

      // Validate MCP request format
      const validationResult = MCPRequestSchema.safeParse(parsed);
      if (!validationResult.success) {
        this.sendError(null, ErrorCodes.INVALID_REQUEST, 'Invalid MCP request format');
        return;
      }

      const request = validationResult.data;
      this.logger.debug('Received MCP request', {
        method: request.method,
        id: request.id,
        hasParams: !!request.params
      });

      // Route the request
      await this.routeRequest(request);

    } catch (error) {
      this.logger.error('Error processing STDIO message', {
        message: message.slice(0, 200),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Route MCP request to appropriate handler
   */
  private async routeRequest(request: MCPRequest): Promise<void> {
    try {
      switch (request.method) {
        case 'initialize':
          await this.handleInitialize(request);
          break;

        case 'tools/list':
          await this.handleToolsList(request);
          break;

        case 'tools/call':
          await this.handleToolCall(request);
          break;

        case 'ping':
          await this.handlePing(request);
          break;

        default:
          this.sendError(
            request.id,
            ErrorCodes.METHOD_NOT_FOUND,
            `Method not found: ${request.method}`
          );
      }

    } catch (error) {
      this.logger.error('Error routing MCP request', {
        method: request.method,
        id: request.id,
        error: error instanceof Error ? error.message : String(error)
      });

      if (error instanceof MCPErrorException) {
        this.sendError(request.id, error.code, error.message, error.details);
      } else {
        this.sendError(
          request.id,
          ErrorCodes.INTERNAL_ERROR,
          'Internal server error'
        );
      }
    }
  }

  /**
   * Handle MCP initialize request
   */
  private async handleInitialize(request: MCPRequest): Promise<void> {
    this.logger.info('Handling initialize request', { id: request.id });

    const response: MCPResponse = {
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

    this.sendResponse(response);
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(request: MCPRequest): Promise<void> {
    this.logger.debug('Handling tools/list request', { id: request.id });

    const tools = Array.from(this.tools.values()).map(handler => handler.definition);

    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools,
      },
    };

    this.sendResponse(response);
  }

  /**
   * Handle tools/call request
   */
  private async handleToolCall(request: MCPRequest): Promise<void> {
    const params = request.params as { name?: string; arguments?: unknown };

    if (!params || !params.name) {
      this.sendError(request.id, ErrorCodes.INVALID_PARAMS, 'Tool name is required');
      return;
    }

    const toolName = params.name;
    const toolArguments = params.arguments;

    this.logger.debug('Handling tool call', {
      id: request.id,
      toolName,
      hasArguments: !!toolArguments
    });

    const toolHandler = this.tools.get(toolName);
    if (!toolHandler) {
      this.sendError(
        request.id,
        ErrorCodes.TOOL_NOT_FOUND,
        `Tool not found: ${toolName}`
      );
      return;
    }

    try {
      const context: ToolExecutionContext = {
        requestId: request.id,
        protocol: 'stdio',
        timestamp: Date.now(),
      };

      const result = await toolHandler.execute(toolArguments, context);

      const response: MCPResponse = {
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

      this.sendResponse(response);

    } catch (error) {
      this.logger.error('Tool execution failed', {
        toolName,
        id: request.id,
        error: error instanceof Error ? error.message : String(error)
      });

      if (error instanceof MCPErrorException) {
        this.sendError(request.id, error.code, error.message, error.details);
      } else {
        this.sendError(
          request.id,
          ErrorCodes.TOOL_EXECUTION_ERROR,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Handle ping request
   */
  private async handlePing(request: MCPRequest): Promise<void> {
    this.logger.trace('Handling ping request', { id: request.id });

    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        pong: true,
        timestamp: Date.now(),
      },
    };

    this.sendResponse(response);
  }

  /**
   * Send MCP response
   */
  private sendResponse(response: MCPResponse): void {
    try {
      const jsonResponse = JSON.stringify(response);
      process.stdout.write(jsonResponse + '\n');

      this.logger.trace('Sent MCP response', {
        id: response.id,
        hasResult: !!response.result,
        hasError: !!response.error
      });

    } catch (error) {
      this.logger.error('Failed to send MCP response', {
        id: response.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Send MCP error response
   */
  private sendError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown
  ): void {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: id || 0,
      error: {
        code,
        message,
        data,
      },
    };

    this.sendResponse(response);
  }

  /**
   * Get current connection status
   */
  getStatus(): {
    isRunning: boolean;
    toolCount: number;
    uptime: number;
  } {
    return {
      isRunning: this._isRunning,
      toolCount: this.tools.size,
      uptime: this._isRunning ? Date.now() : 0,
    };
  }
}

/**
 * Create and configure STDIO protocol handler
 */
export function createStdioHandler(logger: Logger): StdioProtocolHandler {
  return new StdioProtocolHandler(logger);
}