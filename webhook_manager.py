"""
Webhook Manager for MCP-News v2.1
Handles webhook notifications for batch analysis results
"""

import os
import json
import logging
from typing import List, Dict, Any
from datetime import datetime
import aiohttp
from response_models import WebhookPayload

logger = logging.getLogger(__name__)

class WebhookManager:
    """Manages webhook notifications for analysis results"""
    
    def __init__(self):
        self.webhook_url = os.getenv("WEBHOOK_URL")
        self.webhook_secret = os.getenv("WEBHOOK_SECRET")
        self.enabled = bool(self.webhook_url)
        
        if self.enabled:
            logger.info("Webhook notifications enabled")
        else:
            logger.info("Webhook notifications disabled (no URL configured)")
    
    async def send_batch_results(self, results: List[Dict], request_id: str) -> bool:
        """Send batch analysis results via webhook"""
        
        if not self.enabled:
            return True  # Skip if disabled
        
        try:
            # Generate summary statistics
            summary_stats = self._generate_summary_stats(results)
            
            # Create webhook payload
            payload = WebhookPayload(
                request_id=request_id,
                timestamp=datetime.utcnow().isoformat() + "Z",
                total_items=len(results),
                results=results,
                summary_stats=summary_stats
            )
            
            # Send webhook
            success = await self._send_webhook(payload.dict())
            
            if success:
                logger.info(f"Webhook sent successfully for {request_id}")
            else:
                logger.error(f"Webhook failed for {request_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Webhook error for {request_id}: {str(e)}")
            return False
    
    async def _send_webhook(self, payload: Dict[str, Any]) -> bool:
        """Send HTTP webhook request"""
        
        try:
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "MCP-News-v2.1-Webhook"
            }
            
            # Add secret header if configured
            if self.webhook_secret:
                headers["X-Webhook-Secret"] = self.webhook_secret
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.webhook_url,
                    json=payload,
                    headers=headers,
                    timeout=10
                ) as response:
                    
                    if response.status in [200, 201, 202]:
                        return True
                    else:
                        logger.error(f"Webhook HTTP error: {response.status}")
                        return False
        
        except aiohttp.ClientTimeout:
            logger.error("Webhook timeout")
            return False
        except Exception as e:
            logger.error(f"Webhook request error: {str(e)}")
            return False
    
    def _generate_summary_stats(self, results: List[Dict]) -> Dict[str, int]:
        """Generate summary statistics from analysis results"""
        
        stats = {
            "positive": 0,
            "negative": 0,
            "neutral": 0,
            "high_confidence": 0,
            "low_confidence": 0,
            "errors": 0
        }
        
        for result in results:
            # Count impacts
            impact = result.get("impact", "Neutral").lower()
            if impact in stats:
                stats[impact] += 1
            
            # Count confidence levels
            confidence = result.get("confidence", 0)
            if confidence > 75:
                stats["high_confidence"] += 1
            else:
                stats["low_confidence"] += 1
            
            # Count errors
            if result.get("error"):
                stats["errors"] += 1
        
        return stats
    
    async def test_webhook(self) -> Dict[str, Any]:
        """Test webhook connectivity"""
        
        if not self.enabled:
            return {"status": "disabled", "message": "No webhook URL configured"}
        
        test_payload = {
            "test": True,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "service": "mcp-news-v2.1"
        }
        
        success = await self._send_webhook(test_payload)
        
        return {
            "status": "success" if success else "failed",
            "url": self.webhook_url,
            "message": "Test webhook sent" if success else "Test webhook failed"
        }