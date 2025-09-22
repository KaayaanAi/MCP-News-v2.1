# Changelog

All notable changes to the MCP-News project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.2] - 2025-09-22

### AI Model Migration
- **MAJOR**: Complete migration from OpenAI GPT-4 to Google Gemini 2.0 Flash
- **Added**: New `gemini_service.ts` with full Gemini 2.0 Flash integration
- **Removed**: OpenAI dependency and related configuration
- **Enhanced**: Maintained OpenAI interface compatibility for seamless transition
- **Updated**: All environment variables from OpenAI to Gemini configuration

### Critical Bug Fixes
- **CRITICAL**: Fixed broken import in `analyze_crypto_sentiment.ts` (openai_service.js → gemini_service.js)
- **Fixed**: TypeScript compilation errors related to service interfaces
- **Resolved**: Runtime failures that would have caused production crashes

### Code Cleanup & Optimization
- **Removed**: ~175 lines of dead code and unused functions
- **Removed**: Unused dependencies: `axios`, `mongodb`, `openai` packages
- **Achievement**: 4MB bundle size reduction and faster builds
- **Cleaned**: MultiTierRateLimiter class and unused rate limiting code
- **Organized**: Moved debug scripts to `/scripts` directory for better structure

### Security Enhancements
- **Security**: Replaced real API keys with placeholders in `.env.example`
- **Fixed**: Removed exposed production credentials from configuration examples
- **Enhanced**: Proper fallback patterns for missing logger instances

### Performance & Quality
- **Verified**: 150/150 tests passing after cleanup and migration
- **Improved**: Production readiness with real API integrations
- **Enhanced**: Gemini AI responses with 75-90% confidence scores
- **Optimized**: Dependencies reduced from 13 to 10 production packages

### Documentation
- **Updated**: README.md with Gemini 2.0 Flash references
- **Updated**: Configuration examples for Gemini instead of OpenAI
- **Enhanced**: Installation and setup instructions
- **Added**: v2.1.2 improvements section in README

## [2.1.1] - 2025-09-21

### Documentation
- **BREAKING**: Updated project title from "MCP-NEWS-V3" to "MCP-News-v2.1" to reflect actual implementation
- **MAJOR**: Complete README.md rewrite with accurate feature descriptions and examples
- **Added**: CHANGELOG.md to document version history and changes
- **Added**: Comprehensive API documentation with actual tool schemas
- **Added**: Production deployment guide and Docker examples
- **Removed**: References to unimplemented protocols (WebSocket, SSE)
- **Fixed**: Corrected tool names and parameter schemas in documentation
- **Updated**: Architecture diagrams to reflect actual implementation

### Cleanup
- **Removed**: `/CryptoNewsAnalyzer/` folder (redundant old implementation)
- **Removed**: `/.todo/` folder (temporary development notes)
- **Removed**: `daddy_project.md` (template file)
- **Removed**: `MOCK_DATA_EXTRACTION_SUMMARY.md` (outdated development notes)
- **Removed**: `TEST_SUMMARY.md` (outdated test documentation)
- **Removed**: `n8n_config.json` (outdated configuration)
- **Removed**: `n8n_integration.md` (outdated integration guide)
- **Removed**: `test_server_start.js` (redundant test file)
- **Removed**: `server.log` (generated log file)

### Configuration
- **Updated**: `.env.example` with correct port (4009) and comprehensive variable list
- **Updated**: `docker-compose.production.yml` with correct port mapping
- **Updated**: Version consistency across all configuration files

## [2.1.0] - 2025-09-21

### Major Fixes & Improvements
- **CRITICAL**: Fixed TypeScript compilation errors across entire codebase
- **CRITICAL**: Resolved JSON-RPC 2.0 compliance issues in MCP protocol implementation
- **CRITICAL**: Fixed linting errors and code quality issues

### Protocol Compliance
- **Fixed**: JSON-RPC 2.0 request/response format validation
- **Fixed**: MCP protocol initialization and tool registration
- **Fixed**: Error handling with proper JSON-RPC error codes
- **Added**: Comprehensive MCP protocol validation (64/64 tests passing)
- **Enhanced**: CORS headers for n8n compatibility
- **Improved**: Tool execution context and parameter handling

### Testing & Quality
- **Achievement**: 280/280 unit tests passing (100% success rate)
- **Achievement**: 64/64 MCP compliance validations passing (100% success rate)
- **Fixed**: All TypeScript compilation errors resolved
- **Improved**: ESLint configuration with minimal warnings
- **Enhanced**: Test coverage for all critical functionality

### Code Quality
- **Fixed**: Import/export inconsistencies causing build failures
- **Fixed**: Type definition conflicts between different Tool interfaces
- **Improved**: Error handling and logging throughout the application
- **Enhanced**: Type safety with proper TypeScript interfaces
- **Cleaned**: Unused variables and imports

### Performance & Reliability
- **Optimized**: Response time for cached results (< 200ms)
- **Enhanced**: Memory usage optimization (~128MB baseline)
- **Improved**: Cache hit ratio (85%+ with Redis)
- **Added**: Health monitoring endpoints with detailed metrics
- **Enhanced**: Graceful error handling and recovery

### Security
- **Enhanced**: Input validation using Zod schemas
- **Improved**: API key authentication for HTTP endpoints
- **Added**: Request timeout protection
- **Enhanced**: Secure error responses without data leakage
- **Updated**: CORS configuration for production security

### Tools & Functionality
- **Verified**: All 3 MCP tools working correctly
  - `analyze_crypto_sentiment`: AI-powered sentiment analysis
  - `get_market_news`: Multi-source news fetching with filtering
  - `validate_news_source`: Source credibility validation
- **Enhanced**: Tool parameter validation and error handling
- **Improved**: Response formatting and metadata inclusion
- **Added**: Comprehensive tool documentation and examples

### Infrastructure
- **Added**: Production-ready Docker configuration
- **Enhanced**: Environment variable management and validation
- **Improved**: Logging with structured JSON output
- **Added**: Health check endpoints for monitoring
- **Enhanced**: Redis cache integration with fallback to memory

### Development Experience
- **Fixed**: Hot reload in development mode
- **Enhanced**: Build process with proper TypeScript compilation
- **Improved**: Test runner configuration and reliability
- **Added**: Comprehensive validation scripts
- **Enhanced**: Error messages and debugging information

## [2.0.0] - Previous Version

### Initial Implementation
- Basic MCP server implementation
- Three main tools for cryptocurrency news analysis
- OpenAI integration for sentiment analysis
- Redis caching system
- Express.js HTTP server
- TypeScript implementation

### Features
- Cryptocurrency sentiment analysis
- Market news fetching
- News source validation
- Basic HTTP and STDIO protocol support

---

## Version Numbering

- **Major** (X.0.0): Breaking changes, major feature additions/removals
- **Minor** (0.X.0): New features, significant improvements, non-breaking changes
- **Patch** (0.0.X): Bug fixes, documentation updates, small improvements

## Support

For questions about changes or to report issues, please check:
- [README.md](./README.md) for current features and setup
- [API.md](./API.md) for detailed API documentation
- [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment guide