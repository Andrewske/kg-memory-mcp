# Knowledge Graph MCP Server

<div align="center">

[![MCP Protocol](https://img.shields.io/badge/Protocol-MCP-brightgreen)](https://github.com/modelcontextprotocol)
[![TypeScript](https://img.shields.io/badge/TypeScript-ES2022-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Prisma-336791)](https://www.prisma.io/)
[![OpenAI](https://img.shields.io/badge/AI-OpenAI%20%7C%20Anthropic-412991)](https://openai.com/)

A **Model Context Protocol (MCP)** server that transforms unstructured text into a searchable knowledge graph with AI-powered extraction, conceptualization, and semantic search capabilities.

[Features](#features) • [Quick Start](#quick-start) • [Architecture](#architecture) • [API Reference](#api-reference) • [Examples](#examples) • [Contributing](#contributing)

</div>

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Database Setup](#database-setup)
- [Usage](#usage)
  - [Transport Modes](#transport-modes)
  - [MCP Tools](#mcp-tools)
  - [HTTP API Endpoints](#http-api-endpoints)
- [Examples](#examples)
- [Development](#development)
- [Security](#security)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

The Knowledge Graph MCP Server is a sophisticated system that automatically extracts structured knowledge from text, creating a queryable graph database of entities, relationships, events, and concepts. It supports both traditional MCP communication over STDIO and modern HTTP/REST APIs with Server-Sent Events (SSE).

**Inspiration**: This project was heavily inspired by the groundbreaking work in [AutoSchemaKG](https://github.com/HKUST-KnowComp/AutoSchemaKG), which pioneered autonomous knowledge graph construction with entity-event dual modeling and dynamic schema induction. I've adapted their core insights around multi-stage triple extraction, conceptualization processes, and the critical importance of events as first-class citizens in knowledge representation, while implementing it as a practical MCP server for AI assistant integration.

### What is MCP?

The **Model Context Protocol (MCP)** is an open protocol that standardizes how AI assistants (like Claude) communicate with external tools and data sources. This server implements MCP to provide knowledge graph capabilities to AI systems.

### Key Capabilities

- **🧠 AI-Powered Extraction**: Automatically extracts four types of knowledge triples from text
- **🔍 Semantic Search**: Multi-modal search using vector embeddings and fusion ranking
- **📊 Conceptualization**: Generates hierarchical concepts at different abstraction levels
- **🔄 Deduplication**: Intelligent duplicate detection using semantic similarity
- **🚀 Dual Transport**: Supports both STDIO (for MCP clients) and HTTP (for web applications)
- **⚡ Production Ready**: Built with TypeScript, PostgreSQL, and enterprise-grade security

## Features

### Knowledge Extraction

The server extracts four distinct types of knowledge relationships:

1. **Entity-Entity Relationships**: Connections between people, places, organizations
   - Example: `(Alice, works_for, TechCorp)`
   
2. **Entity-Event Relationships**: How entities participate in events
   - Example: `(Bob, attended, Conference_2024)`
   
3. **Event-Event Relationships**: Temporal and causal connections between events
   - Example: `(Meeting, preceded, Decision)`
   
4. **Emotional Context**: Sentiment and emotional states
   - Example: `(Team, felt_confident_about, Project_Launch)`

### Conceptualization

Automatically generates abstract concepts from extracted knowledge:

- **High Level**: Broad themes and categories (e.g., "collaboration", "innovation")
- **Medium Level**: Domain-specific concepts (e.g., "software development", "team dynamics")
- **Low Level**: Specific instances and details (e.g., "sprint planning", "code review")

### Search Capabilities

Advanced fusion search combining multiple strategies:

- **Entity Search**: Find specific entities by name
- **Relationship Search**: Query by predicate patterns
- **Semantic Search**: Full-text similarity search
- **Concept Search**: Abstract concept matching
- **Fusion Ranking**: Weighted combination of all search types

### Vector Embeddings

- OpenAI `text-embedding-3-small` (1536 dimensions)
- On-demand generation without caching
- Efficient batch processing
- PostgreSQL pgvector for similarity search

### Technology Stack

- **Runtime**: Node.js with ES modules
- **Language**: TypeScript (ES2022) with strict typing
- **Database**: PostgreSQL with Prisma ORM and pgvector
- **Vector Search**: pgvector extension
- **AI Providers**: OpenAI & Anthropic via AI SDK
- **HTTP Server**: Express.js with security middleware
- **Job Queue**: QStash for asynchronous processing
- **Testing**: Jest with TypeScript support
- **Code Quality**: Biome for linting and formatting
- **Package Manager**: pnpm

### Architecture Overview

#### Pure Functional Architecture

The codebase follows strict functional programming principles:

- **Pure Functions**: All operations are stateless with explicit dependencies
- **No Hidden State**: No factories, closures, or implicit mutations
- **Result Types**: Consistent error handling without exceptions
- **Explicit Dependencies**: All functions receive required services as parameters

#### 3-Stage Processing Pipeline

Knowledge processing uses a coordinated pipeline architecture:

1. **EXTRACTION Stage**: AI-powered triple extraction from text
2. **CONCEPTS Stage**: Abstract concept generation and hierarchy building  
3. **DEDUPLICATION Stage**: Semantic duplicate detection and removal

Each stage runs as independent QStash jobs with progress tracking and error recovery.

#### Unified Vector Storage

All embeddings are stored in a single `vector_embeddings` table with type discrimination:

- **ENTITY**: Entity name embeddings for entity search
- **RELATIONSHIP**: Predicate/relationship embeddings
- **SEMANTIC**: Full triple content embeddings for semantic search
- **CONCEPT**: Abstract concept embeddings

#### Dual Transport Design

The server supports two independent transport modes:

- **STDIO Transport**: Traditional MCP over stdin/stdout for Claude Desktop
- **HTTP Transport**: RESTful API with Server-Sent Events for web applications
- **Dual Mode**: Both transports running simultaneously

## Getting Started

### Prerequisites

- Node.js 20+ (LTS recommended)
- PostgreSQL 15+ with pgvector extension
- pnpm package manager
- OpenAI or Anthropic API key

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/kg-memory-mcp.git
   cd kg-memory-mcp
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Initialize the database**:
   ```bash
   pnpm run db:push
   ```

### Configuration

Create a `.env` file with the following variables:

```env
# Database (Required)
DATABASE_URL="postgresql://user:password@localhost:5432/knowledge_graph"

# AI Provider Keys (Required - choose one or both)
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."

# Transport Configuration
ENABLE_STDIO_TRANSPORT=true     # Enable MCP over STDIO
ENABLE_HTTP_TRANSPORT=false     # Enable HTTP REST API
NODE_ENV=development            # development | production

# HTTP Transport Configuration
HTTP_PORT=3000                  # HTTP server port
HTTP_BASE_PATH=/api             # API base path
HTTP_CORS_ORIGINS=*             # CORS origins
HTTP_RATE_LIMIT_WINDOW=15       # Rate limit window (minutes)
HTTP_RATE_LIMIT_MAX=100         # Max requests per window
HTTP_ENABLE_SSE=true            # Enable Server-Sent Events

# Job Queue (Optional - for async processing)
QSTASH_TOKEN="qstash_..."       # QStash token for job processing
QSTASH_URL="https://..."        # QStash callback URL

# AI Configuration
AI_PROVIDER=openai              # openai | anthropic
AI_MODEL=gpt-4o-mini           # AI model for extraction
EMBEDDING_MODEL=text-embedding-3-small  # Embedding model
EXTRACTION_METHOD=four-stage    # four-stage | single-pass

# Knowledge Graph Configuration
KG_EMBEDDING_MODEL=text-embedding-3-small
KG_EMBEDDING_DIMENSIONS=1536
KG_EXTRACTION_MODEL=gpt-4o-mini
KG_AI_PROVIDER=openai

# Logging & Debugging
LOG_LEVEL=INFO                  # ERROR | WARN | INFO | DEBUG | TRACE
LOG_TO_STDERR=false             # Write logs to stderr
LOG_STACK_TRACE=false           # Include stack traces
DIAGNOSTIC_MODE=false           # Log full request/response payloads

# Granular Debug Configuration (Development)
DEBUG_EXTRACTION=false          # Debug extraction operations
DEBUG_DATABASE=false            # Debug database operations
DEBUG_EMBEDDINGS=false          # Debug embedding generation
DEBUG_CONCEPTS=false            # Debug concept operations
DEBUG_DEDUPLICATION=false       # Debug deduplication
DEBUG_PIPELINE=false            # Debug pipeline coordination

# Performance Tuning
BATCH_SIZE=100                  # Embedding batch size
SEARCH_TOP_K=10                 # Initial search candidates
MIN_SCORE=0.7                   # Similarity threshold
SEMANTIC_THRESHOLD=0.85         # Deduplication threshold
DB_MAX_CONNECTIONS=20           # Database connection pool
```

### Database Setup

1. **Install PostgreSQL with pgvector**:
   ```bash
   # macOS
   brew install postgresql pgvector
   
   # Ubuntu/Debian
   sudo apt-get install postgresql postgresql-contrib
   sudo apt-get install postgresql-15-pgvector
   ```

2. **Create database and enable pgvector**:
   ```sql
   CREATE DATABASE knowledge_graph;
   \c knowledge_graph
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. **Run Prisma migrations**:
   ```bash
   pnpm run db:push
   ```

4. **Create vector indexes** (optional but recommended):
   ```sql
   -- Unified vector embeddings index
   CREATE INDEX idx_vector_embeddings_embedding 
   ON vector_embeddings USING ivfflat (embedding vector_cosine_ops);
   
   -- Additional indexes for efficient filtering
   CREATE INDEX idx_vector_embeddings_type_embedding 
   ON vector_embeddings USING btree (vector_type);
   
   CREATE INDEX idx_vector_embeddings_entity_name 
   ON vector_embeddings USING btree (entity_name);
   ```

## Usage

### Transport Modes

The server supports two transport modes that can run independently or simultaneously:

#### STDIO Transport (Traditional MCP)

For use with Claude Desktop and other MCP clients:

```bash
# Development
pnpm run dev:stdio

# Production
pnpm run build
pnpm run start:stdio
```

**Claude Desktop Configuration** (`.claude/config.json`):
```json
{
  "mcpServers": {
    "knowledge-graph": {
      "command": "node",
      "args": ["/path/to/kg-memory-mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "OPENAI_API_KEY": "sk-...",
        "ENABLE_STDIO_TRANSPORT": "true",
        "ENABLE_HTTP_TRANSPORT": "false"
      }
    }
  }
}
```

#### HTTP Transport (REST API)

For web applications and custom integrations:

```bash
# Development
pnpm run dev:http

# Production
pnpm run build
pnpm run start:http
```

#### Dual Mode

Run both transports simultaneously:

```bash
# Development
pnpm run dev:dual

# Production
pnpm run build
pnpm run start:dual
```

### MCP Tools

The server exposes 5 primary tools through the MCP protocol:

#### 1. `process_knowledge`

Extract and store knowledge from text using the 3-stage pipeline:

```typescript
{
  text: string;              // Text to process
  source: string;            // Source identifier
  source_type: string;       // Type: "thread", "file", "manual", "api"
  source_date: string;       // ISO date string
}
```

**Returns**: Job tracking information for the 3-stage pipeline (EXTRACTION → CONCEPTS → DEDUPLICATION)

**Example**:
```json
{
  "text": "Alice works at TechCorp as a senior engineer. She led the API redesign project in 2024.",
  "source": "meeting_notes_001",
  "source_type": "manual",
  "source_date": "2024-01-15T10:00:00Z"
}
```

#### 2. `get_pipeline_status`

Get the status and progress of a knowledge processing pipeline:

```typescript
{
  parentJobId: string;       // Parent job ID from process_knowledge
}
```

**Returns**: Real-time progress tracking for all pipeline stages

**Example**:
```json
{
  "parentJobId": "abc123-def456-ghi789"
}
```

#### 3. `search_knowledge_graph`

Search using fusion ranking (combines entity, relationship, semantic, and concept search):

```typescript
{
  query: string;             // Search query
  limit?: number;            // Max results (default: 10)
  threshold?: number;        // Similarity threshold (default: 0.0)
  searchTypes?: string[];    // Enable specific search types (default: all)
  weights?: {                // Custom ranking weights
    entity?: number;         // Default: 0.3
    relationship?: number;   // Default: 0.2
    semantic?: number;       // Default: 0.3
    concept?: number;        // Default: 0.2
  };
}
```

**Example**:
```json
{
  "query": "API redesign project",
  "limit": 20,
  "searchTypes": ["entity", "semantic"],
  "weights": {
    "entity": 0.4,
    "semantic": 0.6
  }
}
```

#### 4. `search_concepts`

Search conceptual abstractions:

```typescript
{
  query: string;                    // Search query
  abstraction?: "high" | "medium" | "low";  // Filter by level
}
```

#### 5. `get_knowledge_graph_stats`

Get knowledge graph statistics and metrics:

```typescript
{} // No parameters required
```

**Returns**: Comprehensive statistics including triple counts, concept counts, vector embeddings, and database metrics



### HTTP API Endpoints

When running in HTTP mode, the following RESTful endpoints are available:

#### Core Endpoints

- `GET /api/` - Service information
- `GET /api/health` - Health check with dependency status
- `GET /api/metrics` - Performance metrics
- `GET /api/capabilities` - MCP capabilities and tool list

#### Knowledge Operations

- `POST /api/process-knowledge` - Extract and store knowledge using 3-stage pipeline
- `POST /api/search-knowledge` - Fusion search across all knowledge types
- `POST /api/search-concepts` - Search conceptual abstractions
- `GET /api/stats` - Knowledge graph statistics and metrics

#### Pipeline Management

- `POST /api/get-pipeline-status` - Get status and progress of processing pipeline
- `GET /api/job-status/{jobId}` - Get specific job status (QStash integration)

#### Job Queue (QStash Integration)

- `POST /api/process-job` - Queue knowledge processing jobs
- `POST /api/jobs/extraction` - Queue extraction batch jobs
- `POST /api/jobs/concepts` - Queue concept generation jobs  
- `POST /api/jobs/deduplication` - Queue deduplication jobs

#### SSE/MCP Endpoint

- `GET /api/sse` - Server-Sent Events for MCP protocol over HTTP

### Response Format

All API responses follow a consistent format:

```typescript
{
  success: boolean;
  data?: any;           // Response data
  error?: {
    message: string;
    operation: string;
  };
  operation: string;    // Operation name
  timestamp: string;    // ISO timestamp
}
```

## Examples

### JavaScript/Node.js

```javascript
// Simple extraction example
const response = await fetch('http://localhost:3000/api/process-knowledge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'The new product launch increased revenue by 25% in Q4 2024.',
    source: 'quarterly_report',
    source_type: 'file'
  })
});

const result = await response.json();
console.log(`Stored ${result.data.triplesStored} triples`);
```

### cURL

```bash
# Health check
curl http://localhost:3000/api/health

# Extract knowledge
curl -X POST http://localhost:3000/api/process-knowledge \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Microsoft acquired GitHub in 2018 for $7.5 billion.",
    "source": "tech_news",
    "include_concepts": true
  }'

# Search with fusion
curl -X POST http://localhost:3000/api/search-knowledge \
  -H "Content-Type: application/json" \
  -d '{"query": "Microsoft GitHub acquisition"}'
```


## Development

### Project Structure

```
kg-memory-mcp/
├── src/
│   ├── features/              # Core feature modules (pure functions)
│   │   ├── knowledge-extraction/   # AI-powered triple extraction
│   │   ├── conceptualization/      # Concept generation
│   │   ├── deduplication/          # Duplicate detection
│   │   └── knowledge-graph/        # Graph operations & search
│   ├── server/                # Transport implementations
│   │   ├── stdio-server.ts    # MCP STDIO transport
│   │   ├── http-server.ts     # Express HTTP server
│   │   ├── transport-manager.ts  # Shared tool logic
│   │   └── routes/            # HTTP endpoints
│   ├── shared/                # Shared infrastructure
│   │   ├── database/          # Prisma operations
│   │   ├── services/          # AI & embedding services
│   │   ├── types/             # TypeScript definitions
│   │   └── utils/             # Utilities
│   └── index.ts              # Entry point
├── prisma/
│   └── schema.prisma         # Database schema
├── examples/                 # Client examples
├── scripts/                  # Development scripts
└── tests/                    # Test files
```

### Development Commands

```bash
# Development workflow
pnpm run dev          # Development server with hot reload (STDIO only)
pnpm run dev:stdio    # STDIO transport only (traditional MCP)
pnpm run dev:http     # HTTP transport only (REST API + SSE)
pnpm run dev:dual     # Both transports simultaneously

# Production workflow
pnpm run build        # TypeScript compilation
pnpm run start        # Production server (STDIO only)
pnpm run start:http   # Production HTTP transport  
pnpm run start:dual   # Production dual transport

# Database operations
pnpm run db:push      # Push schema changes to database
pnpm run db:migrate   # Create new migration
pnpm run db:generate  # Generate Prisma client
pnpm run db:studio    # Open Prisma Studio GUI
pnpm run db:reset     # Reset database (caution: deletes all data)

# Code quality
pnpm run lint         # Biome linting
pnpm run format       # Biome formatting
pnpm run check        # Full check (lint + type check + tests)

# Testing
pnpm run test         # Run all Jest tests
pnpm run test:unit    # Unit tests only
pnpm run test:integration # Integration tests only
pnpm run test:pipeline # Pipeline-specific tests
pnpm run test:watch   # Run tests in watch mode
pnpm run test:coverage # Generate coverage report

# Performance testing
pnpm run benchmark    # Run performance benchmarks
pnpm run ai-isolation # Test AI provider isolation
pnpm run ai-extraction # Test extraction performance
pnpm run ai-embedding # Test embedding generation
pnpm run ai-conceptualization # Test concept generation
pnpm run ai-latency   # Test API latency

# Utilities
pnpm run server:inspect # Launch MCP Inspector for debugging
pnpm run mcp          # Direct MCP mode (alias for dev)
pnpm run watch        # Watch mode with tsx
```


### Environment Variables for Production

```env
# Required
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
OPENAI_API_KEY=sk-...

# Production Settings
NODE_ENV=production
ENABLE_HTTP_TRANSPORT=true
ENABLE_STDIO_TRANSPORT=false

# Security
HTTP_CORS_ORIGINS=https://yourdomain.com
HTTP_RATE_LIMIT_MAX=100
HTTP_RATE_LIMIT_WINDOW=15

# Performance
DB_MAX_CONNECTIONS=20
BATCH_SIZE=64
SEARCH_TOP_K=20

# Monitoring
LOG_LEVEL=INFO
DIAGNOSTIC_MODE=false
```

### Deployment Platforms

#### Vercel

```json
{
  "functions": {
    "api/index.js": {
      "maxDuration": 60
    }
  }
}
```

#### Railway

```toml
[deploy]
startCommand = "pnpm run start:http"

[build]
builder = "NIXPACKS"
buildCommand = "pnpm install && pnpm run build"
```

#### AWS Lambda

Use the provided handler wrapper in `src/server/deploy-handlers.ts`.

## Security

### Best Practices

1. **API Keys**: Store in environment variables, never commit
2. **Database**: Use SSL connections in production
3. **CORS**: Configure specific origins, avoid wildcards
4. **Rate Limiting**: Implement per-IP limits
5. **Input Validation**: All inputs validated with Zod schemas
6. **SQL Injection**: Protected by Prisma ORM
7. **XSS Prevention**: Content-Type headers enforced

### Security Headers (HTTP Mode)

The server automatically sets security headers via Helmet:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (when using HTTPS)

### Performance Tuning

```env
# Database
DB_MAX_CONNECTIONS=20        # Increase for high load
DB_CONNECTION_TIMEOUT=5000   # Milliseconds

# Embeddings
BATCH_SIZE=64               # Larger batches for throughput
EMBEDDING_DIMENSIONS=1536    # Or 3072 for large model

# Search
SEARCH_TOP_K=20             # Initial candidates for reranking
MIN_SCORE=0.7               # Similarity threshold
```

### Monitoring

- Health endpoint: `/api/health`
- Metrics endpoint: `/api/metrics`
- Token usage tracking in database
- Request duration logging


### Debug Mode

Enable detailed logging:

```env
LOG_LEVEL=DEBUG
DIAGNOSTIC_MODE=true
LOG_STACK_TRACE=true
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following our code style
4. Add tests for new functionality
5. Run quality checks (`pnpm run check`)
6. Commit with descriptive messages
7. Push to your fork
8. Open a Pull Request


---

<div align="center">
Made with ❤️ by the Knowledge Graph MCP Team
</div>