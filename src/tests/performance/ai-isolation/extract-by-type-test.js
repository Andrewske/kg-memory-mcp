#!/usr/bin/env node

/**
 * ExtractByType Performance Isolation Test
 *
 * Purpose: Test individual extractByType calls for each triple type to identify
 * which specific extraction types are causing the 95% AI bottleneck
 *
 * Measurements:
 * - Individual API response times per type
 * - Token usage patterns
 * - Prompt complexity impact
 * - Model response patterns
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the function we're testing
async function loadExtractFunction() {
	const { extractByType, createTypeSpecificPrompt } = await import(
		'../../../features/knowledge-extraction/extract.js'
	);
	return { extractByType, createTypeSpecificPrompt };
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
 * Create test data for extraction
 */
function createTestData(text, size) {
	return {
		text,
		source: `extract-by-type-test-${size}`,
		source_type: 'performance-test',
		source_date: new Date().toISOString(),
	};
}

/**
 * Test individual extractByType performance
 */
async function testExtractByType(extractByType, testData, type) {
	const startTime = performance.now();
	const startMemory = process.memoryUsage();

	console.log(`[${type}] Starting extraction test...`);

	try {
		const result = await extractByType(testData, type);

		const endTime = performance.now();
		const endMemory = process.memoryUsage();
		const duration = endTime - startTime;
		const memoryUsed = endMemory.heapUsed - startMemory.heapUsed;

		if (!result.success) {
			console.error(`[${type}] ❌ Extraction failed:`, result.error);
			return {
				type,
				success: false,
				error: result.error,
				duration,
				memoryUsed,
				timestamp: new Date().toISOString(),
			};
		}

		const triplesExtracted = result.data.length;
		const tokensPerSecond = testData.text.length / 4 / (duration / 1000); // Rough token estimate
		const msPerToken = duration / (testData.text.length / 4);

		console.log(`[${type}] ✅ Extraction completed:`, {
			duration: `${duration.toFixed(2)}ms`,
			triplesExtracted,
			tokensPerSecond: tokensPerSecond.toFixed(2),
			msPerToken: msPerToken.toFixed(2),
			memoryUsed: `${(memoryUsed / 1024 / 1024).toFixed(2)}MB`,
		});

		return {
			type,
			success: true,
			results: {
				triplesExtracted,
				duration,
				tokensPerSecond,
				msPerToken,
				memoryUsed,
				textLength: testData.text.length,
				estimatedTokens: Math.round(testData.text.length / 4),
			},
			sampleTriples: result.data.slice(0, 3), // Include sample for quality analysis
			timestamp: new Date().toISOString(),
		};
	} catch (error) {
		const endTime = performance.now();
		const duration = endTime - startTime;

		console.error(`[${type}] ❌ Extraction threw error:`, error.message);

		return {
			type,
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
 * Run comprehensive extractByType performance test
 */
async function runExtractByTypeTest() {
	console.log('🧪 ExtractByType Performance Isolation Test');
	console.log('==============================================\n');

	const { extractByType } = await loadExtractFunction();

	// Load test texts
	const testSizes = [
		{ name: 'small', filename: 'small-text.txt' },
		{ name: 'medium', filename: 'medium-text.txt' },
	];

	const extractionTypes = ['ENTITY_ENTITY', 'ENTITY_EVENT', 'EVENT_EVENT', 'EMOTIONAL_CONTEXT'];

	const results = [];

	for (const testSize of testSizes) {
		console.log(`\n📝 Testing ${testSize.name} text (${testSize.filename})`);
		console.log('─'.repeat(50));

		const text = loadTestText(testSize.filename);
		if (!text) {
			console.error(`❌ Failed to load ${testSize.filename}, skipping...`);
			continue;
		}

		console.log(`Text length: ${text.length} characters (~${Math.round(text.length / 4)} tokens)`);

		const testData = createTestData(text, testSize.name);
		const sizeResults = [];

		// Test each extraction type individually
		for (const type of extractionTypes) {
			console.log(`\n🔍 Testing ${type} extraction...`);

			const result = await testExtractByType(extractByType, testData, type);
			sizeResults.push(result);

			// Add delay between requests to avoid rate limiting
			if (extractionTypes.indexOf(type) < extractionTypes.length - 1) {
				console.log('⏳ Waiting 2s to avoid rate limiting...');
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}

		results.push({
			testSize: testSize.name,
			textLength: text.length,
			estimatedTokens: Math.round(text.length / 4),
			results: sizeResults,
		});
	}

	// Generate comprehensive report
	console.log('\n📊 EXTRACTION TYPE PERFORMANCE ANALYSIS');
	console.log('=====================================\n');

	// Analyze results by type across all sizes
	const typeAnalysis = {};

	for (const sizeResult of results) {
		console.log(`\n${sizeResult.testSize.toUpperCase()} TEXT RESULTS:`);
		console.log(`Text: ${sizeResult.textLength} chars (~${sizeResult.estimatedTokens} tokens)`);
		console.log('─'.repeat(40));

		for (const result of sizeResult.results) {
			if (!result.success) {
				console.log(`❌ ${result.type}: FAILED - ${result.error?.message || 'Unknown error'}`);
				continue;
			}

			const r = result.results;
			console.log(`✅ ${result.type}:`);
			console.log(`   Duration: ${r.duration.toFixed(2)}ms`);
			console.log(`   Triples: ${r.triplesExtracted}`);
			console.log(`   Speed: ${r.tokensPerSecond.toFixed(1)} tok/s`);
			console.log(`   Efficiency: ${r.msPerToken.toFixed(1)}ms/token`);
			console.log(`   Memory: ${(r.memoryUsed / 1024 / 1024).toFixed(1)}MB`);

			// Aggregate type analysis
			if (!typeAnalysis[result.type]) {
				typeAnalysis[result.type] = {
					totalDuration: 0,
					totalTriples: 0,
					testCount: 0,
					avgDuration: 0,
					avgTriples: 0,
					avgTokenSpeed: 0,
					avgMsPerToken: 0,
				};
			}

			const analysis = typeAnalysis[result.type];
			analysis.totalDuration += r.duration;
			analysis.totalTriples += r.triplesExtracted;
			analysis.testCount += 1;
			analysis.avgDuration = analysis.totalDuration / analysis.testCount;
			analysis.avgTriples = analysis.totalTriples / analysis.testCount;
			analysis.avgTokenSpeed += r.tokensPerSecond;
			analysis.avgMsPerToken += r.msPerToken;
		}
	}

	// Calculate final averages
	for (const type in typeAnalysis) {
		const analysis = typeAnalysis[type];
		analysis.avgTokenSpeed = analysis.avgTokenSpeed / analysis.testCount;
		analysis.avgMsPerToken = analysis.avgMsPerToken / analysis.testCount;
	}

	console.log('\n🎯 EXTRACTION TYPE PERFORMANCE RANKING');
	console.log('=====================================');

	// Sort by average duration (fastest first)
	const sortedTypes = Object.entries(typeAnalysis).sort(
		([, a], [, b]) => a.avgDuration - b.avgDuration
	);

	sortedTypes.forEach(([type, analysis], index) => {
		const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
		console.log(`${medal} ${type}:`);
		console.log(`   Avg Duration: ${analysis.avgDuration.toFixed(2)}ms`);
		console.log(`   Avg Triples: ${analysis.avgTriples.toFixed(1)}`);
		console.log(`   Avg Speed: ${analysis.avgTokenSpeed.toFixed(1)} tok/s`);
		console.log(`   Avg Efficiency: ${analysis.avgMsPerToken.toFixed(1)}ms/token`);
		console.log('');
	});

	// Save detailed results
	const reportData = {
		testName: 'ExtractByType Performance Isolation',
		timestamp: new Date().toISOString(),
		environment: {
			nodeVersion: process.version,
			platform: process.platform,
		},
		results,
		typeAnalysis,
		recommendations: generateRecommendations(typeAnalysis),
	};

	console.log('💡 OPTIMIZATION RECOMMENDATIONS:');
	console.log('================================');
	reportData.recommendations.forEach((rec, index) => {
		console.log(`${index + 1}. ${rec}`);
	});

	return reportData;
}

/**
 * Generate optimization recommendations based on test results
 */
function generateRecommendations(typeAnalysis) {
	const recommendations = [];
	const types = Object.entries(typeAnalysis);

	if (types.length === 0) {
		return ['No successful extractions to analyze'];
	}

	// Find slowest and fastest types
	const slowest = types.reduce((a, b) => (a[1].avgDuration > b[1].avgDuration ? a : b));
	const fastest = types.reduce((a, b) => (a[1].avgDuration < b[1].avgDuration ? a : b));

	if (slowest[1].avgDuration > fastest[1].avgDuration * 1.5) {
		recommendations.push(
			`${slowest[0]} is ${(slowest[1].avgDuration / fastest[1].avgDuration).toFixed(1)}x slower than ${fastest[0]} - investigate prompt complexity`
		);
	}

	// Check for consistently slow types
	const avgDuration =
		types.reduce((sum, [, analysis]) => sum + analysis.avgDuration, 0) / types.length;
	const slowTypes = types.filter(([, analysis]) => analysis.avgDuration > avgDuration * 1.2);

	if (slowTypes.length > 0) {
		recommendations.push(
			`Slow extraction types detected: ${slowTypes.map(([type]) => type).join(', ')} - consider prompt optimization`
		);
	}

	// Check extraction efficiency
	const lowEfficiencyTypes = types.filter(([, analysis]) => analysis.avgTriples < 1);
	if (lowEfficiencyTypes.length > 0) {
		recommendations.push(
			`Low triple extraction efficiency: ${lowEfficiencyTypes.map(([type]) => type).join(', ')} - review prompt effectiveness`
		);
	}

	// Overall speed analysis
	const overallAvgSpeed =
		types.reduce((sum, [, analysis]) => sum + analysis.avgTokenSpeed, 0) / types.length;
	if (overallAvgSpeed < 20) {
		recommendations.push(
			`Overall token processing speed is ${overallAvgSpeed.toFixed(1)} tok/s - investigate API latency and model selection`
		);
	}

	if (recommendations.length === 0) {
		recommendations.push('All extraction types performing within expected parameters');
	}

	return recommendations;
}

// Run the test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runExtractByTypeTest()
		.then(_results => {
			console.log('\n✅ ExtractByType performance test completed successfully');
			process.exit(0);
		})
		.catch(error => {
			console.error('\n❌ ExtractByType performance test failed:', error);
			process.exit(1);
		});
}

export { runExtractByTypeTest };
