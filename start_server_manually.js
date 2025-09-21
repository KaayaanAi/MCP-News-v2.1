#!/usr/bin/env node

// Manual server startup for testing
import { MCPNewsServer } from './dist/server.js';
import process from 'process';

console.log('Starting MCP server manually...');

let server;
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('Force shutdown...');
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, stopping server gracefully...`);

  try {
    if (server && typeof server.stop === 'function') {
      await Promise.race([
        server.stop(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout')), 10000)
        )
      ]);
      console.log('Server stopped successfully');
    }
  } catch (error) {
    console.error('Error during shutdown:', error.message);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

try {
  server = new MCPNewsServer();

  server.start().then(() => {
    console.log('✅ Server started successfully');
    console.log('Press Ctrl+C to stop the server');
  }).catch((error) => {
    console.error('❌ Fatal error starting server:', error);
    process.exit(1);
  });
} catch (error) {
  console.error('❌ Error creating server instance:', error);
  process.exit(1);
}