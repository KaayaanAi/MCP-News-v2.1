#!/usr/bin/env python3
"""
Kaayaan MCP News v2.1 Server
Production-ready MCP server for cryptocurrency news sentiment analysis
Compatible with n8n MCP Client and Kaayaan infrastructure
"""

import sys
import json
import asyncio
import logging
import os
import signal
import traceback
from typing import Dict, Any, List, Optional
from datetime import datetime
import re

# MCP Protocol imports

# Core analysis components
from news_analyzer import CryptoNewsAnalyzer
from cache_manager import CacheManager
from webhook_manager import WebhookManager

# Configure structured logging for production
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr)  # MCP requires stderr for logs
    ]
)
logger = logging.getLogger(__name__)

class KaayaanMCPNewsServer:
    """
    Production MCP Server for Kaayaan News Analysis
    Implements MCP stdio protocol for n8n integration
    """
    
    def __init__(self):
        self.cache_manager: Optional[CacheManager] = None
        self.webhook_manager: Optional[WebhookManager] = None
        self.analyzer: Optional[CryptoNewsAnalyzer] = None
        self.running = True
        self.server_name = "kaayaan-mcp-news"
        self.version = "2.1.0"
        
    async def initialize(self):
        """Initialize all service components"""
        try:
            # Initialize cache manager with Kaayaan Redis
            self.cache_manager = CacheManager()
            await self.cache_manager.connect()
            
            # Initialize webhook manager
            self.webhook_manager = WebhookManager()
            
            # Initialize news analyzer
            self.analyzer = CryptoNewsAnalyzer(self.cache_manager)
            
            logger.info(f"🚀 {self.server_name} v{self.version} initialized successfully")
            logger.info("💾 Redis cache connected")
            logger.info("📡 Webhook manager ready")
            logger.info("🤖 AI analysis engine loaded")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize server: {e}")
            raise
    
    async def shutdown(self):
        """Graceful shutdown"""
        logger.info("🔄 Shutting down MCP server...")
        self.running = False
        
        if self.cache_manager:
            await self.cache_manager.disconnect()
        
        logger.info("✅ Server shutdown complete")
    
    def create_mcp_response(self, id: Any, result: Any = None, error: Dict = None) -> Dict:
        """Create MCP-compliant JSON-RPC 2.0 response"""
        response = {
            "jsonrpc": "2.0",
            "id": id
        }
        
        if error:
            response["error"] = error
        else:
            response["result"] = result
            
        return response
    
    def create_mcp_error(self, code: int, message: str, data: Any = None) -> Dict:
        """Create MCP error object"""
        error = {
            "code": code,
            "message": message
        }
        if data is not None:
            error["data"] = data
        return error
    
    async def handle_tools_list(self, id: Any) -> Dict:
        """Handle tools/list request - return available MCP tools"""
        tools = [
            {
                "name": "crypto_news_analyze",
                "description": "Analyze cryptocurrency news for sentiment and market impact with AI-powered analysis",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "News headline or title",
                            "minLength": 1,
                            "maxLength": 500
                        },
                        "summary": {
                            "type": "string", 
                            "description": "News content or description",
                            "minLength": 1,
                            "maxLength": 2000
                        },
                        "source": {
                            "type": "string",
                            "description": "News source (optional)",
                            "maxLength": 100
                        }
                    },
                    "required": ["title", "summary"]
                }
            },
            {
                "name": "crypto_news_batch_analyze",
                "description": "Analyze multiple cryptocurrency news items in batch for efficiency",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "news_items": {
                            "type": "array",
                            "description": "Array of news items to analyze",
                            "minItems": 1,
                            "maxItems": 50,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string", "minLength": 1, "maxLength": 500},
                                    "summary": {"type": "string", "minLength": 1, "maxLength": 2000},
                                    "source": {"type": "string", "maxLength": 100}
                                },
                                "required": ["title", "summary"]
                            }
                        }
                    },
                    "required": ["news_items"]
                }
            },
            {
                "name": "crypto_market_sentiment",
                "description": "Get overall cryptocurrency market sentiment from recent news analysis",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "timeframe": {
                            "type": "string",
                            "description": "Analysis timeframe",
                            "enum": ["1h", "6h", "24h"],
                            "default": "24h"
                        },
                        "coins": {
                            "type": "array",
                            "description": "Specific coins to analyze (optional)",
                            "items": {"type": "string"},
                            "maxItems": 10
                        }
                    }
                }
            },
            {
                "name": "crypto_impact_keywords",
                "description": "Extract and analyze impact keywords from cryptocurrency text",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "Text to analyze for crypto impact keywords",
                            "minLength": 1,
                            "maxLength": 5000
                        },
                        "include_weights": {
                            "type": "boolean",
                            "description": "Include keyword impact weights in response",
                            "default": false
                        }
                    },
                    "required": ["text"]
                }
            },
            {
                "name": "server_health_check",
                "description": "Check server health and performance metrics",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]
        
        return self.create_mcp_response(id, {"tools": tools})
    
    async def handle_tool_call(self, id: Any, params: Dict) -> Dict:
        """Handle tools/call request"""
        tool_name = params.get("name")
        arguments = params.get("arguments", {})
        
        try:
            if tool_name == "crypto_news_analyze":
                return await self._handle_single_analysis(id, arguments)
            
            elif tool_name == "crypto_news_batch_analyze":
                return await self._handle_batch_analysis(id, arguments)
            
            elif tool_name == "crypto_market_sentiment":
                return await self._handle_market_sentiment(id, arguments)
            
            elif tool_name == "crypto_impact_keywords":
                return await self._handle_keyword_analysis(id, arguments)
            
            elif tool_name == "server_health_check":
                return await self._handle_health_check(id, arguments)
            
            else:
                return self.create_mcp_response(
                    id, 
                    error=self.create_mcp_error(-32601, f"Unknown tool: {tool_name}")
                )
                
        except Exception as e:
            logger.error(f"Tool call error for {tool_name}: {str(e)}")
            logger.error(traceback.format_exc())
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32603, "Internal server error", str(e))
            )
    
    async def _handle_single_analysis(self, id: Any, arguments: Dict) -> Dict:
        """Handle single news analysis"""
        title = arguments.get("title", "").strip()
        summary = arguments.get("summary", "").strip()
        source = arguments.get("source", "").strip()
        
        if not title or not summary:
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32602, "Invalid params: title and summary required")
            )
        
        request_id = f"mcp_single_{datetime.utcnow().strftime('%H%M%S%f')}"
        
        try:
            result = await self.analyzer.analyze_single(title, summary, request_id)
            
            # Add source to response if provided
            response_data = result.dict()
            if source:
                response_data["source"] = source
                
            response_data["analysis_id"] = request_id
            response_data["timestamp"] = datetime.utcnow().isoformat() + "Z"
            
            logger.info(f"✅ Single analysis completed: {request_id}")
            return self.create_mcp_response(id, response_data)
            
        except Exception as e:
            logger.error(f"❌ Single analysis failed {request_id}: {str(e)}")
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32603, "Analysis failed", str(e))
            )
    
    async def _handle_batch_analysis(self, id: Any, arguments: Dict) -> Dict:
        """Handle batch news analysis"""
        news_items = arguments.get("news_items", [])
        
        if not news_items or not isinstance(news_items, list):
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32602, "Invalid params: news_items array required")
            )
        
        if len(news_items) > 50:
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32602, "Batch size limit exceeded (max 50 items)")
            )
        
        request_id = f"mcp_batch_{datetime.utcnow().strftime('%H%M%S%f')}"
        
        try:
            results = await self.analyzer.analyze_batch(news_items, request_id)
            
            # Add metadata to each result
            for i, result in enumerate(results):
                result["item_index"] = i
                result["analysis_id"] = f"{request_id}_item_{i}"
                
                # Add source if provided
                if i < len(news_items) and "source" in news_items[i]:
                    result["source"] = news_items[i]["source"]
            
            # Send webhook notification if configured
            if self.webhook_manager:
                await self.webhook_manager.send_batch_results(results, request_id)
            
            response_data = {
                "results": results,
                "total_items": len(results),
                "request_id": request_id,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "summary": self._generate_batch_summary(results)
            }
            
            logger.info(f"✅ Batch analysis completed: {request_id} ({len(results)} items)")
            return self.create_mcp_response(id, response_data)
            
        except Exception as e:
            logger.error(f"❌ Batch analysis failed {request_id}: {str(e)}")
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32603, "Batch analysis failed", str(e))
            )
    
    async def _handle_market_sentiment(self, id: Any, arguments: Dict) -> Dict:
        """Handle market sentiment analysis"""
        timeframe = arguments.get("timeframe", "24h")
        specific_coins = arguments.get("coins", [])
        
        try:
            # Get cached sentiment data from Redis
            cache_key = f"market_sentiment:{timeframe}:{hash(str(sorted(specific_coins)))}"
            cached_sentiment = await self.cache_manager.get(cache_key)
            
            if cached_sentiment:
                logger.info(f"📊 Market sentiment cache hit for {timeframe}")
                return self.create_mcp_response(id, cached_sentiment)
            
            # Calculate sentiment from recent cache entries
            sentiment_data = await self._calculate_market_sentiment(timeframe, specific_coins)
            
            # Cache for 30 minutes
            await self.cache_manager.set(cache_key, sentiment_data, ttl=1800)
            
            logger.info(f"📊 Market sentiment calculated for {timeframe}")
            return self.create_mcp_response(id, sentiment_data)
            
        except Exception as e:
            logger.error(f"❌ Market sentiment failed: {str(e)}")
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32603, "Market sentiment analysis failed", str(e))
            )
    
    async def _handle_keyword_analysis(self, id: Any, arguments: Dict) -> Dict:
        """Handle keyword impact analysis"""
        text = arguments.get("text", "").strip()
        include_weights = arguments.get("include_weights", False)
        
        if not text:
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32602, "Invalid params: text required")
            )
        
        try:
            # Use analyzer's keyword analysis
            keyword_result = self.analyzer._keyword_analysis(text.lower())
            impact, confidence = keyword_result
            
            # Extract detected keywords
            positive_keywords = []
            negative_keywords = []
            
            for keyword, weight in self.analyzer.positive_keywords.items():
                if re.search(r'\b' + re.escape(keyword) + r'\b', text, re.IGNORECASE):
                    if include_weights:
                        positive_keywords.append({"keyword": keyword, "weight": weight})
                    else:
                        positive_keywords.append(keyword)
            
            for keyword, weight in self.analyzer.negative_keywords.items():
                if re.search(r'\b' + re.escape(keyword) + r'\b', text, re.IGNORECASE):
                    if include_weights:
                        negative_keywords.append({"keyword": keyword, "weight": weight})
                    else:
                        negative_keywords.append(keyword)
            
            # Detect crypto mentions
            detected_coins = self.analyzer._detect_coins(text)
            
            result = {
                "impact": impact.value,
                "confidence": confidence,
                "positive_keywords": positive_keywords,
                "negative_keywords": negative_keywords,
                "detected_coins": detected_coins,
                "total_keywords": len(positive_keywords) + len(negative_keywords),
                "analysis_timestamp": datetime.utcnow().isoformat() + "Z"
            }
            
            logger.info(f"🔍 Keyword analysis completed: {len(positive_keywords) + len(negative_keywords)} keywords found")
            return self.create_mcp_response(id, result)
            
        except Exception as e:
            logger.error(f"❌ Keyword analysis failed: {str(e)}")
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32603, "Keyword analysis failed", str(e))
            )
    
    async def _handle_health_check(self, id: Any, arguments: Dict) -> Dict:
        """Handle server health check"""
        try:
            # Check Redis connection
            redis_healthy = await self.cache_manager.is_connected() if self.cache_manager else False
            
            # Get cache stats
            cache_stats = await self.cache_manager.get_stats() if self.cache_manager else {}
            
            # Test webhook if configured
            webhook_status = "disabled"
            if self.webhook_manager and self.webhook_manager.enabled:
                webhook_test = await self.webhook_manager.test_webhook()
                webhook_status = webhook_test.get("status", "unknown")
            
            health_data = {
                "server_name": self.server_name,
                "version": self.version,
                "status": "healthy",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "timezone": "Asia/Kuwait",
                "components": {
                    "redis_cache": "healthy" if redis_healthy else "unhealthy",
                    "webhook_manager": webhook_status,
                    "news_analyzer": "healthy" if self.analyzer else "unhealthy"
                },
                "cache_stats": cache_stats,
                "environment": {
                    "log_level": os.getenv("LOG_LEVEL", "INFO"),
                    "mongodb_configured": bool(os.getenv("MONGODB_URL")),
                    "redis_configured": bool(os.getenv("REDIS_URL")),
                    "whatsapp_configured": bool(os.getenv("WHATSAPP_API")),
                    "openai_configured": bool(os.getenv("OPENAI_API_KEY"))
                }
            }
            
            logger.info("💚 Health check completed")
            return self.create_mcp_response(id, health_data)
            
        except Exception as e:
            logger.error(f"❌ Health check failed: {str(e)}")
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32603, "Health check failed", str(e))
            )
    
    async def _calculate_market_sentiment(self, timeframe: str, specific_coins: List[str]) -> Dict:
        """Calculate overall market sentiment from cached analyses"""
        # This is a simplified version - in production you'd query your analytics database
        sentiment_data = {
            "timeframe": timeframe,
            "overall_sentiment": "Neutral",
            "confidence": 50,
            "analyzed_items": 0,
            "sentiment_breakdown": {
                "positive": 0,
                "negative": 0,
                "neutral": 0
            },
            "top_coins_mentioned": [],
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        
        if specific_coins:
            sentiment_data["filtered_coins"] = specific_coins
        
        return sentiment_data
    
    def _generate_batch_summary(self, results: List[Dict]) -> Dict:
        """Generate summary statistics from batch results"""
        summary = {
            "positive_count": 0,
            "negative_count": 0,
            "neutral_count": 0,
            "high_confidence_count": 0,
            "low_confidence_count": 0,
            "error_count": 0,
            "avg_confidence": 0.0,
            "top_affected_coins": []
        }
        
        confidences = []
        all_coins = []
        
        for result in results:
            impact = result.get("impact", "Neutral")
            confidence = result.get("confidence", 0)
            
            # Count impacts
            if impact == "Positive":
                summary["positive_count"] += 1
            elif impact == "Negative":
                summary["negative_count"] += 1
            else:
                summary["neutral_count"] += 1
            
            # Count confidence levels
            if confidence > 75:
                summary["high_confidence_count"] += 1
            else:
                summary["low_confidence_count"] += 1
            
            # Track errors
            if result.get("error"):
                summary["error_count"] += 1
            
            confidences.append(confidence)
            all_coins.extend(result.get("affected_coins", []))
        
        # Calculate average confidence
        if confidences:
            summary["avg_confidence"] = round(sum(confidences) / len(confidences), 1)
        
        # Get top mentioned coins
        if all_coins:
            from collections import Counter
            coin_counts = Counter(all_coins)
            summary["top_affected_coins"] = [
                {"coin": coin, "mentions": count} 
                for coin, count in coin_counts.most_common(5)
            ]
        
        return summary
    
    async def handle_request(self, request_data: Dict) -> Dict:
        """Main request handler"""
        method = request_data.get("method")
        params = request_data.get("params", {})
        id = request_data.get("id")
        
        logger.info(f"📨 Received MCP request: {method} (id: {id})")
        
        if method == "initialize":
            return self.create_mcp_response(id, {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": self.server_name,
                    "version": self.version
                }
            })
        
        elif method == "tools/list":
            return await self.handle_tools_list(id)
        
        elif method == "tools/call":
            return await self.handle_tool_call(id, params)
        
        else:
            logger.warning(f"⚠️ Unknown method: {method}")
            return self.create_mcp_response(
                id,
                error=self.create_mcp_error(-32601, f"Method not found: {method}")
            )
    
    async def run(self):
        """Main server loop using MCP stdio protocol"""
        logger.info(f"🔄 Starting {self.server_name} v{self.version}")
        
        try:
            await self.initialize()
            
            # Main message loop
            while self.running:
                try:
                    # Read JSON-RPC request from stdin
                    line = await asyncio.get_event_loop().run_in_executor(
                        None, sys.stdin.readline
                    )
                    
                    if not line:
                        logger.info("📪 No more input, shutting down")
                        break
                    
                    line = line.strip()
                    if not line:
                        continue
                    
                    # Parse JSON-RPC request
                    try:
                        request_data = json.loads(line)
                    except json.JSONDecodeError as e:
                        logger.error(f"❌ Invalid JSON: {e}")
                        error_response = self.create_mcp_response(
                            None, 
                            error=self.create_mcp_error(-32700, "Parse error")
                        )
                        print(json.dumps(error_response), flush=True)
                        continue
                    
                    # Handle request
                    response = await self.handle_request(request_data)
                    
                    # Send response to stdout
                    print(json.dumps(response), flush=True)
                    
                except KeyboardInterrupt:
                    logger.info("🛑 Received interrupt signal")
                    break
                except Exception as e:
                    logger.error(f"❌ Unexpected error in main loop: {e}")
                    logger.error(traceback.format_exc())
                    
        finally:
            await self.shutdown()

# Signal handlers for graceful shutdown
def signal_handler(signum, frame):
    logger.info(f"📡 Received signal {signum}")
    sys.exit(0)

async def main():
    """Main entry point"""
    # Set up signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Create and run server
    server = KaayaanMCPNewsServer()
    await server.run()

if __name__ == "__main__":
    # Set timezone for Kaayaan infrastructure
    os.environ.setdefault("TZ", "Asia/Kuwait")
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🏁 Server stopped by user")
    except Exception as e:
        logger.error(f"💥 Fatal error: {e}")
        sys.exit(1)