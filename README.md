# Knowledge Graph MCP Server

A high-performance Model Context Protocol (MCP) server for knowledge graph operations. This server provides comprehensive knowledge graph functionality including AI-powered triple extraction, semantic search, conceptualization, and advanced deduplication with PostgreSQL storage and vector embeddings.

## Features

- **🚀 Background Processing**: Fast response times with asynchronous conceptualization
- **🧠 AI-Powered Triple Extraction**: Extract knowledge relationships using OpenAI/Anthropic models
- **🔍 Semantic Search**: Vector-based similarity search with PostgreSQL and embeddings
- **📊 Conceptualization**: Generate hierarchical concept abstractions (high/medium/low levels)
- **🔄 Smart Deduplication**: Advanced duplicate detection with confidence scoring
- **⚡ High Performance**: Sub-second responses with background processing for heavy operations
- **🗄️ Robust Storage**: PostgreSQL with Prisma ORM for reliable data persistence
- **🔧 Pure Functional Architecture**: Stateless design with explicit dependencies

## Installation

### Prerequisites

- Node.js 18+ 
- PostgreSQL database
- OpenAI API key (required) and/or Anthropic API key (optional)

### Local Development

```bash
git clone <repository-url>
cd full-context-mcp
pnpm install
cp .env.example .env
# Edit .env with your configuration
pnpm run db:generate
pnpm run db:migrate
pnpm run build
```

## Configuration

### Required Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/knowledge_graph"

# AI APIs (at least one required)
OPENAI_API_KEY="your-openai-api-key"          # Required for embeddings
ANTHROPIC_API_KEY="your-anthropic-api-key"    # Optional alternative
```

### Optional Configuration

```bash
# AI Provider Settings
KNOWLEDGE_GRAPH_AI_PROVIDER="openai"                    # openai | anthropic
KNOWLEDGE_GRAPH_AI_MODEL="gpt-4o-mini"                 # AI model for extraction
KNOWLEDGE_GRAPH_EMBEDDING_MODEL="text-embedding-3-small" # OpenAI embedding model
KNOWLEDGE_GRAPH_EMBEDDING_DIMENSIONS=1536               # Embedding dimensions

# Processing Settings
KNOWLEDGE_GRAPH_EXTRACTION_MAX_TOKENS=4000              # Max tokens per extraction
KNOWLEDGE_GRAPH_DEDUP_SIMILARITY_THRESHOLD=0.85         # Deduplication threshold
KNOWLEDGE_GRAPH_DEDUP_BATCH_SIZE=50                     # Deduplication batch size

# Database Settings
KG_DB_CONNECTION_TIMEOUT=5000                           # Connection timeout (ms)
KG_DB_MAX_CONNECTIONS=10                                # Max database connections
```

### Database Setup

```bash
# Generate Prisma client
pnpm run db:generate

# Run database migrations
pnpm run db:migrate

# Optional: Open Prisma Studio
pnpm run db:studio
```

## Transport Options

This server supports **dual transport modes** for maximum flexibility:

### 🔗 STDIO Transport (Default)
Traditional MCP over stdin/stdout for direct integration with MCP clients like Claude Desktop.

### 🌐 HTTP Transport (Optional)
RESTful HTTP API with Server-Sent Events (SSE) support for web applications and HTTP-based integrations.

## HTTP Transport Setup

### Quick Start

```bash
# Enable HTTP transport
export ENABLE_HTTP_TRANSPORT=true
export HTTP_PORT=3000

# Start with HTTP support
pnpm run dev:http
# OR for production
pnpm run build && pnpm run start:http
```

The server will be available at:
- **REST API**: `http://localhost:3000/api/`
- **SSE/MCP Endpoint**: `http://localhost:3000/api/mcp`
- **Health Check**: `http://localhost:3000/api/health`
- **API Documentation**: `http://localhost:3000/api/openapi.json`

### HTTP Environment Configuration

Add these variables to your `.env` file:

```bash
# HTTP Transport (all optional)
ENABLE_HTTP_TRANSPORT=true              # Enable HTTP server
HTTP_PORT=3000                          # Server port
HTTP_BASE_PATH=/api                     # API base path
HTTP_CORS_ORIGINS=*                     # CORS origins (* for development)
HTTP_RATE_LIMIT_WINDOW=15               # Rate limit window (minutes)
HTTP_RATE_LIMIT_MAX=100                 # Max requests per window
HTTP_ENABLE_SSE=true                    # Enable SSE/MCP endpoint
```

### Dual Transport Mode

Run both STDIO and HTTP simultaneously:

```bash
# Development
pnpm run dev:dual

# Production
pnpm run build && pnpm run start:dual
```

This allows:
- **STDIO**: For Claude Desktop and MCP client integration
- **HTTP**: For web applications and REST API access

### HTTP API Endpoints

#### REST API (Stateless)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/process-knowledge` | POST | Extract and store knowledge with background concepts |
| `/api/search-knowledge` | POST | Search knowledge graph by similarity |
| `/api/search-concepts` | POST | Search conceptual abstractions |
| `/api/deduplicate` | POST | Deduplicate knowledge triples |
| `/api/stats` | GET | Get comprehensive knowledge graph statistics |
| `/api/entities` | GET | Enumerate unique entities in the graph |

#### Monitoring & Documentation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check with database/AI status |
| `/api/version` | GET | Server version information |
| `/api/capabilities` | GET | Available MCP tools list |
| `/api/metrics` | GET | System performance metrics |
| `/api/openapi.json` | GET | OpenAPI 3.0 specification |

#### MCP over HTTP/SSE

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mcp` | GET | Server-Sent Events MCP protocol endpoint |

### HTTP Usage Examples

#### cURL Examples

**Process Knowledge:**
```bash
curl -X POST http://localhost:3000/api/process-knowledge \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Alice is a machine learning engineer at Google. She specializes in deep learning and loves PyTorch.",
    "source": "example_conversation",
    "include_concepts": true,
    "deduplicate": true
  }'
```

**Search Knowledge:**
```bash
curl -X POST http://localhost:3000/api/search-knowledge \
  -H "Content-Type: application/json" \
  -d '{
    "query": "machine learning deep learning",
    "limit": 10,
    "threshold": 0.7,
    "types": ["entity-entity", "entity-event"]
  }'
```

**Get Statistics:**
```bash
curl http://localhost:3000/api/stats
```

**Health Check:**
```bash
curl http://localhost:3000/api/health
```

#### Claude Code Integration

Add HTTP transport to Claude Code:

```bash
claude mcp add --transport http knowledge-graph http://localhost:3000/mcp
```

### HTTP vs STDIO Comparison

| Feature | STDIO Transport | HTTP Transport |
|---------|----------------|----------------|
| **Use Case** | MCP clients, Claude Desktop | Web apps, REST APIs, HTTP clients |
| **Protocol** | MCP over stdin/stdout | REST + MCP over SSE |
| **Performance** | Lowest latency | ~5-10ms overhead |
| **Scalability** | Single client | Multiple concurrent clients |
| **Web Integration** | Not directly accessible | Direct browser/web access |
| **Monitoring** | Limited | Rich endpoints (/health, /metrics) |
| **Documentation** | MCP introspection | OpenAPI specification |
| **Security** | Process isolation | CORS, rate limiting, headers |

### Production Considerations

**Security:**
- Rate limiting: 100 requests per 15 minutes (configurable)
- CORS protection with configurable origins
- Security headers via Helmet middleware
- Input validation on all endpoints

**Performance:**
- Gzip compression for responses
- Background processing for heavy operations
- Database connection pooling
- Efficient vector similarity search

**Monitoring:**
- Health checks for database and AI services
- Comprehensive metrics endpoint
- Request/response logging
- Error tracking and reporting

## Usage

### Development

```bash
# Development with hot reload
pnpm run dev

# Production build and start
pnpm run build
pnpm run start

# Run tests
pnpm run test
pnpm run test:watch

# Code quality checks
pnpm run lint
pnpm run format
pnpm run check
```

### As an MCP Server

The server communicates via stdio using the Model Context Protocol. It automatically starts when executed and provides 6 main tools for knowledge graph operations.

**⚡ Performance Note**: The `process_knowledge` tool now features **background processing** for conceptualization, providing immediate responses (~2-5 seconds) while concepts are generated asynchronously.

### Available Tools

#### 1. `process_knowledge` 🚀 *NEW: Background Processing*

Extract and store knowledge triples with optional conceptualization. **Features background processing** for fast responses.

**Parameters:**
- `text` (required): Text content to process
- `source` (required): Source identifier  
- `thread_id` (optional): Thread grouping identifier
- `conversation_date` (optional): ISO date string
- `processing_batch_id` (optional): Batch processing identifier
- `include_concepts` (optional): Generate concepts in background (default: false)
- `deduplicate` (optional): Remove duplicates (default: true)

**Performance:**
- **Without concepts**: ~2-5 seconds
- **With concepts**: ~2-5 seconds response + background processing
- **Background logging**: Monitor conceptualization progress in console

**Example:**
```json
{
  "text": "John is a software engineer at Google. He loves TypeScript and works on AI projects.",
  "source": "conversation_001", 
  "include_concepts": true,
  "deduplicate": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "triplesStored": 4,
    "conceptsStored": "processing in background",
    "metadata": {...}
  }
}
```

#### 2. `search_knowledge_graph`

Search for relevant knowledge triples using vector similarity.

**Parameters:**
- `query` (required): Search query
- `limit` (optional): Maximum results (default: 10)
- `threshold` (optional): Similarity threshold (default: 0.0)
- `types` (optional): Filter by triple types (`entity-entity`, `entity-event`, `event-event`, `emotional-context`)
- `sources` (optional): Filter by sources

**Example:**
```json
{
  "query": "software engineering TypeScript",
  "limit": 5,
  "threshold": 0.7,
  "types": ["entity-entity", "entity-event"]
}
```

#### 3. `search_concepts`

Search for concepts in the knowledge graph.

**Parameters:**
- `query` (required): Search query
- `limit` (optional): Maximum results (default: 10)
- `threshold` (optional): Similarity threshold (default: 0.0)

#### 4. `store_knowledge_triples`

Directly store pre-structured knowledge triples.

**Parameters:**
- `triples` (required): Array of knowledge triples with required fields:
  - `subject`, `predicate`, `object` (strings)
  - `type` (one of: `entity-entity`, `entity-event`, `event-event`, `emotional-context`)
  - `source` (string)
  - Optional: `thread_id`, `conversation_date`, `processing_batch_id`, `confidence`

#### 5. `deduplicate_triples`

Deduplicate and normalize knowledge triples.

**Parameters:**
- `triples` (required): Array of knowledge triples

#### 6. `get_knowledge_graph_stats`

Get comprehensive statistics about the knowledge graph.

**Returns:**
- Total triples count by type
- Total concepts count by abstraction level
- Unique sources and entities
- Database performance metrics
- Last updated timestamps
- Configuration summary

## Knowledge Graph Schema

### Triple Types

The system recognizes four types of knowledge relationships:

#### 1. **Entity-Entity** (`entity-entity`)
Relationships between people, places, organizations, tools, concepts
- Examples: "John works at Google", "TypeScript is a programming language"

#### 2. **Entity-Event** (`entity-event`) 
Relationships between entities and activities/experiences
- Examples: "John implemented the API", "Google launched the product"

#### 3. **Event-Event** (`event-event`)
Temporal, causal, or contextual relationships between events
- Examples: "Learning TypeScript led to joining the team", "The meeting resulted in the decision"

#### 4. **Emotional-Context** (`emotional-context`)
Emotional states, preferences, mental patterns, attitudes
- Examples: "John loves TypeScript", "The team feels excited about the project"

### Conceptualization Levels

**Concept Abstraction Hierarchy:**
- **High**: Abstract domains and fields ("Software Engineering", "Technology")
- **Medium**: Specific technologies and practices ("Web Development", "TypeScript Programming")
- **Low**: Concrete tools and instances ("VS Code", "React Components")

### Data Structure

### Data Structures

**Knowledge Triple:**
```typescript
interface KnowledgeTriple {
  subject: string;                    // Entity or event performing the action
  predicate: string;                  // Relationship or action
  object: string;                     // Target entity, event, or attribute
  type: TripleType;                   // Classification of relationship
  source: string;                     // Source identifier
  thread_id?: string;                 // Conversation thread grouping
  conversation_date?: string;         // ISO date string
  extracted_at: string;               // Extraction timestamp
  processing_batch_id?: string;       // Batch processing identifier
  confidence?: number;                // AI confidence score (0-1)
}

type TripleType = 
  | 'entity-entity' 
  | 'entity-event' 
  | 'event-event' 
  | 'emotional-context';
```

**Concept Node:**
```typescript
interface ConceptNode {
  concept: string;                           // Abstract concept name
  abstraction_level: 'high' | 'medium' | 'low'; // Hierarchy level
  confidence: number;                        // AI confidence score (0-1)
  source: string;                            // Source identifier
  extracted_at: string;                      // Extraction timestamp
  processing_batch_id?: string;              // Batch processing identifier
  reasoning?: string;                        // AI reasoning for concept
}
```

**Conceptualization Relationship:**
```typescript
interface ConceptualizationRelationship {
  source_element: string;              // Original triple element
  source_type: 'entity' | 'event' | 'relation'; // Element type
  concept: string;                     // Abstract concept
  confidence: number;                  // Relationship confidence
  reasoning?: string;                  // AI reasoning
}
```

## Architecture

### 🏗️ Pure Functional Architecture

The system follows a **stateless functional design** with explicit dependencies:

- **No Hidden State**: All dependencies passed as parameters
- **Pure Functions**: Predictable inputs/outputs without side effects
- **No Factory Functions**: Direct function exports instead of `createXOperations`
- **Database-First**: All persistence handled by PostgreSQL with proper indexes
- **Explicit Error Handling**: Result types instead of exceptions

### 📁 Project Structure

```
src/
├── features/                    # Feature modules (pure functions)
│   ├── knowledge-extraction/    # AI-powered triple extraction  
│   ├── conceptualization/       # Concept hierarchy generation
│   ├── deduplication/           # Smart duplicate detection
│   └── knowledge-graph/         # Core graph operations & search
├── shared/                      # Shared infrastructure
│   ├── database/               # PostgreSQL adapter with Prisma
│   ├── services/               # AI provider & embedding services
│   ├── types/                  # TypeScript definitions
│   └── utils/                  # Utility functions
└── server/                     # MCP server implementation
    └── mcp-server.ts          # Lightweight server with direct calls
```

### 🗄️ Storage & Performance

**Database:**
- **PostgreSQL** with Prisma ORM for robust ACID transactions
- **Vector Storage** for embeddings with similarity search
- **Optimized Indexes** for fast queries across all triple fields
- **Migration System** for schema evolution

**Background Processing:**
- **Asynchronous Conceptualization** using `setImmediate()`
- **Non-blocking Responses** for immediate user feedback
- **Error Isolation** preventing background failures from affecting main flow
- **Progress Logging** for monitoring background tasks

### 🔍 Search Strategy

**Vector-Based Similarity Search:**
1. **Text Embedding**: Convert queries to OpenAI embeddings
2. **Cosine Similarity**: Find semantically similar triples
3. **Multi-field Search**: Search across subject, predicate, object
4. **Concept Integration**: Include conceptual abstractions
5. **Threshold Filtering**: Configurable similarity thresholds
6. **Result Ranking**: Ordered by relevance scores

## Performance & Scaling

### ⚡ Performance Characteristics

**Response Times:**
- **Knowledge Processing**: 2-5 seconds (immediate) + background conceptualization
- **Search Queries**: <500ms for typical datasets
- **Stats Retrieval**: <100ms
- **Deduplication**: Batched processing with configurable thresholds

**Background Processing Benefits:**
- ✅ **No Timeout Errors**: Conceptualization runs asynchronously 
- ✅ **Immediate Feedback**: Users get responses right away
- ✅ **Resource Efficiency**: Heavy AI operations don't block the server
- ✅ **Error Resilience**: Background failures don't affect main operations

### 🚀 Optimization Features

**Database Optimizations:**
- **Connection Pooling**: Configurable max connections
- **Query Optimization**: Proper indexes on all searchable fields
- **Batch Operations**: Efficient bulk inserts and updates
- **Transaction Management**: ACID compliance for data integrity

**AI API Efficiency:**
- **On-Demand Embeddings**: Generated when needed, stored in database
- **Configurable Models**: Choose optimal models for your use case
- **Error Handling**: Robust retry logic and graceful degradation
- **Rate Limiting**: Built-in AI API throttling protection

### 📈 Scaling Considerations

**Storage:**
- **PostgreSQL**: Scales to millions of triples with proper indexing
- **Vector Storage**: Efficient similarity search with configurable dimensions
- **Backup & Recovery**: Standard PostgreSQL tooling

**Compute:**
- **Stateless Design**: Easy horizontal scaling
- **Background Processing**: CPU-intensive tasks don't block responses
- **Memory Efficiency**: No in-memory caches, database handles persistence

**Monitoring:**
- **Console Logging**: Background task progress and errors
- **Database Metrics**: Query performance and connection usage
- **AI API Usage**: Token consumption and rate limiting

## Development

### 🛠️ Development Workflow

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Database setup
pnpm run db:generate    # Generate Prisma client
pnpm run db:migrate     # Run migrations
pnpm run db:studio      # Optional: Open Prisma Studio

# Development
pnpm run dev            # Hot reload development server
pnpm run build          # TypeScript compilation
pnpm run start          # Production server

# Testing
pnpm run test           # Run Jest tests
pnpm run test:watch     # Watch mode
pnpm run test:unit      # Unit tests only

# Code Quality
pnpm run lint           # Biome linting
pnpm run format         # Biome formatting
pnpm run check          # Full check (lint + typecheck)

# Testing Integration
./scripts/test-client.mjs    # Test MCP client integration
```

### 🧪 Testing Strategy

**Unit Tests:**
- Pure function testing with mock dependencies
- No database or AI API calls in unit tests
- Fast execution with Jest

**Integration Tests:**
- Full flow testing with real database
- AI API mocking for reproducible results
- Background processing verification

**Manual Testing:**
```bash
# Use development mode to test path resolution
pnpm run dev

# Test with MCP inspector
pnpm run server:inspect
```

## Integration

### 🤖 Claude Desktop Integration

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "knowledge-graph": {
      "command": "node",
      "args": ["path/to/full-context-mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/knowledge_graph",
        "OPENAI_API_KEY": "your-openai-api-key",
        "ANTHROPIC_API_KEY": "your-anthropic-api-key"
      }
    }
  }
}
```

**Development Mode (recommended for testing):**
```json
{
  "mcpServers": {
    "knowledge-graph": {
      "command": "npx",
      "args": ["tsx", "path/to/full-context-mcp/src/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/knowledge_graph",
        "OPENAI_API_KEY": "your-openai-api-key"
      }
    }
  }
}
```

### 🔌 Custom MCP Client Integration

The server communicates via stdio using the Model Context Protocol:

```typescript
import { spawn } from 'child_process';

// Start the server
const server = spawn('npx', ['tsx', 'src/index.ts'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    DATABASE_URL: 'your-database-url',
    OPENAI_API_KEY: 'your-api-key'
  }
});

// Send MCP requests
const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'process_knowledge',
    arguments: {
      text: 'Your text here',
      source: 'your-app',
      include_concepts: true
    }
  }
};

server.stdin.write(JSON.stringify(request) + '\n');
```

### 🎯 Usage Examples

**Extract Knowledge:**
```bash
# Process text and generate concepts in background
curl -X POST localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "process_knowledge",
      "arguments": {
        "text": "Sarah is a data scientist at OpenAI. She specializes in machine learning and loves Python programming.",
        "source": "example",
        "include_concepts": true
      }
    }
  }'
```

**Search Knowledge:**
```bash
# Search for related information
curl -X POST localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "search_knowledge_graph",
      "arguments": {
        "query": "machine learning Python",
        "limit": 10,
        "threshold": 0.7
      }
    }
  }'
```

## Troubleshooting

### 🐛 Common Issues

**Path Resolution Errors:**
```bash
# Use development mode to avoid TypeScript path mapping issues
pnpm run dev
# OR build first for production
pnpm run build && pnpm run start
```

**Database Connection Issues:**
```bash
# Check database is running
psql $DATABASE_URL -c "SELECT 1;"

# Regenerate Prisma client
pnpm run db:generate

# Reset database if needed
pnpm run db:reset
```

**Background Processing Not Working:**
- Check console logs for `[Background]` messages
- Verify AI API keys are set correctly
- Ensure database is accessible for background tasks

**Performance Issues:**
- Monitor PostgreSQL query performance
- Check embedding API rate limits
- Verify proper database indexes are in place

### 📊 Monitoring

**Console Output:**
```
[Background] Starting conceptualization for 5 triples...
[Background] Successfully stored 23 concepts and 15 relationships
```

**Database Queries:**
```bash
# Check triple count
psql $DATABASE_URL -c "SELECT COUNT(*) FROM triples;"

# Check concept count by level
psql $DATABASE_URL -c "SELECT abstraction_level, COUNT(*) FROM concepts GROUP BY abstraction_level;"
```

## Contributing

### 🤝 Development Guidelines

1. **Pure Functions**: All new features should follow the stateless functional architecture
2. **Explicit Dependencies**: Pass all dependencies as function parameters
3. **Error Handling**: Use Result types, avoid throwing exceptions
4. **Testing**: Add unit tests for pure functions, integration tests for full flows
5. **TypeScript**: Maintain strict typing with comprehensive type definitions

### 🔄 Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes following the architecture guidelines
4. Add tests: `pnpm run test`
5. Run quality checks: `pnpm run check`
6. Update documentation if needed
7. Submit a pull request with detailed description

### 📋 Code Style

- **Biome** for linting and formatting
- **TypeScript strict mode** with comprehensive typing
- **Functional programming** patterns preferred
- **No global state** or hidden mutations
- **Database-first** approach for all persistence

## License

MIT License - see LICENSE file for details.

## Support

- **Issues**: Use the GitHub issue tracker
- **Discussions**: GitHub Discussions for questions and ideas
- **Documentation**: This README and inline code comments
- **Examples**: See `/scripts/test-client.mjs` for integration examples