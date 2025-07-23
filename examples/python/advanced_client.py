#!/usr/bin/env python3

"""
Advanced HTTP Client Example for Knowledge Graph MCP Server

This example demonstrates advanced features including:
- Async/await support with aiohttp
- Comprehensive error handling
- Retry logic with exponential backoff
- Rate limiting handling
- Connection pooling
- Batch processing
- Performance monitoring

Requirements:
    pip install aiohttp asyncio tenacity
"""

import asyncio
import json
import time
from datetime import datetime
from typing import Dict, Any, Optional, List, Union
from dataclasses import dataclass, field

import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type


@dataclass
class ClientStats:
    """Track client performance statistics"""
    requests: int = 0
    errors: int = 0
    total_time: float = 0.0
    retries: int = 0
    
    @property
    def average_response_time(self) -> float:
        return self.total_time / self.requests if self.requests > 0 else 0.0
    
    @property
    def error_rate(self) -> float:
        return (self.errors / self.requests * 100) if self.requests > 0 else 0.0


class KnowledgeGraphAdvancedClient:
    def __init__(self, 
                 base_url: str = "http://localhost:3000/api",
                 timeout: int = 30,
                 max_retries: int = 3,
                 retry_delay: float = 1.0,
                 api_key: Optional[str] = None,
                 connector_limit: int = 100):
        
        self.base_url = base_url.rstrip('/')
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.api_key = api_key
        
        # Performance tracking
        self.stats = ClientStats()
        
        # Session configuration
        connector = aiohttp.TCPConnector(
            limit=connector_limit,
            limit_per_host=20,
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )
        
        headers = {
            'Content-Type': 'application/json',
            'X-MCP-Version': '2024-11-05',
            'User-Agent': 'KnowledgeGraph-Advanced-Python-Client/1.0.0'
        }
        
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'
        
        self.session = aiohttp.ClientSession(
            connector=connector,
            headers=headers,
            timeout=self.timeout
        )
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
    
    async def close(self):
        """Close the HTTP session"""
        if self.session and not self.session.closed:
            await self.session.close()
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((aiohttp.ClientError, asyncio.TimeoutError))
    )
    async def _make_request(self, endpoint: str, method: str = 'GET', data: Optional[Dict] = None) -> Dict[str, Any]:
        """Make an HTTP request with retry logic"""
        start_time = time.time()
        self.stats.requests += 1
        
        url = f"{self.base_url}{endpoint}"
        
        try:
            print(f"📡 {method} {endpoint}")
            
            async with self.session.request(method, url, json=data) as response:
                response_data = await response.json()
                
                # Track timing
                duration = time.time() - start_time
                self.stats.total_time += duration
                
                # Handle rate limiting
                if response.status == 429:
                    retry_after = int(response.headers.get('Retry-After', 60))
                    print(f"⏳ Rate limited. Waiting {retry_after} seconds...")
                    await asyncio.sleep(retry_after)
                    self.stats.retries += 1
                    return await self._make_request(endpoint, method, data)
                
                # Handle HTTP errors
                if response.status >= 400:
                    error_msg = response_data.get('error', {}).get('message', f'HTTP {response.status}')
                    raise aiohttp.ClientResponseError(
                        request_info=response.request_info,
                        history=response.history,
                        status=response.status,
                        message=error_msg
                    )
                
                # Handle API errors
                if not response_data.get('success', True):
                    error_msg = response_data.get('error', {}).get('message', 'Unknown API error')
                    raise RuntimeError(f"API Error: {error_msg}")
                
                print(f"✅ Request completed in {duration*1000:.1f}ms")
                return response_data.get('data', response_data)
                
        except Exception as e:
            self.stats.errors += 1
            duration = time.time() - start_time
            self.stats.total_time += duration
            print(f"❌ Request failed after {duration*1000:.1f}ms: {str(e)}")
            raise
    
    async def health_check(self) -> Dict[str, Any]:
        """Check server health status"""
        return await self._make_request('/health')
    
    async def process_knowledge(self, text: str, source: str, 
                               thread_id: Optional[str] = None,
                               conversation_date: Optional[str] = None,
                               include_concepts: bool = True,
                               deduplicate: bool = True,
                               batch_id: Optional[str] = None) -> Dict[str, Any]:
        """Extract and store knowledge from text"""
        data = {
            'text': text,
            'source': source,
            'include_concepts': include_concepts,
            'deduplicate': deduplicate
        }
        
        if thread_id:
            data['thread_id'] = thread_id
        if conversation_date:
            data['conversation_date'] = conversation_date
        else:
            data['conversation_date'] = datetime.utcnow().isoformat() + 'Z'
        if batch_id:
            data['processing_batch_id'] = batch_id
        
        return await self._make_request('/process-knowledge', 'POST', data)
    
    async def search_knowledge(self, query: str, 
                              limit: int = 10,
                              threshold: float = 0.7,
                              types: Optional[List[str]] = None,
                              sources: Optional[List[str]] = None) -> Dict[str, Any]:
        """Search the knowledge graph"""
        data = {
            'query': query,
            'limit': limit,
            'threshold': threshold
        }
        
        if types:
            data['types'] = types
        if sources:
            data['sources'] = sources
        
        return await self._make_request('/search-knowledge', 'POST', data)
    
    async def search_concepts(self, query: str,
                             limit: int = 10,
                             threshold: float = 0.7) -> Dict[str, Any]:
        """Search concepts in the knowledge graph"""
        data = {
            'query': query,
            'limit': limit,
            'threshold': threshold
        }
        
        return await self._make_request('/search-concepts', 'POST', data)
    
    async def store_triples(self, triples: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Store pre-structured knowledge triples"""
        return await self._make_request('/store-triples', 'POST', {'triples': triples})
    
    async def deduplicate_triples(self, triples: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Deduplicate knowledge triples"""
        return await self._make_request('/deduplicate', 'POST', {'triples': triples})
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get knowledge graph statistics"""
        return await self._make_request('/stats')
    
    async def get_entities(self, role: str = 'both',
                          min_occurrence: int = 1,
                          limit: int = 100,
                          sort_by: str = 'frequency',
                          sources: Optional[List[str]] = None,
                          types: Optional[List[str]] = None) -> Dict[str, Any]:
        """Get entities from the knowledge graph"""
        params = [
            f"role={role}",
            f"min_occurrence={min_occurrence}",
            f"limit={limit}",
            f"sort_by={sort_by}"
        ]
        
        if sources:
            params.append(f"sources={','.join(sources)}")
        if types:
            params.append(f"types={','.join(types)}")
        
        query_string = '?' + '&'.join(params)
        return await self._make_request(f'/entities{query_string}')
    
    async def get_version(self) -> Dict[str, Any]:
        """Get server version information"""
        return await self._make_request('/version')
    
    async def get_metrics(self) -> Dict[str, Any]:
        """Get server metrics"""
        return await self._make_request('/metrics')
    
    async def get_capabilities(self) -> Dict[str, Any]:
        """Get server capabilities"""
        return await self._make_request('/capabilities')
    
    async def process_batch(self, items: List[Any], processor, concurrency: int = 3) -> Dict[str, Any]:
        """Process a batch of items with controlled concurrency"""
        semaphore = asyncio.Semaphore(concurrency)
        results = []
        errors = []
        
        print(f"📦 Processing batch of {len(items)} items with concurrency {concurrency}")
        
        async def process_item(item, index):
            async with semaphore:
                try:
                    result = await processor(item, index)
                    return {'success': True, 'index': index, 'result': result}
                except Exception as e:
                    return {'success': False, 'index': index, 'error': str(e)}
        
        # Process all items
        tasks = [process_item(item, i) for i, item in enumerate(items)]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Categorize results
        for result in batch_results:
            if isinstance(result, Exception):
                errors.append({'error': str(result)})
            elif result['success']:
                results.append(result)
            else:
                errors.append(result)
                print(f"❌ Batch item {result['index']} failed: {result['error']}")
        
        print(f"✅ Batch completed: {len(results)} succeeded, {len(errors)} failed")
        return {'results': results, 'errors': errors}
    
    def get_performance_stats(self) -> Dict[str, Union[int, float]]:
        """Get client performance statistics"""
        return {
            'total_requests': self.stats.requests,
            'total_errors': self.stats.errors,
            'total_retries': self.stats.retries,
            'average_response_time': round(self.stats.average_response_time * 1000, 1),  # ms
            'error_rate': round(self.stats.error_rate, 2),
            'total_time': round(self.stats.total_time, 2)
        }
    
    def reset_stats(self):
        """Reset performance statistics"""
        self.stats = ClientStats()


async def main():
    async with KnowledgeGraphAdvancedClient(
        base_url='http://localhost:3000/api',
        timeout=30,
        max_retries=3,
        retry_delay=1.0
    ) as client:
        
        try:
            print("🚀 Knowledge Graph MCP Server - Advanced Python Client Example\n")
            
            # 1. Health check and server info
            print("1. Performing health check and getting server info...")
            health, version, capabilities, metrics = await asyncio.gather(
                client.health_check(),
                client.get_version(),
                client.get_capabilities(),
                client.get_metrics()
            )
            
            print(f"✅ Server health: {health['status']}")
            print(f"✅ Server version: {version['version']}")
            print(f"✅ Available tools: {', '.join([tool['name'] for tool in capabilities['tools']])}")
            print(f"✅ Server uptime: {metrics['uptime']}")
            print()
            
            # 2. Batch processing example
            print("2. Demonstrating batch processing...")
            texts = [
                "Rachel is a data scientist at Netflix. She specializes in recommendation algorithms and machine learning.",
                "Tom works as a DevOps engineer at Spotify. He focuses on Kubernetes and infrastructure automation.",
                "Lisa is a product manager at Airbnb. She works on user experience and growth strategies.",
                "James is a security researcher at Google. He specializes in cryptography and secure systems.",
                "Anna is a frontend developer at Facebook. She works with React and modern web technologies."
            ]
            
            async def process_text(text, index):
                return await client.process_knowledge(
                    text, 
                    f'batch_example_{index}',
                    thread_id='advanced_demo',
                    include_concepts=True
                )
            
            batch_result = await client.process_batch(texts, process_text, concurrency=2)
            print(f"✅ Batch processing completed: {len(batch_result['results'])} items processed")
            print()
            
            # 3. Advanced search with multiple criteria
            print("3. Performing advanced search...")
            search_results = await client.search_knowledge(
                'data scientist machine learning DevOps Kubernetes',
                limit=10,
                threshold=0.6,
                types=['entity-entity', 'entity-event'],
                sources=[f'batch_example_{i}' for i in range(5)]
            )
            
            print(f"✅ Advanced search found {len(search_results['results'])} results")
            for i, result in enumerate(search_results['results'][:3], 1):
                triple = result['triple']
                print(f"   {i}. {triple['subject']} → {triple['predicate']} → {triple['object']}")
                print(f"      Score: {result['similarity']:.3f} | Type: {triple['type']}")
            print()
            
            # 4. Concurrent operations
            print("4. Performing concurrent operations...")
            stats_task = client.get_stats()
            entities_task = client.get_entities(role='both', min_occurrence=1, limit=20, sort_by='frequency')
            concepts_task = client.search_concepts('technology software programming', limit=5, threshold=0.7)
            
            stats, entities, concepts = await asyncio.gather(stats_task, entities_task, concepts_task)
            
            print("✅ Concurrent operations completed:")
            print(f"   Knowledge graph stats: {stats['totalTriples']} triples, {stats['totalConcepts']} concepts")
            print(f"   Top entities: {', '.join([e['entity'] for e in entities['entities'][:3]])}")
            print(f"   Related concepts: {', '.join([c['concept']['concept'] for c in concepts['results'][:3]])}")
            print()
            
            # 5. Error handling demonstration
            print("5. Demonstrating error handling...")
            try:
                # This should fail due to invalid parameters
                await client.search_knowledge("", limit=-1, threshold=2.0)
            except Exception as e:
                print(f"✅ Correctly handled invalid request: {type(e).__name__}")
            print()
            
            # 6. Performance statistics
            print("6. Performance statistics:")
            perf_stats = client.get_performance_stats()
            print("✅ Client performance:")
            for key, value in perf_stats.items():
                print(f"   {key.replace('_', ' ').title()}: {value}")
            print()
            
            print("🎉 Advanced Python client example completed successfully!")
            
        except Exception as error:
            print(f"❌ Critical error: {error}")
            
            if "Connection refused" in str(error):
                print("💡 Make sure the Knowledge Graph MCP Server is running with HTTP transport enabled:")
                print("   ENABLE_HTTP_TRANSPORT=true pnpm run dev:http")
            
            raise


if __name__ == "__main__":
    asyncio.run(main())