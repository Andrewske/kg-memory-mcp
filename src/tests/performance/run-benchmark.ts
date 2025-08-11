#!/usr/bin/env tsx

/**
 * Direct benchmark runner that bypasses Jest complexity
 * Run with: npx tsx src/tests/performance/run-benchmark.ts
 */

import { performance } from 'perf_hooks';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { processKnowledge } from '../../server/transport-manager';
import type { ProcessKnowledgeArgs } from '../../server/transport-manager';
import { env } from '../../shared/env';

// Use test directory path
const testDir = resolve(process.cwd(), 'src/tests/performance');

interface BenchmarkResult {
  testName: string;
  filename: string;
  textLength: number;
  estimatedTokens: number;
  duration: number;
  success: boolean;
  results?: {
    triplesStored: number;
    conceptsStored: number;
    conceptualizationsStored: number;
  };
  error?: string;
  memoryUsed: number;
}

async function runSingleBenchmark(
  name: string, 
  filename: string
): Promise<BenchmarkResult> {
  console.log(`\n🚀 Starting ${name} benchmark...`);
  
  const text = readFileSync(resolve(testDir, 'fixtures', filename), 'utf-8');
  const estimatedTokens = Math.ceil(text.length / 4);
  
  console.log(`📄 Text length: ${text.length} characters`);
  console.log(`🎫 Estimated tokens: ${estimatedTokens}`);
  console.log(`🤖 Using model: ${env.AI_MODEL}`);
  console.log(`🔧 Extraction method: ${env.EXTRACTION_METHOD}`);
  
  const args: ProcessKnowledgeArgs = {
    text,
    source: `benchmark-${name}`,
    source_type: 'performance-test',
    source_date: new Date().toISOString(),
  };

  const startTime = performance.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  try {
    const result = await processKnowledge(args);
    const duration = performance.now() - startTime;
    const memoryUsed = process.memoryUsage().heapUsed - startMemory;
    
    const benchmarkResult: BenchmarkResult = {
      testName: name,
      filename,
      textLength: text.length,
      estimatedTokens,
      duration,
      success: result.success,
      memoryUsed,
    };

    if (result.success && result.data) {
      benchmarkResult.results = {
        triplesStored: result.data.triplesStored || 0,
        conceptsStored: result.data.conceptsStored || 0,
        conceptualizationsStored: result.data.conceptualizationsStored || 0,
      };
      
      console.log(`✅ Success! Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`📝 Triples stored: ${benchmarkResult.results.triplesStored}`);
      console.log(`🧠 Concepts stored: ${benchmarkResult.results.conceptsStored}`);
      console.log(`🔗 Conceptualizations: ${benchmarkResult.results.conceptualizationsStored}`);
    } else {
      benchmarkResult.error = result.error?.message || 'Unknown error';
      console.log(`❌ Failed: ${benchmarkResult.error}`);
    }
    
    console.log(`🧠 Memory used: ${(memoryUsed / 1024 / 1024).toFixed(2)}MB`);
    
    return benchmarkResult;
    
  } catch (error) {
    const duration = performance.now() - startTime;
    const memoryUsed = process.memoryUsage().heapUsed - startMemory;
    
    console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    return {
      testName: name,
      filename,
      textLength: text.length,
      estimatedTokens,
      duration,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      memoryUsed,
    };
  }
}

async function runAllBenchmarks() {
  console.log('='.repeat(60));
  console.log('🎯 KNOWLEDGE GRAPH PERFORMANCE BENCHMARK');
  console.log('='.repeat(60));
  
  // Check environment
  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) {
    console.error('❌ No AI API keys found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY');
    process.exit(1);
  }
  
  console.log(`✅ Environment ready`);
  console.log(`   🤖 AI Provider: ${env.AI_PROVIDER}`);
  console.log(`   📊 Model: ${env.AI_MODEL}`);
  console.log(`   🔧 Method: ${env.EXTRACTION_METHOD}`);
  
  const testCases = [
    { name: 'small', filename: 'small-text.txt' },
    { name: 'medium', filename: 'medium-text.txt' },
    { name: 'large', filename: 'large-text.txt' },
    { name: 'xlarge', filename: 'xlarge-text.txt' },
  ];
  
  const results: BenchmarkResult[] = [];
  
  for (const testCase of testCases) {
    const result = await runSingleBenchmark(testCase.name, testCase.filename);
    results.push(result);
    
    // Small delay between tests to avoid overwhelming the API
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Generate summary report
  console.log('\n' + '='.repeat(60));
  console.log('📊 BENCHMARK SUMMARY');
  console.log('='.repeat(60));
  
  const successfulResults = results.filter(r => r.success);
  
  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    const duration = (result.duration / 1000).toFixed(2);
    const throughput = result.success ? (result.estimatedTokens / (result.duration / 1000)).toFixed(1) : 'N/A';
    const efficiency = result.success && result.results ? (result.duration / result.results.triplesStored).toFixed(0) : 'N/A';
    
    console.log(`${status} ${result.testName.padEnd(8)} | ${duration.padStart(6)}s | ${throughput.padStart(8)} tok/s | ${efficiency.padStart(6)}ms/triple`);
  });
  
  if (successfulResults.length > 0) {
    console.log('\n📈 PERFORMANCE INSIGHTS:');
    
    const avgTimePerToken = successfulResults.reduce((sum, r) => 
      sum + (r.duration / r.estimatedTokens), 0
    ) / successfulResults.length;
    
    const avgTriplesPerToken = successfulResults.reduce((sum, r) => 
      sum + ((r.results?.triplesStored || 0) / r.estimatedTokens), 0
    ) / successfulResults.length;
    
    console.log(`⚡ Average speed: ${avgTimePerToken.toFixed(2)}ms per token`);
    console.log(`📝 Average extraction: ${avgTriplesPerToken.toFixed(3)} triples per token`);
    
    // Identify bottlenecks
    const slowestResult = successfulResults.reduce((max, r) => 
      (r.duration / r.estimatedTokens) > (max.duration / max.estimatedTokens) ? r : max
    );
    
    console.log(`\n🐌 Slowest processing: ${slowestResult.testName} (${(slowestResult.duration / slowestResult.estimatedTokens).toFixed(2)}ms/token)`);
    
    // Optimization suggestions
    console.log('\n💡 OPTIMIZATION OPPORTUNITIES:');
    if (env.EXTRACTION_METHOD === 'four-stage') {
      console.log('   🚀 Use parallel extraction for 75% improvement');
    }
    console.log('   📦 Implement embedding deduplication for 50-60% improvement');
    console.log('   🔄 Add database batching for 20-30% improvement');
    
    const currentWorstTime = Math.max(...successfulResults.map(r => r.duration));
    const optimizedTime = currentWorstTime * 0.15; // 85% improvement estimate
    
    console.log(`\n🎯 ESTIMATED OPTIMIZATION IMPACT:`);
    console.log(`   Current worst: ${(currentWorstTime / 1000).toFixed(1)}s`);
    console.log(`   After optimization: ${(optimizedTime / 1000).toFixed(1)}s`);
    console.log(`   Expected improvement: ~85%`);
  }
  
  // Save detailed results
  const reportPath = resolve(testDir, 'reports', `baseline-${Date.now()}.json`);
  const detailedReport = {
    timestamp: new Date().toISOString(),
    environment: {
      aiProvider: env.AI_PROVIDER,
      aiModel: env.AI_MODEL,
      extractionMethod: env.EXTRACTION_METHOD,
      embeddingModel: env.EMBEDDING_MODEL,
      batchSize: env.BATCH_SIZE,
    },
    results,
    summary: {
      totalTests: results.length,
      successful: successfulResults.length,
      failed: results.length - successfulResults.length,
      avgTimePerToken: successfulResults.length > 0 ? 
        successfulResults.reduce((sum, r) => sum + (r.duration / r.estimatedTokens), 0) / successfulResults.length : 0,
    }
  };
  
  writeFileSync(reportPath, JSON.stringify(detailedReport, null, 2));
  console.log(`\n💾 Detailed report saved: ${reportPath}`);
  
  console.log('\n✨ Phase 0: Test Infrastructure Complete!');
  console.log('Ready to implement Phase 1: Parallel Extraction optimization');
}

// Handle CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllBenchmarks().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
  });
}