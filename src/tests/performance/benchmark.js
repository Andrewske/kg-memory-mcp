#!/usr/bin/env tsx

/**
 * Knowledge Graph Performance Benchmark
 * 
 * This is the working Phase 0 performance test that establishes a baseline
 * for measuring the improvements from subsequent optimization phases.
 * 
 * Usage:
 *   pnpm run benchmark          # Run quick benchmark (small + medium)
 *   pnpm run benchmark:full     # Run full benchmark (all sizes)
 * 
 * Or directly:
 *   npx tsx src/tests/performance/benchmark.js
 */

import { performance } from 'perf_hooks';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { processKnowledge } from '../../server/transport-manager.js';

const testDir = resolve(process.cwd(), 'src/tests/performance');

async function runBenchmark(name, filename, timeout) {
  console.log(`🚀 Starting ${name} benchmark...`);
  
  const text = readFileSync(resolve(testDir, 'fixtures', filename), 'utf-8');
  const estimatedTokens = Math.ceil(text.length / 4);
  
  console.log(`📄 Text: ${text.length} chars (~${estimatedTokens} tokens)`);
  console.log(`⏱️  Timeout: ${timeout / 1000}s`);
  
  const args = {
    text,
    source: `benchmark-${name}`,
    source_type: 'performance-test',
    source_date: new Date().toISOString(),
  };

  const startTime = performance.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeout / 1000}s`)), timeout);
    });
    
    const result = await Promise.race([
      processKnowledge(args),
      timeoutPromise,
    ]);
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    const memoryUsed = process.memoryUsage().heapUsed - startMemory;
    
    const report = {
      testName: name,
      filename,
      textLength: text.length,
      estimatedTokens,
      duration,
      success: result.success,
      memoryUsed,
      performance: {
        tokensPerSecond: estimatedTokens / (duration / 1000),
        msPerToken: duration / estimatedTokens,
        mbPerToken: (memoryUsed / 1024 / 1024) / estimatedTokens,
      },
      timestamp: new Date().toISOString(),
    };

    if (result.success && result.data) {
      report.results = {
        triplesStored: result.data.triplesStored || 0,
        conceptsStored: result.data.conceptsStored || 0,
        conceptualizationsStored: result.data.conceptualizationsStored || 0,
      };
      report.performance.extractionEfficiency = (report.results.triplesStored / estimatedTokens) * 1000;
      
      console.log(`✅ ${name}: ${(duration / 1000).toFixed(2)}s | ${report.results.triplesStored} triples | ${report.performance.tokensPerSecond.toFixed(1)} tok/s`);
      console.log(`   Efficiency: ${report.performance.extractionEfficiency.toFixed(2)} triples/1k tokens`);
    } else {
      report.error = result.error?.message || 'Unknown error';
      console.log(`❌ ${name} failed: ${report.error}`);
    }
    
    console.log(`💾 Memory: ${(memoryUsed / 1024 / 1024).toFixed(2)}MB (${(report.performance.mbPerToken * 1000).toFixed(1)}KB/token)`);
    
    return report;
    
  } catch (error) {
    const duration = performance.now() - startTime;
    const memoryUsed = process.memoryUsage().heapUsed - startMemory;
    
    console.log(`❌ ${name} failed: ${error.message}`);
    
    return {
      testName: name,
      filename,
      textLength: text.length,
      estimatedTokens,
      duration,
      success: false,
      error: error.message,
      memoryUsed,
      performance: {
        tokensPerSecond: 0,
        msPerToken: 0,
        mbPerToken: 0,
        extractionEfficiency: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

function generateReport(results) {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log('\n' + '='.repeat(70));
  console.log('🏁 PERFORMANCE BASELINE REPORT - PHASE 0');
  console.log('='.repeat(70));
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Total Tests: ${results.length} (${successful.length} ✅ ${failed.length} ❌)`);
  console.log('');

  if (successful.length > 0) {
    console.log('📊 SUCCESSFUL BENCHMARKS');
    console.log('-'.repeat(80));
    console.log('Test     | Time(s) | Speed  | Triples | Efficiency | Memory | ms/token');
    console.log('         |         |(tok/s) |         |(trip/1k)   | (MB)   |         ');
    console.log('-'.repeat(80));
    
    successful.forEach(result => {
      const time = (result.duration / 1000).toFixed(1);
      const speed = result.performance.tokensPerSecond.toFixed(0);
      const triples = result.results?.triplesStored || 0;
      const efficiency = result.performance.extractionEfficiency?.toFixed(1) || '0.0';
      const memory = (result.memoryUsed / 1024 / 1024).toFixed(1);
      const msPerToken = result.performance.msPerToken.toFixed(1);
      
      console.log(
        `${result.testName.padEnd(8)} | ${time.padStart(7)} | ${speed.padStart(6)} | ${triples.toString().padStart(7)} | ${efficiency.padStart(10)} | ${memory.padStart(6)} | ${msPerToken.padStart(7)}`
      );
    });
    
    console.log('');
    console.log('🔍 PERFORMANCE INSIGHTS');
    console.log('-'.repeat(50));
    
    const avgSpeed = successful.reduce((sum, r) => sum + r.performance.tokensPerSecond, 0) / successful.length;
    const avgEfficiency = successful.reduce((sum, r) => sum + (r.performance.extractionEfficiency || 0), 0) / successful.length;
    const avgTimePerToken = successful.reduce((sum, r) => sum + r.performance.msPerToken, 0) / successful.length;
    const slowest = successful.reduce((max, r) => r.duration > max.duration ? r : max);
    const fastest = successful.reduce((min, r) => r.duration < min.duration ? r : min);
    
    console.log(`Average Processing Speed: ${avgSpeed.toFixed(1)} tokens/second`);
    console.log(`Average Time per Token: ${avgTimePerToken.toFixed(1)}ms`);
    console.log(`Average Extraction Rate: ${avgEfficiency.toFixed(2)} triples per 1000 tokens`);
    console.log(`Performance Range: ${fastest.testName} (${(fastest.duration / 1000).toFixed(1)}s) → ${slowest.testName} (${(slowest.duration / 1000).toFixed(1)}s)`);
    
    console.log('');
    console.log('🚀 PHASE 1 OPTIMIZATION TARGETS');
    console.log('-'.repeat(50));
    
    if (avgTimePerToken > 150) {
      console.log('🔥 CRITICAL: Very slow performance detected');
      console.log(`   Current: ${avgTimePerToken.toFixed(1)}ms/token`);
      console.log(`   Target after Phase 1: ~${(avgTimePerToken * 0.25).toFixed(1)}ms/token (75% faster)`);
      console.log('');
      console.log('🎯 HIGH PRIORITY OPTIMIZATIONS:');
      console.log('   1. Parallel extraction (four-stage → concurrent) - 75% improvement');
      console.log('   2. Embedding deduplication - 50-60% improvement');
      console.log('   3. Database batching - 20-30% improvement');
    } else if (avgTimePerToken > 50) {
      console.log('⚠️  MODERATE: Performance issues detected');
      console.log('🎯 RECOMMENDED OPTIMIZATIONS:');
      console.log('   1. Embedding deduplication for cost savings');
      console.log('   2. Database batching for better throughput');
    } else {
      console.log('✅ GOOD: Baseline performance is acceptable');
      console.log('💡 Still worth optimizing for cost and efficiency gains');
    }
    
    console.log('');
    console.log('🎯 EXPECTED RESULTS AFTER PHASE 1 OPTIMIZATIONS:');
    const optimizedSpeed = avgSpeed * 4; // 4x faster with parallel processing
    const optimizedTime = avgTimePerToken * 0.25; // 75% improvement
    console.log(`   Speed: ${optimizedSpeed.toFixed(0)} tokens/second (4x current)`);
    console.log(`   Time per token: ${optimizedTime.toFixed(1)}ms (75% reduction)`);
    console.log(`   Total improvement: ~85% faster overall processing`);
  }
  
  if (failed.length > 0) {
    console.log('');
    console.log('❌ FAILED TESTS');
    console.log('-'.repeat(30));
    failed.forEach(result => {
      console.log(`${result.testName}: ${result.error}`);
    });
  }
  
  return {
    summary: 'Phase 0 Baseline Complete',
    totalTests: results.length,
    successful: successful.length,
    failed: failed.length,
    avgTimePerToken: successful.length > 0 ? successful.reduce((sum, r) => sum + r.performance.msPerToken, 0) / successful.length : 0,
    avgSpeed: successful.length > 0 ? successful.reduce((sum, r) => sum + r.performance.tokensPerSecond, 0) / successful.length : 0,
    nextPhase: 'Phase 1: Implement parallel extraction optimization',
  };
}

async function main() {
  console.log('🎯 KNOWLEDGE GRAPH PERFORMANCE BENCHMARK - PHASE 0');
  console.log('   Establishing baseline performance before optimizations');
  console.log('='.repeat(70));
  
  // Check if we should run full benchmark
  const runFull = process.argv.includes('--full') || process.env.BENCHMARK_FULL === 'true';
  
  const testCases = [
    { name: 'small', filename: 'small-text.txt', timeout: 45000 },
    { name: 'medium', filename: 'medium-text.txt', timeout: 80000 },
  ];
  
  if (runFull) {
    testCases.push(
      { name: 'large', filename: 'large-text.txt', timeout: 120000 },
      { name: 'xlarge', filename: 'xlarge-text.txt', timeout: 300000 }
    );
  }
  
  console.log(`📋 Running ${testCases.length} test cases (${runFull ? 'full' : 'quick'} mode)`);
  console.log('');
  
  const results = [];
  
  for (const testCase of testCases) {
    const result = await runBenchmark(testCase.name, testCase.filename, testCase.timeout);
    results.push(result);
    
    // Delay between tests to avoid API rate limits
    if (testCase !== testCases[testCases.length - 1]) {
      console.log('⏳ Cooling down (3s)...\n');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Generate final report
  const analysis = generateReport(results);
  
  // Save detailed results
  const detailedReport = {
    phase: 'Phase 0: Baseline',
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
    },
    testConfig: {
      mode: runFull ? 'full' : 'quick',
      testCases: testCases.map(tc => ({ name: tc.name, timeout: tc.timeout })),
    },
    results,
    analysis,
  };
  
  const reportPath = resolve(testDir, 'reports', `phase0-baseline-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(detailedReport, null, 2));
  
  console.log('');
  console.log(`💾 Detailed report saved: ${reportPath}`);
  console.log('');
  console.log('✨ PHASE 0 COMPLETE!');
  console.log('📋 Baseline performance established');  
  console.log('🚀 Ready to implement Phase 1: Parallel Extraction Optimization');
  
  // Return exit code based on results
  const hasFailures = results.some(r => !r.success);
  if (hasFailures) {
    console.log('⚠️  Some tests failed - see report for details');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  });
}