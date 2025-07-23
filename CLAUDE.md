# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Technology Stack

This is a **Knowledge Graph MCP Server** built with:
- **TypeScript** (ES2022) with strict typing
- **Node.js** with ES modules
- **PostgreSQL** with Prisma ORM
- **OpenAI/Anthropic APIs** via AI SDK
- **Model Context Protocol (MCP)** via multiple transports:
  - **STDIO transport** (traditional MCP)
  - **HTTP/REST API** with OpenAPI documentation
- **Express.js** for HTTP server with security middleware
- **Vector embeddings** with OpenAI text-embedding models
- **Jest** for testing
- **pnpm** for package management

## Extra instructions
- use aliases ~ example: import package from '~/api/package'

## Common Development Commands

```bash
# Development workflow (Transport Modes)
pnpm run dev          # Development server with hot reload (STDIO only)
pnpm run dev:stdio    # STDIO transport only (traditional MCP)
pnpm run dev:http     # HTTP transport only (REST API + SSE)
pnpm run dev:dual     # Both transports simultaneously

# Production workflow
pnpm run build        # TypeScript compilation
pnpm run start        # Production server (STDIO only)
pnpm run start:stdio  # Production STDIO transport
pnpm run start:http   # Production HTTP transport  
pnpm run start:dual   # Production dual transport

# Database operations
- Tell the user when any database operations need to be run. Provide SQL scripts when needed.

# Code quality
pnpm run lint         # Biome linting
pnpm run format       # Biome formatting
pnpm run test         # Jest testing
pnpm run check        # Full code quality check (lint + type check)

# Testing
pnpm run test:unit    # Run unit tests
pnpm run test:watch   # Run tests in watch mode
pnpm run test:http    # Test HTTP API endpoints
pnpm run test:mcp     # Test MCP client integration
scripts/test-client.mjs      # STDIO MCP client testing
scripts/test-http-client.mjs # HTTP API client testing
```

## Architecture Overview

### Dual Transport Architecture

The server supports **dual transport modes** with shared stateless functions:

1. **Transport Layer** (`src/server/`): Multiple transport implementations
   - `stdio-server.ts`: Traditional MCP over stdin/stdout
   - `http-server.ts`: Express.js HTTP server with REST API
   - `transport-manager.ts`: Shared tool handling logic
   - `routes/`: HTTP endpoint implementations
   - `docs/`: OpenAPI documentation

2. **Feature Modules** (`src/features/`): Pure stateless functions
   - `knowledge-extraction/`: AI-powered triple extraction
   - `conceptualization/`: Concept hierarchy generation  
   - `deduplication/`: Smart duplicate detection
   - `knowledge-graph/`: Core graph operations and search

3. **Shared Infrastructure** (`src/shared/`):
   - `services/`: Database, AI provider, and embedding services
   - `database/`: PostgreSQL adapter with Prisma
   - `types/`: Comprehensive TypeScript definitions
   - `utils/`: Utility functions and configuration

### Pure Functional Principles

The codebase strictly adheres to functional programming:
- **No hidden state** - All dependencies passed as parameters
- **No factory functions** - Direct function exports instead of `createXOperations`
- **No in-memory caches** - Database handles all persistence
- **Pure functions only** - Predictable inputs/outputs
- **Explicit dependencies** - No closures or hidden mutations
- **Result types** - Consistent error handling without exceptions

### Key Features

- **Dual Transport Support**: STDIO (traditional MCP) and HTTP (REST + SSE) simultaneously
- **Knowledge Extraction**: Four triple types (entity-entity, entity-event, event-event, emotional-context)
- **Database-First Search**: All queries go directly to database with proper indexes
- **Conceptualization**: High/medium/low abstraction levels with hierarchical concepts
- **Direct Embeddings**: OpenAI embeddings generated on-demand without caching
- **Batch Processing**: Efficient bulk operations with database transactions
- **Production Ready**: Security middleware, rate limiting, monitoring endpoints

## Transport Modes

### STDIO Transport (Default)
- Traditional MCP protocol over stdin/stdout
- Used by Claude Desktop and MCP clients
- Start with: `pnpm run dev:stdio`

### HTTP Transport (Optional)  
- RESTful API with OpenAPI documentation
- Server-Sent Events for MCP protocol over HTTP
- Production middleware: CORS, compression, rate limiting, security headers
- Start with: `pnpm run dev:http`
- Environment: `ENABLE_HTTP_TRANSPORT=true`

### Dual Mode
- Run both transports simultaneously
- Start with: `pnpm run dev:dual`

## MCP Tools

The server exposes 6 main tools (available via both transports):
1. `process_knowledge` - Extract and store knowledge from text with background concepts
2. `search_knowledge_graph` - Search triples by semantic similarity
3. `search_concepts` - Search conceptual abstractions  
4. `store_knowledge_triples` - Store pre-structured knowledge
5. `deduplicate_triples` - Remove duplicate relationships
6. `get_knowledge_graph_stats` - Comprehensive system statistics
7. `enumerate_entities` - List entities with filtering options

## Development Notes

- **Type Safety**: Strict TypeScript with comprehensive type definitions in `src/shared/types/index.ts`
- **Error Handling**: Use Result types, avoid throwing exceptions
- **Database**: Always run `pnpm run db:push` after schema changes
- **Testing**: Mock dependencies for unit tests, use real services for integration tests
- **Configuration**: use env.ts
- **No State Management**: All functions are stateless with explicit parameters
- **Direct Function Calls**: No factory patterns or dependency injection frameworks
- **Database Indexes**: Ensure proper indexes for efficient queries (replacing in-memory lookups)
- **remember to use dev to test to avoid path alias errors**

## Environment Setup

### Required Variables
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` - AI provider API keys

### Transport Configuration  
- `ENABLE_STDIO_TRANSPORT` - Enable STDIO MCP transport (default: true)
- `ENABLE_HTTP_TRANSPORT` - Enable HTTP/REST transport (default: false)

### HTTP Transport (Optional)
- `HTTP_PORT` - Server port (default: 3000)
- `HTTP_BASE_PATH` - API base path (default: /api)
- `HTTP_CORS_ORIGINS` - CORS origins (default: *)
- `HTTP_ENABLE_SSE` - Enable SSE/MCP endpoint (default: true)
- `HTTP_RATE_LIMIT_WINDOW` - Rate limit window in minutes (default: 15)
- `HTTP_RATE_LIMIT_MAX` - Max requests per window (default: 100)

### AI & Knowledge Graph Configuration
- `KNOWLEDGE_GRAPH_AI_PROVIDER` - AI provider: openai | anthropic (default: openai)
- `KNOWLEDGE_GRAPH_AI_MODEL` - AI model for extraction (default: gpt-4o-mini)
- `KNOWLEDGE_GRAPH_EMBEDDING_MODEL` - Embedding model (default: text-embedding-3-small)

## File Structure

```
/src/                              # Source code
├── features/                      # Feature modules (pure functions)
│   ├── knowledge-extraction/      # AI-powered triple extraction
│   ├── conceptualization/         # Concept hierarchy generation  
│   ├── deduplication/            # Smart duplicate detection
│   └── knowledge-graph/          # Core graph operations and search
├── server/                       # Transport implementations
│   ├── stdio-server.ts          # Traditional MCP over stdin/stdout
│   ├── http-server.ts           # Express.js HTTP server
│   ├── sse-server.ts            # Server-Sent Events MCP transport
│   ├── transport-manager.ts     # Shared tool handling logic
│   ├── routes/                  # HTTP endpoint implementations
│   │   └── knowledge-routes.ts  # REST API endpoints
│   └── docs/                    # API documentation
│       └── openapi.ts           # OpenAPI specification
├── shared/                       # Shared infrastructure
│   ├── database/                 # PostgreSQL adapter with Prisma
│   ├── services/                 # Service interfaces (AI, embeddings)
│   ├── types/                    # Comprehensive TypeScript definitions
│   └── utils/                    # Utility functions and configuration
└── index.ts                     # Main entry point with transport selection

/examples/                       # HTTP client examples
├── javascript/                   # Node.js client examples
├── python/                       # Python client examples  
├── web/                         # Browser-based client examples
└── curl/                        # cURL command examples

/prisma/                         # Database schema and migrations
/scripts/                        # Testing and development scripts
```

## Key Architecture Decisions

1. **Transport Separation**: Clean separation between transport layers (STDIO/HTTP) and business logic
2. **Shared Stateless Functions**: Both transports call the same pure functions in `src/features/`
3. **No Factory Functions**: All operations exported as individual functions with explicit dependencies
4. **No Caching Layer**: Embeddings generated on-demand, database handles all persistence  
5. **Database-First**: All queries go directly to PostgreSQL with proper indexes
6. **Express.js Integration**: Production-ready HTTP server with security middleware
7. **OpenAPI Documentation**: Auto-generated API documentation for HTTP endpoints

## Code Examples

### Before (Stateful Factory Pattern)
```typescript
// ❌ OLD: Factory with hidden state
const knowledgeGraphOps = createKnowledgeGraphOperations(config);
await knowledgeGraphOps.storeTriples(triples);
```

### After (Pure Functions)
```typescript
// ✅ NEW: Pure function with explicit dependencies
import { storeTriples } from '~/features/knowledge-graph/operations.js';

await storeTriples(triples, db, config);
```

### Testing Example
```typescript
// Easy to test with mock dependencies
it('should store triples', async () => {
  const mockDb = {
    checkExistingTriples: jest.fn().mockResolvedValue([]),
    storeTriples: jest.fn().mockResolvedValue({ success: true })
  };
  
  const result = await storeTriples(testTriples, mockDb, config);
  expect(result.success).toBe(true);
});
```




## Client Examples

Comprehensive client examples available in `/examples/`:
- **JavaScript/Node.js**: Simple, advanced, and SSE MCP clients
- **Python**: Sync and async clients with retry logic
- **Browser/Web**: Complete web interface with SSE support  
- **cURL**: Executable script testing all endpoints

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.