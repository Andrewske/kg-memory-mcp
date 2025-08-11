# Performance Optimization Plan for processKnowledge

## Current Performance Issues
The `processKnowledge` function is timing out with 4000+ token inputs due to several bottlenecks in the extraction, conceptualization, and storage pipeline.

## ✅ Implementation Validation
After reviewing the actual codebase implementation, all optimizations have been validated:
- **Four-stage extraction** is indeed sequential (src/features/knowledge-extraction/extract.ts:172-182)
- **Duplicate embeddings** confirmed in multiple locations
- **Conceptualization** runs inline, with commented-out background code
- **Database operations** lack transaction batching
- **Vector duplication** exists for entities in multiple triples

## Top 5 Optimization Recommendations (Ranked by Impact)

### 1. **Parallel Processing of Four-Stage Extraction** (Highest Impact - 75% improvement)

**Current Issue:**
```typescript
// Sequential processing - 4 separate AI calls one after another
for (const type of ['ENTITY_ENTITY', 'ENTITY_EVENT', 'EVENT_EVENT', 'EMOTIONAL_CONTEXT']) {
    const result = await extractByType(data, type); // Each waits for the previous!
}
```

**Solution:**
```typescript
// Parallel processing - All 4 AI calls simultaneously
const extractionPromises = [
    'ENTITY_ENTITY',
    'ENTITY_EVENT', 
    'EVENT_EVENT',
    'EMOTIONAL_CONTEXT'
].map(type => extractByType(data, type));

const results = await Promise.all(extractionPromises);
```

**Expected Impact:** Reduce extraction time from ~4x to ~1x (75% reduction)

### 2. **Batch Embedding Generation and Reuse** (High Impact - 50-60% improvement)

**Current Issue:**
- Embeddings generated multiple times for the same text:
  - During deduplication (all triples)
  - During entity vector storage (duplicates for each triple)
  - During relationship vector storage
  - During semantic vector storage

**Solution:**
```typescript
// Generate all embeddings once at the beginning
const allTexts = [
    ...new Set([
        ...triples.map(t => t.subject),
        ...triples.map(t => t.object),
        ...triples.map(t => t.predicate),
        ...triples.map(t => `${t.subject} ${t.predicate} ${t.object}`)
    ])
];

const embeddingMap = await generateEmbeddingMap(allTexts, embeddingService);
// Reuse embeddingMap throughout the pipeline
```

**Expected Impact:** Reduce embedding API calls by 50-60%

### 3. **Optimize Conceptualization Integration** (High Impact - 30-40% improvement)

**Current Issue:**
- Conceptualization runs inline, blocking the main flow
- Makes additional AI call after extraction completes
- Sequential with other operations

**Solution Options:**

**Option A: Parallel Processing**
```typescript
// Run conceptualization in parallel with deduplication/storage
const [deduplicationResult, conceptResult] = await Promise.all([
    deduplicateTriples(triples, embeddingService),
    generateConcepts(conceptInput, metadata)
]);
```

**Option B: Background Processing**
```typescript
// Queue conceptualization for background processing
queueConceptualization(triples, metadata); // Non-blocking
```

**Expected Impact:** 30-40% reduction in total processing time

### 4. **Database Operations Optimization** (Medium Impact - 20-30% improvement)

**Current Issues:**
- Multiple separate DB queries
- Sequential storage operations
- No transaction batching

**Solutions:**
```typescript
// Batch all DB operations in a transaction
await prisma.$transaction(async (tx) => {
    // Check all existing triples in one query
    const existingIds = await tx.knowledgeTriple.findMany({
        where: { id: { in: tripleIds } },
        select: { id: true }
    });
    
    // Bulk insert all new data
    await Promise.all([
        tx.knowledgeTriple.createMany({ data: newTriples }),
        tx.conceptNode.createMany({ data: concepts }),
        tx.conceptualization.createMany({ data: conceptualizations })
    ]);
});
```

**Configuration Changes:**
```env
# Increase connection pool
DB_MAX_CONNECTIONS=20  # From 10
DB_CONNECTION_TIMEOUT=10000  # From 5000
```

**Expected Impact:** 20-30% reduction in database latency

### 5. **Reduce Redundant Vector Generation** (Medium Impact - 30-40% improvement)

**Current Issue:**
```typescript
// Creates duplicate embeddings for entities appearing in multiple triples
for (const triple of triples) {
    if (triple.subject === entity || triple.object === entity) {
        entityVectors.push({
            embedding, // Same embedding stored multiple times!
            knowledge_triple_id: triple.id
        });
    }
}
```

**Solution:**
```typescript
// Store unique vectors with junction table
const uniqueEntityVectors = new Map();
for (const entity of uniqueEntities) {
    uniqueEntityVectors.set(entity, {
        vector_id: generateVectorId(entity),
        text: entity,
        embedding: embeddingMap.get(entity)
    });
}

// Create junction table entries linking vectors to triples
const vectorTripleLinks = [];
for (const triple of triples) {
    if (uniqueEntityVectors.has(triple.subject)) {
        vectorTripleLinks.push({
            vector_id: uniqueEntityVectors.get(triple.subject).vector_id,
            triple_id: triple.id
        });
    }
    // Similar for object...
}
```

**Expected Impact:** 30-40% reduction in vector storage operations

## Additional Quick Wins

### 1. **Increase Batch Sizes**
```typescript
// In env.ts
BATCH_SIZE=100  // From 32
```

### 2. **Conditional Debug Logging**
```typescript
// Add debug flag
const DEBUG = env.LOG_LEVEL === 'DEBUG';
if (DEBUG) console.log('[ProcessKnowledge] Starting...');
```

### 3. **Pre-compile Zod Schemas**
```typescript
// Move schema compilation outside of function calls
const COMPILED_TRIPLE_SCHEMA = TripleSchema.parse.bind(TripleSchema);
const COMPILED_CONCEPT_SCHEMA = ConceptSchema.parse.bind(ConceptSchema);
```

### 4. **Implement Text Chunking for Large Inputs**
```typescript
// For texts > 3000 tokens, process in chunks
if (tokenCount > 3000) {
    const chunks = splitIntoChunks(text, 2000);
    const chunkResults = await Promise.all(
        chunks.map(chunk => processChunk(chunk))
    );
    return mergeChunkResults(chunkResults);
}
```

### 5. **Add Caching Layer**
```typescript
// Cache frequently seen patterns
const cacheKey = generateCacheKey(text);
const cached = await cache.get(cacheKey);
if (cached) return cached;
```

## 🧪 Performance Testing Strategy

### Test Harness Development (PHASE 0 - MUST DO FIRST)
Create a performance benchmarking test that:
1. **Runs the full processKnowledge pipeline** without database writes
2. **Generates detailed timing reports** for each stage:
   - Extraction time (total and per-type for four-stage)
   - Deduplication time
   - Embedding generation time (with call counts)
   - Conceptualization time
   - Mock storage time
3. **Outputs comparison report** including:
   - Token count of input
   - Number of triples extracted
   - Number of concepts generated
   - Total embeddings generated
   - Duplicate embeddings identified
   - Total processing time
   - Memory usage

```typescript
// Test structure example
interface PerformanceReport {
  inputTokens: number;
  extractionTime: {
    total: number;
    perStage?: Record<string, number>;
  };
  deduplicationTime: number;
  embeddingStats: {
    totalCalls: number;
    uniqueTexts: number;
    duplicates: number;
    time: number;
  };
  conceptualizationTime: number;
  results: {
    triplesExtracted: number;
    conceptsGenerated: number;
    vectorsCreated: number;
  };
  totalTime: number;
  memoryUsed: number;
}
```

## Implementation Priority (Updated)

### **Phase 0: Test Infrastructure (2-3 hours)**
1. Create performance test harness with mock database
2. Generate baseline performance report with current implementation
3. Create test dataset with various text sizes (500, 1000, 2000, 4000+ tokens)
4. Implement automated comparison reporting

### **Phase 1: Parallel Extraction (2-3 hours)**
1. Implement parallel four-stage extraction using Promise.allSettled()
2. Add proper error handling for failed extraction stages
3. Run performance tests and compare to baseline
4. Expected: 60-75% improvement on extraction phase

### **Phase 2: Embedding Optimization (3-4 hours)**
1. Implement embedding map/reuse pattern
2. Generate all unique embeddings once at start
3. Remove duplicate vector generation in storage
4. Increase BATCH_SIZE to 100
5. Run performance tests
6. Expected: Additional 40-50% overall improvement

### **Phase 3: Architecture Improvements (4-5 hours)**
1. Re-enable and fix background conceptualization
2. Implement database transaction batching
3. Add text chunking for >3000 tokens
4. Remove conditional debug logging
5. Run performance tests
6. Expected: Additional 20-30% improvement

### **Phase 4: Advanced Optimizations (Optional, 3-4 hours)**
1. Implement single-pass extraction option
2. Smart model switching based on text size
3. Progressive processing with streaming
4. Run final performance tests
5. Expected: Additional 15-20% improvement

## Expected Overall Impact

- **Current baseline (from test):** Establish via Phase 0
- **After Phase 1:** 60-75% faster extraction
- **After Phase 2:** 80-85% total improvement
- **After Phase 3:** 85-90% total improvement 
- **After Phase 4:** 90-95% total improvement

**Total expected improvement: 85-95% reduction in processing time**

## Additional Discoveries & Considerations

### 🔍 Existing Infrastructure to Leverage
1. **QStash Queue System** already exists (src/server/routes/queue.ts)
   - Can be used for large job processing
   - Already has job status tracking
   
2. **Background Conceptualization** code exists but commented out
   - Investigate why it was disabled
   - May have had issues that need addressing

3. **Batch Size Configuration** already in place
   - Current: 32, can easily increase to 100

4. **Single-Pass Extraction** already implemented
   - Switch via EXTRACTION_METHOD env variable
   - Test quality vs performance tradeoff

### ⚠️ Important Implementation Notes

1. **No Backwards Compatibility Needed**
   - Can make breaking changes to improve performance
   - Simplifies implementation significantly

2. **Error Handling in Parallel Operations**
   - Use Promise.allSettled() instead of Promise.all()
   - Ensures partial failures don't lose all data

3. **Database Index Optimization**
   - Add indexes for frequently queried fields
   - Consider composite indexes for search patterns

4. **Memory Management**
   - Monitor memory usage with larger batch sizes
   - Implement streaming for very large texts

### Alternative Considerations

#### Single-Pass vs Four-Stage Extraction
- **Current:** gpt-5-nano (already very fast)
- **Single-pass:** 1 AI call vs 4 (75% faster)
- **Quality tradeoff:** Test with performance harness

#### Model Selection Strategy
- **Small texts (<1000 tokens):** Keep current fast model
- **Large texts (>3000 tokens):** Consider chunking
- **Auto-switching:** Based on token count

#### Progressive Processing
- Return partial results as they complete
- Stream results back to client
- Useful for real-time feedback

## Monitoring and Metrics

Add performance monitoring:
```typescript
const metrics = {
    extraction_time: 0,
    deduplication_time: 0,
    storage_time: 0,
    embedding_time: 0,
    conceptualization_time: 0,
    total_time: 0
};

// Track each operation
const start = Date.now();
// ... operation ...
metrics.extraction_time = Date.now() - start;
```

## Performance Test Implementation Details

### Test File Structure
```
/src/tests/performance/
├── process-knowledge-benchmark.test.ts  # Main test file
├── fixtures/                            # Test data
│   ├── small-text.txt      # 500 tokens
│   ├── medium-text.txt     # 1000 tokens
│   ├── large-text.txt      # 2000 tokens
│   └── xlarge-text.txt     # 4000+ tokens
├── mocks/                               # Mock implementations
│   ├── mock-database.ts    # In-memory database
│   ├── mock-embedding.ts   # Track embedding calls
│   └── mock-ai-provider.ts # Optional: mock AI responses
└── reports/                             # Generated reports
    └── baseline.json        # Initial performance baseline
```

### Test Implementation Example
```typescript
// process-knowledge-benchmark.test.ts
import { performance } from 'perf_hooks';

describe('ProcessKnowledge Performance Benchmark', () => {
  let mockDb: MockDatabase;
  let mockEmbedding: MockEmbeddingService;
  let report: PerformanceReport;

  beforeEach(() => {
    mockDb = new MockDatabase();
    mockEmbedding = new MockEmbeddingService();
    report = initializeReport();
  });

  it('should benchmark processKnowledge with 4000+ tokens', async () => {
    const text = await loadFixture('xlarge-text.txt');
    const startTime = performance.now();
    const startMemory = process.memoryUsage();

    // Track extraction phases
    const extractionStart = performance.now();
    const result = await processKnowledgeBenchmark({
      text,
      source: 'test',
      source_type: 'benchmark',
      source_date: new Date().toISOString(),
    }, {
      db: mockDb,
      embeddingService: mockEmbedding,
      onPhaseComplete: (phase, duration) => {
        report[phase + 'Time'] = duration;
      }
    });

    // Calculate totals
    report.totalTime = performance.now() - startTime;
    report.memoryUsed = process.memoryUsage().heapUsed - startMemory.heapUsed;
    
    // Gather statistics
    report.embeddingStats = mockEmbedding.getStatistics();
    report.results = {
      triplesExtracted: result.triples.length,
      conceptsGenerated: result.concepts.length,
      vectorsCreated: mockDb.vectors.length,
    };

    // Save or compare report
    await saveReport(report);
    console.log('Performance Report:', report);
    
    // Assertions for regression testing
    expect(report.totalTime).toBeLessThan(15000); // 15 seconds max
  });
});
```

### Mock Services Implementation
```typescript
// mock-embedding.ts
class MockEmbeddingService {
  private callCount = 0;
  private uniqueTexts = new Set<string>();
  private duplicates = 0;

  async embedBatch(texts: string[]) {
    this.callCount++;
    texts.forEach(text => {
      if (this.uniqueTexts.has(text)) {
        this.duplicates++;
      } else {
        this.uniqueTexts.add(text);
      }
    });
    // Return mock embeddings
    return texts.map(() => new Array(1536).fill(0.1));
  }

  getStatistics() {
    return {
      totalCalls: this.callCount,
      uniqueTexts: this.uniqueTexts.size,
      duplicates: this.duplicates,
    };
  }
}
```

## Testing Recommendations

1. **Run baseline benchmark** before any changes
2. **Test each optimization phase** independently
3. **Compare reports** between phases
4. **Test with real AI calls** periodically (not just mocks)
5. **Monitor for quality regression** in extraction
6. **Load test** with concurrent operations
7. **Profile memory usage** with heap snapshots

## Configuration Recommendations

```env
# Optimal settings for performance
EXTRACTION_METHOD=single-pass  # If quality is acceptable
BATCH_SIZE=100
DB_MAX_CONNECTIONS=20
ENABLE_SEMANTIC_DEDUP=false  # Disable if not critical
AI_MODEL=gpt-3.5-turbo  # Faster model if quality acceptable
LOG_LEVEL=INFO  # Reduce logging overhead
```