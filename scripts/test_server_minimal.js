#!/usr/bin/env node

// Minimal test to check if the server can start
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing server imports...');

async function runMinimalTest() {
  try {
    console.log('Step 1: Checking if dist/server.js exists...');
    const serverPath = join(__dirname, 'dist', 'server.js');
    const serverExists = fs.existsSync(serverPath);
    console.log(`Server file exists: ${serverExists}`);

    if (!serverExists) {
      console.error('❌ Server file not found at:', serverPath);
      console.error('   Please build the project first: npm run build');
      process.exit(1);
    }

    console.log('Step 2: Checking file permissions...');
    const stats = fs.statSync(serverPath);
    console.log(`File size: ${stats.size} bytes`);
    console.log(`Last modified: ${stats.mtime.toISOString()}`);

    console.log('Step 3: Attempting to import server module...');
    const serverModule = await import('./dist/server.js');
    console.log('✅ Server module imported successfully');
    console.log('Available exports:', Object.keys(serverModule));

    console.log('Step 4: Testing server class instantiation...');
    const { MCPNewsServer } = serverModule;

    if (!MCPNewsServer) {
      throw new Error('MCPNewsServer class not found in exports');
    }

    console.log('✅ MCPNewsServer class found');

    // Test instantiation without starting
    try {
      const server = new MCPNewsServer();
      console.log('✅ Server instance created successfully');
      console.log('Server instance type:', typeof server);
    } catch (instantiationError) {
      console.error('❌ Error creating server instance:', instantiationError.message);
      throw instantiationError;
    }

    console.log('\n🎉 All tests passed! Server module is ready.');
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    return false;
  }
}

// Run the test and exit with appropriate code
runMinimalTest()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Unexpected error in test runner:', error);
    process.exit(1);
  });