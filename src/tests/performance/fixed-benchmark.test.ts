/**
 * Fixed Performance Benchmark Test
 * Tests the real processKnowledge function and generates baseline performance reports
 */

import { performance } from 'perf_hooks';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Use relative imports to avoid Jest path mapping issues
import { processKnowledge } from '../../server/transport-manager';
import type { ProcessKnowledgeArgs } from '../../server/transport-manager';

const testDir = resolve(process.cwd(), 'src/tests/performance');

interface BenchmarkResult {
  testName: string;
  filename: string;
  textLength: number;
  estimatedTokens: number;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  results?: {
    triplesStored: number;
    conceptsStored: number;
    conceptualizationsStored: number;
  };
  error?: string;
  memoryUsed: number;
  performance: {
    tokensPerSecond: number;
    msPerToken: number;
    extractionEfficiency: number; // triples per 1000 tokens
  };
}

class BenchmarkRunner {
  private results: BenchmarkResult[] = [];

  async runBenchmark(name: string, filename: string, timeout = 60000): Promise<BenchmarkResult> {
    console.log(`🚀 Starting ${name} benchmark...`);
    
    const text = readFileSync(resolve(testDir, 'fixtures', filename), 'utf-8');
    const estimatedTokens = Math.ceil(text.length / 4);
    
    const args: ProcessKnowledgeArgs = {
      text,
      source: `benchmark-${name}`,
      source_type: 'performance-test',
      source_date: new Date().toISOString(),
    };

    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    try {
      // Set a timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Test timeout')), timeout);
      });
      
      const result = await Promise.race([
        processKnowledge(args),
        timeoutPromise,
      ]);
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      const memoryUsed = process.memoryUsage().heapUsed - startMemory;
      
      const benchmarkResult: BenchmarkResult = {
        testName: name,
        filename,
        textLength: text.length,
        estimatedTokens,
        startTime,
        endTime,
        duration,
        success: result.success,
        memoryUsed,
        performance: {
          tokensPerSecond: estimatedTokens / (duration / 1000),
          msPerToken: duration / estimatedTokens,
          extractionEfficiency: 0,
        },
      };

      if (result.success && result.data) {
        benchmarkResult.results = {
          triplesStored: result.data.triplesStored || 0,
          conceptsStored: result.data.conceptsStored || 0,
          conceptualizationsStored: result.data.conceptualizationsStored || 0,
        };
        benchmarkResult.performance.extractionEfficiency = 
          (benchmarkResult.results.triplesStored / estimatedTokens) * 1000;
        
        console.log(`✅ ${name}: ${(duration / 1000).toFixed(2)}s | ${benchmarkResult.results.triplesStored} triples`);
      } else {
        benchmarkResult.error = result.error?.message || 'Unknown error';
        console.log(`❌ ${name} failed: ${benchmarkResult.error}`);
      }
      
      this.results.push(benchmarkResult);
      return benchmarkResult;
      
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      const memoryUsed = process.memoryUsage().heapUsed - startMemory;
      
      const benchmarkResult: BenchmarkResult = {
        testName: name,
        filename,
        textLength: text.length,
        estimatedTokens,
        startTime,
        endTime,
        duration,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        memoryUsed,
        performance: {
          tokensPerSecond: 0,
          msPerToken: 0,
          extractionEfficiency: 0,
        },
      };
      
      console.log(`❌ ${name} failed: ${benchmarkResult.error}`);
      this.results.push(benchmarkResult);
      return benchmarkResult;
    }
  }

  generateReport(): string {
    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);
    
    const lines = [
      '\n=== PERFORMANCE BENCHMARK REPORT ===',
      `Generated: ${new Date().toISOString()}`,
      `Total Tests: ${this.results.length} (${successful.length} successful, ${failed.length} failed)`,
      '',
    ];

    if (successful.length > 0) {
      lines.push('--- Successful Benchmarks ---');
      lines.push('Test     | Time(s) | Tokens/s | Triples | Efficiency | Memory(MB)');
      lines.push('---------|---------|----------|---------|------------|----------');
      
      successful.forEach(result => {
        const time = (result.duration / 1000).toFixed(1);
        const speed = result.performance.tokensPerSecond.toFixed(0);
        const triples = result.results?.triplesStored || 0;
        const efficiency = result.performance.extractionEfficiency.toFixed(1);
        const memory = (result.memoryUsed / 1024 / 1024).toFixed(1);
        
        lines.push(
          `${result.testName.padEnd(8)} | ${time.padStart(7)} | ${speed.padStart(8)} | ${triples.toString().padStart(7)} | ${efficiency.padStart(10)} | ${memory.padStart(8)}`
        );
      });
      
      lines.push('');
      lines.push('--- Performance Insights ---');
      
      const avgSpeed = successful.reduce((sum, r) => sum + r.performance.tokensPerSecond, 0) / successful.length;
      const avgEfficiency = successful.reduce((sum, r) => sum + r.performance.extractionEfficiency, 0) / successful.length;
      const slowest = successful.reduce((max, r) => r.duration > max.duration ? r : max);
      
      lines.push(`Average Speed: ${avgSpeed.toFixed(1)} tokens/second`);
      lines.push(`Average Extraction: ${avgEfficiency.toFixed(2)} triples per 1000 tokens`);
      lines.push(`Slowest Test: ${slowest.testName} (${(slowest.duration / 1000).toFixed(2)}s)`);
    }
    
    if (failed.length > 0) {
      lines.push('', '--- Failed Tests ---');
      failed.forEach(result => {
        lines.push(`❌ ${result.testName}: ${result.error}`);
      });
    }
    
    lines.push('', '--- Optimization Recommendations ---');
    if (successful.length > 0) {
      const avgTimePerToken = successful.reduce((sum, r) => sum + r.performance.msPerToken, 0) / successful.length;
      if (avgTimePerToken > 100) { // More than 100ms per token is slow
        lines.push('🚀 HIGH PRIORITY: Current performance is slow - implement parallel extraction');
        lines.push('📦 HIGH PRIORITY: Add embedding deduplication to reduce API calls');
        lines.push('🔄 MEDIUM PRIORITY: Add database batching and transaction optimization');
      } else {
        lines.push('✅ Performance is acceptable, but optimizations can still help:');
        lines.push('📦 Consider embedding deduplication for cost savings');
        lines.push('🔄 Database batching for improved throughput');
      }
    }
    
    return lines.join('\n');
  }

  saveReport() {
    const report = {
      timestamp: new Date().toISOString(),
      results: this.results,
      summary: this.generateReport(),
    };
    
    const reportPath = resolve(testDir, 'reports', `baseline-${Date.now()}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Baseline report saved: ${reportPath}`);
    return reportPath;
  }
}

describe('Fixed Performance Benchmark', () => {
  let runner: BenchmarkRunner;
  
  beforeAll(() => {
    runner = new BenchmarkRunner();
  });

  afterAll(() => {
    console.log(runner.generateReport());
    runner.saveReport();
  });

  // Test each size with appropriate timeouts
  it('should benchmark small text (fast)', async () => {
    const result = await runner.runBenchmark('small', 'small-text.txt', 30000);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.textLength).toBeGreaterThan(0);
  }, 35000);

  it('should benchmark medium text', async () => {
    const result = await runner.runBenchmark('medium', 'medium-text.txt', 60000);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.textLength).toBeGreaterThan(0);
  }, 65000);

  it('should benchmark large text', async () => {
    const result = await runner.runBenchmark('large', 'large-text.txt', 90000);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.textLength).toBeGreaterThan(0);
  }, 95000);

  // Skip xlarge by default to avoid long test times
  it.skip('should benchmark xlarge text (slow)', async () => {
    const result = await runner.runBenchmark('xlarge', 'xlarge-text.txt', 180000);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.textLength).toBeGreaterThan(0);
  }, 185000);
});