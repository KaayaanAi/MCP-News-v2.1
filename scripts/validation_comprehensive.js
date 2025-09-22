#!/usr/bin/env node

/**
 * COMPREHENSIVE MCP Server Validation
 * Tests ALL requirements for MCP protocol compliance and n8n integration
 */

import http from 'http';
import process from 'process';

const PORT = process.env.HTTP_PORT || 4009;
const TIMEOUT = 10000;

console.log('🔬 COMPREHENSIVE MCP-News-v2.1 VALIDATION');
console.log('============================================\n');

class ComprehensiveMCPValidator {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.results = [];
  }

  async makeRequest(method, params = undefined, expectError = false) {
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
            resolve({ statusCode: res.statusCode, response, headers: res.headers });
          } catch (error) {
            reject(new Error(`Invalid JSON response (${data.length} chars): ${data.substring(0, 200)}${data.length > 200 ? '...' : ''}`));
          }
        });

        res.on('error', (error) => {
          reject(new Error(`Response stream error: ${error.message}`));
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${TIMEOUT}ms`));
      });

      // Handle write errors
      try {
        req.write(postData);
        req.end();
      } catch (error) {
        reject(new Error(`Failed to send request: ${error.message}`));
      }
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
            resolve({ statusCode: res.statusCode, response, headers: res.headers });
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

  test(name, assertion, details = null) {
    try {
      if (assertion) {
        console.log(`✅ ${name}`);
        this.passed++;
        this.results.push({ name, status: 'PASS', details });
      } else {
        console.log(`❌ ${name}`);
        if (details) console.log(`   Details: ${details}`);
        this.failed++;
        this.results.push({ name, status: 'FAIL', details });
      }
    } catch (error) {
      console.log(`❌ ${name} - Error: ${error.message}`);
      this.failed++;
      this.results.push({ name, status: 'ERROR', details: error.message });
    }
  }

  async runComprehensiveValidation() {
    console.log('🏥 1. HEALTH & BASIC CONNECTIVITY');
    console.log('----------------------------------');
    try {
      const { statusCode, response, headers } = await this.makeHealthRequest();
      this.test('Health endpoint responds with 200', statusCode === 200);
      this.test('Health response has status field', response.status === 'healthy');
      this.test('Health response has timestamp', !!response.timestamp);
      this.test('Health response has version 2.1.0', response.version === '2.1.0');
      this.test('Health response has tools info', !!response.tools);
      this.test('Health endpoint has proper content-type', headers['content-type']?.includes('application/json'));
    } catch (error) {
      console.log(`❌ Health check failed: ${error.message}`);
      this.failed += 6;
    }

    console.log('\n🎯 2. MCP PROTOCOL COMPLIANCE');
    console.log('-----------------------------');

    // Test 2.1: Initialize method
    try {
      const { statusCode, response } = await this.makeRequest('initialize');
      this.test('Initialize responds with 200', statusCode === 200);
      this.test('Initialize has JSON-RPC 2.0 field', response.jsonrpc === '2.0');
      this.test('Initialize has result field', !!response.result);
      this.test('ProtocolVersion is 2024-11-05', response.result?.protocolVersion === '2024-11-05');
      this.test('Initialize has capabilities object', !!response.result?.capabilities);
      this.test('Capabilities has tools property', response.result?.capabilities.hasOwnProperty('tools'));
      this.test('Capabilities has resources property', response.result?.capabilities.hasOwnProperty('resources'));
      this.test('Capabilities has prompts property', response.result?.capabilities.hasOwnProperty('prompts'));
      this.test('Capabilities has logging property', response.result?.capabilities.hasOwnProperty('logging'));
      this.test('ServerInfo name is mcp-news-server', response.result?.serverInfo?.name === 'mcp-news-server');
      this.test('ServerInfo has version 2.1.0', response.result?.serverInfo?.version === '2.1.0');
    } catch (error) {
      console.log(`❌ Initialize failed: ${error.message}`);
      this.failed += 11;
    }

    // Test 2.2: Tools/list method
    try {
      const { statusCode, response } = await this.makeRequest('tools/list');
      this.test('Tools/list responds with 200', statusCode === 200);
      this.test('Tools/list has JSON-RPC 2.0 field', response.jsonrpc === '2.0');
      this.test('Tools/list has result field', !!response.result);
      this.test('Tools/list result has tools array', Array.isArray(response.result?.tools));
      this.test('Tools array has exactly 3 tools', response.result?.tools?.length === 3);

      const tools = response.result?.tools || [];
      const toolNames = tools.map(t => t.name);
      this.test('Has analyze_crypto_sentiment tool', toolNames.includes('analyze_crypto_sentiment'));
      this.test('Has get_market_news tool', toolNames.includes('get_market_news'));
      this.test('Has validate_news_source tool', toolNames.includes('validate_news_source'));

      // Detailed tool schema validation
      tools.forEach(tool => {
        this.test(`Tool ${tool.name} has description`, !!tool.description);
        this.test(`Tool ${tool.name} has inputSchema`, !!tool.inputSchema);
        this.test(`Tool ${tool.name} inputSchema is object type`, tool.inputSchema?.type === 'object');
        this.test(`Tool ${tool.name} has properties`, !!tool.inputSchema?.properties);
        this.test(`Tool ${tool.name} has required fields`, Array.isArray(tool.inputSchema?.required) || tool.inputSchema?.required === undefined);
      });

      // Specific schema validation for crypto sentiment tool
      const sentimentTool = tools.find(t => t.name === 'analyze_crypto_sentiment');
      if (sentimentTool) {
        this.test('Sentiment tool has content property', !!sentimentTool.inputSchema?.properties?.content);
        this.test('Content property has type string', sentimentTool.inputSchema?.properties?.content?.type === 'string');
        this.test('Content property has description', !!sentimentTool.inputSchema?.properties?.content?.description);
        this.test('Content property has minLength', typeof sentimentTool.inputSchema?.properties?.content?.minLength === 'number');
        this.test('Content property has maxLength', typeof sentimentTool.inputSchema?.properties?.content?.maxLength === 'number');
      }
    } catch (error) {
      console.log(`❌ Tools/list failed: ${error.message}`);
      this.failed += 20;
    }

    // Test 2.3: Tools/call method with valid parameters
    try {
      const { statusCode, response } = await this.makeRequest('tools/call', {
        name: 'analyze_crypto_sentiment',
        arguments: {
          content: 'Bitcoin is showing strong bullish momentum today with significant buying pressure.'
        }
      });
      this.test('Tools/call responds with 200', statusCode === 200);
      this.test('Tools/call has JSON-RPC 2.0 field', response.jsonrpc === '2.0');
      this.test('Tools/call has result field', !!response.result);
      this.test('Tools/call result has content array', Array.isArray(response.result?.content));
      this.test('Content has text type', response.result?.content?.[0]?.type === 'text');
      this.test('Content has text value', !!response.result?.content?.[0]?.text);
    } catch (error) {
      console.log(`❌ Tools/call failed: ${error.message}`);
      this.failed += 6;
    }

    console.log('\n⚠️  3. ERROR HANDLING COMPLIANCE');
    console.log('--------------------------------');

    // Test 3.1: Invalid method
    try {
      const { statusCode, response } = await this.makeRequest('invalid/method');
      this.test('Invalid method returns 400', statusCode === 400);
      this.test('Invalid method has error object', !!response.error);
      this.test('Invalid method error code is -32601', response.error?.code === -32601);
      this.test('Invalid method has JSON-RPC 2.0 field', response.jsonrpc === '2.0');
    } catch (error) {
      console.log(`❌ Invalid method test failed: ${error.message}`);
      this.failed += 4;
    }

    // Test 3.2: Invalid JSON-RPC format
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

    // Test 3.3: Invalid tool name
    try {
      const { statusCode, response } = await this.makeRequest('tools/call', {
        name: 'nonexistent_tool',
        arguments: {}
      });
      this.test('Invalid tool returns error response', statusCode >= 400);
      this.test('Invalid tool has error field', !!response.error);
    } catch (error) {
      console.log(`❌ Invalid tool test failed: ${error.message}`);
      this.failed += 2;
    }

    console.log('\n🌐 4. n8n INTEGRATION COMPATIBILITY');
    console.log('-----------------------------------');

    // Test 4.1: CORS headers
    try {
      const { headers } = await this.makeHealthRequest();
      this.test('CORS Access-Control-Allow-Origin header present', !!headers['access-control-allow-origin']);
      this.test('CORS Access-Control-Allow-Methods header present', !!headers['access-control-allow-methods']);
      this.test('CORS Access-Control-Allow-Headers header present', !!headers['access-control-allow-headers']);
    } catch (error) {
      console.log(`❌ CORS validation failed: ${error.message}`);
      this.failed += 3;
    }

    // Test 4.2: HTTP POST endpoint
    try {
      const { statusCode } = await this.makeRequest('initialize');
      this.test('HTTP /mcp endpoint accepts POST requests', statusCode === 200);
    } catch (error) {
      console.log(`❌ HTTP POST validation failed: ${error.message}`);
      this.failed += 1;
    }

    console.log('\n📊 5. VALIDATION SUMMARY');
    console.log('========================');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Success Rate: ${Math.round((this.passed / (this.passed + this.failed)) * 100)}%`);

    if (this.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! MCP server is FULLY COMPLIANT.');
      console.log('✅ 100% MCP protocol compliance');
      console.log('✅ n8n integration ready');
      console.log('✅ Production-ready configuration');
      return 0;
    } else {
      console.log('\n⚠️  VALIDATION FAILURES DETECTED');
      console.log('❌ Some requirements not met');
      console.log('❌ Requires fixes before production use');

      console.log('\n📝 FAILED TESTS:');
      this.results.filter(r => r.status === 'FAIL' || r.status === 'ERROR').forEach(result => {
        console.log(`   ❌ ${result.name}${result.details ? ` - ${result.details}` : ''}`);
      });

      return 1;
    }
  }
}

// Check if server is running first
async function checkServerRunning() {
  try {
    const validator = new ComprehensiveMCPValidator();
    await validator.makeHealthRequest();
    return true;
  } catch (error) {
    console.log('❌ Server not running or not accessible');
    console.log('   Please start the server first with: npm start');
    console.log(`   Expected endpoint: http://localhost:${PORT}/health`);
    return false;
  }
}

// Main execution
async function main() {
  const isRunning = await checkServerRunning();
  if (!isRunning) {
    process.exit(1);
  }

  const validator = new ComprehensiveMCPValidator();
  const exitCode = await validator.runComprehensiveValidation();
  process.exit(exitCode);
}

main().catch(error => {
  console.error('❌ Validation script failed:', error.message);
  process.exit(1);
});