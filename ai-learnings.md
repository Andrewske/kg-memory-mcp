# AI Learnings - Knowledge Graph MCP Server

This file contains critical insights for working on the Knowledge Graph MCP Server. It focuses on information that prevents bugs, saves debugging time, and highlights architectural constraints.

## 📋 How to Use & Maintain This File

### When to ADD Information
✅ **Add** if it meets ANY of these criteria:
- **Silent failures**: Errors that don't throw exceptions or produce clear error messages
- **Architectural constraints**: Non-negotiable patterns (e.g., unified vector storage)
- **Performance gotchas**: Things that cause 2x+ slowdowns
- **Non-obvious solutions**: Solutions that took >2 hours to discover
- **Breaking changes**: Major refactors that change how agents should work

❌ **Don't add**:
- Historical performance data (keep only current baseline)
- Step-by-step debugging narratives
- Errors with clear stack traces
- Information redundant with CLAUDE.md or README.md
- Temporary workarounds (add TODOs instead)

### Where to UPDATE Information

| Type of Update | Section to Modify |
|----------------|-------------------|
| Performance baseline changes | → **Current Performance State** |
| New critical gotchas | → **Critical Implementation Details** |
| Completed optimizations | → Remove from **Active Work**, update **Current Performance State** |
| Architecture changes | → **Core Architecture Essentials** |
| New testing insights | → **Development & Testing** |
| Breaking changes | → **Critical Implementation Details** + add warning |

### Maintenance Guidelines
- **Quality bar**: "Would this save an agent 2+ hours of debugging?"
- **Conciseness**: If you add >50 lines, condense something else
- **Current state over history**: Replace old performance data, don't append
- **Examples**: One concise example per issue, not multiple variations

---

## 🏗️ Core Architecture Essentials

### Non-Negotiable Patterns

1. **Pure Functional Design**
   - No factory functions or hidden state
   - All dependencies passed explicitly as parameters
   - Functions return `Result<T>` types for errors
   - Example: `storeTriples(triples, db, embeddingMap, config)` not `storeTriples(triples)`

2. **Unified Vector Storage** ⚠️ CRITICAL
   - Single `vector_embeddings` table with `vector_type` field (ENTITY, RELATIONSHIP, SEMANTIC, CONCEPT)
   - **DO NOT** reference old table names: `entity_vectors`, `relationship_vectors`, `semantic_vectors`
   - All vector operations use: `await db.vectorEmbedding.create({ data: { vector_type: 'ENTITY', ... } })`

3. **Dual Transport Support**
   - STDIO (traditional MCP) and HTTP (REST API + SSE) run independently or together
   - Both transports share same tool handlers in `transport-manager.ts`
   - Environment flags: `ENABLE_STDIO_TRANSPORT`, `ENABLE_HTTP_TRANSPORT`

4. **3-Stage Processing Pipeline**
   - Jobs flow: EXTRACTION → CONCEPTS → DEDUPLICATION
   - Each stage uses pure functions in `src/features/knowledge-processing/handlers/`
   - QStash queue manages async processing with progress tracking

### Key Directories

```
src/
├── features/                      # Pure stateless functions (business logic)
│   ├── knowledge-extraction/      # AI-powered triple extraction
│   ├── conceptualization/         # Concept hierarchy generation
│   ├── deduplication/             # Semantic duplicate detection
│   ├── knowledge-graph/           # Graph operations and search
│   └── knowledge-processing/      # Job pipeline coordination
│       ├── handlers/              # Functional job handlers (CRITICAL)
│       │   ├── extraction-function.ts
│       │   ├── concept-function.ts
│       │   └── deduplication-function.ts
│       ├── pipeline-coordinator.ts
│       └── job-router.ts
├── server/                        # Transport implementations
│   ├── stdio-server.ts           # Traditional MCP
│   ├── http-server.ts            # Express.js HTTP server
│   ├── transport-manager.ts      # Shared tool handling
│   └── routes/                   # HTTP endpoint implementations
└── shared/                        # Shared infrastructure
    ├── database/                  # PostgreSQL operations
    │   ├── batch-storage.ts      # ⚠️ SQL injection risk (lines 368-388)
    │   └── vector-operations.ts  # Unified vector storage
    ├── services/                  # AI provider services
    ├── types/                     # TypeScript definitions
    └── utils/                     # Utility functions
```

---

## ⚡ Current Performance State

### Performance Baseline (October 2025)
- **Processing Speed**: ~20ms/token with gpt-4o-mini (68% improvement from original 66.6ms/token)
- **Primary Bottleneck**: AI extraction API calls (95% of processing time)
- **Highly Optimized Areas**:
  - Database operations: 526ms (0.8% of total time)
  - Embedding generation: 100% cache hit rate (0 duplicate API calls)
  - Parallel extraction: 4 stages run concurrently

### What's Already Optimized
✅ **Extraction**: Four-stage extraction runs in parallel using `Promise.allSettled()`
✅ **Embeddings**: `generateEmbeddingMap()` creates embeddings once, 70-80% cost reduction
✅ **Database**: Atomic transactions via `batchStoreKnowledge()`, 526ms storage time
✅ **Deduplication**: Semantic duplicate detection using embedding similarity (0.85 threshold)

### Known Performance Characteristics
- **Small Text (315 tokens)**: May timeout at 45s (API latency issues)
- **Medium Text (982 tokens)**: ~20s processing time
- **Large Text (2000+ tokens)**: Scales linearly with token count
- **Embedding Batch Size**: Default 100 (configurable via `BATCH_SIZE` env var)

---

## 🔧 Critical Implementation Details

### ⚠️ Things That Break Silently

#### 1. Vector Storage (MOST COMMON ERROR)
**Problem**: Using old table names or wrong patterns causes silent failures.

```typescript
// ❌ WRONG - These tables don't exist
await db.entity_vectors.create(...)
await db.relationship_vectors.create(...)

// ✅ CORRECT - Use unified table with vector_type
await db.vectorEmbedding.create({
  data: {
    entity_id: entityId,
    vector_type: 'ENTITY',
    vector: `[${embedding.join(',')}]::vector`,
    ...
  }
})
```

**Key Points**:
- All vectors stored in `vector_embeddings` table
- Use `vector_type` field: 'ENTITY' | 'RELATIONSHIP' | 'SEMANTIC' | 'CONCEPT'
- Vector format: `[${embedding.join(',')}]::vector` for raw SQL

#### 2. Embedding Deduplication (PERFORMANCE CRITICAL)
**Problem**: Not using `generateEmbeddingMap()` causes duplicate API calls (70-80% cost increase).

```typescript
// ❌ WRONG - Embeds same text multiple times
for (const triple of triples) {
  const embedding = await embeddingService.generateEmbedding(triple.subject);
}

// ✅ CORRECT - Generate embedding map once
const allTexts = [...new Set(triples.flatMap(t => [t.subject, t.object, t.predicate]))];
const embeddingMap = await generateEmbeddingMap(allTexts, embeddingService, config);
// Now lookup embeddings from map (no additional API calls)
```

**Implementation**: See `src/shared/database/batch-storage.ts:generateEmbeddingMap()`

#### 3. Database Transactions with Vectors
**Problem**: Prisma doesn't support `createMany()` for models with `Unsupported("vector")` fields.

```typescript
// ❌ WRONG - Fails silently with vector fields
await db.$transaction(async (tx) => {
  await tx.vectorEmbedding.createMany({ data: vectors }); // ERROR
});

// ✅ CORRECT - Separate core data and vectors
await db.$transaction(async (tx) => {
  await tx.knowledgeTriple.createMany({ data: triples });
  await tx.conceptNode.createMany({ data: concepts });
});
// Generate vectors AFTER transaction
await generateAndStoreVectorsPostTransaction(vectorData);
```

**Reason**: pgvector compatibility issue with Prisma bulk operations.

#### 4. SQL Injection Vulnerability ⚠️ SECURITY
**Location**: `src/shared/database/batch-storage.ts:368-388`

**Problem**: Raw SQL with string interpolation for vector storage:
```typescript
// ⚠️ VULNERABLE - Needs parameterization
const query = `INSERT INTO vector_embeddings (vector) VALUES ([${vector.join(',')}]::vector)`;
```

**Status**: Known issue, needs migration to Prisma parameterized queries or `Prisma.sql`.

### 🐛 Common Gotchas

#### Path Aliases in Tests
```typescript
// ❌ FAILS in Jest tests
import { processKnowledge } from '~/server/transport-manager.js';

// ✅ WORKS in Jest
import { processKnowledge } from '../../server/transport-manager';

// ✅ WORKS in tsx/runtime
import { processKnowledge } from '~/server/transport-manager.js';
```

**Solution**: Use `tsx` for performance tests, not Jest. Or use relative imports in Jest tests.

#### ES Module Issues
```typescript
// ❌ Not available in ES modules
const __dirname = dirname(__filename);

// ✅ Works in ES modules
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
```

#### Prisma Type Imports
```typescript
// ✅ Import database types from Prisma client
import type { KnowledgeTriple, ConceptNode } from '@prisma/client';
```

---

## 🧪 Development & Testing

### Essential Commands

```bash
# Performance Testing (RECOMMENDED)
pnpm run benchmark          # Quick baseline (small + medium, ~2-3 min)
pnpm run benchmark:full     # Full benchmark (all sizes, ~10-15 min)

# Development
pnpm run dev:stdio          # STDIO transport only
pnpm run dev:http           # HTTP transport only
pnpm run dev:dual           # Both transports

# Code Quality
pnpm run check              # Lint + typecheck + tests

# Database
pnpm run db:push            # Push schema changes
pnpm run db:studio          # Open Prisma Studio GUI
```

### Testing Strategy

#### Performance Testing ✅
```bash
# ✅ WORKS - Use these
pnpm run benchmark
npx tsx src/tests/performance/benchmark.js

# ❌ BROKEN - Jest has ES module issues
npx jest src/tests/performance/
```

**Why Jest Fails**: moduleNameMapper doesn't handle ES modules with `.js` extensions properly.

#### Performance Metrics to Track
- **Tokens/second**: Current baseline ~50 tok/s (20ms/token)
- **Time per token**: Current baseline ~20ms
- **Memory usage**: Should be <50MB for medium text (982 tokens)
- **API call efficiency**: Should be 0 duplicate embeddings (100% cache hit rate)
- **Extraction efficiency**: Triples per 1000 tokens varies by content

#### Test Fixtures
- **Small**: 315 tokens (timeout: 45s)
- **Medium**: 982 tokens (timeout: 80s)
- **Large**: ~2000 tokens (timeout: 120s)
- **XLarge**: ~4000+ tokens (timeout: 300s)

### Environment Variables (Performance-Related)

```bash
# AI Configuration
AI_MODEL="gpt-4o-mini"                    # Current default (fast)
EXTRACTION_METHOD="four-stage"            # vs "single-pass"
EMBEDDING_MODEL="text-embedding-3-small"

# Performance Tuning
BATCH_SIZE="100"                          # Embedding batch size (increased from 32)
SEARCH_TOP_K="10"                         # Initial search candidates
MIN_SCORE="0.7"                           # Similarity threshold
SEMANTIC_THRESHOLD="0.85"                 # Deduplication threshold
```

---

## 🚀 Active Work & Next Steps

### In Progress: Benchmark Deduplication Reporting (October 2025)

**Problem**: Pipeline benchmark reports showed inconsistent triple counts:
- Quality metrics: "24 triples stored"
- Raw extraction summary: "39 extracted, 39 kept" (wrong!)
- Reality: 39 extracted → 15 removed by database dedup → 24 stored

**Status**: Partially fixed
- ✅ `rawExtractionData.summary.total_kept` now shows actual stored count
- ❌ Individual triples not marked with database duplicate status
- ❌ Summary missing "Database Duplicates: 33" count

**Key Files**:
- `src/features/knowledge-processing/handlers/extraction-function.ts:220-268`
- `src/shared/database/batch-storage.ts` (checkExistingTriples)
- `src/benchmarks/pipeline.ts:185-222`

**What Still Needs Work**:
1. Add `DATABASE_DUPLICATE` status to triple markers
2. Capture which triples filtered during `checkExistingTriples()`
3. Update reports to show database duplicates separately from semantic duplicates

### Next Optimization: Text Generation vs Structured Output

**Current Bottleneck**: AI extraction takes 95% of processing time.

**Hypothesis**: Switching from `generateObject()` to `generateText()` + JSON parsing will be 40-50% faster.

**Current Approach (Slower)**:
```typescript
const response = await aiProvider.generateObject({
  model: 'gpt-4o-mini',
  schema: TripleSchema, // Zod schema validation during generation
  prompt: extractionPrompt
});
```

**Proposed Approach (40-50% Faster)**:
```typescript
const response = await aiProvider.generateText({
  model: 'gpt-4o-mini',
  prompt: `${extractionPrompt}\n\nReturn ONLY valid JSON, no markdown.`
});
const triples = JSON.parse(response.text);
const validated = TripleSchema.safeParse({ triples });
```

**Why Faster**:
- Structured output adds 40-50% overhead during generation
- Modern LLMs (gpt-4o-mini) are excellent at generating valid JSON
- Parsing + validation after generation is much faster than inline schema validation

**Expected Impact**:
- Current: 20ms/token → Optimized: 8-10ms/token (60% improvement)
- Small text: 2-3s, Medium text: 5-8s

**Implementation Location**: `src/shared/services/ai-provider-service.ts:32-38`

### Database Schema Notes

**Unified Vector Storage** (Updated August 2025):
- Single `vector_embeddings` table with polymorphic relationships
- `vector_type` field: 'ENTITY' | 'RELATIONSHIP' | 'SEMANTIC' | 'CONCEPT'
- Benefits: 60% code reduction, simpler maintenance, better bulk operations

**Key Tables**:
- `KnowledgeTriple`: Core relationship storage with extraction metadata
- `ConceptNode`: Hierarchical concept abstractions
- `VectorEmbedding`: Unified vector storage (replaces 4 separate tables)
- `ConceptualizationRelationship`: Links entities to concepts
- `ProcessingJob`: QStash job tracking with progress updates

---

## 📊 Code Quality & Style

### Functional Programming Patterns
- **Functions**: ≤20 lines, ≤3 nesting levels, single purpose
- **No classes**: Use pure functions, not OOP patterns (except framework requirements)
- **Explicit dependencies**: All parameters passed explicitly
- **Result types**: Return `Result<T>` for error handling

### Error Handling
- Database errors: Return `Result<T>` with error details
- AI API failures: Retry logic with exponential backoff
- Validation errors: Zod schema validation with detailed messages
- Never log sensitive information (API keys, user data)

### Debugging
```bash
# Useful debug environment variables
LOG_LEVEL="DEBUG"           # Detailed logging
DIAGNOSTIC_MODE="true"      # Full request/response payloads
LOG_TO_STDERR="true"        # Logs to stderr for debugging
```

**Common Debug Prefixes**:
- `[ProcessKnowledge]` - Main processing pipeline
- `[VECTOR DEBUG]` - Vector generation debugging
- `[Background]` - Background processing (currently disabled)

---

## 🎯 Summary

This knowledge graph system has been extensively optimized:
- ✅ **Extraction**: Parallel four-stage processing
- ✅ **Embeddings**: Zero duplicate API calls (70-80% cost reduction)
- ✅ **Database**: Atomic transactions (526ms, 0.8% of total time)
- ✅ **Architecture**: Pure functional design with unified vector storage

**Next high-impact optimization**: Replace structured output with text generation (40-50% potential improvement).

**Critical warnings**:
- ⚠️ SQL injection vulnerability in batch-storage.ts:368-388
- ⚠️ Always use unified `vector_embeddings` table (not separate tables)
- ⚠️ Always use `generateEmbeddingMap()` to avoid duplicate embeddings
- ⚠️ Use `pnpm run benchmark` for performance testing (not Jest)
