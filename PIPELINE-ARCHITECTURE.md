# 3-Job Hybrid Pipeline Architecture

## Overview

The Knowledge Graph MCP Server has been upgraded to use a **3-job hybrid pipeline** architecture that maintains all current optimizations while enabling better scalability and timeout prevention.

## Architecture

### Previous Architecture (Monolithic)
```
processKnowledge() → [All operations sequentially] → Result
```

### New Architecture (3-Job Hybrid)
```
processKnowledge() → initiate pipeline → Parent Job Created
                                       ↓
Stage 1: EXTRACT_KNOWLEDGE_BATCH → [4 parallel extractions + storage]
                                       ↓ (smart scheduling)
Stage 2: GENERATE_CONCEPTS → [AI concept generation]
                                       ↓ (smart scheduling)  
Stage 3: DEDUPLICATE_KNOWLEDGE → [Semantic deduplication]
```

## Key Benefits

1. **Preserves Current Optimizations**
   - ✅ Embedding map prevents duplicate generation
   - ✅ Batch transaction storage maintains atomicity
   - ✅ Parallel extraction (4 simultaneous AI calls)
   - ✅ Smart text chunking for large inputs

2. **Eliminates Timeout Issues**
   - ✅ Work distributed across multiple jobs
   - ✅ Each job has independent timeout limits
   - ✅ Partial failures don't lose all work

3. **Better Monitoring & Control**
   - ✅ Real-time progress tracking per stage
   - ✅ Individual job status and metrics
   - ✅ Resource usage monitoring

4. **Improved Scalability**
   - ✅ Jobs can be processed on different workers
   - ✅ Resource limits prevent overwhelm
   - ✅ Smart scheduling based on actual completion

## Job Types

### 1. EXTRACT_KNOWLEDGE_BATCH (Stage 1)
- **Purpose**: Coordinate parallel extraction of all triple types
- **Input**: Raw text, source metadata
- **Process**:
  1. Text chunking (if >3000 tokens)
  2. 4 parallel extractions (entity-entity, entity-event, event-event, emotional-context)
  3. Generate comprehensive embedding map (once)
  4. Deduplicate triples using embedding map
  5. Batch store all data in atomic transaction
  6. Schedule Stage 2 jobs
- **Output**: Stored triples, concepts, and vectors

### 2. GENERATE_CONCEPTS (Stage 2)
- **Purpose**: Generate high-level conceptual abstractions
- **Input**: Stored triples from Stage 1
- **Process**:
  1. Read all triples for source
  2. Extract elements (entities, events)
  3. Generate concepts using AI
  4. Store concepts and relationships
- **Output**: Stored concept nodes and relationships

### 3. DEDUPLICATE_KNOWLEDGE (Stage 3, Optional)
- **Purpose**: Remove semantic duplicates across all stored data
- **Input**: All stored triples for source
- **Process**:
  1. Load all triples
  2. Generate embeddings for comparison
  3. Identify duplicates using similarity thresholds
  4. Remove duplicates and associated vectors
- **Output**: Cleaned, deduplicated knowledge graph

## Usage

### Basic Usage
```javascript
import { processKnowledge } from '~/server/transport-manager.js';

const result = await processKnowledge({
  text: "Your text content here...",
  source: "document_123",
  source_type: "document", 
  source_date: "2024-01-01T00:00:00.000Z"
});

console.log('Pipeline initiated:', result.data.parentJobId);
```

### Monitoring Progress
```javascript
import { getPipelineStatusTool } from '~/server/transport-manager.js';

const status = await getPipelineStatusTool({
  parentJobId: "your-parent-job-id"
});

console.log('Pipeline status:', status.data);
```

### MCP Tool Calls
```json
// Process knowledge
{
  "name": "process_knowledge",
  "arguments": {
    "text": "Your text content...",
    "source": "document_123",
    "source_type": "document",
    "source_date": "2024-01-01T00:00:00.000Z"
  }
}

// Check progress
{
  "name": "get_pipeline_status", 
  "arguments": {
    "parentJobId": "returned-job-id"
  }
}
```

## Configuration

### Environment Variables
```bash
# AI Configuration
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
EXTRACTION_METHOD=four-stage
EXTRACTION_TEMPERATURE=0.1

# Pipeline Configuration
BATCH_SIZE=100
MAX_CHUNK_TOKENS=3000
ENABLE_SEMANTIC_DEDUP=true
SEMANTIC_THRESHOLD=0.85

# QStash (for job scheduling)
QSTASH_TOKEN=your-qstash-token
HTTP_SERVER_URL=https://your-server.com
```

### Resource Limits (Per Job)
```javascript
const resourceLimits = {
  maxConnections: 2,    // Database connections
  maxAICalls: 4,       // Parallel AI operations  
  maxMemoryMB: 2048,   // Memory limit
};
```

## Database Schema

### Enhanced ProcessingJob Model
```prisma
model ProcessingJob {
  id            String     @id @default(dbgenerated("gen_random_uuid()"))
  job_type      JobType    @default(PROCESS_KNOWLEDGE)
  parent_job_id String?    // For job hierarchy
  stage         JobStage?  // Pipeline stage tracking
  text          String     @db.Text
  metadata      Json       @default("{}")
  status        JobStatus  @default(QUEUED)
  progress      Int        @default(0) // 0-100 progress
  result        Json?
  metrics       Json       @default("{}") // Performance metrics
  // ... standard fields
}
```

### Job Status Tracking
- `QUEUED` → `PROCESSING` → `COMPLETED`/`FAILED`
- Progress: 0-100 for granular tracking
- Metrics: Processing time, resource usage, etc.

## Error Handling

### Graceful Degradation
- Stage 1 failures: Continue with partial extraction results
- Stage 2 failures: Knowledge still available from Stage 1
- Stage 3 failures: Non-critical, original data preserved

### Retry Logic
- Built-in retry mechanism for failed jobs
- Configurable retry limits (default: 3)
- Exponential backoff for transient failures

### Monitoring
- Job-level error tracking
- Performance metrics collection  
- Resource usage monitoring
- Alert thresholds for anomalies

## Performance Improvements

### Expected Improvements
- **Timeout Prevention**: 90% reduction in timeouts for large texts
- **Resource Efficiency**: 50% better resource utilization
- **Monitoring**: Real-time visibility into processing stages
- **Fault Tolerance**: Partial failures don't lose all work

### Benchmark Results
(Run tests to populate actual metrics)
- Baseline processing time: TBD
- New pipeline time: TBD  
- Memory usage: TBD
- Success rate improvement: TBD

## Testing

### Run Integration Tests
```bash
# Run pipeline integration tests
pnpm run test src/tests/performance/pipeline-integration.test.ts

# Run full test suite
pnpm run test

# Run with coverage
pnpm run test:coverage
```

### Manual Testing
```bash
# Start development server
pnpm run dev

# Test with small document
curl -X POST http://localhost:3000/api/knowledge \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Test content...",
    "source": "test",
    "source_type": "manual",
    "source_date": "2024-01-01T00:00:00.000Z"
  }'

# Check status
curl -X GET "http://localhost:3000/api/pipeline/status/{parentJobId}"
```

## Migration Notes

### Backwards Compatibility
- ✅ Existing `process_knowledge` calls work unchanged
- ✅ Legacy job types are handled for transition period  
- ✅ All current optimizations preserved

### Deployment Strategy
1. Deploy new code with feature flag disabled
2. Test pipeline with small subset of traffic
3. Gradually increase traffic to new pipeline
4. Monitor performance and error rates
5. Full migration after validation

## Troubleshooting

### Common Issues

#### Pipeline Stuck
```bash
# Check job status in database
SELECT id, job_type, status, progress, error_message 
FROM processing_jobs 
WHERE parent_job_id = 'your-parent-id';

# Retry failed jobs manually
UPDATE processing_jobs 
SET status = 'QUEUED', retry_count = retry_count + 1 
WHERE id = 'failed-job-id';
```

#### QStash Issues
- Verify `QSTASH_TOKEN` is set correctly
- Check `HTTP_SERVER_URL` is accessible
- Monitor QStash dashboard for failed deliveries

#### Performance Issues
- Check resource limits in job metadata
- Monitor database connection pool
- Review AI API rate limits
- Check memory usage and GC pressure

### Logging
Enable detailed logging:
```bash
LOG_LEVEL=DEBUG pnpm run dev
```

Key log prefixes:
- `[BatchExtraction]` - Stage 1 processing
- `[ConceptGeneration]` - Stage 2 processing  
- `[Deduplication]` - Stage 3 processing
- `[PipelineCoordinator]` - Job scheduling
- `[JobRouter]` - Job routing and status

## Future Enhancements

### Planned Improvements
1. **Auto-scaling**: Dynamic resource allocation based on load
2. **Streaming Results**: Return partial results as stages complete
3. **Priority Queues**: High-priority job processing
4. **Advanced Monitoring**: Prometheus metrics, Grafana dashboards
5. **Multi-tenant**: Isolated processing for different sources

### Configuration Options
1. **Stage Skipping**: Allow skipping concepts or deduplication
2. **Custom Scheduling**: User-defined delays between stages  
3. **Resource Profiles**: Different limits for different job types
4. **Batching**: Group similar jobs for efficiency

The new architecture provides a solid foundation for these future enhancements while maintaining the robustness and performance of the current system.