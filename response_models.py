"""
Pydantic models for MCP-News v2.1
Defines request/response schemas and validation
"""

from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field, validator
from enum import Enum

class ImpactType(str, Enum):
    POSITIVE = "Positive"
    NEGATIVE = "Negative"
    NEUTRAL = "Neutral"

class NewsItem(BaseModel):
    """Single news item for analysis"""
    title: str = Field(..., min_length=1, max_length=500, description="News headline")
    summary: str = Field(..., min_length=1, max_length=2000, description="News description")

class NewsAnalysisResponse(BaseModel):
    """Response model for news analysis results"""
    impact: ImpactType = Field(..., description="Market impact assessment")
    confidence: int = Field(..., ge=0, le=100, description="Confidence score 0-100")
    affected_coins: List[str] = Field(default_factory=list, description="List of affected cryptocurrencies")
    summary: str = Field(..., description="Executive summary for broadcasting")
    lang: str = Field(default="en", description="Detected language code")
    low_confidence: Optional[bool] = Field(default=False, description="Flag for keyword-only analysis")
    error: Optional[str] = Field(default=None, description="Error message if LLM failed")
    
    @validator('affected_coins')
    def validate_coins(cls, v):
        # Convert to uppercase and remove duplicates
        return list(set([coin.upper() for coin in v if coin]))

class SingleNewsRequest(BaseModel):
    """Request for single news analysis"""
    title: str = Field(..., min_length=1, max_length=500)
    summary: str = Field(..., min_length=1, max_length=2000)

class BatchNewsRequest(BaseModel):
    """Request for batch news analysis"""
    news: List[NewsItem] = Field(..., min_items=1, max_items=50, description="Batch of news items")

class MCPRequest(BaseModel):
    """MCP JSON-RPC 2.0 request model"""
    jsonrpc: str = Field(default="2.0", description="JSON-RPC version")
    id: Union[str, int] = Field(..., description="Request ID")
    method: str = Field(..., description="RPC method name")
    params: Dict[str, Any] = Field(default_factory=dict, description="Method parameters")

class MCPResponse(BaseModel):
    """MCP JSON-RPC 2.0 response model"""
    jsonrpc: str = Field(default="2.0", description="JSON-RPC version")
    id: Union[str, int] = Field(..., description="Request ID")
    result: Optional[Any] = Field(default=None, description="Success result")
    error: Optional[Dict[str, Any]] = Field(default=None, description="Error details")

class HealthResponse(BaseModel):
    """Health check response model"""
    status: str = Field(..., description="Service health status")
    service: str = Field(..., description="Service name")
    version: str = Field(..., description="Service version")
    timestamp: str = Field(..., description="Current timestamp")
    redis_status: Optional[str] = Field(default=None, description="Redis connection status")
    uptime: Optional[str] = Field(default=None, description="Service uptime")

class WebhookPayload(BaseModel):
    """Webhook notification payload"""
    request_id: str = Field(..., description="Analysis request ID")
    timestamp: str = Field(..., description="Analysis completion time")
    total_items: int = Field(..., description="Number of analyzed items")
    results: List[NewsAnalysisResponse] = Field(..., description="Analysis results")
    summary_stats: Dict[str, int] = Field(default_factory=dict, description="Summary statistics")

class CacheStats(BaseModel):
    """Cache statistics model"""
    hits: int = Field(default=0, description="Cache hit count")
    misses: int = Field(default=0, description="Cache miss count")
    total: int = Field(default=0, description="Total requests")
    hit_ratio: float = Field(default=0.0, description="Cache hit ratio")
    
    @validator('hit_ratio', always=True)
    def calculate_hit_ratio(cls, v, values):
        total = values.get('total', 0)
        hits = values.get('hits', 0)
        return round(hits / total, 3) if total > 0 else 0.0