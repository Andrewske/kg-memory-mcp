# AI Learnings - Knowledge Graph MCP Server

This file contains insights and lessons learned from working on the Knowledge Graph MCP Server project, specifically to help future developers understand the codebase structure, performance characteristics, and optimization opportunities.

## 📁 Project Structure & Architecture

### Core Architecture
- **Dual Transport**: Supports both STDIO (traditional MCP) and HTTP (REST API) simultaneously
- **Pure Functional Design**: No factories, no hidden state - all dependencies passed as parameters
- **Database-First**: All operations go directly to PostgreSQL with proper indexing
- **TypeScript with ES Modules**: Uses strict typing with path aliases (`~` maps to `src/`)

### Key Directories
```
src/
├── features/           # Pure stateless functions (business logic)
│   ├── knowledge-extraction/     # AI-powered triple extraction
│   ├── conceptualization/        # Concept hierarchy generation
│   ├── deduplication/            # Smart duplicate detection
│   └── knowledge-graph/          # Core graph operations and search
├── server/             # Transport implementations
│   ├── stdio-server.ts          # Traditional MCP
│   ├── http-server.ts           # Express.js HTTP server
│   └── transport-manager.ts     # Shared tool handling logic
├── shared/             # Shared infrastructure
│   ├── database/               # PostgreSQL adapter with Prisma
│   ├── services/               # AI, embedding, queue services
│   ├── types/                  # Comprehensive TypeScript definitions
│   └── utils/                  # Utility functions and configuration
└── tests/performance/   # Performance testing infrastructure
```

## 🔧 Development Environment & Setup

### Essential Environment Variables
```bash
# Required
DATABASE_URL="postgresql://username:password@localhost:5432/knowledge_graph"
OPENAI_API_KEY="sk-..." # OR ANTHROPIC_API_KEY
AI_GATEWAY_API_KEY="..." # For AI provider service

# Performance-related
EXTRACTION_METHOD="four-stage" # vs "single-pass"
BATCH_SIZE="32" # Embedding batch size
AI_MODEL="gpt-4o-mini" # Current default
EMBEDDING_MODEL="text-embedding-3-small"
```

### Development Commands
```bash
# Testing & Building
pnpm test              # Jest tests
pnpm run build         # TypeScript compilation with path aliases
pnpm run check         # Lint + typecheck + tests

# Performance Benchmarking
npx tsx src/tests/performance/run-benchmark.ts

# Development modes
pnpm run dev:stdio     # STDIO transport only
pnpm run dev:http      # HTTP transport only  
pnpm run dev:dual      # Both transports
```

## ⚡ Performance Characteristics & Bottlenecks

### Current Baseline Performance (Small Text - 315 tokens)
- **Processing Time**: ~63 seconds
- **Throughput**: ~5 tokens/second
- **Memory Usage**: ~18MB for small inputs
- **Vector Operations**: 152 vectors generated (76 entity, 38 relationship, 38 semantic)

### Identified Performance Bottlenecks

#### 1. Sequential Four-Stage Extraction (Highest Impact)
**Location**: `src/features/knowledge-extraction/extract.ts:172-182`

```typescript
// Current: Sequential processing
for (const type of ['ENTITY_ENTITY', 'ENTITY_EVENT', 'EVENT_EVENT', 'EMOTIONAL_CONTEXT']) {
    const result = await extractByType(data, type); // Each waits for the previous!
}

// Recommended: Parallel processing  
const results = await Promise.all([
    extractByType(data, 'ENTITY_ENTITY'),
    extractByType(data, 'ENTITY_EVENT'), 
    extractByType(data, 'EVENT_EVENT'),
    extractByType(data, 'EMOTIONAL_CONTEXT')
]);
```
**Expected Impact**: 75% faster extraction

#### 2. Duplicate Embedding Generation (High Impact)
**Location**: Multiple locations in vector generation pipeline

**Current Issue**: Same text embedded multiple times
- During deduplication (all triples)
- During entity vector storage (duplicates for each triple)
- During relationship vector storage
- During semantic vector storage

**Solution**: Generate embedding map once at the start
```typescript
const allTexts = [...new Set([...triples.map(t => t.subject), ...])];
const embeddingMap = await generateEmbeddingMap(allTexts);
// Reuse throughout pipeline
```
**Expected Impact**: 50-60% reduction in embedding calls

#### 3. Database Transaction Inefficiency
**Location**: Vector storage operations

**Current**: Multiple separate transactions
**Recommended**: Batch all operations in single transaction
**Expected Impact**: 20-30% faster database operations

## 🧪 Testing Infrastructure

### Performance Testing Setup
Created comprehensive testing infrastructure in `src/tests/performance/`:

- **Fixtures**: 4 text sizes (small: 315 tokens → xlarge: ~4000+ tokens)
- **Mock Services**: Database and embedding services for isolated testing
- **Real Benchmarks**: Actual AI calls with detailed timing and memory tracking
- **Automated Reports**: JSON reports with optimization suggestions

### Running Performance Tests
```bash
# Full benchmark suite with real AI calls
npx tsx src/tests/performance/run-benchmark.ts

# Jest-based tests (requires environment setup)
pnpm test src/tests/performance/
```

### Key Metrics Tracked
- Processing time per phase (extraction, deduplication, storage)
- Memory usage and peak consumption
- Embedding API call efficiency (duplicates detected)
- Tokens processed per second
- Database operation timing

## 🎯 Optimization Roadmap

### Phase 1: Parallel Extraction (75% improvement)
- Implement Promise.all() for four-stage extraction
- Add proper error handling with Promise.allSettled()
- Maintain same output format for compatibility

### Phase 2: Embedding Optimization (50-60% improvement) 
- Generate embedding map once at start of pipeline
- Eliminate duplicate embeddings across vector types
- Increase batch size to 100 (from 32)

### Phase 3: Database Batching (20-30% improvement)
- Implement transaction batching for all database operations
- Optimize connection pool settings
- Add proper indexing for frequently queried fields

### Phase 4: Advanced Optimizations (15-20% improvement)
- Text chunking for inputs >3000 tokens
- Smart model switching based on text size
- Background conceptualization processing

**Total Expected Improvement**: 85-95% faster processing

## 🐛 Common Issues & Solutions

### TypeScript/Jest Configuration Issues
**Problem**: Path alias resolution fails in tests
**Solution**: Use relative imports in tests or ensure Jest moduleNameMapper is correct:
```javascript
moduleNameMapper: {
  '^~/(.*)$': '<rootDir>/src/$1'
}
```

### Import/Export Issues with ES Modules
**Problem**: `require.main === module` doesn't work in ES modules
**Solution**: Use `import.meta.url === \`file://\${process.argv[1]}\``

### Prisma Type Imports
**Problem**: Custom type definitions conflict with Prisma-generated types
**Solution**: Import directly from `@prisma/client` for database types:
```typescript
import type { KnowledgeTriple, ConceptNode } from '@prisma/client';
```

### Environment Variable Validation
**Problem**: Missing or invalid environment variables cause runtime failures
**Solution**: The project uses Zod validation in `src/shared/env.ts` - check this file for required variables

## 📊 Database Schema Insights

### Key Tables and Relationships
- `KnowledgeTriple`: Core relationship storage with extraction metadata
- `ConceptNode`: Hierarchical concept abstractions
- `EntityVector`, `RelationshipVector`, `SemanticVector`: Separate vector storage for different search types
- `Conceptualization`: Links between entities and their conceptual abstractions

### Vector Storage Strategy
The system generates multiple vector types for comprehensive search:
- **Entity vectors**: For subject/object entities in triples
- **Relationship vectors**: For predicate relationships
- **Semantic vectors**: For full triple meaning
- **Concept vectors**: For conceptual abstractions

This multi-vector approach enables fusion search but creates performance overhead due to duplicate embeddings.

## 🔍 Debugging & Monitoring

### Useful Debug Environment Variables
```bash
LOG_LEVEL="DEBUG"           # Detailed logging
DIAGNOSTIC_MODE="true"      # Full request/response payloads
LOG_TO_STDERR="true"        # Logs to stderr for debugging
```

### Performance Monitoring
- Memory usage tracking with `process.memoryUsage()`
- Timing with `performance.now()`
- Token usage tracking (see `src/shared/utils/token-tracking.ts`)
- Vector operation logging (very detailed output available)

### Common Debug Patterns
The codebase uses extensive console logging with prefixes like:
- `[ProcessKnowledge]` - Main processing pipeline
- `[VECTOR DEBUG]` - Vector generation debugging
- `[Background]` - Background processing (currently disabled)

## 🚀 Next Developer Recommendations

### Immediate Priorities
1. **Implement Parallel Extraction** - Easiest 75% performance gain
2. **Set up embedding deduplication** - Significant efficiency improvement
3. **Add transaction batching** - Database performance boost

### Code Quality Improvements
1. **Add comprehensive error handling** in parallel operations
2. **Implement proper retry mechanisms** for AI API calls
3. **Add circuit breakers** for external service failures
4. **Improve memory management** for large text processing

### Testing Enhancements
1. **Add integration tests** with real database
2. **Implement load testing** for concurrent operations
3. **Add API compatibility tests** between STDIO and HTTP transports
4. **Create regression test suite** for performance optimizations

### Architecture Considerations
1. **Consider caching layer** for frequently processed texts
2. **Evaluate queue-based processing** for large batch operations
3. **Implement progressive results streaming** for long-running operations
4. **Add horizontal scaling capabilities** for high-throughput scenarios

## 📝 Development Workflow Tips

### Before Making Changes
1. Run baseline performance benchmark to establish current metrics
2. Check existing tests pass: `pnpm run check`
3. Review the improvement plan in `improve_efficiency.md`

### After Making Changes
1. Run performance benchmarks to measure impact
2. Ensure all tests still pass
3. Update this learning file with new insights
4. Document any breaking changes or new environment requirements

### Code Style Notes
- Functions are pure with explicit dependencies (no hidden state)
- Use `Result<T>` types for error handling instead of throwing exceptions
- Path aliases (`~`) are preferred for imports
- Database operations should be wrapped in transactions
- All AI operations should include token usage tracking

This knowledge graph system has significant potential for optimization, and the performance testing infrastructure is now in place to measure and validate improvements systematically.