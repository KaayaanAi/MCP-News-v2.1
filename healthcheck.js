#!/usr/bin/env node

/**
 * Docker Health Check Script
 * Validates that the MCP server is running and responding correctly
 */

import http from 'http';
import process from 'process';

const PORT = process.env.HTTP_PORT || 4009;
const TIMEOUT = 3000; // 3 seconds timeout

function healthCheck() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path: '/health',
      method: 'GET',
      timeout: TIMEOUT,
    }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const health = JSON.parse(data);

          if (res.statusCode === 200 && health.status === 'healthy') {
            console.log('✅ Health check passed:', health.status);
            resolve(0);
          } else {
            console.error('❌ Health check failed:', health);
            reject(1);
          }
        } catch (error) {
          console.error('❌ Health check parse error:', error.message);
          reject(1);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Health check request error:', error.message);
      reject(1);
    });

    req.on('timeout', () => {
      console.error('❌ Health check timeout');
      req.destroy();
      reject(1);
    });

    req.end();
  });
}

// Run health check
healthCheck()
  .then((code) => process.exit(code))
  .catch((code) => process.exit(code));