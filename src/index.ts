#!/usr/bin/env node

/**
 * MCP-NEWS-V2.1 - Official MCP Server Implementation
 * Main entry point supporting both STDIO (MCP standard) and HTTP (n8n compatible)
 */

import { config } from 'dotenv';
import process from 'process';
import { z } from 'zod';
import { getLogger } from './utils/logger.js';
import { MCPNewsServer } from './mcp-server.js';
import { HttpMCPServer } from './http-server.js';
import type { Logger } from './types/index.js';

// Environment configuration schema
const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SERVER_MODE: z.enum(['stdio', 'http', 'both']).default('both'),
  HTTP_PORT: z.coerce.number().default(4009),
  API_KEY: z.string().optional(),
  PRETTY_LOGS: z.coerce.boolean().default(true),
});

/**
 * Universal MCP Server Manager
 * Manages both STDIO and HTTP MCP servers based on configuration
 */
class UniversalMCPServer {
  private logger: Logger;
  private config: z.infer<typeof EnvSchema>;
  private mcpServer: MCPNewsServer | null = null;
  private httpServer: HttpMCPServer | null = null;
  private isRunning = false;

  constructor() {
    // Load environment configuration
    config();
    this.config = EnvSchema.parse(process.env);

    // Initialize logger
    this.logger = getLogger({
      level: this.config.LOG_LEVEL,
      pretty: this.config.PRETTY_LOGS,
      service: 'mcp-news-universal'
    });

    this.logger.info('Universal MCP Server Manager initializing', {
      nodeEnv: this.config.NODE_ENV,
      serverMode: this.config.SERVER_MODE,
      httpPort: this.config.HTTP_PORT,
    });
  }

  /**
   * Start the server based on configuration
   */
  async start(): Promise<void> {
    try {
      const promises: Promise<void>[] = [];

      // Start STDIO MCP server (for Claude Desktop and direct MCP clients)
      if (this.config.SERVER_MODE === 'stdio' || this.config.SERVER_MODE === 'both') {
        this.mcpServer = new MCPNewsServer();
        promises.push(this.mcpServer.start());
        this.logger.info('Starting STDIO MCP server');
      }

      // Start HTTP MCP server (for n8n and web clients)
      if (this.config.SERVER_MODE === 'http' || this.config.SERVER_MODE === 'both') {
        this.httpServer = new HttpMCPServer();
        promises.push(this.httpServer.start());
        this.logger.info('Starting HTTP MCP server', { port: this.config.HTTP_PORT });
      }

      // Wait for all servers to start
      await Promise.all(promises);

      this.isRunning = true;
      this.logger.info('Universal MCP Server started successfully', {
        mode: this.config.SERVER_MODE,
        pid: process.pid,
      });

      // Setup graceful shutdown
      this.setupGracefulShutdown();

    } catch (error) {
      this.logger.error('Failed to start server', error);
      await this.stop();
      process.exit(1);
    }
  }

  /**
   * Stop all servers
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Universal MCP Server');

    try {
      const stopPromises: Promise<void>[] = [];

      // Stop STDIO MCP server
      if (this.mcpServer) {
        stopPromises.push(this.mcpServer.stop());
      }

      // Stop HTTP MCP server
      if (this.httpServer) {
        stopPromises.push(this.httpServer.stop());
      }

      // Wait for all servers to stop
      await Promise.all(stopPromises);

      this.isRunning = false;
      this.logger.info('Universal MCP Server stopped successfully');

    } catch (error) {
      this.logger.error('Error during server shutdown', error);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

    signals.forEach(signal => {
      process.on(signal, async () => {
        this.logger.info(`Received ${signal}, initiating graceful shutdown`);
        await this.stop();
        process.exit(0);
      });
    });

    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception', error);
      await this.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      this.logger.error('Unhandled rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        promise: String(promise)
      });
      await this.stop();
      process.exit(1);
    });
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    const server = new UniversalMCPServer();
    await server.start();

    // Keep the process alive for STDIO mode
    if (process.stdin.readable) {
      process.stdin.resume();
    }

  } catch (error) {
    // Fatal error during server startup
    const logger = getLogger({ level: 'error', pretty: true, service: 'mcp-news-universal' });
    logger.error('Fatal error starting server', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Unhandled error in main
    const logger = getLogger({ level: 'error', pretty: true, service: 'mcp-news-universal' });
    logger.error('Unhandled error in main', error);
    process.exit(1);
  });
}

export { UniversalMCPServer, MCPNewsServer, HttpMCPServer };