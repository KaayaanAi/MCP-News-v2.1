"""
Redis Cache Manager for MCP-News v2.1
Handles caching, rate limiting, and statistics
"""

import os
import json
import logging
from typing import Optional, Dict, Any
import aioredis
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class CacheManager:
    """Redis-based cache and rate limiting manager"""
    
    def __init__(self):
        self.redis: Optional[aioredis.Redis] = None
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        self.stats = {"hits": 0, "misses": 0, "total": 0}
        
    async def connect(self):
        """Connect to Redis"""
        try:
            self.redis = aioredis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            
            # Test connection
            await self.redis.ping()
            logger.info("Redis connected successfully")
            
        except Exception as e:
            logger.error(f"Redis connection failed: {str(e)}")
            raise
    
    async def disconnect(self):
        """Disconnect from Redis"""
        if self.redis:
            await self.redis.close()
            logger.info("Redis disconnected")
    
    async def is_connected(self) -> bool:
        """Check Redis connection status"""
        if not self.redis:
            return False
        try:
            await self.redis.ping()
            return True
        except:
            return False
    
    async def get(self, key: str) -> Optional[Dict[str, Any]]:
        """Get cached value"""
        if not self.redis:
            return None
        
        try:
            value = await self.redis.get(key)
            if value:
                self.stats["hits"] += 1
                self.stats["total"] += 1
                return json.loads(value)
            else:
                self.stats["misses"] += 1
                self.stats["total"] += 1
                return None
                
        except Exception as e:
            logger.error(f"Cache get error: {str(e)}")
            return None
    
    async def set(self, key: str, value: Dict[str, Any], ttl: int = 43200):
        """Set cached value with TTL (default 12 hours)"""
        if not self.redis:
            return False
        
        try:
            await self.redis.setex(key, ttl, json.dumps(value, default=str))
            return True
        except Exception as e:
            logger.error(f"Cache set error: {str(e)}")
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete cached value"""
        if not self.redis:
            return False
        
        try:
            await self.redis.delete(key)
            return True
        except Exception as e:
            logger.error(f"Cache delete error: {str(e)}")
            return False
    
    async def check_rate_limit(self, identifier: str, limit: int = 100, window: int = 3600) -> bool:
        """
        Check rate limit for identifier
        Returns True if within limit, False if exceeded
        """
        if not self.redis:
            return True  # Allow if Redis unavailable
        
        try:
            key = f"rate_limit:{identifier}"
            current = await self.redis.get(key)
            
            if current is None:
                # First request
                await self.redis.setex(key, window, 1)
                return True
            
            current_count = int(current)
            if current_count >= limit:
                return False
            
            # Increment counter
            await self.redis.incr(key)
            return True
            
        except Exception as e:
            logger.error(f"Rate limit check error: {str(e)}")
            return True  # Allow on error
    
    async def get_rate_limit_status(self, identifier: str, window: int = 3600) -> Dict[str, int]:
        """Get current rate limit status for identifier"""
        if not self.redis:
            return {"count": 0, "remaining": 100, "reset_time": 0}
        
        try:
            key = f"rate_limit:{identifier}"
            current = await self.redis.get(key)
            ttl = await self.redis.ttl(key)
            
            count = int(current) if current else 0
            remaining = max(0, 100 - count)
            reset_time = int(datetime.utcnow().timestamp()) + ttl if ttl > 0 else 0
            
            return {
                "count": count,
                "remaining": remaining,
                "reset_time": reset_time
            }
            
        except Exception as e:
            logger.error(f"Rate limit status error: {str(e)}")
            return {"count": 0, "remaining": 100, "reset_time": 0}
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        stats = self.stats.copy()
        
        if self.redis:
            try:
                # Get Redis info
                info = await self.redis.info()
                stats.update({
                    "redis_memory": info.get("used_memory_human", "N/A"),
                    "redis_connected_clients": info.get("connected_clients", 0),
                    "redis_uptime": info.get("uptime_in_seconds", 0)
                })
            except Exception as e:
                logger.error(f"Failed to get Redis stats: {str(e)}")
        
        return stats
    
    async def flush_cache(self, pattern: str = None) -> int:
        """Flush cache entries matching pattern"""
        if not self.redis:
            return 0
        
        try:
            if pattern:
                keys = await self.redis.keys(pattern)
                if keys:
                    return await self.redis.delete(*keys)
                return 0
            else:
                await self.redis.flushdb()
                return 1
                
        except Exception as e:
            logger.error(f"Cache flush error: {str(e)}")
            return 0