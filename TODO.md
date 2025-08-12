# TODO - Knowledge Graph MCP Server

## = Enhanced Debug Logging System

**Priority: High** - Based on recent debugging session that revealed critical data capture issues

### **Problem Solved**
Pipeline reports were showing "0 triples extracted" despite logs showing "36 triples stored" due to:
- Source field mismatches (`pipeline-test-123` vs `pipeline-test-123_chunk_0`)
- Timing issues with post-transaction operations
- Query relationship problems with vector embeddings
- Lack of visibility into data flow transformations

### **Logging Strategy Tasks**

#### **1. Create Centralized Debug Logger** 
- [ ] Create `src/shared/utils/debug-logger.ts`
- [ ] Support structured JSON logging with configurable levels
- [ ] Include operation context, timing, and data state in all logs
- [ ] Add environment-based debug configuration (`DEBUG_LEVEL`, `DEBUG_EXTRACTION`, etc.)

#### **2. Data Flow & State Transition Logging**
- [ ] **Source Field Tracking**: Log all source transformations (`source` ’ `source_chunk_0`)
- [ ] **Query Parameter Logging**: Show exact query parameters vs expected results
- [ ] **State Snapshots**: Log data counts before/after major operations
- [ ] **Cross-Reference Validation**: Verify data consistency between related operations

#### **3. Database Operation Enhancement**
- [ ] **Query Logging**: Log all database queries with parameters and result counts
- [ ] **Timing Boundaries**: Track transaction vs post-transaction operations
- [ ] **Relationship Validation**: Verify foreign key relationships in complex queries
- [ ] **Sample Data Logging**: Show sample results for debugging (with PII protection)

#### **4. Pipeline Coordination Logging**
- [ ] **Job Lifecycle**: Track job creation, processing, and completion
- [ ] **Progress Correlation**: Link progress updates to actual data changes
- [ ] **Error Context**: Include full operation context in error messages
- [ ] **Dependency Tracking**: Log relationships between jobs and data

#### **5. Report Generation Debugging**
- [ ] **Query vs Results**: Always log what's queried vs what's found
- [ ] **Data Consistency Checks**: Validate report data against database state
- [ ] **Timing Analysis**: Track when queries run relative to data creation
- [ ] **Source Pattern Matching**: Verify pattern queries work correctly

### **Implementation Patterns That Worked**

```typescript
// 1. Query Parameter + Result Logging
console.log(`[COMPONENT] Querying with pattern: ${pattern}*`);
console.log(`[COMPONENT] Found ${results.length} matching records`);
if (results.length > 0) {
  console.log(`[COMPONENT] Sample sources:`, [...new Set(results.slice(0,3).map(r => r.source))]);
}

// 2. State Transition Tracking  
console.log(`[COMPONENT] Input: ${input.length} items`);
console.log(`[COMPONENT] Processed: ${processed.length} items`);  
console.log(`[COMPONENT] Output: ${output.length} items`);

// 3. Timing & Dependencies
console.log(`[COMPONENT] Waiting for post-transaction operations...`);
console.log(`[COMPONENT] Operation completed: ${result.success ? '' : 'L'}`);
```

### **Expected Benefits**
- **Faster Debugging**: Clear visibility into data transformations and mismatches
- **Proactive Issue Detection**: Catch source field and timing issues before they cause silent failures
- **Production Monitoring**: Structured logs for observability and monitoring
- **Self-Documenting Code**: Rich operation context makes code easier to understand and maintain

---

## =€ Future Enhancements

### **Performance Optimization**
- [ ] Implement batch processing optimizations
- [ ] Add caching layer for frequently accessed embeddings
- [ ] Optimize database queries and indexes

### **API & Integration**
- [ ] Complete OpenAPI documentation
- [ ] Add rate limiting and security enhancements
- [ ] Implement webhooks for job completion notifications

### **Testing & Quality**
- [ ] Expand integration test coverage
- [ ] Add performance benchmarking suite
- [ ] Implement chaos testing for reliability validation