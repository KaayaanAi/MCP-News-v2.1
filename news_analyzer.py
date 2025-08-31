"""
Hybrid AI News Analysis Engine for MCP-News v2.1
Combines keyword filtering with LLM confirmation for cost-effective analysis
"""

import os
import re
import asyncio
import logging
from typing import List, Dict, Tuple, Optional
from datetime import datetime
import json
import aiohttp

from response_models import NewsAnalysisResponse, ImpactType
from cache_manager import CacheManager

logger = logging.getLogger(__name__)

class CryptoNewsAnalyzer:
    """
    Advanced cryptocurrency news analyzer with hybrid AI approach:
    Phase 1: Fast keyword filtering
    Phase 2: LLM confirmation for relevant/ambiguous cases
    """
    
    def __init__(self, cache_manager: CacheManager):
        self.cache = cache_manager
        
        # Positive sentiment keywords with weights
        self.positive_keywords = {
            'surge': 10, 'soar': 10, 'rally': 9, 'pump': 8, 'moon': 8,
            'bullish': 9, 'positive': 7, 'gain': 8, 'up': 6, 'rise': 7,
            'breakout': 9, 'adoption': 8, 'approval': 10, 'partnership': 8,
            'upgrade': 7, 'milestone': 8, 'breakthrough': 9, 'success': 8,
            'launch': 7, 'integration': 7, 'buy': 6, 'invest': 7,
            'green': 5, 'profit': 8, 'ath': 9, 'new high': 9
        }
        
        # Negative sentiment keywords with weights
        self.negative_keywords = {
            'crash': 10, 'dump': 9, 'drop': 8, 'fall': 7, 'decline': 7,
            'bearish': 9, 'negative': 7, 'loss': 8, 'down': 6, 'plunge': 9,
            'collapse': 10, 'hack': 10, 'scam': 10, 'fraud': 10, 'ban': 9,
            'regulation': 6, 'crackdown': 8, 'liquidation': 8, 'sell': 6,
            'red': 5, 'correction': 7, 'dip': 5, 'panic': 8, 'fear': 7
        }
        
        # Cryptocurrency patterns for detection
        self.crypto_patterns = {
            r'\bbtc\b|\bbitcoin\b': 'BTC',
            r'\beth\b|\bethereum\b': 'ETH', 
            r'\bbnb\b|\bbinance\b': 'BNB',
            r'\bada\b|\bcardano\b': 'ADA',
            r'\bsol\b|\bsolana\b': 'SOL',
            r'\bxrp\b|\bripple\b': 'XRP',
            r'\bdot\b|\bpolkadot\b': 'DOT',
            r'\bavax\b|\bavalanche\b': 'AVAX',
            r'\bmatic\b|\bpolygon\b': 'MATIC',
            r'\blink\b|\bchainlink\b': 'LINK'
        }
        
        # Language detection patterns
        self.arabic_pattern = re.compile(r'[\u0600-\u06FF]')
        
    async def analyze_single(self, title: str, summary: str, request_id: str) -> NewsAnalysisResponse:
        """Analyze single news item with caching"""
        
        # Create cache key
        cache_key = f"news:{hash(title + summary)}"
        
        # Check cache first
        cached_result = await self.cache.get(cache_key)
        if cached_result:
            logger.info(f"[{request_id}] Cache hit for analysis")
            return NewsAnalysisResponse(**cached_result)
        
        # Perform analysis
        result = await self._analyze_news_item(title, summary, request_id)
        
        # Cache result for 12 hours
        await self.cache.set(cache_key, result.dict(), ttl=43200)
        
        return result
    
    async def analyze_batch(self, news_items: List[Dict], request_id: str) -> List[Dict]:
        """Analyze batch of news items efficiently"""
        
        logger.info(f"[{request_id}] Starting batch analysis of {len(news_items)} items")
        
        # Process items concurrently
        tasks = []
        for i, item in enumerate(news_items):
            task = self._analyze_news_item(
                item.get('title', ''), 
                item.get('summary', ''), 
                f"{request_id}_item_{i}"
            )
            tasks.append(task)
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Convert results to dict format and handle exceptions
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"[{request_id}] Item {i} failed: {str(result)}")
                processed_results.append({
                    "impact": "Neutral",
                    "confidence": 0,
                    "affected_coins": [],
                    "summary": "Analysis failed",
                    "lang": "en",
                    "error": str(result)
                })
            else:
                processed_results.append(result.dict())
        
        logger.info(f"[{request_id}] Batch analysis completed")
        return processed_results
    
    async def _analyze_news_item(self, title: str, summary: str, item_id: str) -> NewsAnalysisResponse:
        """Core analysis logic for single news item"""
        
        # Combine title and summary for analysis
        full_text = f"{title} {summary}".lower()
        
        # Phase 1: Keyword-based analysis
        keyword_result = self._keyword_analysis(full_text)
        
        # Detect language
        lang = "ar" if self.arabic_pattern.search(title + summary) else "en"
        
        # Detect affected coins
        affected_coins = self._detect_coins(title + summary)
        
        # Phase 2: Determine if LLM analysis needed
        needs_llm = self._needs_llm_analysis(keyword_result, full_text)
        
        if needs_llm:
            # Try LLM analysis
            try:
                llm_result = await self._llm_analysis(title, summary, lang, item_id)
                if llm_result:
                    llm_result.affected_coins = affected_coins or llm_result.affected_coins
                    return llm_result
            except Exception as e:
                logger.warning(f"[{item_id}] LLM analysis failed: {str(e)}")
        
        # Fallback to keyword analysis
        impact, confidence = keyword_result
        
        # Generate summary
        summary_text = self._generate_summary(title, impact, confidence, lang)
        
        return NewsAnalysisResponse(
            impact=impact,
            confidence=min(confidence, 75),  # Cap keyword confidence
            affected_coins=affected_coins,
            summary=summary_text,
            lang=lang,
            low_confidence=True if confidence < 60 else False
        )
    
    def _keyword_analysis(self, text: str) -> Tuple[ImpactType, int]:
        """Fast keyword-based sentiment analysis"""
        
        positive_score = 0
        negative_score = 0
        
        # Score positive keywords
        for keyword, weight in self.positive_keywords.items():
            matches = len(re.findall(r'\b' + re.escape(keyword) + r'\b', text, re.IGNORECASE))
            positive_score += matches * weight
        
        # Score negative keywords
        for keyword, weight in self.negative_keywords.items():
            matches = len(re.findall(r'\b' + re.escape(keyword) + r'\b', text, re.IGNORECASE))
            negative_score += matches * weight
        
        # Determine impact and confidence
        if positive_score > negative_score and positive_score > 5:
            impact = ImpactType.POSITIVE
            confidence = min(positive_score * 2, 100)
        elif negative_score > positive_score and negative_score > 5:
            impact = ImpactType.NEGATIVE
            confidence = min(negative_score * 2, 100)
        else:
            impact = ImpactType.NEUTRAL
            confidence = 40 + abs(positive_score - negative_score)
        
        return impact, min(confidence, 85)
    
    def _needs_llm_analysis(self, keyword_result: Tuple[ImpactType, int], text: str) -> bool:
        """Determine if LLM analysis is needed"""
        
        impact, confidence = keyword_result
        
        # Always use LLM for low confidence cases
        if confidence < 60:
            return True
        
        # Use LLM for specific high-impact keywords
        high_impact_keywords = ['regulation', 'ban', 'approval', 'etf', 'sec', 'hack']
        if any(keyword in text for keyword in high_impact_keywords):
            return True
        
        # Skip LLM for very confident keyword results
        return False
    
    async def _llm_analysis(self, title: str, summary: str, lang: str, item_id: str) -> Optional[NewsAnalysisResponse]:
        """LLM-powered analysis using OpenAI or Claude"""
        
        # Check if LLM is configured
        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key:
            logger.warning(f"[{item_id}] No LLM API key configured")
            return None
        
        prompt = self._create_llm_prompt(title, summary, lang)
        
        try:
            async with aiohttp.ClientSession() as session:
                headers = {
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": "gpt-4",
                    "messages": [
                        {"role": "system", "content": "You are a cryptocurrency market analyst."},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 200,
                    "temperature": 0.1
                }
                
                async with session.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=10
                ) as response:
                    
                    if response.status != 200:
                        logger.error(f"[{item_id}] LLM API error: {response.status}")
                        return None
                    
                    data = await response.json()
                    result_text = data["choices"][0]["message"]["content"]
                    
                    # Parse LLM response
                    return self._parse_llm_response(result_text, lang)
        
        except Exception as e:
            logger.error(f"[{item_id}] LLM request failed: {str(e)}")
            return None
    
    def _create_llm_prompt(self, title: str, summary: str, lang: str) -> str:
        """Create prompt for LLM analysis"""
        
        return f"""Analyze this cryptocurrency news for market impact:

Title: {title}
Summary: {summary}

Respond with JSON format only:
{{
    "impact": "Positive|Negative|Neutral",
    "confidence": 0-100,
    "summary": "Brief summary for trading alerts",
    "reasoning": "Why this impact?"
}}

Focus on immediate market sentiment and price impact potential."""
    
    def _parse_llm_response(self, response: str, lang: str) -> Optional[NewsAnalysisResponse]:
        """Parse and validate LLM response"""
        
        try:
            # Extract JSON from response
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if not json_match:
                return None
            
            data = json.loads(json_match.group())
            
            return NewsAnalysisResponse(
                impact=ImpactType(data.get("impact", "Neutral")),
                confidence=min(max(data.get("confidence", 50), 0), 100),
                affected_coins=[],  # Will be filled by caller
                summary=data.get("summary", "Analysis completed"),
                lang=lang,
                low_confidence=False
            )
            
        except Exception as e:
            logger.error(f"Failed to parse LLM response: {str(e)}")
            return None
    
    def _detect_coins(self, text: str) -> List[str]:
        """Detect mentioned cryptocurrencies"""
        
        detected = []
        text_lower = text.lower()
        
        for pattern, coin in self.crypto_patterns.items():
            if re.search(pattern, text_lower):
                detected.append(coin)
        
        return list(set(detected))
    
    def _generate_summary(self, title: str, impact: ImpactType, confidence: int, lang: str) -> str:
        """Generate executive summary for broadcasting"""
        
        # Truncate title if too long
        short_title = title[:80] + "..." if len(title) > 80 else title
        
        confidence_text = "High" if confidence > 75 else "Medium" if confidence > 50 else "Low"
        
        if lang == "ar":
            return f"{short_title} - تأثير {impact.value} ({confidence_text} ثقة)"
        else:
            return f"{short_title} - {impact.value} impact ({confidence_text} confidence)"