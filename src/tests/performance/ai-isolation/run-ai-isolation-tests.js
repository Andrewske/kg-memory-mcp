#!/usr/bin/env node

/**
 * AI Isolation Tests Master Runner
 *
 * Purpose: Execute all AI performance isolation tests and generate
 * comprehensive analysis to identify the root causes of the 95% AI bottleneck
 *
 * Tests Included:
 * - ExtractByType performance analysis
 * - Embedding batch optimization analysis
 * - Conceptualization performance analysis
 * - API latency measurement analysis
 *
 * Output: Comprehensive performance report with optimization roadmap
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import all test modules
async function loadTestModules() {
	const { runExtractByTypeTest } = await import('./extract-by-type-test.js');
	const { runEmbeddingBatchTest } = await import('./embedding-batch-test.js');
	const { runConceptualizationTest } = await import('./conceptualization-test.js');
	const { runAPILatencyTest } = await import('./api-latency-test.js');

	return {
		runExtractByTypeTest,
		runEmbeddingBatchTest,
		runConceptualizationTest,
		runAPILatencyTest,
	};
}

/**
 * Run individual test with error handling and timing
 */
async function runTestSafely(testName, testFunction) {
	console.log(`\n🚀 Starting ${testName}...`);
	console.log('='.repeat(60));

	const startTime = performance.now();

	try {
		const result = await testFunction();
		const duration = performance.now() - startTime;

		console.log(`\n✅ ${testName} completed successfully in ${(duration / 1000).toFixed(2)}s`);

		return {
			testName,
			success: true,
			duration,
			data: result,
			timestamp: new Date().toISOString(),
		};
	} catch (error) {
		const duration = performance.now() - startTime;

		console.error(`\n❌ ${testName} failed after ${(duration / 1000).toFixed(2)}s:`, error.message);

		return {
			testName,
			success: false,
			duration,
			error: {
				message: error.message,
				stack: error.stack,
			},
			timestamp: new Date().toISOString(),
		};
	}
}

/**
 * Generate comprehensive cross-test analysis
 */
function generateCrossTestAnalysis(results) {
	const analysis = {
		summary: {},
		bottleneckAnalysis: {},
		correlations: {},
		recommendations: [],
	};

	const successfulResults = results.filter(r => r.success);
	const failedResults = results.filter(r => !r.success);

	// Summary statistics
	analysis.summary = {
		totalTests: results.length,
		successfulTests: successfulResults.length,
		failedTests: failedResults.length,
		totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
		avgTestDuration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
	};

	// Extract key performance metrics from each test
	const performanceMetrics = {};

	successfulResults.forEach(result => {
		const testData = result.data;

		switch (result.testName) {
			case 'ExtractByType Performance Test':
				if (testData.typeAnalysis) {
					performanceMetrics.extraction = {
						avgDurationPerType:
							Object.values(testData.typeAnalysis).reduce((sum, t) => sum + t.avgDuration, 0) /
							Object.keys(testData.typeAnalysis).length,
						avgTokenSpeed:
							Object.values(testData.typeAnalysis).reduce((sum, t) => sum + t.avgTokenSpeed, 0) /
							Object.keys(testData.typeAnalysis).length,
						slowestType: Object.entries(testData.typeAnalysis).reduce((a, b) =>
							a[1].avgDuration > b[1].avgDuration ? a : b
						),
						fastestType: Object.entries(testData.typeAnalysis).reduce((a, b) =>
							a[1].avgDuration < b[1].avgDuration ? a : b
						),
					};
				}
				break;

			case 'Embedding Batch Performance Test':
				if (testData.batchAnalysis) {
					const optimalBatch = Object.entries(testData.batchAnalysis).reduce((a, b) =>
						a[1].avgEfficiency > b[1].avgEfficiency ? a : b
					);
					performanceMetrics.embedding = {
						optimalBatchSize: optimalBatch[0],
						optimalEfficiency: optimalBatch[1].avgEfficiency,
						avgTokenSpeed:
							Object.values(testData.batchAnalysis).reduce((sum, b) => sum + b.avgTokenSpeed, 0) /
							Object.keys(testData.batchAnalysis).length,
					};
				}
				break;

			case 'Conceptualization Performance Test':
				if (testData.results && testData.results.length > 0) {
					const successfulConceptResults = testData.results.filter(r => r.result.success);
					if (successfulConceptResults.length > 0) {
						performanceMetrics.conceptualization = {
							avgProcessingSpeed:
								successfulConceptResults.reduce(
									(sum, r) => sum + r.result.results.processingSpeed,
									0
								) / successfulConceptResults.length,
							avgConceptsPerElement:
								successfulConceptResults.reduce(
									(sum, r) => sum + r.result.results.conceptsPerElement,
									0
								) / successfulConceptResults.length,
							avgConfidence:
								successfulConceptResults.reduce(
									(sum, r) => sum + r.result.results.avgConfidence,
									0
								) / successfulConceptResults.length,
						};
					}
				}
				break;

			case 'API Latency Performance Test': {
				const basicLatency = testData.testResults?.find(t => t.testName === 'basic-latency');
				const modelLatency = testData.testResults?.find(t => t.testName === 'model-latency');
				if (basicLatency || modelLatency) {
					performanceMetrics.apiLatency = {
						basicLatency: basicLatency?.avgLatency || 0,
						modelLatency: modelLatency?.avgLatency || 0,
						successRate: basicLatency?.successRate || modelLatency?.successRate || 0,
						variability: modelLatency?.latencyStdDev || 0,
					};
				}
				break;
			}
		}
	});

	// Bottleneck analysis
	analysis.bottleneckAnalysis = analyzeBottlenecks(performanceMetrics);

	// Generate correlations
	analysis.correlations = findPerformanceCorrelations(performanceMetrics);

	// Generate cross-test recommendations
	analysis.recommendations = generateCrossTestRecommendations(
		performanceMetrics,
		analysis.bottleneckAnalysis
	);

	return analysis;
}

/**
 * Analyze bottlenecks across all tests
 */
function analyzeBottlenecks(metrics) {
	const bottlenecks = {
		primary: [],
		secondary: [],
		insights: [],
	};

	// API Latency Analysis (Primary bottleneck candidate)
	if (metrics.apiLatency) {
		const { basicLatency, modelLatency, successRate } = metrics.apiLatency;
		const avgLatency = Math.max(basicLatency, modelLatency);

		if (avgLatency > 3000) {
			bottlenecks.primary.push({
				type: 'API_LATENCY',
				severity: 'HIGH',
				metric: `${avgLatency.toFixed(0)}ms average API response time`,
				impact:
					'This explains the 95% processing time bottleneck - API calls dominate execution time',
			});
		} else if (avgLatency > 1500) {
			bottlenecks.secondary.push({
				type: 'API_LATENCY',
				severity: 'MEDIUM',
				metric: `${avgLatency.toFixed(0)}ms average API response time`,
				impact: 'Moderate API latency contributing to slow processing',
			});
		}

		if (successRate < 0.9) {
			bottlenecks.primary.push({
				type: 'API_RELIABILITY',
				severity: 'HIGH',
				metric: `${((1 - successRate) * 100).toFixed(1)}% API failure rate`,
				impact: 'Failed API calls require retries, multiplying processing time',
			});
		}
	}

	// Extraction Performance Analysis
	if (metrics.extraction) {
		const { avgTokenSpeed, slowestType, fastestType } = metrics.extraction;

		if (avgTokenSpeed < 20) {
			bottlenecks.secondary.push({
				type: 'EXTRACTION_SPEED',
				severity: 'MEDIUM',
				metric: `${avgTokenSpeed.toFixed(1)} tokens/second extraction speed`,
				impact: 'Slow token processing affects overall pipeline performance',
			});
		}

		if (slowestType && fastestType) {
			const speedRatio = slowestType[1].avgDuration / fastestType[1].avgDuration;
			if (speedRatio > 2) {
				bottlenecks.insights.push({
					type: 'EXTRACTION_IMBALANCE',
					metric: `${slowestType[0]} is ${speedRatio.toFixed(1)}x slower than ${fastestType[0]}`,
					impact: 'Imbalanced extraction types suggest prompt optimization opportunities',
				});
			}
		}
	}

	// Embedding Performance Analysis
	if (metrics.embedding) {
		const { avgTokenSpeed } = metrics.embedding;

		if (avgTokenSpeed < 500) {
			bottlenecks.secondary.push({
				type: 'EMBEDDING_SPEED',
				severity: 'LOW',
				metric: `${avgTokenSpeed.toFixed(0)} tokens/second embedding speed`,
				impact: 'Embedding processing is secondary bottleneck after optimizations',
			});
		}
	}

	// Conceptualization Performance Analysis
	if (metrics.conceptualization) {
		const { avgProcessingSpeed } = metrics.conceptualization;

		if (avgProcessingSpeed < 5) {
			bottlenecks.secondary.push({
				type: 'CONCEPTUALIZATION_SPEED',
				severity: 'LOW',
				metric: `${avgProcessingSpeed.toFixed(1)} elements/second conceptualization speed`,
				impact: 'Conceptualization adds processing overhead but is not primary bottleneck',
			});
		}
	}

	return bottlenecks;
}

/**
 * Find performance correlations between tests
 */
function findPerformanceCorrelations(metrics) {
	const correlations = [];

	// API latency vs extraction speed correlation
	if (metrics.apiLatency && metrics.extraction) {
		const apiLatency = Math.max(metrics.apiLatency.basicLatency, metrics.apiLatency.modelLatency);
		const extractionSpeed = metrics.extraction.avgTokenSpeed;

		if (apiLatency > 2000 && extractionSpeed < 25) {
			correlations.push({
				type: 'API_EXTRACTION_CORRELATION',
				description: 'High API latency correlates with slow extraction speed',
				insight: 'Network/API issues are the root cause of extraction bottleneck',
			});
		}
	}

	// Success rate vs processing speed correlation
	if (metrics.apiLatency) {
		const successRate = metrics.apiLatency.successRate;

		if (successRate < 0.85) {
			correlations.push({
				type: 'RELIABILITY_PERFORMANCE_CORRELATION',
				description: 'Low API success rate compounds performance issues',
				insight: 'Retry logic needed to handle API failures gracefully',
			});
		}
	}

	// Embedding efficiency correlation
	if (metrics.embedding && metrics.embedding.optimalEfficiency > 90) {
		correlations.push({
			type: 'EMBEDDING_OPTIMIZATION_SUCCESS',
			description: 'Embedding batch optimization is working effectively',
			insight: 'Phase 2 optimizations successfully eliminated embedding bottleneck',
		});
	}

	return correlations;
}

/**
 * Generate cross-test optimization recommendations
 */
function generateCrossTestRecommendations(metrics, bottlenecks) {
	const recommendations = [];

	// Primary recommendations based on bottleneck analysis
	if (bottlenecks.primary.length > 0) {
		recommendations.push('🎯 PRIMARY OPTIMIZATIONS (High Impact):');

		bottlenecks.primary.forEach(bottleneck => {
			switch (bottleneck.type) {
				case 'API_LATENCY':
					recommendations.push(
						'   • Implement request timeout optimization and retry logic with exponential backoff'
					);
					recommendations.push('   • Add circuit breaker pattern for failed API calls');
					recommendations.push('   • Consider API region optimization or provider alternatives');
					recommendations.push('   • Implement request batching/grouping where possible');
					break;

				case 'API_RELIABILITY':
					recommendations.push('   • Implement robust retry mechanisms with exponential backoff');
					recommendations.push('   • Add request deduplication to avoid retry storms');
					recommendations.push('   • Monitor API status and implement graceful degradation');
					break;
			}
		});
	}

	// Secondary recommendations
	if (bottlenecks.secondary.length > 0) {
		recommendations.push('');
		recommendations.push('⚙️  SECONDARY OPTIMIZATIONS (Medium Impact):');

		bottlenecks.secondary.forEach(bottleneck => {
			switch (bottleneck.type) {
				case 'EXTRACTION_SPEED':
					recommendations.push('   • Optimize prompts for faster processing');
					recommendations.push('   • Consider model switching for speed vs quality tradeoff');
					break;

				case 'EMBEDDING_SPEED':
					recommendations.push('   • Fine-tune batch sizes for optimal throughput');
					recommendations.push('   • Consider embedding caching for frequently seen texts');
					break;

				case 'CONCEPTUALIZATION_SPEED':
					recommendations.push('   • Move conceptualization to background processing queue');
					recommendations.push('   • Implement progressive concept generation');
					break;
			}
		});
	}

	// Implementation insights
	if (bottlenecks.insights.length > 0) {
		recommendations.push('');
		recommendations.push('💡 IMPLEMENTATION INSIGHTS:');

		bottlenecks.insights.forEach(insight => {
			if (insight.type === 'EXTRACTION_IMBALANCE') {
				recommendations.push(
					`   • ${insight.metric} - balance prompt complexity across extraction types`
				);
			}
		});
	}

	// Specific optimization recommendations based on metrics
	if (metrics.apiLatency?.basicLatency > 5000) {
		recommendations.push('');
		recommendations.push(
			'🚨 CRITICAL: API latency exceeds 5 seconds - immediate investigation required'
		);
		recommendations.push('   • Check network connectivity and DNS resolution');
		recommendations.push('   • Verify API endpoint regions and routing');
		recommendations.push('   • Consider switching to faster AI provider/model');
	}

	if (metrics.embedding?.optimalBatchSize) {
		recommendations.push('');
		recommendations.push(
			`✅ CONFIRMED: Optimal embedding batch size is ${metrics.embedding.optimalBatchSize} (${metrics.embedding.optimalEfficiency.toFixed(1)} texts/call)`
		);
		recommendations.push('   • Update production configuration to use optimal batch size');
	}

	// Overall strategy recommendation
	recommendations.push('');
	recommendations.push('🎯 OPTIMIZATION STRATEGY:');
	if (
		metrics.apiLatency &&
		(metrics.apiLatency.basicLatency > 2000 || metrics.apiLatency.modelLatency > 2000)
	) {
		recommendations.push(
			'   1. Focus on API request optimization (highest impact - addresses 95% bottleneck)'
		);
		recommendations.push('   2. Implement background processing for non-blocking operations');
		recommendations.push('   3. Add comprehensive monitoring and alerting for API performance');
		recommendations.push('   4. Consider architectural changes for high-latency scenarios');
	} else {
		recommendations.push(
			'   1. API latency is within acceptable range - focus on algorithmic optimizations'
		);
		recommendations.push('   2. Continue with planned optimization phases');
	}

	return recommendations;
}

/**
 * Save comprehensive report to file
 */
async function saveReport(reportData) {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `ai-isolation-report-${timestamp}.json`;
	const filepath = resolve(__dirname, '../reports', filename);

	try {
		// Ensure reports directory exists
		const reportsDir = resolve(__dirname, '../reports');
		const { mkdirSync } = await import('node:fs');
		try {
			mkdirSync(reportsDir, { recursive: true });
		} catch (e) {
			// Directory might already exist
		}

		writeFileSync(filepath, JSON.stringify(reportData, null, 2));
		console.log(`\n📄 Detailed report saved to: ${filename}`);
		return filepath;
	} catch (error) {
		console.error('Failed to save report:', error.message);
		return null;
	}
}

/**
 * Main test runner function
 */
async function runAIIsolationTests() {
	console.log('🧪 AI Performance Isolation Test Suite');
	console.log('=====================================');
	console.log('🎯 Goal: Identify root causes of 95% AI processing bottleneck');
	console.log(
		'📊 Expected: Detailed analysis of extraction, embedding, conceptualization, and API latency'
	);
	console.log('\n🚀 Starting comprehensive AI performance analysis...\n');

	const overallStartTime = performance.now();

	try {
		// Load all test modules
		const testModules = await loadTestModules();

		// Run each test suite
		const testResults = [];

		// Test 1: ExtractByType Performance
		const extractResult = await runTestSafely(
			'ExtractByType Performance Test',
			testModules.runExtractByTypeTest
		);
		testResults.push(extractResult);

		// Test 2: Embedding Batch Performance
		const embeddingResult = await runTestSafely(
			'Embedding Batch Performance Test',
			testModules.runEmbeddingBatchTest
		);
		testResults.push(embeddingResult);

		// Test 3: Conceptualization Performance
		const conceptResult = await runTestSafely(
			'Conceptualization Performance Test',
			testModules.runConceptualizationTest
		);
		testResults.push(conceptResult);

		// Test 4: API Latency Performance
		const apiResult = await runTestSafely(
			'API Latency Performance Test',
			testModules.runAPILatencyTest
		);
		testResults.push(apiResult);

		const overallEndTime = performance.now();
		const totalDuration = overallEndTime - overallStartTime;

		// Generate comprehensive cross-test analysis
		console.log(`\n${'='.repeat(80)}`);
		console.log('📋 COMPREHENSIVE AI PERFORMANCE ANALYSIS');
		console.log('='.repeat(80));

		const crossAnalysis = generateCrossTestAnalysis(testResults);

		// Display summary
		console.log('\n📊 EXECUTION SUMMARY:');
		console.log(`   Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
		console.log(`   Tests Run: ${crossAnalysis.summary.totalTests}`);
		console.log(`   Successful: ${crossAnalysis.summary.successfulTests}`);
		console.log(`   Failed: ${crossAnalysis.summary.failedTests}`);
		console.log(
			`   Average Test Time: ${(crossAnalysis.summary.avgTestDuration / 1000).toFixed(2)}s`
		);

		// Display bottleneck analysis
		if (crossAnalysis.bottleneckAnalysis.primary.length > 0) {
			console.log('\n🚨 PRIMARY BOTTLENECKS IDENTIFIED:');
			crossAnalysis.bottleneckAnalysis.primary.forEach(bottleneck => {
				console.log(`   ❗ ${bottleneck.type}: ${bottleneck.metric}`);
				console.log(`      Impact: ${bottleneck.impact}`);
			});
		}

		if (crossAnalysis.bottleneckAnalysis.secondary.length > 0) {
			console.log('\n⚠️  SECONDARY BOTTLENECKS:');
			crossAnalysis.bottleneckAnalysis.secondary.forEach(bottleneck => {
				console.log(`   • ${bottleneck.type}: ${bottleneck.metric}`);
			});
		}

		// Display correlations
		if (crossAnalysis.correlations.length > 0) {
			console.log('\n🔗 PERFORMANCE CORRELATIONS:');
			crossAnalysis.correlations.forEach(correlation => {
				console.log(`   • ${correlation.description}`);
				console.log(`     Insight: ${correlation.insight}`);
			});
		}

		// Display recommendations
		console.log('\n💡 COMPREHENSIVE OPTIMIZATION ROADMAP:');
		console.log('=======================================');
		crossAnalysis.recommendations.forEach(rec => {
			console.log(rec);
		});

		// Compile final report
		const finalReport = {
			testName: 'AI Performance Isolation Test Suite',
			timestamp: new Date().toISOString(),
			executionTime: totalDuration,
			environment: {
				nodeVersion: process.version,
				platform: process.platform,
			},
			testResults,
			crossAnalysis,
			conclusion: generateConclusion(crossAnalysis),
		};

		// Save detailed report
		const reportPath = saveReport(finalReport);

		console.log('\n✅ AI Performance Isolation Test Suite completed successfully!');
		console.log(`📊 Total execution time: ${(totalDuration / 1000).toFixed(2)}s`);
		if (reportPath) {
			console.log(`📄 Detailed report available at: ${reportPath}`);
		}

		return finalReport;
	} catch (error) {
		const totalDuration = performance.now() - overallStartTime;

		console.error('\n❌ AI Isolation Test Suite failed:', error.message);
		console.error(`⏱️  Failed after: ${(totalDuration / 1000).toFixed(2)}s`);

		throw error;
	}
}

/**
 * Generate final conclusion based on all test results
 */
function generateConclusion(crossAnalysis) {
	const conclusion = {
		rootCause: 'UNKNOWN',
		confidence: 'LOW',
		expectedImprovement: '0-10%',
		nextSteps: [],
	};

	const { bottleneckAnalysis } = crossAnalysis;

	// Determine root cause
	if (bottleneckAnalysis.primary.length > 0) {
		const primaryBottleneck = bottleneckAnalysis.primary[0];

		if (primaryBottleneck.type === 'API_LATENCY') {
			conclusion.rootCause = 'HIGH_API_LATENCY';
			conclusion.confidence = 'HIGH';
			conclusion.expectedImprovement = '60-80%';
			conclusion.nextSteps = [
				'Implement API request optimization and retry logic',
				'Add circuit breaker pattern for reliability',
				'Consider API provider/region optimization',
				'Implement request batching where possible',
			];
		} else if (primaryBottleneck.type === 'API_RELIABILITY') {
			conclusion.rootCause = 'API_RELIABILITY_ISSUES';
			conclusion.confidence = 'HIGH';
			conclusion.expectedImprovement = '40-60%';
			conclusion.nextSteps = [
				'Implement robust retry mechanisms',
				'Add request deduplication',
				'Monitor API health and implement fallbacks',
			];
		}
	} else if (bottleneckAnalysis.secondary.length > 0) {
		conclusion.rootCause = 'MULTIPLE_MINOR_BOTTLENECKS';
		conclusion.confidence = 'MEDIUM';
		conclusion.expectedImprovement = '20-40%';
		conclusion.nextSteps = [
			'Address multiple secondary bottlenecks incrementally',
			'Focus on highest-impact optimizations first',
		];
	} else {
		conclusion.rootCause = 'OPTIMIZATION_OPPORTUNITIES_LIMITED';
		conclusion.confidence = 'MEDIUM';
		conclusion.expectedImprovement = '10-20%';
		conclusion.nextSteps = [
			'Focus on architectural improvements',
			'Consider alternative processing strategies',
		];
	}

	return conclusion;
}

// Run the test suite if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runAIIsolationTests()
		.then(() => {
			process.exit(0);
		})
		.catch(error => {
			console.error('\nTest suite failed:', error);
			process.exit(1);
		});
}

export { runAIIsolationTests };
