import { performance } from 'perf_hooks';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { processKnowledge } from '~/server/transport-manager';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager';
import { MockDatabase } from './mocks/mock-database';
import { MockEmbeddingService } from './mocks/mock-embedding';
import { MockAIProvider } from './mocks/mock-ai-provider';
import { createEmbeddingService } from '~/shared/services/embedding-service';
import { env } from '~/shared/env';

const testDir = resolve(process.cwd(), 'src/tests/performance');

interface PerformanceReport {
  testName: string;
  inputTokens: number;
  textLength: number;
  environment: {
    aiProvider: string;
    aiModel: string;
    extractionMethod: string;
    embeddingModel: string;
    batchSize: number;
  };
  phases: {
    total: number;
    // We measure the black box, but could add instrumentation later
    breakdown?: {
      extraction?: number;
      deduplication?: number;
      embedding?: number;
      conceptualization?: number;
      storage?: number;
    };
  };
  results: {
    success: boolean;
    triplesStored?: number;
    conceptsStored?: number;
    conceptualizationsStored?: number;
    error?: string;
  };
  totalTime: number;
  memoryUsed: number;
  timestamp: string;
}

class PerformanceBenchmark {
  private mockDb?: MockDatabase;
  private useRealServices: boolean;

  constructor(useRealServices = true) {
    this.useRealServices = useRealServices;
    if (!useRealServices) {
      this.mockDb = new MockDatabase();
    }
  }

  reset() {
    if (this.mockDb) {
      this.mockDb.reset();
    }
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
      environment: {
        aiProvider: env.AI_PROVIDER,
        aiModel: env.AI_MODEL,
        extractionMethod: env.EXTRACTION_METHOD,
        embeddingModel: env.EMBEDDING_MODEL,
        batchSize: env.BATCH_SIZE,
      },
      phases: {
        total: 0,
      },
      results: {
        success: false,
      },
      totalTime: 0,
      memoryUsed: 0,
      timestamp: new Date().toISOString(),
    };

    try {
      console.log(`🚀 Starting benchmark: ${report.testName}`);
      console.log(`📄 Text: ${args.text.length} chars, ~${estimatedTokens} tokens`);
      console.log(`🤖 Model: ${env.AI_MODEL} (${env.EXTRACTION_METHOD})`);
      
      // Test the actual processKnowledge function as a black box
      const result = await processKnowledge(args);
      
      // Calculate timing and memory
      report.totalTime = performance.now() - startTime;
      const endMemory = process.memoryUsage();
      report.memoryUsed = endMemory.heapUsed - startMemory.heapUsed;
      report.phases.total = report.totalTime;
      
      // Extract results
      report.results.success = result.success;
      
      if (result.success && result.data) {
        report.results.triplesStored = result.data.triplesStored || 0;
        report.results.conceptsStored = result.data.conceptsStored || 0;
        report.results.conceptualizationsStored = result.data.conceptualizationsStored || 0;
        
        console.log(`✅ Success! Duration: ${(report.totalTime / 1000).toFixed(2)}s`);
        console.log(`📝 Triples: ${report.results.triplesStored}`);
        console.log(`🧠 Concepts: ${report.results.conceptsStored}`);
        console.log(`🔗 Conceptualizations: ${report.results.conceptualizationsStored}`);
      } else {
        report.results.error = result.error?.message || 'Unknown error';
        console.log(`❌ Failed: ${report.results.error}`);
      }
      
      console.log(`💾 Memory: ${(report.memoryUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`⚡ Speed: ${(estimatedTokens / (report.totalTime / 1000)).toFixed(1)} tokens/sec`);
      
      return report;

    } catch (error) {
      report.totalTime = performance.now() - startTime;
      const endMemory = process.memoryUsage();
      report.memoryUsed = endMemory.heapUsed - startMemory.heapUsed;
      report.phases.total = report.totalTime;
      report.results.error = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`❌ Benchmark failed after ${(report.totalTime / 1000).toFixed(2)}s:`, error);
      
      return report;
    }
  }

  generateReportSummary(report: PerformanceReport): string {
    const lines = [
      `\n=== PERFORMANCE BENCHMARK REPORT ===`,
      `Test: ${report.testName}`,
      `Timestamp: ${report.timestamp}`,
      `Input: ${report.textLength} characters (${report.inputTokens} estimated tokens)`,
      `Status: ${report.results.success ? '✅ SUCCESS' : '❌ FAILED'}`,
      `Total Time: ${report.totalTime.toFixed(2)}ms (${(report.totalTime / 1000).toFixed(2)}s)`,
      `Memory Used: ${(report.memoryUsed / 1024 / 1024).toFixed(2)}MB`,
      '',
      '--- Environment ---',
      `AI Provider: ${report.environment.aiProvider}`,
      `AI Model: ${report.environment.aiModel}`,
      `Extraction Method: ${report.environment.extractionMethod}`,
      `Embedding Model: ${report.environment.embeddingModel}`,
      `Batch Size: ${report.environment.batchSize}`,
      '',
      '--- Performance Metrics ---',
      `Processing Speed: ${(report.inputTokens / (report.totalTime / 1000)).toFixed(1)} tokens/sec`,
      `Time per Token: ${(report.totalTime / report.inputTokens).toFixed(2)}ms`,
      `Memory per Token: ${((report.memoryUsed / 1024 / 1024) / report.inputTokens * 1000).toFixed(2)}KB`,
      '',
    ];

    if (report.results.success) {
      lines.push(
        '--- Results ---',
        `Triples Stored: ${report.results.triplesStored || 0}`,
        `Concepts Stored: ${report.results.conceptsStored || 0}`,
        `Conceptualizations: ${report.results.conceptualizationsStored || 0}`,
        `Extraction Efficiency: ${((report.results.triplesStored || 0) / report.inputTokens * 1000).toFixed(2)} triples/1k tokens`,
        ''
      );
    } else {
      lines.push(
        '--- Error ---',
        `Error: ${report.results.error || 'Unknown error'}`,
        ''
      );
    }

    return lines.join('\n');
  }
}

describe('ProcessKnowledge Performance Benchmark', () => {
  let benchmark: PerformanceBenchmark;
  const reports: PerformanceReport[] = [];

  beforeEach(() => {
    benchmark = new PerformanceBenchmark(true); // Use real services
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
        resolve(testDir, 'fixtures', filename), 
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
      expect(report.phases.total).toBeGreaterThan(0);
      expect(report.results.success).toBeDefined();

      if (report.results.success) {
        expect(report.results.triplesStored).toBeGreaterThanOrEqual(0);
        expect(report.results.conceptsStored).toBeGreaterThanOrEqual(0);
      }

      // Performance regression tests - these should be adjusted based on baseline
      // For now, just ensure reasonable bounds
      expect(report.totalTime).toBeLessThan(60000); // 60 seconds max
      expect(report.memoryUsed).toBeLessThan(500 * 1024 * 1024); // 500MB max
    });
  });

  it('should identify performance bottlenecks', async () => {
    // This test runs after all benchmarks and analyzes the results
    if (reports.length === 0) return;

    const successfulReports = reports.filter(r => r.results.success);
    if (successfulReports.length === 0) {
      console.log('\n⚠️  No successful benchmarks to analyze');
      return;
    }

    console.log('\n=== PERFORMANCE BOTTLENECK ANALYSIS ===');
    
    // Find the largest/slowest test for detailed analysis
    const largestTest = successfulReports.reduce((max, current) => 
      current.inputTokens > max.inputTokens ? current : max
    );
    
    const slowestTest = successfulReports.reduce((max, current) => 
      current.totalTime > max.totalTime ? current : max
    );
    
    console.log(`📊 Analysis based on largest test: ${largestTest.testName}`);
    console.log(`🐌 Slowest test: ${slowestTest.testName} (${(slowestTest.totalTime/1000).toFixed(2)}s)`);
    
    // Performance scaling analysis
    console.log('\n--- Performance Scaling ---');
    successfulReports.forEach(report => {
      const tokensPerSec = report.inputTokens / (report.totalTime / 1000);
      const msPerToken = report.totalTime / report.inputTokens;
      console.log(`${report.testName.padEnd(8)}: ${tokensPerSec.toFixed(1)} tok/s (${msPerToken.toFixed(2)}ms/token)`);
    });
    
    // Identify bottlenecks based on optimization plan
    console.log('\n--- Potential Optimizations ---');
    if (largestTest.environment.extractionMethod === 'four-stage') {
      console.log('🚀 HIGH IMPACT: Switch to parallel extraction (75% improvement expected)');
    }
    console.log('📦 HIGH IMPACT: Implement embedding deduplication (50-60% improvement expected)');
    console.log('🔄 MEDIUM IMPACT: Add database batching (20-30% improvement expected)');
    
    // Memory efficiency analysis
    const avgMemoryPerToken = successfulReports.reduce((sum, r) => 
      sum + (r.memoryUsed / r.inputTokens), 0) / successfulReports.length;
    
    console.log(`\n--- Memory Analysis ---`);
    console.log(`Average memory per token: ${(avgMemoryPerToken / 1024).toFixed(2)}KB`);
    
    if (avgMemoryPerToken > 1024 * 100) { // 100KB per token is high
      console.log(`⚠️  HIGH MEMORY USAGE detected - consider streaming or chunking`);
    }
    
    // Generate comparison table
    console.log('\n--- Benchmark Comparison ---');
    console.log('Size      | Time (s) | Tokens/s | MB    | Triples | Efficiency');
    console.log('----------|----------|----------|-------|---------|----------');
    
    successfulReports.forEach(report => {
      const size = report.testName.replace('processKnowledge-', '').replace('tokens', '');
      const time = (report.totalTime / 1000).toFixed(1);
      const speed = (report.inputTokens / (report.totalTime / 1000)).toFixed(0);
      const memory = (report.memoryUsed / 1024 / 1024).toFixed(1);
      const triples = report.results.triplesStored || 0;
      const efficiency = (triples / report.inputTokens * 1000).toFixed(1);
      
      console.log(`${size.padEnd(9)} | ${time.padStart(8)} | ${speed.padStart(8)} | ${memory.padStart(5)} | ${triples.toString().padStart(7)} | ${efficiency.padStart(8)}`);
    });

    // Save detailed analysis
    const analysisReport = {
      timestamp: new Date().toISOString(),
      totalTests: reports.length,
      successfulTests: successfulReports.length,
      largestTest: largestTest.testName,
      slowestTest: slowestTest.testName,
      avgMemoryPerToken,
      recommendations: [
        'Implement parallel extraction for 75% improvement',
        'Add embedding deduplication for 50-60% improvement',
        'Implement database batching for 20-30% improvement',
      ],
      benchmarkResults: successfulReports,
    };

    // Save the analysis
    const reportPath = resolve(testDir, 'reports', `analysis-${Date.now()}.json`);
    writeFileSync(reportPath, JSON.stringify(analysisReport, null, 2));
    console.log(`\n💾 Analysis saved: ${reportPath}`);
  });
});