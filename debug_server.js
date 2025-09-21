#!/usr/bin/env node

console.log('🔍 Starting MCP Server Debug...');

try {
  console.log('Step 1: Checking Node.js version...');
  console.log('Node.js version:', process.version);

  console.log('Step 2: Testing basic imports...');
  const { createServer } = await import('http');
  console.log('✅ HTTP module imported successfully');

  const express = await import('express');
  console.log('✅ Express imported successfully');

  console.log('Step 3: Testing dotenv...');
  const { config } = await import('dotenv');
  config();
  console.log('✅ Dotenv loaded successfully');

  console.log('Step 4: Testing compiled server import...');
  const serverModule = await import('./dist/server.js');
  console.log('✅ Server module imported successfully');
  console.log('Server exports:', Object.keys(serverModule));

  console.log('Step 5: Testing server instantiation...');
  const { MCPNewsServer } = serverModule;
  const server = new MCPNewsServer();
  console.log('✅ Server instance created successfully');

  console.log('Step 6: Starting server...');
  await server.start();
  console.log('✅ Server started successfully!');

  console.log('Step 7: Testing health endpoint...');
  setTimeout(async () => {
    try {
      const { default: http } = await import('http');
      const req = http.request({
        hostname: 'localhost',
        port: 4009,
        path: '/health',
        method: 'GET',
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            console.log('✅ Health check response:', response);
            process.exit(0);
          } catch (parseError) {
            console.error('❌ Health check response parse error:', parseError.message);
            console.error('Raw response:', data);
            process.exit(1);
          }
        });
      });
      req.on('error', (error) => {
        console.error('❌ Health check failed:', error.message);
        process.exit(1);
      });
      req.on('timeout', () => {
        console.error('❌ Health check timeout');
        req.destroy();
        process.exit(1);
      });
      req.end();
    } catch (error) {
      console.error('❌ Health check error:', error.message);
      process.exit(1);
    }
  }, 2000);

} catch (error) {
  console.error('❌ Debug failed at step:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}