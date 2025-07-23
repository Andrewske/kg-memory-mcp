# MCP Integration Guide

This document provides complete instructions for integrating the Knowledge Graph MCP Server with external AI SDK projects.

## Prerequisites

- Node.js 18+ 
- PostgreSQL database
- OpenAI API key (required for embeddings)
- Anthropic API key (optional, alternative AI provider)

## Transport Options

The Knowledge Graph MCP Server supports multiple transport protocols:

1. **STDIO** (Default) - Traditional MCP protocol over standard input/output
2. **HTTP/REST** - RESTful API with OpenAPI documentation  
3. **SSE/MCP** - MCP protocol over Server-Sent Events
4. **Dual Mode** - Multiple transports simultaneously

### Quick Start Commands

```bash
# STDIO only (default MCP mode)
pnpm run dev:stdio

# HTTP only (REST API mode)  
pnpm run dev:http

# Both transports (dual mode)
pnpm run dev:dual

# Test the HTTP API
pnpm run test:http
```

## Installation in Your AI SDK Project

```bash
npm install @modelcontextprotocol/sdk
```

## Basic Integration

### 1. Create MCP Client

```javascript
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

class KnowledgeGraphMCP {
  constructor(serverPath, envVars = {}) {
    this.serverPath = serverPath;
    this.envVars = envVars;
    this.client = null;
    this.serverProcess = null;
  }

  async connect() {
    // Spawn the MCP server
    this.serverProcess = spawn('node', [this.serverPath], {
      stdio: 'pipe',
      env: { ...process.env, ...this.envVars },
    });

    // Create transport and client
    const transport = new StdioClientTransport(
      this.serverProcess.stdout, 
      this.serverProcess.stdin
    );
    
    this.client = new McpClient({
      name: 'ai-sdk-client',
      version: '1.0.0',
    });

    await this.client.connect(transport);
    
    // Handle server process errors
    this.serverProcess.on('error', (error) => {
      console.error('MCP Server process error:', error);
    });
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
    }
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
  }

  async callTool(name, args) {
    if (!this.client) {
      throw new Error('MCP client not connected');
    }
    
    const result = await this.client.callTool({ name, arguments: args });
    return JSON.parse(result.content[0].text);
  }
}
```

### 2. Initialize and Use

```javascript
// Initialize the MCP client
const mcpClient = new KnowledgeGraphMCP('/path/to/full-context-mcp/dist/index.js', {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/knowledge_graph',
  OPENAI_API_KEY: 'your-openai-api-key',
  // Optional: ANTHROPIC_API_KEY: 'your-anthropic-api-key'
});

// Connect to the server
await mcpClient.connect();

// Use the knowledge graph tools
try {
  // Extract knowledge from text
  const extractResult = await mcpClient.callTool('process_knowledge', {
    text: 'John works at OpenAI and lives in San Francisco.',
    source: 'example-conversation',
    thread_id: 'thread-123',
    conversation_date: new Date().toISOString()
  });
  
  console.log('Extracted knowledge:', extractResult);

  // Search the knowledge graph
  const searchResult = await mcpClient.callTool('search_knowledge_graph', {
    query: 'John OpenAI',
    limit: 5,
    threshold: 0.7
  });
  
  console.log('Search results:', searchResult);

} finally {
  await mcpClient.disconnect();
}
```

## HTTP/REST Integration

For projects that prefer HTTP/REST APIs over MCP protocol:

### 1. Start HTTP Server

```bash
# Start the server in HTTP mode
ENABLE_HTTP_TRANSPORT=true ENABLE_STDIO_TRANSPORT=false pnpm run dev

# Or use the convenience script
pnpm run dev:http
```

### 2. HTTP Client Example

```javascript
class KnowledgeGraphHTTP {
  constructor(baseUrl = 'http://localhost:3000/api') {
    this.baseUrl = baseUrl;
    this.headers = {
      'Content-Type': 'application/json',
      'X-MCP-Client-Name': 'your-client',
      'X-MCP-Client-Version': '1.0.0',
      'X-MCP-Version': '2024-11-05',
    };
  }

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: this.headers,
      ...options,
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Request failed');
    }
    
    return data;
  }

  async processKnowledge(payload) {
    return this.request('/process-knowledge', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async searchKnowledge(query, limit = 10, threshold = 0.7) {
    return this.request('/search-knowledge', {
      method: 'POST',
      body: JSON.stringify({ query, limit, threshold }),
    });
  }

  async getStats() {
    return this.request('/stats');
  }

  async getHealth() {
    return this.request('/health');
  }
}

// Usage
const httpClient = new KnowledgeGraphHTTP();

// Extract knowledge
const result = await httpClient.processKnowledge({
  text: 'John works at OpenAI and lives in San Francisco.',
  source: 'example-conversation',
});

// Search knowledge
const searchResults = await httpClient.searchKnowledge('John OpenAI', 5, 0.7);
```

### 3. cURL Examples

Complete cURL examples for testing HTTP endpoints:

**Process Knowledge with Concepts:**
```bash
curl -X POST http://localhost:3000/api/process-knowledge \
  -H "Content-Type: application/json" \
  -H "X-MCP-Version: 2024-11-05" \
  -d '{
    "text": "Sarah is a machine learning engineer at Google. She specializes in deep learning and has 5 years of experience with PyTorch. She recently published a paper on transformer architectures.",
    "source": "interview_notes",
    "thread_id": "interview_001", 
    "conversation_date": "2024-01-15T10:30:00Z",
    "include_concepts": true,
    "deduplicate": true
  }'
```

**Search Knowledge Graph:**
```bash
curl -X POST http://localhost:3000/api/search-knowledge \
  -H "Content-Type: application/json" \
  -d '{
    "query": "machine learning PyTorch deep learning",
    "limit": 10,
    "threshold": 0.75,
    "types": ["entity-entity", "entity-event"],
    "sources": ["interview_notes", "meeting_notes"]
  }'
```

**Search Concepts:**
```bash
curl -X POST http://localhost:3000/api/search-concepts \
  -H "Content-Type: application/json" \
  -d '{
    "query": "artificial intelligence machine learning",
    "limit": 5,
    "threshold": 0.8
  }'
```

**Store Pre-structured Triples:**
```bash
curl -X POST http://localhost:3000/api/store-triples \
  -H "Content-Type: application/json" \
  -d '{
    "triples": [
      {
        "subject": "Alice",
        "predicate": "works_at",
        "object": "OpenAI",
        "type": "entity-entity",
        "source": "linkedin_profile",
        "confidence": 0.95,
        "extracted_at": "2024-01-15T10:30:00Z"
      },
      {
        "subject": "Alice",
        "predicate": "specializes_in",
        "object": "natural language processing",
        "type": "entity-entity",
        "source": "linkedin_profile",
        "confidence": 0.90,
        "extracted_at": "2024-01-15T10:30:00Z"
      }
    ]
  }'
```

**Deduplicate Triples:**
```bash
curl -X POST http://localhost:3000/api/deduplicate \
  -H "Content-Type: application/json" \
  -d '{
    "triples": [
      {
        "subject": "John",
        "predicate": "works_at", 
        "object": "Google",
        "type": "entity-entity",
        "source": "conversation_1"
      },
      {
        "subject": "John Smith",
        "predicate": "employed_by",
        "object": "Google Inc",
        "type": "entity-entity", 
        "source": "conversation_2"
      }
    ]
  }'
```

**Get Statistics:**
```bash
curl -X GET http://localhost:3000/api/stats \
  -H "Accept: application/json"
```

**Enumerate Entities:**
```bash
curl -X GET "http://localhost:3000/api/entities?role=both&min_occurrence=2&limit=50&sort_by=frequency" \
  -H "Accept: application/json"
```

**Health Check:**
```bash
curl -X GET http://localhost:3000/api/health \
  -H "Accept: application/json"
```

**Version Information:**
```bash
curl -X GET http://localhost:3000/api/version \
  -H "Accept: application/json"
```

**System Metrics:**
```bash
curl -X GET http://localhost:3000/api/metrics \
  -H "Accept: application/json"
```

**API Capabilities:**
```bash
curl -X GET http://localhost:3000/api/capabilities \
  -H "Accept: application/json"
```

### 4. Error Handling Patterns

HTTP endpoints return consistent error responses:

**Success Response Format:**
```json
{
  "success": true,
  "data": {
    "triplesStored": 5,
    "conceptsStored": "processing in background",
    "metadata": {
      "processingTime": "2.3s",
      "source": "interview_notes"
    }
  }
}
```

**Error Response Format:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": [
      {
        "field": "text",
        "issue": "Text content is required"
      }
    ]
  }
}
```

**Common Error Codes:**
- `VALIDATION_ERROR` (400) - Invalid request parameters
- `UNAUTHORIZED` (401) - API key authentication failed (if enabled)
- `RATE_LIMITED` (429) - Too many requests
- `DATABASE_ERROR` (500) - Database connection or query failed
- `AI_PROVIDER_ERROR` (500) - AI API call failed
- `INTERNAL_ERROR` (500) - Unexpected server error

**Handle Errors in JavaScript:**
```javascript
async function safeAPICall(endpoint, options) {
  try {
    const response = await fetch(`http://localhost:3000/api${endpoint}`, options);
    const data = await response.json();
    
    if (!response.ok) {
      // Handle HTTP error status codes
      switch (response.status) {
        case 400:
          console.error('Validation error:', data.error.details);
          break;
        case 429:
          console.error('Rate limited. Retry after:', response.headers.get('Retry-After'));
          break;
        case 500:
          console.error('Server error:', data.error.message);
          break;
        default:
          console.error('Unexpected error:', data.error);
      }
      throw new Error(data.error.message);
    }
    
    if (!data.success) {
      // Handle application-level errors
      console.error('Application error:', data.error);
      throw new Error(data.error.message);
    }
    
    return data.data;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Cannot connect to knowledge graph server');
    }
    throw error;
  }
}
```

### 5. API Documentation

When running in HTTP mode, comprehensive API documentation is available:

- **OpenAPI Spec**: `http://localhost:3000/api/openapi.json`
- **Health Check**: `http://localhost:3000/api/health`
- **Metrics**: `http://localhost:3000/api/metrics`

## Server-Sent Events (SSE/MCP)

For real-time MCP protocol over HTTP:

### 1. Enable SSE Transport

```bash
# Set environment variables
export ENABLE_HTTP_TRANSPORT=true
export HTTP_ENABLE_SSE=true

# Start server
pnpm run dev:http
```

### 2. SSE/MCP Client Examples

**Full SSE/MCP Client:**
```javascript
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

class SSEKnowledgeGraphClient {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.client = null;
    this.transport = null;
  }

  async connect() {
    // Create SSE transport
    this.transport = new SSEClientTransport(`${this.baseUrl}/api/mcp`);
    
    // Create MCP client
    this.client = new McpClient({
      name: 'knowledge-graph-sse-client',
      version: '1.0.0',
    });

    // Connect with error handling
    try {
      await this.client.connect(this.transport);
      console.log('Connected to SSE/MCP endpoint');
      
      // List available tools
      const tools = await this.client.listTools();
      console.log('Available tools:', tools.tools.map(t => t.name));
      
    } catch (error) {
      console.error('SSE/MCP connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
    }
  }

  async processKnowledge(text, source, options = {}) {
    const result = await this.client.callTool({
      name: 'process_knowledge',
      arguments: {
        text,
        source,
        include_concepts: options.include_concepts || false,
        deduplicate: options.deduplicate !== false,
        thread_id: options.thread_id,
        conversation_date: options.conversation_date || new Date().toISOString(),
        ...options
      }
    });
    
    return JSON.parse(result.content[0].text);
  }

  async searchKnowledge(query, options = {}) {
    const result = await this.client.callTool({
      name: 'search_knowledge_graph',
      arguments: {
        query,
        limit: options.limit || 10,
        threshold: options.threshold || 0.7,
        types: options.types,
        sources: options.sources
      }
    });
    
    return JSON.parse(result.content[0].text);
  }

  async getStats() {
    const result = await this.client.callTool({
      name: 'get_knowledge_graph_stats',
      arguments: {}
    });
    
    return JSON.parse(result.content[0].text);
  }
}

// Usage example
const sseClient = new SSEKnowledgeGraphClient();

try {
  await sseClient.connect();
  
  // Process knowledge
  const processResult = await sseClient.processKnowledge(
    'John is a software engineer at Microsoft. He specializes in cloud architecture.',
    'sse_example',
    { include_concepts: true, thread_id: 'demo_thread' }
  );
  console.log('Process result:', processResult);
  
  // Search knowledge
  const searchResult = await sseClient.searchKnowledge(
    'software engineer cloud',
    { limit: 5, threshold: 0.8 }
  );
  console.log('Search results:', searchResult);
  
  // Get statistics
  const stats = await sseClient.getStats();
  console.log('Knowledge graph stats:', stats);
  
} catch (error) {
  console.error('SSE client error:', error);
} finally {
  await sseClient.disconnect();
}
```

**Browser SSE/MCP Client:**
```javascript
// For browser environments (needs bundling)
class BrowserSSEClient {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.eventSource = null;
    this.messageId = 0;
    this.pendingRequests = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.eventSource = new EventSource(`${this.baseUrl}/api/mcp`);
      
      this.eventSource.onopen = () => {
        console.log('SSE connection opened');
        this.sendInitialize();
        resolve();
      };
      
      this.eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        reject(error);
      };
      
      this.eventSource.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          this.handleResponse(response);
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      };
    });
  }

  sendInitialize() {
    const request = {
      jsonrpc: '2.0',
      id: ++this.messageId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'browser-sse-client',
          version: '1.0.0'
        }
      }
    };
    
    this.eventSource.send(JSON.stringify(request));
  }

  async callTool(name, args) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const request = {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name,
          arguments: args
        }
      };
      
      this.pendingRequests.set(id, { resolve, reject });
      this.eventSource.send(JSON.stringify(request));
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  handleResponse(response) {
    if (response.id && this.pendingRequests.has(response.id)) {
      const { resolve, reject } = this.pendingRequests.get(response.id);
      this.pendingRequests.delete(response.id);
      
      if (response.error) {
        reject(new Error(response.error.message));
      } else {
        resolve(response.result);
      }
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
    }
  }
}

// Usage in browser
const browserClient = new BrowserSSEClient();
await browserClient.connect();

const result = await browserClient.callTool('process_knowledge', {
  text: 'Example text',
  source: 'browser_client'
});
```

**Raw EventSource Example:**
```javascript
// Simple EventSource connection for testing
const eventSource = new EventSource('http://localhost:3000/api/mcp');

eventSource.onopen = () => {
  console.log('Connected to SSE endpoint');
  
  // Send MCP initialize message
  const initMessage = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  };
  
  // Note: EventSource doesn't support sending data
  // Use fetch for sending messages in browser environments
  fetch('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initMessage)
  });
};

eventSource.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log('SSE message received:', response);
};

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
};
```

## Available Tools

### 1. process_knowledge
Extract knowledge triples from text and store them.

```javascript
await mcpClient.callTool('process_knowledge', {
  text: 'Text content to analyze',           // Required
  source: 'conversation-id',                 // Required
  thread_id: 'thread-123',                   // Optional
  conversation_date: '2024-01-01T00:00:00Z', // Optional
  processing_batch_id: 'batch-456',         // Optional
  include_concepts: false,                   // Optional (default: false)
  deduplicate: true                          // Optional (default: true)
});
```

### 2. search_knowledge_graph
Search for relevant knowledge triples using semantic similarity.

```javascript
await mcpClient.callTool('search_knowledge_graph', {
  query: 'search query',                     // Required
  limit: 10,                                 // Optional (default: 10)
  threshold: 0.7                             // Optional (default: 0.0)
});
```

### 3. search_concepts
Search for concepts at different abstraction levels.

```javascript
await mcpClient.callTool('search_concepts', {
  query: 'concept search',                   // Required
  abstraction: 'high'                        // Optional: 'high', 'medium', 'low'
});
```

### 4. deduplicate_triples
Remove duplicate knowledge triples.

```javascript
await mcpClient.callTool('deduplicate_triples', {
  triples: [                                 // Required: array of triple objects
    {
      subject: 'John',
      predicate: 'works_at', 
      object: 'OpenAI',
      type: 'entity-entity',
      source: 'conversation',
      extracted_at: '2024-01-01T00:00:00Z',
      confidence: 0.9
    }
    // ... more triples
  ]
});
```

### 5. get_knowledge_graph_stats
Get statistics about the knowledge graph.

```javascript
await mcpClient.callTool('get_knowledge_graph_stats', {});
```

### 6. enumerate_entities
List entities in the knowledge graph with filtering options.

```javascript
await mcpClient.callTool('enumerate_entities', {
  role: 'both',                              // Optional: 'subject', 'object', 'both'
  min_occurrence: 1,                         // Optional: minimum occurrences
  sources: ['conversation-1', 'conversation-2'], // Optional: filter by sources
  types: ['entity-entity', 'entity-event'],  // Optional: filter by triple types
  limit: 100,                                // Optional: max results
  sort_by: 'frequency'                       // Optional: 'frequency', 'alphabetical', 'recent'
});
```

## Configuration

### Environment Variables

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key for embeddings

**Transport Configuration:**
- `ENABLE_STDIO_TRANSPORT` - Enable STDIO MCP transport (default: 'true')
- `ENABLE_HTTP_TRANSPORT` - Enable HTTP/REST transport (default: 'false')

**HTTP Transport Options:**
- `HTTP_PORT` - HTTP server port (default: 3000)
- `HTTP_BASE_PATH` - API base path (default: '/api')
- `HTTP_CORS_ORIGINS` - CORS origins (default: '*')
- `HTTP_ENABLE_SSE` - Enable SSE/MCP endpoint (default: 'true')
- `HTTP_RATE_LIMIT_WINDOW` - Rate limit window in minutes (default: 15)
- `HTTP_RATE_LIMIT_MAX` - Max requests per window (default: 100)

**AI & Knowledge Graph Options:**
- `ANTHROPIC_API_KEY` - Alternative AI provider
- `KG_EMBEDDING_MODEL` - Embedding model (default: 'text-embedding-3-small')
- `KG_EMBEDDING_DIMENSIONS` - Embedding dimensions (default: 1536)
- `KG_EXTRACTION_MODEL` - AI model for extraction (default: 'gpt-4o-mini')
- `KG_AI_PROVIDER` - AI provider: 'openai' or 'anthropic' (default: 'openai')

### Example Environment Setup

**STDIO Mode (Default):**
```bash
# Required
DATABASE_URL=postgresql://username:password@localhost:5432/knowledge_graph
OPENAI_API_KEY=sk-your-openai-api-key

# Transport (default values)
ENABLE_STDIO_TRANSPORT=true
ENABLE_HTTP_TRANSPORT=false
```

**HTTP Mode:**
```bash
# Required
DATABASE_URL=postgresql://username:password@localhost:5432/knowledge_graph
OPENAI_API_KEY=sk-your-openai-api-key

# HTTP Transport
ENABLE_HTTP_TRANSPORT=true
ENABLE_STDIO_TRANSPORT=false
HTTP_PORT=3000
HTTP_ENABLE_SSE=true

# Optional customization
KG_EMBEDDING_MODEL=text-embedding-3-large
KG_EXTRACTION_MODEL=gpt-4o
KG_AI_PROVIDER=openai
```

**Dual Mode (Both Transports):**
```bash
# Required
DATABASE_URL=postgresql://username:password@localhost:5432/knowledge_graph
OPENAI_API_KEY=sk-your-openai-api-key

# Both transports enabled
ENABLE_STDIO_TRANSPORT=true
ENABLE_HTTP_TRANSPORT=true
HTTP_PORT=3000
HTTP_ENABLE_SSE=true
```

## AI SDK Integration Example

### With Vercel AI SDK

```javascript
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';

// Initialize MCP client
const mcpClient = new KnowledgeGraphMCP(serverPath, envVars);
await mcpClient.connect();

// Define tools for the AI agent
const tools = {
  storeKnowledge: {
    description: 'Extract and store knowledge from text',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to extract knowledge from' },
        source: { type: 'string', description: 'Source identifier' }
      },
      required: ['text', 'source']
    },
    execute: async ({ text, source }) => {
      return await mcpClient.callTool('process_knowledge', { text, source });
    }
  },
  
  searchKnowledge: {
    description: 'Search the knowledge graph',
    parameters: {
      type: 'object', 
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    },
    execute: async ({ query }) => {
      return await mcpClient.callTool('search_knowledge_graph', { query });
    }
  }
};

// Use with AI SDK
const result = await generateObject({
  model: openai('gpt-4o'),
  tools,
  prompt: 'Process this conversation and search for related knowledge...'
});
```

## Error Handling

```javascript
try {
  await mcpClient.connect();
  
  const result = await mcpClient.callTool('process_knowledge', {
    text: 'Some text',
    source: 'test'
  });
  
  if (result.success) {
    console.log('Success:', result.data);
  } else {
    console.error('Tool error:', result.error);
  }
  
} catch (error) {
  console.error('Connection or execution error:', error);
} finally {
  await mcpClient.disconnect();
}
```

## Troubleshooting

### Common Issues

1. **Server fails to start**
   - Check that the built server exists at the specified path
   - Verify all required environment variables are set
   - Ensure PostgreSQL is running and accessible

2. **Connection timeout**
   - Verify the server path is correct
   - Check that Node.js can execute the server file
   - Look at server logs in `./logs/` directory

3. **Database errors**
   - Ensure PostgreSQL is running
   - Verify DATABASE_URL format: `postgresql://user:password@host:port/database`
   - Run database migrations: `pnpm run db:migrate`

4. **API key errors**
   - Verify OpenAI API key is valid and has sufficient credits
   - Check that the API key environment variable is correctly set

5. **HTTP transport issues**
   - Check if port 3000 is available or change `HTTP_PORT`
   - Verify firewall settings allow HTTP traffic
   - Test with `curl http://localhost:3000/api/health`
   - Check browser console for CORS errors

6. **SSE/MCP connection issues**
   - Ensure `HTTP_ENABLE_SSE=true` is set
   - Verify EventSource or SSE client can connect to `/api/mcp`
   - Check network connectivity and proxy settings

### Development vs Production

**Development Mode:**
- STDIO: `pnpm run dev:stdio` or `pnpm run dev`
- HTTP: `pnpm run dev:http`
- Both: `pnpm run dev:dual`

**Production Mode:**
- Build first: `pnpm run build`
- STDIO: `pnpm run start:stdio`
- HTTP: `pnpm run start:http`
- Both: `pnpm run start:dual`

**Manual Spawn (for external integration):**
```javascript
// Development
const serverPath = '/path/to/full-context-mcp/src/index.ts';
spawn('npx', ['tsx', serverPath], { env: { ...process.env, ENABLE_HTTP_TRANSPORT: 'true' } });

// Production
const serverPath = '/path/to/full-context-mcp/dist/index.js';
spawn('node', [serverPath], { env: { ...process.env, ENABLE_HTTP_TRANSPORT: 'true' } });
```

## Performance Considerations

**General:**
- **Batch Operations**: Use `process_knowledge` for multiple texts rather than individual calls
- **Background Processing**: Conceptualization runs in background when `include_concepts: true`
- **Database Indexing**: The server uses proper database indexes for efficient queries

**STDIO Transport:**
- **Connection Pooling**: Reuse MCP client connections when possible
- **Process Management**: Monitor child process health and restart if needed

**HTTP Transport:**
- **Keep-Alive**: HTTP connections use keep-alive by default
- **Rate Limiting**: Built-in rate limiting (configurable)
- **Compression**: Response compression enabled
- **Caching**: Use HTTP caching headers where appropriate
- **Load Balancing**: Multiple HTTP server instances can run on different ports

## Next Steps

1. **Set up your PostgreSQL database**
2. **Choose your transport method:**
   - **STDIO**: Traditional MCP for Claude Desktop or MCP clients
   - **HTTP**: REST API for web applications and standard HTTP clients
   - **SSE**: Real-time MCP over HTTP for browser-based applications
3. **Install dependencies** in your AI project (MCP SDK or HTTP client)
4. **Copy and adapt** the client code examples above
5. **Test** with simple knowledge extraction and search:
   - STDIO: `pnpm run test:mcp`
   - HTTP: `pnpm run test:http`
6. **Integrate** with your AI SDK workflow
7. **Monitor** using health/metrics endpoints (HTTP mode)
8. **Scale** using multiple instances or load balancing (HTTP mode)

## Additional Resources

- **API Documentation**: `http://localhost:3000/api/docs` (when running HTTP mode)
- **Source Code**: Main repository for implementation details
- **MCP Specification**: [Model Context Protocol documentation](https://spec.modelcontextprotocol.io/)
- **OpenAPI Spec**: `http://localhost:3000/api/openapi.json` (when running HTTP mode)