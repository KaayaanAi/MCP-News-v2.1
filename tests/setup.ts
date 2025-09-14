/**
 * Jest setup file for test configuration
 */

// Mock timers for consistent test execution
jest.setTimeout(10000);

// Global test setup
beforeEach(() => {
  // Reset all mocks before each test
  jest.clearAllMocks();

  // Reset Date.now for consistent timing tests
  jest.spyOn(Date, 'now').mockReturnValue(1640995200000); // Fixed timestamp: Jan 1, 2022
});

afterEach(() => {
  // Clean up any remaining timers or async operations
  jest.clearAllTimers();
  jest.restoreAllMocks();
});

// Global error handler for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Suppress console logs during tests unless explicitly needed
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};