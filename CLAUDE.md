# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Technology Stack

This is a **Knowledge Graph MCP Server** built with:
- **TypeScript** (ES2022) with strict typing
- **Node.js** with ES modules
- **PostgreSQL** with Prisma ORM and pgvector
- **OpenAI/Anthropic APIs** via AI SDK
- **Model Context Protocol (MCP)** via STDIO and HTTP/REST transports
- **Express.js** for HTTP server with security middleware
- **QStash** for asynchronous job processing
- **Jest** for testing
- **pnpm** for package management

## Common Development Commands

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
```

## Architecture Overview

### Pure Functional Architecture

The codebase strictly follows functional programming principles:
- **No hidden state** - All dependencies passed explicitly as parameters
- **No factory functions** - Direct function exports only
- **No closures** - Pure functions with predictable inputs/outputs
- **Result types** - Consistent error handling without exceptions
- **Stateless operations** - All state managed by database

### Core Structure

```
src/
├── features/                      # Feature modules (pure functions)
│   ├── knowledge-extraction/      # AI-powered triple extraction
│   ├── conceptualization/         # Concept hierarchy generation  
│   ├── deduplication/            # Semantic duplicate detection
│   ├── knowledge-graph/          # Graph operations and search
│   └── knowledge-processing/      # Job pipeline coordination
│       ├── handlers/             # Functional job handlers
│       │   ├── extraction-function.ts
│       │   ├── concept-function.ts
│       │   └── deduplication-function.ts
│       ├── pipeline-coordinator.ts
│       └── job-router.ts
├── server/                       # Transport implementations
│   ├── stdio-server.ts          # Traditional MCP over stdin/stdout
│   ├── http-server.ts           # Express.js HTTP server
│   ├── transport-manager.ts     # Shared tool handling
│   └── routes/                  # HTTP endpoint implementations
└── shared/                       # Shared infrastructure
    ├── database/                 # PostgreSQL operations
    ├── services/                 # AI provider services
    ├── types/                    # TypeScript definitions
    └── utils/                    # Utility functions
```

### Key Architectural Patterns

1. **Dual Transport Support**: STDIO (MCP) and HTTP (REST/SSE) run independently or together
2. **3-Stage Pipeline**: Jobs process through EXTRACTION → CONCEPTS → DEDUPLICATION
3. **Functional Handlers**: Each pipeline stage uses pure functions with explicit dependencies
4. **Unified Vector Storage**: Single `vector_embeddings` table with `vector_type` field
5. **Database-First Search**: All queries use PostgreSQL with proper indexes
6. **QStash Integration**: Asynchronous job processing with progress tracking

## MCP Tools

The server exposes 7 main tools via both transports:
1. `process_knowledge` - Extract and store knowledge with background processing
2. `search_knowledge_graph` - Fusion search combining multiple strategies
3. `search_concepts` - Search conceptual abstractions  
4. `store_knowledge_triples` - Store pre-structured knowledge
5. `deduplicate_triples` - Remove semantic duplicates
6. `get_knowledge_graph_stats` - System statistics and metrics
7. `enumerate_entities` - List entities with filtering

## Important Implementation Details

### Vector Storage
- **Unified Schema**: Use `vector_embeddings` table with `vector_type` field (ENTITY, RELATIONSHIP, SEMANTIC, CONCEPT)
- **NOT separate tables**: Old table names like `entity_vectors` don't exist
- **Post-Transaction Generation**: Embeddings created in `generateAndStoreVectorsPostTransaction`
- **SQL Format**: Store vectors as `[${embedding.join(',')}]::vector`

### Job Processing
- **Job Types**: PROCESS_KNOWLEDGE (parent), EXTRACT_KNOWLEDGE_BATCH, GENERATE_CONCEPTS, DEDUPLICATE_KNOWLEDGE
- **QStash Queue**: Jobs queued via `/api/process-job` endpoint
- **Progress Tracking**: Real-time progress updates throughout processing
- **Batch Processing**: Default batch size 32 for embeddings (configurable)

### Development Tips
- **Path Aliases**: Use `~/*` imports (e.g., `import { foo } from '~/shared/utils/bar.js'`)
- **Always use dev scripts**: Run via `pnpm run dev`, not direct `node` commands
- **Check embeddings**: Query `vector_embeddings` table directly if issues arise
- **Monitor jobs**: Check `ProcessingJob` table for status and errors

## Environment Configuration

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` - AI provider credentials

### Transport Control
- `ENABLE_STDIO_TRANSPORT` - Enable STDIO MCP (default: true)
- `ENABLE_HTTP_TRANSPORT` - Enable HTTP/REST (default: false)

### AI Configuration
- `AI_PROVIDER` - openai | anthropic (default: openai)
- `AI_MODEL` - Model for extraction (default: gpt-4o-mini)
- `EMBEDDING_MODEL` - Embedding model (default: text-embedding-3-small)
- `EXTRACTION_METHOD` - single-pass | four-stage (default: four-stage)

### Performance Tuning
- `BATCH_SIZE` - Embedding batch size (default: 100)
- `SEARCH_TOP_K` - Initial search candidates (default: 10)
- `MIN_SCORE` - Similarity threshold (default: 0.7)
- `SEMANTIC_THRESHOLD` - Dedup threshold (default: 0.85)

## Testing Strategy

### Unit Tests
Test pure functions with mock dependencies:
```typescript
const mockDb = { checkExistingTriples: jest.fn() };
const result = await storeTriples(triples, mockDb, config);
```

### Integration Tests
Test full pipeline with real database:
```bash
pnpm run test:integration
```

### Performance Tests
Measure extraction, embedding, and search performance:
```bash
pnpm run benchmark
pnpm run ai-isolation
```

## Common Issues & Solutions

- **Missing Embeddings**: Ensure `generateAndStoreVectorsPostTransaction` is called
- **Build Errors**: Check all vector operations use `vector_embeddings` table
- **Path Alias Issues**: Use `pnpm run dev` scripts, not direct `node`
- **Job Stuck**: Check QStash queue and `ProcessingJob` table for errors
- **Slow Search**: Create pgvector indexes (see README for SQL commands)