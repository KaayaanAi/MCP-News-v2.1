// Core dependencies - optimized imports
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const OpenAI = require('openai');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Load environment variables early
require('dotenv').config();

// Production-ready logger utility
const createLogger = () => {
    const isProduction = process.env.NODE_ENV === 'production';
    const isDevelopment = process.env.NODE_ENV === 'development';

    return {
        info: (message, ...args) => {
            if (!isProduction || isDevelopment) {
                console.log(message, ...args);
            }
        },
        error: (message, ...args) => {
            console.error(message, ...args);
        },
        warn: (message, ...args) => {
            console.warn(message, ...args);
        },
        debug: (message, ...args) => {
            if (isDevelopment) {
                console.log('[DEBUG]', message, ...args);
            }
        }
    };
};

const logger = createLogger();

// Application initialization
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5000;

// Security middleware - optimized configuration
const helmetConfig = {
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
};
app.use(helmet(helmetConfig));

// Rate limiting - optimized configuration
const rateLimitConfig = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
};
app.use(rateLimit(rateLimitConfig));

// CORS configuration - optimized
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000'];

const corsConfig = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};
app.use(cors(corsConfig));

app.use(express.json({ limit: '1mb' })); // Reduced payload size for security

// Environment variables validation - optimized
const requiredEnvVars = {
    NEWS_API_KEY: process.env.NEWS_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MONGODB_URI: process.env.MONGODB_URI,
};

// Validate all required environment variables at once
const missingVars = Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key);

if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
}

// Destructure for cleaner access
const { NEWS_API_KEY, OPENAI_API_KEY, MONGODB_URI } = requiredEnvVars;

// Initialize OpenAI client with configuration
const openaiConfig = {
    apiKey: OPENAI_API_KEY,
    timeout: 30000, // 30 seconds timeout
    maxRetries: 2,
};
const openai = new OpenAI(openaiConfig);

// Initialize MongoDB client with optimized configuration
const mongoConfig = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4, // Use IPv4, skip trying IPv6
};
const mongoClient = new MongoClient(MONGODB_URI, mongoConfig);
let db = null;

// MongoDB connection with optimized retry logic
const CONNECTION_CONFIG = {
    maxRetries: 3,
    retryDelay: 5000,
    dbName: 'crypto_news',
};

let connectionRetries = 0;

const connectToMongoDB = async () => {
    try {
        await mongoClient.connect();
        db = mongoClient.db(CONNECTION_CONFIG.dbName);
        logger.info('✅ Connected to MongoDB database');
        connectionRetries = 0;
        return true;
    } catch (error) {
        connectionRetries++;
        logger.error(
            `❌ MongoDB connection failed (attempt ${connectionRetries}/${CONNECTION_CONFIG.maxRetries}):`,
            error.message
        );

        if (connectionRetries < CONNECTION_CONFIG.maxRetries) {
            logger.info(`⏳ Retrying MongoDB connection in ${CONNECTION_CONFIG.retryDelay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, CONNECTION_CONFIG.retryDelay));
            return connectToMongoDB();
        }

        logger.error('❌ Failed to connect to MongoDB after maximum retries. Continuing without database.');
        db = null;
        return false;
    }
};

connectToMongoDB();

// News API configuration
const NEWS_API_CONFIG = {
    baseURL: 'https://newsapi.org/v2/everything',
    timeout: 15000,
    pageSize: 20,
    language: 'en',
};

// OpenAI prompt configuration
const OPENAI_CONFIG = {
    model: 'gpt-4',
    temperature: 0.2,
    maxTokens: 2000,
    timeout: 30000,
    systemPrompt: 'You are a professional cryptocurrency market analyst. Analyze the sentiment of news articles and provide comprehensive trading insights. Respond only in valid JSON format.',
};

// Utility functions for better code organization
const fetchNewsArticles = async (query) => {
    const params = {
        q: query,
        sortBy: 'publishedAt',
        pageSize: NEWS_API_CONFIG.pageSize,
        language: NEWS_API_CONFIG.language,
        apiKey: NEWS_API_KEY,
    };

    try {
        const response = await axios.get(NEWS_API_CONFIG.baseURL, {
            params,
            timeout: NEWS_API_CONFIG.timeout,
            validateStatus: (status) => status < 500,
        });

        // Handle API-specific error responses
        if (response.status === 429) {
            throw new Error('NewsAPI rate limit exceeded - please try again later');
        }
        if (response.status === 401) {
            throw new Error('NewsAPI authentication failed - invalid API key');
        }
        if (response.status >= 400) {
            throw new Error(`NewsAPI error (${response.status}): ${response.data?.message || 'Unknown error'}`);
        }

        return response;
    } catch (axiosError) {
        if (axiosError.code === 'ECONNABORTED') {
            throw new Error('NewsAPI request timeout - service may be unavailable');
        }
        if (axiosError.response) {
            throw new Error(`NewsAPI error (${axiosError.response.status}): ${axiosError.response.data?.message || 'Unknown API error'}`);
        }
        if (axiosError.request) {
            throw new Error('NewsAPI network error - unable to reach service');
        }
        throw new Error(`NewsAPI request failed: ${axiosError.message}`);
    }
};

const performSentimentAnalysis = async (newsText) => {
    const userPrompt = `Analyze these cryptocurrency news articles and provide sentiment analysis:

${newsText}

Provide your analysis in this exact JSON format:
{
    "overall_sentiment": "positive|negative|neutral",
    "confidence": 0.95,
    "affected_coins": ["BTC", "ETH"],
    "market_impact": "high|medium|low",
    "summary": "Detailed analysis in English and Arabic",
    "trading_signals": [
        {
            "coin": "BTC",
            "signal": "buy|sell|hold",
            "strength": "strong|moderate|weak",
            "timeframe": "short|medium|long",
            "reasoning": "explanation"
        }
    ]
}`;

    const completion = await Promise.race([
        openai.chat.completions.create({
            model: OPENAI_CONFIG.model,
            messages: [
                { role: 'system', content: OPENAI_CONFIG.systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: OPENAI_CONFIG.temperature,
            max_tokens: OPENAI_CONFIG.maxTokens,
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`OpenAI request timeout after ${OPENAI_CONFIG.timeout / 1000} seconds`)), OPENAI_CONFIG.timeout)
        ),
    ]);

    if (!completion.choices?.[0]?.message) {
        throw new Error('Invalid response from OpenAI GPT-4 API');
    }

    try {
        return JSON.parse(completion.choices[0].message.content);
    } catch (parseError) {
        throw new Error(`Failed to parse OpenAI response: ${parseError.message}`);
    }
};

const saveAnalysisResult = async (analysisResult) => {
    if (!db) {
        logger.warn('⚠️  MongoDB not available - analysis not saved');
        return false;
    }

    try {
        const collection = db.collection('crypto_analysis');
        await collection.insertOne(analysisResult);
        logger.debug('✅ Analysis saved to MongoDB');
        return true;
    } catch (dbError) {
        logger.error('❌ Failed to save to MongoDB:', dbError.message);
        return false;
    }
};

// Main analysis function - optimized and modular
const analyzeQuery = async (query) => {
    const startTime = Date.now();
    const getElapsedTime = () => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

    try {
        // Step 1: Fetch news articles
        logger.debug(`📰 Fetching news for: ${query}`);
        const newsResponse = await fetchNewsArticles(query);

        if (!newsResponse.data?.articles?.length) {
            throw new Error(`No news articles found for query: ${query}`);
        }

        // Filter valid articles
        const articles = newsResponse.data.articles.filter(article =>
            article.title && article.description && article.content
        );

        if (articles.length === 0) {
            throw new Error(`No valid news articles found for query: ${query}`);
        }

        logger.debug(`✅ Fetched ${articles.length} articles in ${getElapsedTime()}`);

        // Step 2: Perform sentiment analysis
        logger.debug('🤖 Analyzing sentiment with OpenAI GPT-4');
        const newsText = articles
            .map(article => `${article.title}: ${article.description}`)
            .join('\n\n');

        const sentimentAnalysis = await performSentimentAnalysis(newsText);
        logger.debug('✅ Sentiment analysis completed');

        // Step 3: Prepare and save results
        const analysisResult = {
            query,
            news_articles: articles.map(article => ({
                title: article.title,
                description: article.description,
                url: article.url,
                publishedAt: article.publishedAt,
                source: article.source.name,
            })),
            sentiment_analysis: sentimentAnalysis,
            trading_signals: sentimentAnalysis.trading_signals || [],
            timestamp: new Date().toISOString(),
            processing_time: getElapsedTime(),
        };

        await saveAnalysisResult(analysisResult);
        return analysisResult;

    } catch (error) {
        logger.error('❌ Analysis failed:', error.message);

        // Save error for tracking
        if (db) {
            try {
                await db.collection('crypto_analysis').insertOne({
                    query,
                    error: error.message,
                    timestamp: new Date().toISOString(),
                    processing_time: getElapsedTime(),
                });
            } catch (dbError) {
                logger.error('❌ Failed to save error to MongoDB:', dbError.message);
            }
        }

        throw error;
    }
};

// Input validation configuration
const VALIDATION_CONFIG = {
    maxQueryLength: 100,
    allowedPattern: /^[a-zA-Z0-9\s\-_.()$]+$/,
    suspiciousPatterns: [
        /[<>]/g,           // HTML tags
        /javascript:/gi,    // JavaScript injection
        /data:/gi,         // Data URI
        /vbscript:/gi,     // VBScript
        /on\w+=/gi,        // Event handlers
        /script/gi,        // Script tags
        /eval\(/gi,        // Eval function
        /document\./gi,    // Document object
        /window\./gi,      // Window object
    ],
};

// Input validation utility
const validateQuery = (query) => {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return { valid: false, error: 'Invalid query parameter', message: 'Query must be a non-empty string' };
    }

    const sanitizedQuery = query.trim().substring(0, VALIDATION_CONFIG.maxQueryLength);

    if (sanitizedQuery.length === 0) {
        return { valid: false, error: 'Empty query', message: 'Query cannot be empty after trimming' };
    }

    if (!VALIDATION_CONFIG.allowedPattern.test(sanitizedQuery)) {
        return {
            valid: false,
            error: 'Invalid query format',
            message: 'Query contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, periods, parentheses, and $ are allowed.',
        };
    }

    // Check for suspicious patterns
    for (const pattern of VALIDATION_CONFIG.suspiciousPatterns) {
        if (pattern.test(sanitizedQuery)) {
            return {
                valid: false,
                error: 'Security violation',
                message: 'Query contains potentially malicious content',
            };
        }
    }

    return { valid: true, sanitizedQuery };
};

// Main API endpoint - optimized
app.post('/analyze', async (req, res) => {
    try {
        const { query } = req.body;
        const validation = validateQuery(query);

        if (!validation.valid) {
            return res.status(400).json({
                error: validation.error,
                message: validation.message,
            });
        }

        logger.debug(`🚀 Starting analysis for: ${validation.sanitizedQuery}`);
        const result = await analyzeQuery(validation.sanitizedQuery);

        res.json(result);
    } catch (error) {
        logger.error('❌ API Error:', error.message);
        res.status(500).json({
            error: 'Analysis failed',
            message: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});

// Health check endpoint - optimized
app.get('/health', async (req, res) => {
    const timestamp = new Date().toISOString();
    const services = {
        newsapi: NEWS_API_KEY ? 'configured' : 'missing',
        openai: OPENAI_API_KEY ? 'configured' : 'missing',
        mongodb: 'disconnected',
    };

    try {
        if (!db) {
            throw new Error('Database not connected');
        }

        await db.admin().ping();
        services.mongodb = 'connected';

        res.json({
            status: 'healthy',
            timestamp,
            services,
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp,
            services,
        });
    }
});

// Start server with enhanced logging
const server = app.listen(PORT, () => {
    logger.info(`🚀 CryptoNewsAnalyzer running on port ${PORT}`);
    logger.info(`📊 Real-time cryptocurrency analysis`);
    logger.info(`🔗 POST /analyze - Analyze cryptocurrency news`);
    logger.info(`❤️  GET /health - Health check`);
    logger.info(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Set server timeout
server.timeout = 120000; // 2 minutes
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000; // 66 seconds

// Graceful shutdown - optimized
const gracefulShutdown = async (signal) => {
    logger.info(`📴 Received ${signal}. Shutting down gracefully...`);

    try {
        // Close server first
        await new Promise((resolve) => {
            server.close((err) => {
                if (err) logger.error('❌ Error closing server:', err.message);
                else logger.info('✅ Server closed');
                resolve();
            });
        });

        // Close MongoDB connection
        if (mongoClient) {
            await mongoClient.close();
            logger.info('✅ MongoDB connection closed');
        }

        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Error during graceful shutdown:', error.message);
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Enhanced error handling
process.on('uncaughtException', (error) => {
    logger.error('❌ Uncaught Exception:', error.message);
    logger.error(error.stack);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
});

process.on('warning', (warning) => {
    logger.warn('⚠️  Warning:', warning.name, warning.message);
});