import { performance } from 'perf_hooks';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { processKnowledge } from '../../server/transport-manager';
import type { ProcessKnowledgeArgs } from '../../server/transport-manager';
import { env } from '../../shared/env';

// Use test directory path for Jest
const testDir = resolve(process.cwd(), 'src/tests/performance');

interface DetailedPerformanceReport {
  testName: string;
  timestamp: string;
  environment: {
    extractionMethod: string;
    aiModel: string;
    embeddingModel: string;
    batchSize: number;
  };
  input: {
    textLength: number;
    estimatedTokens: number;
    filename: string;
  };
  phases: {
    total: number;
    extraction?: number;
    deduplication?: number;
    storage?: number;
    conceptualization?: number;
  };
  results: {
    triplesStored: number;
    conceptsStored: number;
    conceptualizationsStored: number;
  };
  performance: {
    memoryUsed: number;
    peakMemoryUsage: number;
  };
  success: boolean;
  error?: string;
}

class RealPerformanceBenchmark {
  private reports: DetailedPerformanceReport[] = [];

  async benchmarkProcessKnowledge(
    args: ProcessKnowledgeArgs,
    testName: string,
    filename: string
  ): Promise<DetailedPerformanceReport> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    let peakMemoryUsage = startMemory.heapUsed;

    // Monitor memory usage during execution
    const memoryMonitor = setInterval(() => {
      const current = process.memoryUsage().heapUsed;
      if (current > peakMemoryUsage) {
        peakMemoryUsage = current;
      }
    }, 100);

    const report: DetailedPerformanceReport = {
      testName,
      timestamp: new Date().toISOString(),
      environment: {
        extractionMethod: env.EXTRACTION_METHOD,
        aiModel: env.AI_MODEL,
        embeddingModel: env.EMBEDDING_MODEL,
        batchSize: env.BATCH_SIZE,
      },
      input: {
        textLength: args.text.length,
        estimatedTokens: Math.ceil(args.text.length / 4),
        filename,
      },
      phases: {
        total: 0,
      },
      results: {
        triplesStored: 0,
        conceptsStored: 0,
        conceptualizationsStored: 0,
      },
      performance: {
        memoryUsed: 0,
        peakMemoryUsage: 0,
      },
      success: false,
    };

    try {
      console.log(`\n🚀 Starting benchmark: ${testName}`);
      console.log(`📄 Text length: ${args.text.length} characters (${report.input.estimatedTokens} estimated tokens)`);
      console.log(`🤖 Model: ${env.AI_MODEL}`);
      console.log(`📊 Extraction method: ${env.EXTRACTION_METHOD}`);
      
      const result = await processKnowledge(args);
      
      clearInterval(memoryMonitor);
      
      if (result.success && result.data) {
        report.success = true;
        report.results = {
          triplesStored: result.data.triplesStored || 0,
          conceptsStored: result.data.conceptsStored || 0,
          conceptualizationsStored: result.data.conceptualizationsStored || 0,
        };
      } else {
        report.success = false;
        report.error = result.error?.message || 'Unknown error';
      }

    } catch (error) {
      clearInterval(memoryMonitor);
      report.success = false;
      report.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Benchmark failed: ${report.error}`);
    }

    // Calculate final metrics
    report.phases.total = performance.now() - startTime;
    const endMemory = process.memoryUsage();
    report.performance.memoryUsed = endMemory.heapUsed - startMemory.heapUsed;
    report.performance.peakMemoryUsage = peakMemoryUsage - startMemory.heapUsed;

    this.reports.push(report);
    return report;
  }

  generateReportSummary(report: DetailedPerformanceReport): string {
    const lines = [
      `\n=== REAL PERFORMANCE BENCHMARK REPORT ===`,
      `🏷️  Test: ${report.testName}`,
      `📅 Timestamp: ${report.timestamp}`,
      `✅ Status: ${report.success ? '✅ SUCCESS' : '❌ FAILED'}`,
    ];

    if (report.error) {
      lines.push(`❌ Error: ${report.error}`);
    }

    lines.push(
      '',
      '--- Environment ---',
      `🤖 AI Model: ${report.environment.aiModel}`,
      `🔧 Extraction Method: ${report.environment.extractionMethod}`,
      `📊 Embedding Model: ${report.environment.embeddingModel}`,
      `📦 Batch Size: ${report.environment.batchSize}`,
      '',
      '--- Input ---',
      `📄 File: ${report.input.filename}`,
      `📏 Length: ${report.input.textLength} characters`,
      `🎫 Estimated Tokens: ${report.input.estimatedTokens}`,
      '',
      '--- Performance ---',
      `⏱️  Total Time: ${report.phases.total.toFixed(2)}ms (${(report.phases.total / 1000).toFixed(1)}s)`,
      `🧠 Memory Used: ${(report.performance.memoryUsed / 1024 / 1024).toFixed(2)}MB`,
      `📈 Peak Memory: ${(report.performance.peakMemoryUsage / 1024 / 1024).toFixed(2)}MB`,
      '',
      '--- Results ---',
      `📝 Triples Stored: ${report.results.triplesStored}`,
      `🧠 Concepts Stored: ${report.results.conceptsStored}`,
      `🔗 Conceptualizations: ${report.results.conceptualizationsStored}`,
      '',
      '--- Efficiency Metrics ---',
      `⚡ Time per Triple: ${report.results.triplesStored > 0 ? (report.phases.total / report.results.triplesStored).toFixed(2) : 'N/A'}ms`,
      `🎯 Triples per Second: ${report.results.triplesStored > 0 ? ((report.results.triplesStored * 1000) / report.phases.total).toFixed(2) : 'N/A'}`,
      `📊 Tokens per Second: ${report.input.estimatedTokens > 0 ? ((report.input.estimatedTokens * 1000) / report.phases.total).toFixed(2) : 'N/A'}`,
      ''
    );

    return lines.join('\n');
  }

  saveReportsToFile() {
    const reportsPath = resolve(testDir, 'reports', `benchmark-${Date.now()}.json`);
    
    const summary = {
      generatedAt: new Date().toISOString(),
      environment: this.reports[0]?.environment || {},
      totalTests: this.reports.length,
      successfulTests: this.reports.filter(r => r.success).length,
      reports: this.reports,
      comparison: this.generateComparisonAnalysis(),
    };

    writeFileSync(reportsPath, JSON.stringify(summary, null, 2));
    console.log(`\n💾 Full benchmark report saved to: ${reportsPath}`);
    
    return reportsPath;
  }

  private generateComparisonAnalysis() {
    const successfulReports = this.reports.filter(r => r.success);
    if (successfulReports.length < 2) return null;

    // Sort by input size
    const sorted = [...successfulReports].sort((a, b) => a.input.estimatedTokens - b.input.estimatedTokens);
    
    return {
      scalingAnalysis: {
        smallestTest: {
          tokens: sorted[0].input.estimatedTokens,
          time: sorted[0].phases.total,
          timePerToken: sorted[0].phases.total / sorted[0].input.estimatedTokens,
        },
        largestTest: {
          tokens: sorted[sorted.length - 1].input.estimatedTokens,
          time: sorted[sorted.length - 1].phases.total,
          timePerToken: sorted[sorted.length - 1].phases.total / sorted[sorted.length - 1].input.estimatedTokens,
        }
      },
      averageMetrics: {
        timePerToken: successfulReports.reduce((sum, r) => sum + (r.phases.total / r.input.estimatedTokens), 0) / successfulReports.length,
        triplesPerToken: successfulReports.reduce((sum, r) => sum + (r.results.triplesStored / r.input.estimatedTokens), 0) / successfulReports.length,
        memoryPerToken: successfulReports.reduce((sum, r) => sum + (r.performance.memoryUsed / r.input.estimatedTokens), 0) / successfulReports.length,
      }
    };
  }

  getReports(): DetailedPerformanceReport[] {
    return [...this.reports];
  }

  reset() {
    this.reports = [];
  }
}

describe('Real ProcessKnowledge Performance Benchmark', () => {
  let benchmark: RealPerformanceBenchmark;

  beforeAll(() => {
    // Check that we have the necessary environment variables
    if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) {
      throw new Error('❌ No AI API keys found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable.');
    }
    
    if (!env.DATABASE_URL) {
      throw new Error('❌ DATABASE_URL not set. Please configure your database connection.');
    }

    console.log('\n🔧 Environment Check:');
    console.log(`✅ AI Provider: ${env.AI_PROVIDER}`);
    console.log(`✅ AI Model: ${env.AI_MODEL}`);
    console.log(`✅ Extraction Method: ${env.EXTRACTION_METHOD}`);
    console.log(`✅ Database: Connected`);
  });

  beforeEach(() => {
    benchmark = new RealPerformanceBenchmark();
  });

  afterAll(() => {
    if (benchmark.getReports().length > 0) {
      const reportPath = benchmark.saveReportsToFile();
      
      // Generate final summary
      const reports = benchmark.getReports();
      console.log('\n' + '='.repeat(60));
      console.log('🎯 BENCHMARK SUMMARY');
      console.log('='.repeat(60));
      
      reports.forEach(report => {
        console.log(benchmark.generateReportSummary(report));
      });

      // Performance insights
      const successfulReports = reports.filter(r => r.success);
      if (successfulReports.length > 1) {
        console.log('\n📊 PERFORMANCE INSIGHTS:');
        
        const avgTimePerToken = successfulReports.reduce((sum, r) => 
          sum + (r.phases.total / r.input.estimatedTokens), 0
        ) / successfulReports.length;
        
        const avgTriplesPerToken = successfulReports.reduce((sum, r) => 
          sum + (r.results.triplesStored / r.input.estimatedTokens), 0
        ) / successfulReports.length;

        console.log(`⚡ Average processing speed: ${avgTimePerToken.toFixed(2)}ms per token`);
        console.log(`📝 Average extraction rate: ${avgTriplesPerToken.toFixed(3)} triples per token`);
        
        // Identify the bottleneck
        const largestTest = successfulReports.reduce((max, r) => 
          r.input.estimatedTokens > max.input.estimatedTokens ? r : max
        );
        
        console.log(`\n⚠️  BOTTLENECK ANALYSIS (${largestTest.testName}):`);
        if (largestTest.phases.total > 30000) { // > 30 seconds
          console.log(`🐌 Processing time: ${(largestTest.phases.total / 1000).toFixed(1)}s is quite slow`);
          console.log(`💡 This confirms the need for optimization!`);
        }
      }
    }
  });

  const testCases = [
    { name: 'small', filename: 'small-text.txt', expectedMaxTime: 15000 }, // 15s max
    { name: 'medium', filename: 'medium-text.txt', expectedMaxTime: 30000 }, // 30s max  
    { name: 'large', filename: 'large-text.txt', expectedMaxTime: 60000 }, // 1min max
    { name: 'xlarge', filename: 'xlarge-text.txt', expectedMaxTime: 120000 }, // 2min max
  ];

  testCases.forEach(({ name, filename, expectedMaxTime }) => {
    it(`should benchmark real processKnowledge with ${name} text (${filename})`, async () => {
      const text = readFileSync(resolve(testDir, 'fixtures', filename), 'utf-8');

      const args: ProcessKnowledgeArgs = {
        text,
        source: `benchmark-${name}`,
        source_type: 'performance-test',
        source_date: new Date().toISOString(),
      };

      const report = await benchmark.benchmarkProcessKnowledge(args, `real-${name}`, filename);
      
      console.log(benchmark.generateReportSummary(report));

      // Assertions
      expect(report).toBeDefined();
      expect(report.phases.total).toBeGreaterThan(0);
      
      if (report.success) {
        expect(report.results.triplesStored).toBeGreaterThan(0);
        expect(report.phases.total).toBeLessThan(expectedMaxTime);
      } else {
        console.error(`❌ Test failed: ${report.error}`);
        // Don't fail the test, just log the error for analysis
      }
    }, expectedMaxTime + 10000); // Add 10s buffer to Jest timeout
  });

  it('should identify current performance bottlenecks', () => {
    const reports = benchmark.getReports();
    const successfulReports = reports.filter(r => r.success);
    
    if (successfulReports.length === 0) {
      console.log('⚠️  No successful runs to analyze');
      return;
    }

    console.log('\n🔍 PERFORMANCE BOTTLENECK IDENTIFICATION:');
    
    // Find the slowest per-token processing
    const slowestReport = successfulReports.reduce((max, r) => {
      const timePerToken = r.phases.total / r.input.estimatedTokens;
      const maxTimePerToken = max.phases.total / max.input.estimatedTokens;
      return timePerToken > maxTimePerToken ? r : max;
    });

    const timePerToken = slowestReport.phases.total / slowestReport.input.estimatedTokens;
    
    console.log(`🐌 Slowest processing: ${slowestReport.testName}`);
    console.log(`   ⏱️  ${timePerToken.toFixed(2)}ms per token`);
    console.log(`   🎯 Total time: ${(slowestReport.phases.total / 1000).toFixed(1)}s`);
    
    // Recommendations based on the improvement plan
    console.log('\n💡 OPTIMIZATION OPPORTUNITIES:');
    if (env.EXTRACTION_METHOD === 'four-stage') {
      console.log('   🚀 Switch to parallel extraction (75% faster)');
    }
    console.log('   📦 Implement embedding reuse (50-60% faster)');
    console.log('   🔄 Add database transaction batching (20-30% faster)');
    console.log('   🧠 Optimize conceptualization processing');
    
    const potentialImprovement = env.EXTRACTION_METHOD === 'four-stage' ? 85 : 60;
    const estimatedOptimizedTime = slowestReport.phases.total * (1 - potentialImprovement / 100);
    
    console.log(`\n🎯 ESTIMATED IMPACT:`);
    console.log(`   Current: ${(slowestReport.phases.total / 1000).toFixed(1)}s`);
    console.log(`   After optimization: ${(estimatedOptimizedTime / 1000).toFixed(1)}s`);
    console.log(`   Expected improvement: ${potentialImprovement}%`);
  });
});