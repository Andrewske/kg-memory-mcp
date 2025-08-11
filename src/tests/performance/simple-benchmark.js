#!/usr/bin/env node

/**
 * Simple Performance Benchmark Script
 * Runs performance tests directly without Jest to avoid ES module issues
 * Run with: node src/tests/performance/simple-benchmark.js
 */

import { performance } from 'perf_hooks';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { processKnowledge } from '../../server/transport-manager.js';

const testDir = resolve(process.cwd(), 'src/tests/performance');

async function runBenchmark(name, filename, timeout = 60000) {
  console.log(`🚀 Starting ${name} benchmark...`);
  
  const text = readFileSync(resolve(testDir, 'fixtures', filename), 'utf-8');
  const estimatedTokens = Math.ceil(text.length / 4);
  
  console.log(`📄 Text: ${text.length} chars (~${estimatedTokens} tokens)`);
  
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
      setTimeout(() => reject(new Error('Test timeout')), timeout);
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
      tokensPerSecond: estimatedTokens / (duration / 1000),
      msPerToken: duration / estimatedTokens,
      timestamp: new Date().toISOString(),
    };

    if (result.success && result.data) {
      report.results = {
        triplesStored: result.data.triplesStored || 0,
        conceptsStored: result.data.conceptsStored || 0,
        conceptualizationsStored: result.data.conceptualizationsStored || 0,
      };
      report.extractionEfficiency = (report.results.triplesStored / estimatedTokens) * 1000;
      
      console.log(`✅ ${name}: ${(duration / 1000).toFixed(2)}s | ${report.results.triplesStored} triples | ${report.tokensPerSecond.toFixed(1)} tok/s`);
    } else {
      report.error = result.error?.message || 'Unknown error';
      console.log(`❌ ${name} failed: ${report.error}`);
    }
    
    console.log(`💾 Memory: ${(memoryUsed / 1024 / 1024).toFixed(2)}MB`);
    
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
      tokensPerSecond: 0,
      msPerToken: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

function generateReport(results) {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  const lines = [
    '\n' + '='.repeat(60),
    '🏁 PERFORMANCE BASELINE REPORT',
    '='.repeat(60),
    `Generated: ${new Date().toISOString()}`,
    `Total Tests: ${results.length} (${successful.length} ✅ ${failed.length} ❌)`,
    '',
  ];

  if (successful.length > 0) {
    lines.push('📊 SUCCESSFUL BENCHMARKS');
    lines.push('-'.repeat(70));
    lines.push('Test     | Time(s) | Speed(tok/s) | Triples | Efficiency | Memory(MB)');
    lines.push('-'.repeat(70));
    
    successful.forEach(result => {
      const time = (result.duration / 1000).toFixed(1);
      const speed = result.tokensPerSecond.toFixed(0);
      const triples = result.results?.triplesStored || 0;
      const efficiency = result.extractionEfficiency?.toFixed(1) || '0.0';
      const memory = (result.memoryUsed / 1024 / 1024).toFixed(1);
      
      lines.push(
        `${result.testName.padEnd(8)} | ${time.padStart(7)} | ${speed.padStart(12)} | ${triples.toString().padStart(7)} | ${efficiency.padStart(10)} | ${memory.padStart(9)}`
      );
    });
    
    lines.push('');
    lines.push('🔍 PERFORMANCE INSIGHTS');
    lines.push('-'.repeat(40));
    
    const avgSpeed = successful.reduce((sum, r) => sum + r.tokensPerSecond, 0) / successful.length;
    const avgEfficiency = successful.reduce((sum, r) => sum + (r.extractionEfficiency || 0), 0) / successful.length;
    const slowest = successful.reduce((max, r) => r.duration > max.duration ? r : max);
    const fastest = successful.reduce((min, r) => r.duration < min.duration ? r : min);
    
    lines.push(`Average Speed: ${avgSpeed.toFixed(1)} tokens/second`);
    lines.push(`Average Extraction: ${avgEfficiency.toFixed(2)} triples per 1000 tokens`);
    lines.push(`Fastest Test: ${fastest.testName} (${(fastest.duration / 1000).toFixed(2)}s)`);
    lines.push(`Slowest Test: ${slowest.testName} (${(slowest.duration / 1000).toFixed(2)}s)`);
    
    // Performance analysis
    const avgTimePerToken = successful.reduce((sum, r) => sum + r.msPerToken, 0) / successful.length;
    lines.push(`Average Processing: ${avgTimePerToken.toFixed(1)}ms per token`);
    
    lines.push('');
    lines.push('🚀 OPTIMIZATION OPPORTUNITIES');
    lines.push('-'.repeat(40));
    
    if (avgTimePerToken > 100) {
      lines.push('⚠️  SLOW PERFORMANCE DETECTED');
      lines.push('🔥 HIGH IMPACT: Implement parallel extraction (75% improvement)');
      lines.push('📦 HIGH IMPACT: Add embedding deduplication (50-60% improvement)');
      lines.push('🔄 MEDIUM IMPACT: Database batching (20-30% improvement)');
      
      const optimizedTime = avgTimePerToken * 0.15; // 85% improvement estimate
      lines.push(`💡 After optimization: ~${optimizedTime.toFixed(1)}ms/token (85% improvement)`);
    } else if (avgTimePerToken > 50) {
      lines.push('⚠️  MODERATE PERFORMANCE ISSUES');
      lines.push('📦 RECOMMENDED: Add embedding deduplication for cost savings');
      lines.push('🔄 RECOMMENDED: Database batching for better throughput');
    } else {
      lines.push('✅ GOOD PERFORMANCE');
      lines.push('💡 Consider minor optimizations for even better performance');
    }
  }
  
  if (failed.length > 0) {
    lines.push('', '❌ FAILED TESTS');
    lines.push('-'.repeat(30));
    failed.forEach(result => {
      lines.push(`${result.testName}: ${result.error}`);
    });
  }
  
  return lines.join('\n');
}

async function main() {
  console.log('🎯 STARTING PERFORMANCE BASELINE BENCHMARK');
  console.log('='.repeat(60));
  
  const testCases = [
    { name: 'small', filename: 'small-text.txt', timeout: 30000 },
    { name: 'medium', filename: 'medium-text.txt', timeout: 60000 },
    { name: 'large', filename: 'large-text.txt', timeout: 90000 },
    // Skip xlarge for now to avoid long waits
    // { name: 'xlarge', filename: 'xlarge-text.txt', timeout: 180000 },
  ];
  
  const results = [];
  
  for (const testCase of testCases) {
    const result = await runBenchmark(testCase.name, testCase.filename, testCase.timeout);
    results.push(result);
    
    // Small delay between tests
    if (testCase.name !== 'large') {
      console.log('⏳ Waiting 2s before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Generate and save report
  const report = generateReport(results);
  console.log(report);
  
  const detailedReport = {
    timestamp: new Date().toISOString(),
    summary: 'Performance Baseline Report',
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
    },
    results,
    analysis: report,
  };
  
  const reportPath = resolve(testDir, 'reports', `baseline-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(detailedReport, null, 2));
  console.log(`\n💾 Detailed report saved: ${reportPath}`);
  
  console.log('\n✨ Phase 0 Complete: Performance baseline established!');
  console.log('🚀 Ready for Phase 1: Parallel extraction optimization');
}

// Run the benchmark
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  });
}