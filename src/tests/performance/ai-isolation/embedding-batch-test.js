#!/usr/bin/env node

/**
 * Embedding Batch Performance Isolation Test
 * 
 * Purpose: Test embedBatch performance with various batch sizes and text types
 * to identify optimal batching strategies and API latency patterns
 * 
 * Measurements:
 * - Embedding API response times
 * - Batch processing efficiency
 * - Token costs and usage
 * - Rate limiting effects
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import embedding service
async function loadEmbeddingService() {
	const { createEmbeddingService } = await import('../../../shared/services/embedding-service.js');
	const { env } = await import('../../../shared/env.js');
	
	const embeddingService = createEmbeddingService({
		model: env.EMBEDDING_MODEL,
		batchSize: 32, // We'll override this in tests
	});
	
	return embeddingService;
}

// Test fixtures path
const FIXTURES_DIR = resolve(__dirname, '../fixtures');

/**
 * Load test text from fixtures
 */
function loadTestText(filename) {
	try {
		const filePath = resolve(FIXTURES_DIR, filename);
		return readFileSync(filePath, 'utf8');
	} catch (error) {
		console.error(`Failed to load fixture ${filename}:`, error.message);
		return null;
	}
}

/**
 * Generate test texts of various types
 */
function generateTestTexts(sourceText, count) {
	const words = sourceText.split(/\s+/);
	const texts = [];
	
	// Generate texts of varying lengths
	for (let i = 0; i < count; i++) {
		const startIdx = Math.floor(Math.random() * (words.length - 10));
		const lengthVariation = Math.floor(Math.random() * 20) + 5; // 5-25 words
		const text = words.slice(startIdx, startIdx + lengthVariation).join(' ');
		texts.push(text);
	}
	
	return texts;
}

/**
 * Test embedding batch performance
 */
async function testEmbeddingBatch(embeddingService, texts, batchSize, testName) {
	const startTime = performance.now();
	const startMemory = process.memoryUsage();
	
	console.log(`[${testName}] Testing batch size ${batchSize} with ${texts.length} texts...`);
	console.log(`[${testName}] Sample text: "${texts[0]?.substring(0, 50)}..."`);
	
	try {
		// Override batch size for this test
		const customEmbeddingService = {
			...embeddingService,
			embedBatch: async (batchTexts, context) => {
				// Split into batches manually to control batch size
				const batches = [];
				for (let i = 0; i < batchTexts.length; i += batchSize) {
					batches.push(batchTexts.slice(i, i + batchSize));
				}
				
				console.log(`[${testName}] Processing ${batches.length} batches...`);
				
				const allEmbeddings = [];
				let totalApiCalls = 0;
				
				for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
					const batch = batches[batchIndex];
					const batchStartTime = performance.now();
					
					// Call original embedBatch with single batch
					const result = await embeddingService.embedBatch(batch, context);
					
					if (!result.success) {
						throw new Error(`Batch ${batchIndex + 1} failed: ${result.error.message}`);
					}
					
					allEmbeddings.push(...result.data);
					totalApiCalls++;
					
					const batchDuration = performance.now() - batchStartTime;
					console.log(`[${testName}] Batch ${batchIndex + 1}/${batches.length}: ${batchDuration.toFixed(2)}ms (${batch.length} texts)`);
				}
				
				return {
					success: true,
					data: allEmbeddings,
					metadata: {
						totalApiCalls,
						batchCount: batches.length,
						avgBatchSize: texts.length / batches.length,
					},
				};
			},
		};
		
		const result = await customEmbeddingService.embedBatch(texts, {
			source_type: 'embedding-batch-test',
			source: testName,
		});
		
		const endTime = performance.now();
		const endMemory = process.memoryUsage();
		const duration = endTime - startTime;
		const memoryUsed = endMemory.heapUsed - startMemory.heapUsed;
		
		if (!result.success) {
			console.error(`[${testName}] ❌ Embedding batch failed:`, result.error);
			return {
				testName,
				batchSize,
				success: false,
				error: result.error,
				duration,
				memoryUsed,
				timestamp: new Date().toISOString(),
			};
		}
		
		const embeddings = result.data;
		const totalTexts = texts.length;
		const avgTextLength = texts.reduce((sum, text) => sum + text.length, 0) / totalTexts;
		const estimatedTokens = totalTexts * (avgTextLength / 4);
		const tokensPerSecond = estimatedTokens / (duration / 1000);
		const msPerToken = duration / estimatedTokens;
		const msPerText = duration / totalTexts;
		const apiCalls = result.metadata?.totalApiCalls || 1;
		const efficiency = totalTexts / apiCalls; // Texts per API call
		
		console.log(`[${testName}] ✅ Embedding completed:`, {
			duration: `${duration.toFixed(2)}ms`,
			embeddings: embeddings.length,
			apiCalls,
			efficiency: `${efficiency.toFixed(1)} texts/call`,
			tokensPerSecond: tokensPerSecond.toFixed(2),
			msPerToken: msPerToken.toFixed(2),
			msPerText: msPerText.toFixed(2),
			memoryUsed: `${(memoryUsed / 1024 / 1024).toFixed(2)}MB`,
		});
		
		return {
			testName,
			batchSize,
			success: true,
			results: {
				totalTexts,
				embeddingsGenerated: embeddings.length,
				duration,
				apiCalls,
				efficiency,
				tokensPerSecond,
				msPerToken,
				msPerText,
				memoryUsed,
				avgTextLength,
				estimatedTokens,
				batchCount: result.metadata?.batchCount || 1,
			},
			timestamp: new Date().toISOString(),
		};
		
	} catch (error) {
		const endTime = performance.now();
		const duration = endTime - startTime;
		
		console.error(`[${testName}] ❌ Embedding batch threw error:`, error.message);
		
		return {
			testName,
			batchSize,
			success: false,
			error: {
				message: error.message,
				stack: error.stack,
			},
			duration,
			timestamp: new Date().toISOString(),
		};
	}
}

/**
 * Test duplicate text detection efficiency
 */
async function testDuplicateEmbedding(embeddingService, texts) {
	console.log('\n🔄 Testing duplicate text handling...');
	
	// Create texts with duplicates
	const uniqueTexts = texts.slice(0, 20);
	const duplicatedTexts = [
		...uniqueTexts,
		...uniqueTexts, // 100% duplicates
		...uniqueTexts.slice(0, 10), // 50% more duplicates
	];
	
	console.log(`Testing with ${duplicatedTexts.length} texts (${uniqueTexts.length} unique)`);
	
	const result = await testEmbeddingBatch(embeddingService, duplicatedTexts, 32, 'duplicate-test');
	
	if (result.success) {
		const duplicateEfficiency = uniqueTexts.length / result.results.embeddingsGenerated;
		console.log(`Duplicate detection efficiency: ${(duplicateEfficiency * 100).toFixed(1)}%`);
		result.results.duplicateEfficiency = duplicateEfficiency;
	}
	
	return result;
}

/**
 * Run comprehensive embedding batch performance test
 */
async function runEmbeddingBatchTest() {
	console.log('🧪 Embedding Batch Performance Isolation Test');
	console.log('============================================\n');
	
	const embeddingService = await loadEmbeddingService();
	
	// Load test text
	const mediumText = loadTestText('medium-text.txt');
	if (!mediumText) {
		throw new Error('Failed to load test fixtures');
	}
	
	// Generate test texts of various sizes
	const testSets = [
		{ name: 'small-batch', count: 10 },
		{ name: 'medium-batch', count: 50 },
		{ name: 'large-batch', count: 100 },
		{ name: 'xlarge-batch', count: 200 },
	];
	
	const batchSizes = [16, 32, 64, 100, 150];
	const results = [];
	
	for (const testSet of testSets) {
		console.log(`\n📝 Testing ${testSet.name} (${testSet.count} texts)`);
		console.log('─'.repeat(50));
		
		const texts = generateTestTexts(mediumText, testSet.count);
		const setResults = [];
		
		// Test different batch sizes
		for (const batchSize of batchSizes) {
			console.log(`\n🔍 Testing batch size ${batchSize}...`);
			
			const result = await testEmbeddingBatch(
				embeddingService,
				texts,
				batchSize,
				`${testSet.name}-batch-${batchSize}`
			);
			
			setResults.push(result);
			
			// Add delay between tests to avoid rate limiting
			if (batchSizes.indexOf(batchSize) < batchSizes.length - 1) {
				console.log('⏳ Waiting 1s to avoid rate limiting...');
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}
		
		results.push({
			testSet: testSet.name,
			textCount: testSet.count,
			results: setResults,
		});
	}
	
	// Test duplicate handling
	const duplicateTestTexts = generateTestTexts(mediumText, 30);
	const duplicateResult = await testDuplicateEmbedding(embeddingService, duplicateTestTexts);
	
	// Generate comprehensive report
	console.log('\n📊 EMBEDDING BATCH PERFORMANCE ANALYSIS');
	console.log('=======================================\n');
	
	// Analyze optimal batch sizes
	const batchAnalysis = {};
	
	for (const setResult of results) {
		console.log(`\n${setResult.testSet.toUpperCase()} (${setResult.textCount} texts):`);
		console.log('─'.repeat(40));
		
		for (const result of setResult.results) {
			if (!result.success) {
				console.log(`❌ Batch ${result.batchSize}: FAILED - ${result.error?.message || 'Unknown error'}`);
				continue;
			}
			
			const r = result.results;
			console.log(`✅ Batch ${result.batchSize}:`);
			console.log(`   Duration: ${r.duration.toFixed(2)}ms`);
			console.log(`   API calls: ${r.apiCalls}`);
			console.log(`   Efficiency: ${r.efficiency.toFixed(1)} texts/call`);
			console.log(`   Speed: ${r.tokensPerSecond.toFixed(1)} tok/s`);
			console.log(`   Per text: ${r.msPerText.toFixed(2)}ms`);
			console.log(`   Memory: ${(r.memoryUsed / 1024 / 1024).toFixed(1)}MB`);
			
			// Aggregate batch analysis
			if (!batchAnalysis[result.batchSize]) {
				batchAnalysis[result.batchSize] = {
					totalDuration: 0,
					totalApiCalls: 0,
					totalTexts: 0,
					testCount: 0,
					avgEfficiency: 0,
					avgTokenSpeed: 0,
					avgMsPerText: 0,
				};
			}
			
			const analysis = batchAnalysis[result.batchSize];
			analysis.totalDuration += r.duration;
			analysis.totalApiCalls += r.apiCalls;
			analysis.totalTexts += r.totalTexts;
			analysis.testCount += 1;
			analysis.avgEfficiency += r.efficiency;
			analysis.avgTokenSpeed += r.tokensPerSecond;
			analysis.avgMsPerText += r.msPerText;
		}
	}
	
	// Calculate final averages
	for (const batchSize in batchAnalysis) {
		const analysis = batchAnalysis[batchSize];
		analysis.avgEfficiency = analysis.avgEfficiency / analysis.testCount;
		analysis.avgTokenSpeed = analysis.avgTokenSpeed / analysis.testCount;
		analysis.avgMsPerText = analysis.avgMsPerText / analysis.testCount;
		analysis.avgDuration = analysis.totalDuration / analysis.testCount;
		analysis.textsPerApiCall = analysis.totalTexts / analysis.totalApiCalls;
	}
	
	console.log('\n🎯 OPTIMAL BATCH SIZE RANKING');
	console.log('=============================');
	
	// Sort by efficiency (texts per API call, then by speed)
	const sortedBatches = Object.entries(batchAnalysis)
		.sort(([,a], [,b]) => {
			const efficiencyDiff = b.avgEfficiency - a.avgEfficiency;
			if (Math.abs(efficiencyDiff) < 1) {
				return b.avgTokenSpeed - a.avgTokenSpeed; // Higher speed is better
			}
			return efficiencyDiff;
		});
	
	sortedBatches.forEach(([batchSize, analysis], index) => {
		const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
		console.log(`${medal} Batch Size ${batchSize}:`);
		console.log(`   Avg Efficiency: ${analysis.avgEfficiency.toFixed(1)} texts/call`);
		console.log(`   Avg Speed: ${analysis.avgTokenSpeed.toFixed(1)} tok/s`);
		console.log(`   Avg Duration: ${analysis.avgDuration.toFixed(2)}ms`);
		console.log(`   Avg Per Text: ${analysis.avgMsPerText.toFixed(2)}ms`);
		console.log('');
	});
	
	// Duplicate handling results
	if (duplicateResult.success) {
		console.log('🔄 DUPLICATE TEXT HANDLING:');
		console.log(`   Efficiency: ${(duplicateResult.results.duplicateEfficiency * 100).toFixed(1)}%`);
		console.log(`   Duration: ${duplicateResult.results.duration.toFixed(2)}ms`);
		console.log(`   API calls: ${duplicateResult.results.apiCalls}`);
	}
	
	// Save detailed results
	const reportData = {
		testName: 'Embedding Batch Performance Isolation',
		timestamp: new Date().toISOString(),
		environment: {
			nodeVersion: process.version,
			platform: process.platform,
		},
		results,
		duplicateResult,
		batchAnalysis,
		recommendations: generateEmbeddingRecommendations(batchAnalysis, duplicateResult),
	};
	
	console.log('\n💡 OPTIMIZATION RECOMMENDATIONS:');
	console.log('================================');
	reportData.recommendations.forEach((rec, index) => {
		console.log(`${index + 1}. ${rec}`);
	});
	
	return reportData;
}

/**
 * Generate embedding optimization recommendations
 */
function generateEmbeddingRecommendations(batchAnalysis, duplicateResult) {
	const recommendations = [];
	const batches = Object.entries(batchAnalysis);
	
	if (batches.length === 0) {
		return ['No successful embedding tests to analyze'];
	}
	
	// Find optimal batch size
	const optimal = batches.reduce((a, b) => 
		a[1].avgEfficiency > b[1].avgEfficiency ? a : b
	);
	recommendations.push(`Optimal batch size: ${optimal[0]} (${optimal[1].avgEfficiency.toFixed(1)} texts/call, ${optimal[1].avgTokenSpeed.toFixed(1)} tok/s)`);
	
	// Check for efficiency patterns
	const highEfficiencyBatches = batches.filter(([, analysis]) => analysis.avgEfficiency > 80);
	if (highEfficiencyBatches.length > 0) {
		const sizes = highEfficiencyBatches.map(([size]) => size).join(', ');
		recommendations.push(`High-efficiency batch sizes: ${sizes} - consider using these for production`);
	}
	
	// Speed analysis
	const avgSpeed = batches.reduce((sum, [, analysis]) => sum + analysis.avgTokenSpeed, 0) / batches.length;
	if (avgSpeed < 1000) {
		recommendations.push(`Average embedding speed is ${avgSpeed.toFixed(1)} tok/s - investigate network latency and API limits`);
	}
	
	// Large batch analysis
	const largeBatches = batches.filter(([size]) => parseInt(size) >= 100);
	if (largeBatches.length > 0) {
		const avgLargeEfficiency = largeBatches.reduce((sum, [, analysis]) => sum + analysis.avgEfficiency, 0) / largeBatches.length;
		if (avgLargeEfficiency > 90) {
			recommendations.push('Large batch sizes (100+) show good efficiency - consider increasing default batch size');
		} else {
			recommendations.push('Large batch sizes show reduced efficiency - stick to medium batch sizes (32-64)');
		}
	}
	
	// Duplicate handling
	if (duplicateResult?.success && duplicateResult.results.duplicateEfficiency) {
		const efficiency = duplicateResult.results.duplicateEfficiency * 100;
		if (efficiency < 90) {
			recommendations.push(`Duplicate detection efficiency is ${efficiency.toFixed(1)}% - verify embedding deduplication is working correctly`);
		}
	}
	
	if (recommendations.length === 1) {
		recommendations.push('Embedding batch performance within expected parameters');
	}
	
	return recommendations;
}

// Run the test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runEmbeddingBatchTest()
		.then(results => {
			console.log('\n✅ Embedding batch performance test completed successfully');
			process.exit(0);
		})
		.catch(error => {
			console.error('\n❌ Embedding batch performance test failed:', error);
			process.exit(1);
		});
}

export { runEmbeddingBatchTest };