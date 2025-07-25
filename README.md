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
- **Database**: PostgreSQL with Prisma ORM
- **Vector Search**: pgvector extension
- **AI Providers**: OpenAI & Anthropic via AI SDK
- **HTTP Server**: Express.js with security middleware
- **Testing**: Jest with TypeScript support
- **Package Manager**: pnpm

### Functional Architecture

The codebase follows strict functional programming principles:

- **Pure Functions**: All operations are stateless with explicit dependencies
- **No Hidden State**: No factories, closures, or implicit mutations
- **Result Types**: Consistent error handling without exceptions
- **Explicit Dependencies**: All functions receive required services as parameters

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
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/knowledge_graph"

# AI Provider (choose one)
OPENAI_API_KEY="sk-..."
# OR
ANTHROPIC_API_KEY="sk-ant-..."

# Transport Configuration
ENABLE_STDIO_TRANSPORT=true
ENABLE_HTTP_TRANSPORT=false

# Optional: HTTP Configuration
HTTP_PORT=3000
HTTP_BASE_PATH=/api
HTTP_CORS_ORIGINS=*

# Optional: Advanced Settings
AI_PROVIDER=openai              # or 'anthropic'
AI_MODEL=gpt-4o-mini           # or 'claude-3-haiku'
EMBEDDING_MODEL=text-embedding-3-small
EXTRACTION_METHOD=four-stage    # or 'single-pass'
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
   -- Entity vectors
   CREATE INDEX idx_entity_vectors_embedding 
   ON entity_vectors USING ivfflat (embedding vector_cosine_ops);
   
   -- Relationship vectors
   CREATE INDEX idx_relationship_vectors_embedding 
   ON relationship_vectors USING ivfflat (embedding vector_cosine_ops);
   
   -- Semantic vectors
   CREATE INDEX idx_semantic_vectors_embedding 
   ON semantic_vectors USING ivfflat (embedding vector_cosine_ops);
   
   -- Concept vectors
   CREATE INDEX idx_concept_vectors_embedding 
   ON concept_vectors USING ivfflat (embedding vector_cosine_ops);
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

The server exposes two primary tools through the MCP protocol:

#### 1. `process_knowledge`

Extract and store knowledge from text:

```typescript
{
  text: string;              // Text to process
  source: string;            // Source identifier
  source_type?: string;      // Type: "thread", "file", "manual", "api"
  source_date?: string;      // ISO date string
  include_concepts?: boolean; // Generate concepts (async)
}
```

**Example**:
```json
{
  "text": "Alice works at TechCorp as a senior engineer. She led the API redesign project in 2024.",
  "source": "meeting_notes_001",
  "source_type": "manual",
  "include_concepts": true
}
```

#### 2. `search_knowledge_graph`

Search using fusion ranking:

```typescript
{
  query: string;             // Search query
  limit?: number;            // Max results (default: 10)
  threshold?: number;        // Similarity threshold (0-1)
  searchTypes?: string[];    // Enable specific search types
  weights?: {                // Custom ranking weights
    entity?: number;
    relationship?: number;
    semantic?: number;
    concept?: number;
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

#### 3. `search_concepts`

Search conceptual abstractions:

```typescript
{
  query: string;                    // Search query
  abstraction?: "high" | "medium" | "low";  // Filter by level
}
```



### HTTP API Endpoints

When running in HTTP mode, the following RESTful endpoints are available:

#### Core Endpoints

- `GET /api/` - Service information
- `GET /api/health` - Health check with dependency status
- `GET /api/metrics` - Performance metrics
- `GET /api/capabilities` - MCP capabilities and tool list

#### Knowledge Operations

- `POST /api/process-knowledge` - Extract and store knowledge
- `POST /api/search-knowledge` - Fusion search
- `POST /api/search-concepts` - Concept search
- `GET /api/stats` - Knowledge graph statistics

#### Job Queue (Async Processing)

- `POST /api/process-job` - Queue large extraction job
- `GET /api/job-status?jobId={id}` - Check job status

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
# Development
pnpm run dev          # STDIO mode with hot reload
pnpm run dev:http     # HTTP mode
pnpm run dev:dual     # Both transports

# Testing
pnpm run test         # Run all tests
pnpm run test:watch   # Watch mode
pnpm run test:coverage # Coverage report

# Code Quality
pnpm run lint         # Biome linting
pnpm run format       # Code formatting
pnpm run check        # Full quality check

# Database
pnpm run db:studio    # Prisma Studio GUI
pnpm run db:push      # Push schema changes
pnpm run db:migrate   # Create migration
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