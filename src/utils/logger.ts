/**
 * Structured logger using Pino for high-performance logging
 * Supports both development (pretty) and production (JSON) formats
 */

import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';
import type { Logger } from '../types/index.js';

class LoggerService implements Logger {
  private pinoLogger: PinoLogger;

  constructor(options: {
    level?: string;
    pretty?: boolean;
    service?: string;
  } = {}) {
    const { level = 'info', pretty = false, service = 'mcp-news-v3' } = options;

    // Configure Pino logger
    const pinoOptions: pino.LoggerOptions = {
      level,
      base: {
        service,
        pid: process.pid,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    };

    // Use pretty printing in development
    if (pretty && process.env.NODE_ENV !== 'production') {
      this.pinoLogger = pino(pinoOptions, pino.destination({
        sync: false,
      }));
    } else {
      this.pinoLogger = pino(pinoOptions);
    }

    // Log uncaught exceptions and unhandled rejections
    this.setupGlobalErrorHandlers();
  }

  trace(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      this.pinoLogger.trace({ extra: args }, message);
    } else {
      this.pinoLogger.trace(message);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      this.pinoLogger.debug({ extra: args }, message);
    } else {
      this.pinoLogger.debug(message);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      this.pinoLogger.info({ extra: args }, message);
    } else {
      this.pinoLogger.info(message);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      this.pinoLogger.warn({ extra: args }, message);
    } else {
      this.pinoLogger.warn(message);
    }
  }

  error(message: string | Error, ...args: unknown[]): void {
    if (message instanceof Error) {
      this.pinoLogger.error({
        error: {
          name: message.name,
          message: message.message,
          stack: message.stack,
        },
        extra: args.length > 0 ? args : undefined
      }, message.message);
    } else {
      if (args.length > 0) {
        this.pinoLogger.error({ extra: args }, message);
      } else {
        this.pinoLogger.error(message);
      }
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    const childPino = this.pinoLogger.child(bindings);
    return new ChildLogger(childPino);
  }

  /**
   * Log protocol-specific events
   */
  logProtocol(protocol: string, event: string, data?: Record<string, unknown>): void {
    this.info(`[${protocol.toUpperCase()}] ${event}`, data);
  }

  /**
   * Log tool execution events
   */
  logTool(toolName: string, event: string, data?: Record<string, unknown>): void {
    this.info(`[TOOL:${toolName}] ${event}`, data);
  }

  /**
   * Log performance metrics
   */
  logPerformance(operation: string, durationMs: number, metadata?: Record<string, unknown>): void {
    this.info(`[PERF] ${operation} completed`, {
      durationMs,
      ...metadata,
    });
  }

  /**
   * Log security events
   */
  logSecurity(event: string, details: Record<string, unknown>): void {
    this.warn(`[SECURITY] ${event}`, details);
  }

  private setupGlobalErrorHandlers(): void {
    process.on('uncaughtException', (error) => {
      this.error('Uncaught Exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.error('Unhandled Rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        promise: String(promise),
      });
    });

    process.on('SIGTERM', () => {
      this.info('SIGTERM received, shutting down gracefully');
    });

    process.on('SIGINT', () => {
      this.info('SIGINT received, shutting down gracefully');
    });
  }
}

/**
 * Child logger wrapper for Pino child loggers
 */
class ChildLogger implements Logger {
  constructor(private pinoLogger: PinoLogger) {}

  trace(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      this.pinoLogger.trace({ extra: args }, message);
    } else {
      this.pinoLogger.trace(message);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      this.pinoLogger.debug({ extra: args }, message);
    } else {
      this.pinoLogger.debug(message);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      this.pinoLogger.info({ extra: args }, message);
    } else {
      this.pinoLogger.info(message);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (args.length > 0) {
      this.pinoLogger.warn({ extra: args }, message);
    } else {
      this.pinoLogger.warn(message);
    }
  }

  error(message: string | Error, ...args: unknown[]): void {
    if (message instanceof Error) {
      this.pinoLogger.error({
        error: {
          name: message.name,
          message: message.message,
          stack: message.stack,
        },
        extra: args.length > 0 ? args : undefined
      }, message.message);
    } else {
      if (args.length > 0) {
        this.pinoLogger.error({ extra: args }, message);
      } else {
        this.pinoLogger.error(message);
      }
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ChildLogger(this.pinoLogger.child(bindings));
  }
}

// Singleton logger instance
let loggerInstance: LoggerService | null = null;

/**
 * Get or create the global logger instance
 */
export function getLogger(options?: {
  level?: string;
  pretty?: boolean;
  service?: string;
}): Logger {
  if (!loggerInstance) {
    loggerInstance = new LoggerService(options);
  }
  return loggerInstance;
}

/**
 * Create a new logger instance (useful for testing)
 */
export function createLogger(options?: {
  level?: string;
  pretty?: boolean;
  service?: string;
}): Logger {
  return new LoggerService(options);
}

export { LoggerService };