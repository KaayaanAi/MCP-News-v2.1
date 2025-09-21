#!/usr/bin/env node

/**
 * MCP Server Validation Script
 * Tests all required functionality for MCP compliance and n8n compatibility
 */

import http from 'http';
import process from 'process';

const PORT = process.env.HTTP_PORT || 4009;
const TIMEOUT = 5000;

console.log('🔬 MCP Server Validation Starting...\n');

class MCPValidator {
  constructor() {
    this.passed = 0;
    this.failed = 0;
  }

  async makeRequest(method, params = undefined) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        jsonrpc: '2.0',
        method,
        ...(params && { params }),
        id: Date.now(),
      });

      const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: TIMEOUT,
      };

      const req = http.request(options, (res) => {
        let data = '';
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (!data.trim()) {
              reject(new Error('Empty response from server'));
              return;
            }
            const response = JSON.parse(data);
            resolve({ statusCode: res.statusCode, response });
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}...`));
          }
        });

        res.on('error', (error) => {
          reject(new Error(`Response error: ${error.message}`));
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request error: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${TIMEOUT}ms`));
      });

      req.write(postData);
      req.end();
    });
  }

  async makeHealthRequest() {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: PORT,
        path: '/health',
        method: 'GET',
        timeout: TIMEOUT,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            resolve({ statusCode: res.statusCode, response });
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  test(name, assertion) {
    try {
      if (assertion) {
        console.log(`✅ ${name}`);
        this.passed++;
      } else {
        console.log(`❌ ${name}`);
        this.failed++;
      }
    } catch (error) {
      console.log(`❌ ${name} - Error: ${error.message}`);
      this.failed++;
    }
  }

  async runValidation() {
    console.log('1️⃣ Health Check Validation');
    try {
      const { statusCode, response } = await this.makeHealthRequest();
      this.test('Health endpoint responds with 200', statusCode === 200);
      this.test('Health response has status field', response.status === 'healthy');
      this.test('Health response has timestamp', !!response.timestamp);
      this.test('Health response has version', !!response.version);
      this.test('Health response has tools info', !!response.tools);
    } catch (error) {
      console.log(`❌ Health check failed: ${error.message}`);
      this.failed += 5;
    }

    console.log('\n2️⃣ MCP Protocol Validation');

    // Test initialize
    try {
      const { statusCode, response } = await this.makeRequest('initialize');
      this.test('Initialize responds with 200', statusCode === 200);
      this.test('Initialize response has jsonrpc field', response.jsonrpc === '2.0');
      this.test('Initialize response has result field', !!response.result);
      this.test('Initialize has protocolVersion', response.result?.protocolVersion === '2024-11-05');
      this.test('Initialize has capabilities', !!response.result?.capabilities);
      this.test('Initialize has serverInfo', !!response.result?.serverInfo);
      this.test('Server name is correct', response.result?.serverInfo?.name === 'mcp-news-server');
    } catch (error) {
      console.log(`❌ Initialize failed: ${error.message}`);
      this.failed += 7;
    }

    // Test tools/list
    try {
      const { statusCode, response } = await this.makeRequest('tools/list');
      this.test('Tools/list responds with 200', statusCode === 200);
      this.test('Tools/list response has jsonrpc field', response.jsonrpc === '2.0');
      this.test('Tools/list response has result field', !!response.result);
      this.test('Tools/list has tools array', Array.isArray(response.result?.tools));
      this.test('Tools array has 3 tools', response.result?.tools?.length === 3);

      const toolNames = response.result?.tools?.map(t => t.name) || [];
      this.test('Has analyze_crypto_sentiment tool', toolNames.includes('analyze_crypto_sentiment'));
      this.test('Has get_market_news tool', toolNames.includes('get_market_news'));
      this.test('Has validate_news_source tool', toolNames.includes('validate_news_source'));

      // Check tool schemas
      const sentimentTool = response.result?.tools?.find(t => t.name === 'analyze_crypto_sentiment');
      this.test('Sentiment tool has description', !!sentimentTool?.description);
      this.test('Sentiment tool has inputSchema', !!sentimentTool?.inputSchema);
      this.test('Sentiment tool schema has properties', !!sentimentTool?.inputSchema?.properties);
      this.test('Sentiment tool has content property', !!sentimentTool?.inputSchema?.properties?.content);
    } catch (error) {
      console.log(`❌ Tools/list failed: ${error.message}`);
      this.failed += 11;
    }

    // Test tools/call with valid params
    try {
      const { statusCode, response } = await this.makeRequest('tools/call', {
        name: 'analyze_crypto_sentiment',
        arguments: {
          content: 'Bitcoin is showing strong bullish momentum today with significant buying pressure.'
        }
      });
      this.test('Tools/call responds with 200', statusCode === 200);
      this.test('Tools/call response has jsonrpc field', response.jsonrpc === '2.0');
      this.test('Tools/call response has result field', !!response.result);
      this.test('Tools/call result has content array', Array.isArray(response.result?.content));
      this.test('Content has text type', response.result?.content?.[0]?.type === 'text');
    } catch (error) {
      console.log(`❌ Tools/call failed: ${error.message}`);
      this.failed += 5;
    }

    // Test invalid method
    try {
      const { statusCode, response } = await this.makeRequest('invalid/method');
      this.test('Invalid method returns 400', statusCode === 400);
      this.test('Invalid method has error', !!response.error);
      this.test('Invalid method error code is -32601', response.error?.code === -32601);
    } catch (error) {
      console.log(`❌ Invalid method test failed: ${error.message}`);
      this.failed += 3;
    }

    console.log('\n3️⃣ JSON-RPC 2.0 Compliance');

    // Test invalid JSON-RPC format
    try {
      const postData = JSON.stringify({ method: 'test', id: 1 }); // Missing jsonrpc field

      const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const { statusCode, response } = await new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, response: JSON.parse(data) });
            } catch (error) {
              reject(error);
            }
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      this.test('Invalid JSON-RPC format returns 400', statusCode === 400);
      this.test('Invalid format has error field', !!response.error);
      this.test('Invalid format error code is -32600', response.error?.code === -32600);
    } catch (error) {
      console.log(`❌ JSON-RPC validation failed: ${error.message}`);
      this.failed += 3;
    }

    console.log('\n📊 Validation Results:');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Success Rate: ${Math.round((this.passed / (this.passed + this.failed)) * 100)}%`);

    if (this.failed === 0) {
      console.log('\n🎉 All tests passed! MCP server is fully compliant.');
      return 0;
    } else {
      console.log('\n⚠️  Some tests failed. Please review the implementation.');
      return 1;
    }
  }
}

// Run validation
const validator = new MCPValidator();
validator.runValidation()
  .then(code => process.exit(code))
  .catch(error => {
    console.error('❌ Validation script failed:', error.message);
    process.exit(1);
  });