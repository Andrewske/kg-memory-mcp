#!/usr/bin/env python3

"""
Simple HTTP Client Example for Knowledge Graph MCP Server

This example demonstrates basic usage of the HTTP API endpoints using Python.
Run with: python simple_client.py

Requirements:
    pip install requests
"""

import json
import requests
from typing import Dict, Any, Optional, List
from datetime import datetime

class KnowledgeGraphClient:
    def __init__(self, base_url: str = "http://localhost:3000/api", timeout: int = 30):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'X-MCP-Version': '2024-11-05',
            'User-Agent': 'KnowledgeGraph-Python-Client/1.0.0'
        })
    
    def _make_request(self, endpoint: str, method: str = 'GET', data: Optional[Dict] = None) -> Dict[str, Any]:
        """Make an HTTP request to the API"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == 'GET':
                response = self.session.get(url, timeout=self.timeout)
            elif method.upper() == 'POST':
                response = self.session.post(url, json=data, timeout=self.timeout)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            # Check HTTP status
            response.raise_for_status()
            
            # Parse JSON response
            result = response.json()
            
            # Check API success
            if not result.get('success', True):
                error_msg = result.get('error', {}).get('message', 'Unknown API error')
                raise RuntimeError(f"API Error: {error_msg}")
            
            return result.get('data', result)
            
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Request failed: {str(e)}")
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON response: {str(e)}")
    
    def health_check(self) -> Dict[str, Any]:
        """Check server health status"""
        return self._make_request('/health')
    
    def process_knowledge(self, text: str, source: str, 
                         thread_id: Optional[str] = None,
                         conversation_date: Optional[str] = None,
                         include_concepts: bool = True,
                         deduplicate: bool = True) -> Dict[str, Any]:
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
        
        return self._make_request('/process-knowledge', 'POST', data)
    
    def search_knowledge(self, query: str, 
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
        
        return self._make_request('/search-knowledge', 'POST', data)
    
    def search_concepts(self, query: str,
                       limit: int = 10,
                       threshold: float = 0.7) -> Dict[str, Any]:
        """Search concepts in the knowledge graph"""
        data = {
            'query': query,
            'limit': limit,
            'threshold': threshold
        }
        
        return self._make_request('/search-concepts', 'POST', data)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get knowledge graph statistics"""
        return self._make_request('/stats')
    
    def get_entities(self, role: str = 'both',
                    min_occurrence: int = 1,
                    limit: int = 100,
                    sort_by: str = 'frequency') -> Dict[str, Any]:
        """Get entities from the knowledge graph"""
        params = f"?role={role}&min_occurrence={min_occurrence}&limit={limit}&sort_by={sort_by}"
        return self._make_request(f'/entities{params}')
    
    def get_version(self) -> Dict[str, Any]:
        """Get server version information"""
        return self._make_request('/version')
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get server metrics"""
        return self._make_request('/metrics')


def main():
    # Initialize client
    client = KnowledgeGraphClient()
    
    try:
        print("🚀 Knowledge Graph MCP Server - Python Simple Client Example\n")
        
        # 1. Check server health
        print("1. Checking server health...")
        health = client.health_check()
        print(f"✅ Server is healthy: {health['status']}")
        print(f"   Database: {health['database']['status']}")
        print(f"   AI Provider: {health['aiProvider']['status']}")
        print()
        
        # 2. Get server information
        print("2. Getting server information...")
        version = client.get_version()
        print(f"✅ Server version: {version['version']}")
        print(f"   Node.js: {version['nodeVersion']}")
        print()
        
        # 3. Process some knowledge
        print("3. Processing knowledge...")
        process_result = client.process_knowledge(
            text="Michael is a cybersecurity expert at CrowdStrike. He specializes in threat detection and has 8 years of experience in information security. He recently developed a new malware analysis tool using machine learning algorithms.",
            source="python_simple_example",
            thread_id="demo_conversation",
            include_concepts=True
        )
        
        print("✅ Knowledge processed successfully:")
        print(f"   Triples stored: {process_result['triplesStored']}")
        print(f"   Concepts: {process_result['conceptsStored']}")
        print()
        
        # 4. Search the knowledge graph
        print("4. Searching knowledge graph...")
        search_result = client.search_knowledge(
            query="cybersecurity threat detection machine learning",
            limit=5,
            threshold=0.7
        )
        
        print("✅ Search completed:")
        print(f"   Found {len(search_result['results'])} relevant triples:")
        for i, result in enumerate(search_result['results'], 1):
            triple = result['triple']
            print(f"   {i}. {triple['subject']} → {triple['predicate']} → {triple['object']}")
            print(f"      Similarity: {result['similarity']:.3f} | Source: {triple['source']}")
        print()
        
        # 5. Search concepts
        print("5. Searching concepts...")
        concept_result = client.search_concepts(
            query="cybersecurity information security",
            limit=3,
            threshold=0.75
        )
        
        print("✅ Concept search completed:")
        print(f"   Found {len(concept_result['results'])} relevant concepts:")
        for i, result in enumerate(concept_result['results'], 1):
            concept = result['concept']
            print(f"   {i}. {concept['concept']} ({concept['abstraction_level']})")
            print(f"      Similarity: {result['similarity']:.3f}")
        print()
        
        # 6. Get statistics
        print("6. Getting knowledge graph statistics...")
        stats = client.get_stats()
        print("✅ Statistics retrieved:")
        print(f"   Total triples: {stats['totalTriples']}")
        print(f"   Total concepts: {stats['totalConcepts']}")
        print(f"   Unique sources: {stats['uniqueSources']}")
        print(f"   Unique entities: {stats['uniqueEntities']}")
        print()
        
        # 7. Enumerate entities
        print("7. Enumerating top entities...")
        entities = client.get_entities(limit=10, sort_by='frequency')
        print("✅ Top entities by frequency:")
        for i, entity in enumerate(entities['entities'][:5], 1):
            print(f"   {i}. {entity['entity']} (appears {entity['frequency']} times)")
        print()
        
        # 8. Get server metrics
        print("8. Getting server metrics...")
        metrics = client.get_metrics()
        print("✅ Server metrics:")
        print(f"   Uptime: {metrics['uptime']}")
        print(f"   Memory usage: {metrics['memoryUsage']['heapUsed'] / 1024 / 1024:.1f}MB")
        print(f"   CPU usage: {metrics.get('cpuUsage', 'N/A')}")
        print()
        
        print("🎉 All operations completed successfully!")
        
    except Exception as error:
        print(f"❌ Error: {error}")
        
        if "Connection refused" in str(error):
            print("💡 Make sure the Knowledge Graph MCP Server is running with HTTP transport enabled:")
            print("   ENABLE_HTTP_TRANSPORT=true pnpm run dev:http")
        
        exit(1)


if __name__ == "__main__":
    main()