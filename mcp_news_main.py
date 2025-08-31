"""
MCP-News v2.1 - AI-Powered Cryptocurrency News Analysis Server
Production-ready with batch processing, webhooks, and cost optimization
"""

import os
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
import uvicorn
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from news_analyzer import CryptoNewsAnalyzer
from response_models import (
    NewsAnalysisResponse, 
    HealthResponse, 
    MCPRequest, 
    MCPResponse,
    BatchNewsRequest,
    SingleNewsRequest
)
from cache_manager import CacheManager
from webhook_manager import WebhookManager

# Configure logging
os.makedirs("logs", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(request_id)s] %(message)s',
    handlers=[
        logging.FileHandler('logs/mcp-news-v2.1.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global instances
cache_manager: Optional[CacheManager] = None
webhook_manager: Optional[WebhookManager] = None
analyzer: Optional[CryptoNewsAnalyzer] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global cache_manager, webhook_manager, analyzer
    
    # Startup
    try:
        cache_manager = CacheManager()
        await cache_manager.connect()
        
        webhook_manager = WebhookManager()
        analyzer = CryptoNewsAnalyzer(cache_manager)
        
        logger.info("MCP-News v2.1 started at 0.0.0.0:8000")
        logger.info("Tools available: [news_analysis]")
        logger.info("Redis cache connected")
        logger.info("Batch processing & webhook ready")
        logger.info("Healthcheck active")
        
    except Exception as e:
        logger.error(f"Failed to initialize services: {e}")
        raise
    
    yield
    
    # Shutdown
    if cache_manager:
        await cache_manager.disconnect()
    logger.info("MCP-News v2.1 shutdown complete")

# Initialize FastAPI app
app = FastAPI(
    title="MCP-News v2.1",
    description="AI-Powered Cryptocurrency News Analysis Server",
    version="2.1.0",
    lifespan=lifespan
)

# Configure CORS from environment
allowed_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# Authentication dependency
async def verify_token(authorization: Optional[str] = Header(None)):
    """Verify API token from Authorization header"""
    required_token = os.getenv("API_TOKEN")
    if not required_token:
        return True  # No auth required if token not set
    
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization format")
    
    token = authorization.split(" ")[1]
    if token != required_token:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    return True

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint with service status"""
    uptime = datetime.utcnow().isoformat() + "Z"
    
    # Check Redis connection
    redis_status = "connected" if cache_manager and await cache_manager.is_connected() else "disconnected"
    
    return HealthResponse(
        status="healthy",
        service="mcp-news-v2.1",
        version="2.1.0",
        timestamp=uptime,
        redis_status=redis_status,
        uptime=uptime
    )

@app.post("/mcp", response_model=MCPResponse)
async def mcp_endpoint(request: MCPRequest, _: bool = Depends(verify_token)):
    """
    Main MCP JSON-RPC 2.0 endpoint for news analysis
    Supports both single and batch processing
    """
    request_id = f"mcp_{request.id}_{datetime.utcnow().strftime('%H%M%S')}"
    
    try:
        logger.info(f"[{request_id}] MCP request: {request.method}")
        
        if request.method == "tools/call":
            params = request.params
            tool_name = params.get("name")
            
            if tool_name == "news_analysis":
                arguments = params.get("arguments", {})
                
                # Check if it's batch or single request
                if "news" in arguments:
                    # Batch processing
                    news_items = arguments["news"]
                    if not news_items or not isinstance(news_items, list):
                        raise HTTPException(400, "Invalid batch news format")
                    
                    results = await analyzer.analyze_batch(news_items, request_id)
                    
                    # Send webhook if configured
                    if webhook_manager:
                        await webhook_manager.send_batch_results(results, request_id)
                    
                    logger.info(f"[{request_id}] Batch analysis completed: {len(results)} items")
                    
                    return MCPResponse(
                        jsonrpc="2.0",
                        id=request.id,
                        result=results
                    )
                
                else:
                    # Single item processing
                    title = arguments.get("title", "")
                    summary = arguments.get("summary", "")
                    
                    if not title or not summary:
                        raise HTTPException(400, "Both 'title' and 'summary' required")
                    
                    result = await analyzer.analyze_single(title, summary, request_id)
                    
                    logger.info(f"[{request_id}] Single analysis completed")
                    
                    return MCPResponse(
                        jsonrpc="2.0",
                        id=request.id,
                        result=result.dict()
                    )
            
            else:
                raise HTTPException(400, f"Unknown tool: {tool_name}")
        
        elif request.method == "tools/list":
            # Return available tools
            tools = [{
                "name": "news_analysis",
                "description": "Analyze cryptocurrency news for sentiment and market impact (single or batch)",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "News headline (single mode)"},
                        "summary": {"type": "string", "description": "News description (single mode)"},
                        "news": {
                            "type": "array",
                            "description": "Array of news items for batch processing",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string"},
                                    "summary": {"type": "string"}
                                },
                                "required": ["title", "summary"]
                            }
                        }
                    }
                }
            }]
            
            return MCPResponse(
                jsonrpc="2.0",
                id=request.id,
                result={"tools": tools}
            )
        
        else:
            raise HTTPException(400, f"Unknown method: {request.method}")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[{request_id}] Error: {str(e)}")
        return MCPResponse(
            jsonrpc="2.0",
            id=request.id,
            error={
                "code": -32603,
                "message": "Internal error",
                "data": str(e)
            }
        )

@app.post("/analyze")
async def analyze_endpoint(
    request: BatchNewsRequest, 
    _: bool = Depends(verify_token)
):
    """REST endpoint for batch news analysis (n8n compatible)"""
    request_id = f"rest_{datetime.utcnow().strftime('%H%M%S%f')}"
    
    try:
        results = await analyzer.analyze_batch(request.news, request_id)
        
        # Send webhook if configured
        if webhook_manager:
            await webhook_manager.send_batch_results(results, request_id)
        
        return {"results": results, "request_id": request_id}
        
    except Exception as e:
        logger.error(f"[{request_id}] REST analysis error: {str(e)}")
        raise HTTPException(500, f"Analysis failed: {str(e)}")

@app.post("/webhook-test")
async def webhook_test(_: bool = Depends(verify_token)):
    """Test webhook functionality"""
    if not webhook_manager:
        raise HTTPException(400, "Webhook manager not configured")
    
    test_results = [{
        "impact": "Positive",
        "confidence": 95,
        "affected_coins": ["BTC"],
        "summary": "Test webhook notification",
        "lang": "en"
    }]
    
    await webhook_manager.send_batch_results(test_results, "webhook_test")
    return {"message": "Webhook test sent"}

@app.get("/metrics")
async def metrics():
    """Prometheus-style metrics endpoint"""
    if not cache_manager:
        return {"error": "Cache manager not available"}
    
    stats = await cache_manager.get_stats()
    return {
        "cache_hits": stats.get("hits", 0),
        "cache_misses": stats.get("misses", 0),
        "total_requests": stats.get("total", 0),
        "redis_connected": await cache_manager.is_connected()
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "mcp_news_main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info"
    )