#!/usr/bin/env node

/**
 * Conceptualization Performance Isolation Test
 *
 * Purpose: Test generateConcepts performance with various input complexities
 * to identify conceptualization bottlenecks and scaling patterns
 *
 * Measurements:
 * - Concept generation response times
 * - Input complexity scaling
 * - Concept quality vs speed tradeoffs
 * - AI response pattern analysis
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import conceptualization functions
async function loadConceptualizationFunctions() {
	const { generateConcepts, extractElementsFromTriples } = await import(
		'../../../features/conceptualization/conceptualize.js'
	);
	return { generateConcepts, extractElementsFromTriples };
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
 * Generate mock triples for conceptualization testing
 */
function generateMockTriples(count, complexity = 'medium') {
	const entities =
		complexity === 'high'
			? [
					'artificial_intelligence',
					'machine_learning',
					'neural_networks',
					'deep_learning',
					'data_science',
					'algorithms',
					'robotics',
					'automation',
					'computer_vision',
					'natural_language_processing',
				]
			: complexity === 'medium'
				? [
						'technology',
						'innovation',
						'development',
						'research',
						'analysis',
						'system',
						'process',
						'method',
					]
				: ['data', 'user', 'system', 'process'];

	const predicates =
		complexity === 'high'
			? [
					'implements',
					'leverages',
					'optimizes',
					'enhances',
					'integrates_with',
					'depends_on',
					'transforms',
					'analyzes',
				]
			: complexity === 'medium'
				? ['uses', 'creates', 'processes', 'analyzes', 'involves', 'requires']
				: ['has', 'is', 'does', 'uses'];

	const events =
		complexity === 'high'
			? [
					'model_training',
					'data_preprocessing',
					'feature_extraction',
					'hyperparameter_tuning',
					'model_evaluation',
					'deployment',
				]
			: complexity === 'medium'
				? ['processing', 'analysis', 'development', 'testing', 'implementation']
				: ['action', 'event', 'process'];

	const triples = [];
	for (let i = 0; i < count; i++) {
		const subject = entities[Math.floor(Math.random() * entities.length)];
		const predicate = predicates[Math.floor(Math.random() * predicates.length)];
		const object =
			i % 3 === 0
				? events[Math.floor(Math.random() * events.length)]
				: entities[Math.floor(Math.random() * entities.length)];

		triples.push({
			subject,
			predicate,
			object,
			type: i % 4 === 0 ? 'ENTITY_EVENT' : 'ENTITY_ENTITY',
			confidence: 0.8 + Math.random() * 0.2,
		});
	}

	return triples;
}

/**
 * Extract conceptualization input from triples
 */
function extractConceptualizationInput(triples) {
	const entities = new Set();
	const relationships = new Set();
	const events = new Set();
	const contextTriples = [];

	for (const triple of triples) {
		entities.add(triple.subject);
		entities.add(triple.object);
		relationships.add(triple.predicate);

		if (triple.type === 'ENTITY_EVENT' || triple.type === 'EVENT_EVENT') {
			events.add(triple.object);
		}

		contextTriples.push(`${triple.subject} ${triple.predicate} ${triple.object}`);
	}

	return {
		entities: Array.from(entities),
		events: Array.from(events),
		relationships: Array.from(relationships),
		contextTriples,
	};
}

/**
 * Test conceptualization performance
 */
async function testConceptualization(generateConcepts, input, metadata, testName) {
	const startTime = performance.now();
	const startMemory = process.memoryUsage();

	const inputSize = input.entities.length + input.events.length + input.relationships.length;
	console.log(`[${testName}] Testing conceptualization with ${inputSize} elements...`);
	console.log(
		`[${testName}] Elements: ${input.entities.length} entities, ${input.events.length} events, ${input.relationships.length} relationships`
	);
	console.log(`[${testName}] Context triples: ${input.contextTriples.length}`);
	console.log(`[${testName}] Sample entities: ${input.entities.slice(0, 3).join(', ')}`);

	try {
		const result = await generateConcepts(input, metadata);

		const endTime = performance.now();
		const endMemory = process.memoryUsage();
		const duration = endTime - startTime;
		const memoryUsed = endMemory.heapUsed - startMemory.heapUsed;

		if (!result.success) {
			console.error(`[${testName}] ❌ Conceptualization failed:`, result.error);
			return {
				testName,
				inputSize,
				success: false,
				error: result.error,
				duration,
				memoryUsed,
				timestamp: new Date().toISOString(),
			};
		}

		const concepts = result.data.concepts || [];
		const conceptualizations = result.data.conceptualizations || [];

		// Analyze concept distribution
		const abstractionLevels = concepts.reduce((acc, concept) => {
			acc[concept.abstraction_level] = (acc[concept.abstraction_level] || 0) + 1;
			return acc;
		}, {});

		const avgConfidence =
			concepts.length > 0
				? concepts.reduce((sum, c) => sum + c.confidence, 0) / concepts.length
				: 0;

		const conceptsPerElement = concepts.length / inputSize;
		const conceptualizationsPerElement = conceptualizations.length / inputSize;
		const processingSpeed = inputSize / (duration / 1000); // elements per second
		const msPerElement = duration / inputSize;

		console.log(`[${testName}] ✅ Conceptualization completed:`, {
			duration: `${duration.toFixed(2)}ms`,
			concepts: concepts.length,
			conceptualizations: conceptualizations.length,
			abstractionLevels,
			avgConfidence: avgConfidence.toFixed(3),
			conceptsPerElement: conceptsPerElement.toFixed(2),
			processingSpeed: `${processingSpeed.toFixed(2)} elem/s`,
			msPerElement: msPerElement.toFixed(2),
			memoryUsed: `${(memoryUsed / 1024 / 1024).toFixed(2)}MB`,
		});

		return {
			testName,
			inputSize,
			success: true,
			input: {
				entities: input.entities.length,
				events: input.events.length,
				relationships: input.relationships.length,
				contextTriples: input.contextTriples.length,
			},
			results: {
				concepts: concepts.length,
				conceptualizations: conceptualizations.length,
				duration,
				abstractionLevels,
				avgConfidence,
				conceptsPerElement,
				conceptualizationsPerElement,
				processingSpeed,
				msPerElement,
				memoryUsed,
			},
			sampleConcepts: concepts.slice(0, 3), // Include samples for quality analysis
			sampleConceptualizations: conceptualizations.slice(0, 3),
			timestamp: new Date().toISOString(),
		};
	} catch (error) {
		const endTime = performance.now();
		const duration = endTime - startTime;

		console.error(`[${testName}] ❌ Conceptualization threw error:`, error.message);

		return {
			testName,
			inputSize,
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
 * Run comprehensive conceptualization performance test
 */
async function runConceptualizationTest() {
	console.log('🧪 Conceptualization Performance Isolation Test');
	console.log('==============================================\n');

	const { generateConcepts } = await loadConceptualizationFunctions();

	// Test scenarios with varying complexity
	const testScenarios = [
		{ name: 'simple', tripleCount: 10, complexity: 'low' },
		{ name: 'medium', tripleCount: 25, complexity: 'medium' },
		{ name: 'complex', tripleCount: 50, complexity: 'high' },
		{ name: 'large', tripleCount: 75, complexity: 'medium' },
		{ name: 'xlarge', tripleCount: 100, complexity: 'high' },
	];

	const results = [];

	for (const scenario of testScenarios) {
		console.log(`\n📝 Testing ${scenario.name} scenario`);
		console.log(`   Triples: ${scenario.tripleCount}, Complexity: ${scenario.complexity}`);
		console.log('─'.repeat(50));

		// Generate mock triples for this scenario
		const triples = generateMockTriples(scenario.tripleCount, scenario.complexity);
		const input = extractConceptualizationInput(triples);

		const metadata = {
			source: `conceptualization-test-${scenario.name}`,
			source_type: 'performance-test',
		};

		console.log(`🔍 Testing conceptualization for ${scenario.name} scenario...`);

		const result = await testConceptualization(generateConcepts, input, metadata, scenario.name);

		results.push({
			scenario: scenario.name,
			tripleCount: scenario.tripleCount,
			complexity: scenario.complexity,
			result,
		});

		// Add delay between tests to avoid rate limiting
		if (testScenarios.indexOf(scenario) < testScenarios.length - 1) {
			console.log('⏳ Waiting 3s to avoid rate limiting...');
			await new Promise(resolve => setTimeout(resolve, 3000));
		}
	}

	// Generate comprehensive report
	console.log('\n📊 CONCEPTUALIZATION PERFORMANCE ANALYSIS');
	console.log('=========================================\n');

	// Analyze scaling patterns
	const scalingAnalysis = {};
	const complexityAnalysis = { low: [], medium: [], high: [] };

	for (const scenarioResult of results) {
		const { scenario, tripleCount, complexity, result } = scenarioResult;

		console.log(`\n${scenario.toUpperCase()} SCENARIO:`);
		console.log(`Triples: ${tripleCount}, Complexity: ${complexity}`);
		console.log('─'.repeat(30));

		if (!result.success) {
			console.log(`❌ FAILED - ${result.error?.message || 'Unknown error'}`);
			continue;
		}

		const r = result.results;
		console.log(`✅ SUCCESS:`);
		console.log(`   Duration: ${r.duration.toFixed(2)}ms`);
		console.log(`   Concepts: ${r.concepts} (${r.conceptsPerElement.toFixed(2)}/element)`);
		console.log(`   Conceptualizations: ${r.conceptualizations}`);
		console.log(`   Processing Speed: ${r.processingSpeed.toFixed(2)} elem/s`);
		console.log(`   Efficiency: ${r.msPerElement.toFixed(2)}ms/element`);
		console.log(`   Avg Confidence: ${r.avgConfidence.toFixed(3)}`);
		console.log(`   Memory: ${(r.memoryUsed / 1024 / 1024).toFixed(1)}MB`);
		console.log(`   Abstraction Levels:`, r.abstractionLevels);

		// Track scaling patterns
		scalingAnalysis[tripleCount] = {
			duration: r.duration,
			concepts: r.concepts,
			processingSpeed: r.processingSpeed,
			msPerElement: r.msPerElement,
		};

		// Track complexity patterns
		complexityAnalysis[complexity].push({
			tripleCount,
			duration: r.duration,
			conceptsPerElement: r.conceptsPerElement,
			processingSpeed: r.processingSpeed,
		});
	}

	// Scaling analysis
	console.log('\n📈 SCALING PATTERN ANALYSIS');
	console.log('===========================');

	const scalingEntries = Object.entries(scalingAnalysis).sort(
		([a], [b]) => parseInt(a) - parseInt(b)
	);
	if (scalingEntries.length >= 2) {
		console.log('Input Size vs Processing Time:');
		scalingEntries.forEach(([tripleCount, data]) => {
			console.log(
				`   ${tripleCount} triples: ${data.duration.toFixed(2)}ms (${data.processingSpeed.toFixed(2)} elem/s)`
			);
		});

		// Calculate scaling coefficient
		const first = scalingEntries[0][1];
		const last = scalingEntries[scalingEntries.length - 1][1];
		const sizeFactor =
			parseInt(scalingEntries[scalingEntries.length - 1][0]) / parseInt(scalingEntries[0][0]);
		const timeFactor = last.duration / first.duration;
		const scalingCoeff = Math.log(timeFactor) / Math.log(sizeFactor);

		console.log(`\nScaling Analysis:`);
		console.log(`   Size increase: ${sizeFactor.toFixed(1)}x`);
		console.log(`   Time increase: ${timeFactor.toFixed(1)}x`);
		console.log(`   Scaling coefficient: O(n^${scalingCoeff.toFixed(2)})`);

		if (scalingCoeff > 1.5) {
			console.log(`   ⚠️  Super-linear scaling detected - investigate optimization opportunities`);
		} else if (scalingCoeff < 1.2) {
			console.log(`   ✅ Near-linear scaling - good performance characteristics`);
		}
	}

	// Complexity analysis
	console.log('\n🎯 COMPLEXITY IMPACT ANALYSIS');
	console.log('=============================');

	Object.entries(complexityAnalysis).forEach(([complexity, results]) => {
		if (results.length === 0) return;

		const avgSpeed = results.reduce((sum, r) => sum + r.processingSpeed, 0) / results.length;
		const avgConceptsPerElement =
			results.reduce((sum, r) => sum + r.conceptsPerElement, 0) / results.length;

		console.log(`${complexity.toUpperCase()} Complexity:`);
		console.log(`   Avg Speed: ${avgSpeed.toFixed(2)} elem/s`);
		console.log(`   Avg Concepts/Element: ${avgConceptsPerElement.toFixed(2)}`);
		console.log(`   Test Count: ${results.length}`);
	});

	// Save detailed results
	const reportData = {
		testName: 'Conceptualization Performance Isolation',
		timestamp: new Date().toISOString(),
		environment: {
			nodeVersion: process.version,
			platform: process.platform,
		},
		results,
		scalingAnalysis,
		complexityAnalysis,
		recommendations: generateConceptualizationRecommendations(
			results,
			scalingAnalysis,
			complexityAnalysis
		),
	};

	console.log('\n💡 OPTIMIZATION RECOMMENDATIONS:');
	console.log('================================');
	reportData.recommendations.forEach((rec, index) => {
		console.log(`${index + 1}. ${rec}`);
	});

	return reportData;
}

/**
 * Generate conceptualization optimization recommendations
 */
function generateConceptualizationRecommendations(results, scalingAnalysis, complexityAnalysis) {
	const recommendations = [];
	const successfulResults = results.filter(r => r.result.success);

	if (successfulResults.length === 0) {
		return ['No successful conceptualization tests to analyze'];
	}

	// Performance analysis
	const avgProcessingSpeed =
		successfulResults.reduce((sum, r) => sum + r.result.results.processingSpeed, 0) /
		successfulResults.length;
	if (avgProcessingSpeed < 5) {
		recommendations.push(
			`Low conceptualization speed (${avgProcessingSpeed.toFixed(2)} elem/s) - investigate AI model performance and prompt optimization`
		);
	}

	// Quality analysis
	const avgConfidence =
		successfulResults.reduce((sum, r) => sum + r.result.results.avgConfidence, 0) /
		successfulResults.length;
	if (avgConfidence < 0.7) {
		recommendations.push(
			`Low concept confidence (${avgConfidence.toFixed(2)}) - review prompt clarity and examples`
		);
	}

	// Scaling analysis
	const scalingEntries = Object.entries(scalingAnalysis);
	if (scalingEntries.length >= 2) {
		const first = scalingEntries[0][1];
		const last = scalingEntries[scalingEntries.length - 1][1];
		const sizeFactor =
			parseInt(scalingEntries[scalingEntries.length - 1][0]) / parseInt(scalingEntries[0][0]);
		const timeFactor = last.duration / first.duration;
		const scalingCoeff = Math.log(timeFactor) / Math.log(sizeFactor);

		if (scalingCoeff > 1.5) {
			recommendations.push(
				`Super-linear scaling detected (O(n^${scalingCoeff.toFixed(2)})) - consider input size limits or parallel processing`
			);
		}
	}

	// Complexity analysis
	const complexityEntries = Object.entries(complexityAnalysis).filter(
		([, results]) => results.length > 0
	);
	if (complexityEntries.length > 1) {
		const speeds = complexityEntries.map(([complexity, results]) => ({
			complexity,
			avgSpeed: results.reduce((sum, r) => sum + r.processingSpeed, 0) / results.length,
		}));

		const speedRange =
			Math.max(...speeds.map(s => s.avgSpeed)) - Math.min(...speeds.map(s => s.avgSpeed));
		if (speedRange > 2) {
			const slowest = speeds.find(s => s.avgSpeed === Math.min(...speeds.map(s => s.avgSpeed)));
			recommendations.push(
				`${slowest.complexity} complexity significantly slower - consider complexity-based processing strategies`
			);
		}
	}

	// Efficiency analysis
	const conceptsPerElement = successfulResults.map(r => r.result.results.conceptsPerElement);
	const avgConceptsPerElement =
		conceptsPerElement.reduce((sum, c) => sum + c, 0) / conceptsPerElement.length;
	if (avgConceptsPerElement < 0.5) {
		recommendations.push(
			`Low concept generation efficiency (${avgConceptsPerElement.toFixed(2)} concepts/element) - review concept generation prompts`
		);
	} else if (avgConceptsPerElement > 2) {
		recommendations.push(
			`High concept generation rate (${avgConceptsPerElement.toFixed(2)} concepts/element) - consider filtering for quality`
		);
	}

	if (recommendations.length === 0) {
		recommendations.push('Conceptualization performance within expected parameters');
	}

	return recommendations;
}

// Run the test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runConceptualizationTest()
		.then(results => {
			console.log('\n✅ Conceptualization performance test completed successfully');
			process.exit(0);
		})
		.catch(error => {
			console.error('\n❌ Conceptualization performance test failed:', error);
			process.exit(1);
		});
}

export { runConceptualizationTest };
