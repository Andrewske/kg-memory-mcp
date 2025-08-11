import { performance } from 'perf_hooks';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { processKnowledge } from '~/server/transport-manager.js';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import { MockDatabase } from './mocks/mock-database.js';
import { MockEmbeddingService } from './mocks/mock-embedding.js';
import { MockAIProvider } from './mocks/mock-ai-provider.js';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PerformanceReport {
  testName: string;
  inputTokens: number;
  textLength: number;
  phases: {
    extraction: {
      total: number;
      perStage?: Record<string, number>;
      aiStats?: any;
    };
    deduplication: {
      time: number;
      originalCount: number;
      deduplicatedCount: number;
    };
    embedding: {
      time: number;
      stats: any;
    };
    conceptualization: {
      time: number;
      conceptsGenerated: number;
      relationshipsGenerated: number;
    };
    storage: {
      time: number;
      triplesStored: number;
      vectorsStored: number;
      conceptsStored: number;
    };
  };
  results: {
    triplesExtracted: number;
    triplesStored: number;
    conceptsGenerated: number;
    vectorsCreated: number;
  };
  totalTime: number;
  memoryUsed: number;
}

class PerformanceBenchmark {
  private mockDb: MockDatabase;
  private mockEmbedding: MockEmbeddingService;
  private mockAI: MockAIProvider;

  constructor() {
    this.mockDb = new MockDatabase();
    this.mockEmbedding = new MockEmbeddingService();
    this.mockAI = new MockAIProvider();
  }

  reset() {
    this.mockDb.reset();
    this.mockEmbedding.reset();
    this.mockAI.reset();
  }

  async benchmarkProcessKnowledge(args: ProcessKnowledgeArgs): Promise<PerformanceReport> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    
    // Estimate token count (rough approximation: 4 chars per token)
    const estimatedTokens = Math.ceil(args.text.length / 4);

    const report: PerformanceReport = {
      testName: `processKnowledge-${estimatedTokens}tokens`,
      inputTokens: estimatedTokens,
      textLength: args.text.length,
      phases: {
        extraction: { total: 0 },
        deduplication: { time: 0, originalCount: 0, deduplicatedCount: 0 },
        embedding: { time: 0, stats: {} },
        conceptualization: { time: 0, conceptsGenerated: 0, relationshipsGenerated: 0 },
        storage: { time: 0, triplesStored: 0, vectorsStored: 0, conceptsStored: 0 },
      },
      results: { triplesExtracted: 0, triplesStored: 0, conceptsGenerated: 0, vectorsCreated: 0 },
      totalTime: 0,
      memoryUsed: 0,
    };

    try {
      // Phase 1: Knowledge Extraction
      console.log('Starting extraction phase...');
      const extractionStart = performance.now();
      
      // Mock the AI extraction - for now we'll use the actual function but with potential to mock
      const extractionResult = await extractKnowledgeTriples(args);
      
      report.phases.extraction.total = performance.now() - extractionStart;
      report.phases.extraction.aiStats = this.mockAI.getStatistics();

      if (!extractionResult.success || !extractionResult.data) {
        throw new Error(`Extraction failed: ${extractionResult.error?.message}`);
      }

      let { triples, concepts, conceptualizations } = extractionResult.data;
      report.results.triplesExtracted = triples.length;
      report.results.conceptsGenerated = concepts.length;

      // Phase 2: Deduplication
      console.log('Starting deduplication phase...');
      const deduplicationStart = performance.now();
      
      if (triples.length > 0) {
        // Use mock embedding service for deduplication
        const deduplicationResult = await deduplicateTriples(triples, this.mockEmbedding);
        if (deduplicationResult.success && deduplicationResult.data) {
          report.phases.deduplication.originalCount = triples.length;
          triples = deduplicationResult.data.uniqueTriples;
          report.phases.deduplication.deduplicatedCount = triples.length;
        }
      }
      
      report.phases.deduplication.time = performance.now() - deduplicationStart;

      // Phase 3: Embedding Generation (tracked by mock service)
      const embeddingStart = performance.now();
      // Embedding generation is tracked within the mock service during deduplication
      report.phases.embedding.time = performance.now() - embeddingStart;
      report.phases.embedding.stats = this.mockEmbedding.getStatistics();

      // Phase 4: Storage (with mock database)
      console.log('Starting storage phase...');
      const storageStart = performance.now();
      
      // Store triples
      if (triples.length > 0) {
        await this.mockDb.storeTriples(triples);
        
        // Store vectors (simulate the vector storage that happens in storeTriples)
        const uniqueEntities = new Set([
          ...triples.map(t => t.subject),
          ...triples.map(t => t.object)
        ]);
        
        const entityVectors = Array.from(uniqueEntities).map(entity => ({
          text: entity,
          embedding: new Array(1536).fill(0.1),
          knowledge_triple_id: 'test-id',
          metadata: {}
        }));
        
        await this.mockDb.storeEntityVectors(entityVectors);
        
        // Store relationship vectors
        const relationshipVectors = triples.map(triple => ({
          text: triple.predicate,
          embedding: new Array(1536).fill(0.1),
          knowledge_triple_id: triple.id,
          metadata: {}
        }));
        
        await this.mockDb.storeRelationshipVectors(relationshipVectors);
        
        // Store semantic vectors
        const semanticVectors = triples.map(triple => ({
          text: `${triple.subject} ${triple.predicate} ${triple.object}`,
          embedding: new Array(1536).fill(0.1),
          knowledge_triple_id: triple.id,
          metadata: {}
        }));
        
        await this.mockDb.storeSemanticVectors(semanticVectors);
      }
      
      // Store concepts
      if (concepts.length > 0) {
        await this.mockDb.storeConcepts(concepts);
      }
      
      // Store conceptualizations
      if (conceptualizations.length > 0) {
        await this.mockDb.storeConceptualizations(conceptualizations);
      }
      
      report.phases.storage.time = performance.now() - storageStart;
      report.phases.storage.triplesStored = triples.length;
      report.phases.storage.conceptsStored = concepts.length;
      
      // Calculate final results
      report.results.triplesStored = triples.length;
      report.results.vectorsCreated = this.mockDb.entityVectors.length + 
                                     this.mockDb.relationshipVectors.length + 
                                     this.mockDb.semanticVectors.length;
      
      // Calculate totals
      report.totalTime = performance.now() - startTime;
      const endMemory = process.memoryUsage();
      report.memoryUsed = endMemory.heapUsed - startMemory.heapUsed;

      return report;

    } catch (error) {
      console.error('Benchmark failed:', error);
      throw error;
    }
  }

  generateReportSummary(report: PerformanceReport): string {
    const lines = [
      `\n=== PERFORMANCE BENCHMARK REPORT ===`,
      `Test: ${report.testName}`,
      `Input: ${report.textLength} characters (${report.inputTokens} estimated tokens)`,
      `Total Time: ${report.totalTime.toFixed(2)}ms`,
      `Memory Used: ${(report.memoryUsed / 1024 / 1024).toFixed(2)}MB`,
      '',
      '--- Phase Breakdown ---',
      `Extraction: ${report.phases.extraction.total.toFixed(2)}ms`,
      `Deduplication: ${report.phases.deduplication.time.toFixed(2)}ms`,
      `Embedding: ${report.phases.embedding.time.toFixed(2)}ms`,
      `Storage: ${report.phases.storage.time.toFixed(2)}ms`,
      '',
      '--- Results ---',
      `Triples Extracted: ${report.results.triplesExtracted}`,
      `Triples After Dedup: ${report.phases.deduplication.deduplicatedCount}`,
      `Triples Stored: ${report.results.triplesStored}`,
      `Concepts Generated: ${report.results.conceptsGenerated}`,
      `Vectors Created: ${report.results.vectorsCreated}`,
      '',
      '--- Embedding Statistics ---',
      `Total Embedding Calls: ${report.phases.embedding.stats.totalCalls}`,
      `Total Texts Processed: ${report.phases.embedding.stats.totalTexts}`,
      `Unique Texts: ${report.phases.embedding.stats.uniqueTexts}`,
      `Duplicates Detected: ${report.phases.embedding.stats.duplicates}`,
      `Duplicate Rate: ${((report.phases.embedding.stats.duplicates / report.phases.embedding.stats.totalTexts) * 100).toFixed(1)}%`,
      '',
    ];

    return lines.join('\n');
  }
}

describe('ProcessKnowledge Performance Benchmark', () => {
  let benchmark: PerformanceBenchmark;
  const reports: PerformanceReport[] = [];

  beforeEach(() => {
    benchmark = new PerformanceBenchmark();
  });

  afterAll(() => {
    // Generate comparison report
    console.log('\n\n=== BENCHMARK COMPARISON SUMMARY ===');
    reports.forEach(report => {
      console.log(benchmark.generateReportSummary(report));
    });
  });

  const testCases = [
    { name: 'small', filename: 'small-text.txt' },
    { name: 'medium', filename: 'medium-text.txt' },
    { name: 'large', filename: 'large-text.txt' },
    { name: 'xlarge', filename: 'xlarge-text.txt' },
  ];

  testCases.forEach(({ name, filename }) => {
    it(`should benchmark processKnowledge with ${name} text`, async () => {
      const text = readFileSync(
        resolve(__dirname, 'fixtures', filename), 
        'utf-8'
      );

      const args: ProcessKnowledgeArgs = {
        text,
        source: `benchmark-${name}`,
        source_type: 'performance-test',
        source_date: new Date().toISOString(),
      };

      const report = await benchmark.benchmarkProcessKnowledge(args);
      reports.push(report);

      console.log(benchmark.generateReportSummary(report));

      // Basic assertions to ensure the benchmark ran successfully
      expect(report.totalTime).toBeGreaterThan(0);
      expect(report.results.triplesExtracted).toBeGreaterThan(0);
      expect(report.phases.extraction.total).toBeGreaterThan(0);

      // Performance regression tests - these should be adjusted based on baseline
      // For now, just ensure reasonable bounds
      expect(report.totalTime).toBeLessThan(60000); // 60 seconds max
      expect(report.memoryUsed).toBeLessThan(500 * 1024 * 1024); // 500MB max
    });
  });

  it('should identify performance bottlenecks', () => {
    // This test runs after all benchmarks and analyzes the results
    if (reports.length === 0) return;

    const largestTest = reports[reports.length - 1]; // Assuming xlarge is last
    
    console.log('\n=== PERFORMANCE BOTTLENECK ANALYSIS ===');
    
    const totalTime = largestTest.totalTime;
    const phases = [
      { name: 'Extraction', time: largestTest.phases.extraction.total },
      { name: 'Deduplication', time: largestTest.phases.deduplication.time },
      { name: 'Embedding', time: largestTest.phases.embedding.time },
      { name: 'Storage', time: largestTest.phases.storage.time },
    ];
    
    phases.sort((a, b) => b.time - a.time);
    
    console.log('Phases by time consumption:');
    phases.forEach((phase, index) => {
      const percentage = (phase.time / totalTime) * 100;
      console.log(`${index + 1}. ${phase.name}: ${phase.time.toFixed(2)}ms (${percentage.toFixed(1)}%)`);
    });
    
    // Embedding efficiency analysis
    const embStats = largestTest.phases.embedding.stats;
    if (embStats.duplicates > 0) {
      console.log(`\n⚠️  DUPLICATE EMBEDDINGS DETECTED:`);
      console.log(`   ${embStats.duplicates} duplicate embeddings out of ${embStats.totalTexts} total`);
      console.log(`   Efficiency loss: ${((embStats.duplicates / embStats.totalTexts) * 100).toFixed(1)}%`);
    }
    
    // Memory usage analysis
    const memoryMB = largestTest.memoryUsed / 1024 / 1024;
    console.log(`\nMemory Usage: ${memoryMB.toFixed(2)}MB`);
    
    if (memoryMB > 100) {
      console.log(`⚠️  HIGH MEMORY USAGE detected`);
    }
  });
});