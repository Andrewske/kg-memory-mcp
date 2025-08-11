#!/usr/bin/env node

/**
 * API Latency Performance Isolation Test
 * 
 * Purpose: Measure pure API request/response times vs processing overhead
 * to identify network vs computational bottlenecks in the AI extraction pipeline
 * 
 * Measurements:
 * - Request setup time
 * - Network latency
 * - API queue/processing time
 * - Response parsing time
 * - Rate limiting effects
 */

import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import AI provider service
async function loadAIProvider() {
	const { createAIProvider } = await import('../../../shared/services/ai-provider-service.js');
	const { env } = await import('../../../shared/env.js');
	
	const aiProvider = createAIProvider();
	return { aiProvider, env };
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
 * Create simple test prompts of varying complexity
 */
function createTestPrompts() {
	return {
		minimal: {
			prompt: 'Say "hello"',
			expectedTokens: 5,
		},
		simple: {
			prompt: 'List three colors in JSON format as an array called "colors".',
			expectedTokens: 20,
		},
		medium: {
			prompt: `Analyze this text and extract key entities in JSON format:
"The company launched a new AI product last year. The CEO announced record profits."

Return: {"entities": [list of entities]}`,
			expectedTokens: 50,
		},
		complex: {
			prompt: `You are an expert knowledge extraction system. Analyze the following text and extract structured knowledge relationships:

Text: "Microsoft announced the acquisition of OpenAI for $10 billion in January 2023. The deal will accelerate AI development across Microsoft's product portfolio including Azure, Office, and Windows. CEO Satya Nadella praised the partnership as transformational for both companies."

Extract relationships in this JSON format:
{
  "triples": [
    {"subject": "entity1", "predicate": "relationship", "object": "entity2", "confidence": 0.95}
  ]
}

Focus on clear, factual relationships only.`,
			expectedTokens: 150,
		},
	};
}

/**
 * Measure basic API latency with minimal processing
 */
async function measureBasicLatency(aiProvider, iterations = 3) {
	console.log(`\n🔍 Testing basic API latency (${iterations} iterations)...`);
	
	const results = [];
	const simpleSchema = {
		parse: (obj) => obj,
		safeParse: (obj) => ({ success: true, data: obj }),
	};
	
	for (let i = 0; i < iterations; i++) {
		const startTime = performance.now();
		const requestStartTime = Date.now();
		
		try {
			const result = await aiProvider.generateObject(
				'Return JSON: {"message": "hello"}',
				simpleSchema,
				{ maxTokens: 50, temperature: 0 }
			);
			
			const endTime = performance.now();
			const duration = endTime - startTime;
			
			if (result.success) {
				results.push({
					iteration: i + 1,
					duration,
					success: true,
					requestTime: requestStartTime,
					responseTime: Date.now(),
				});
				
				console.log(`   Iteration ${i + 1}: ${duration.toFixed(2)}ms ✅`);
			} else {
				results.push({
					iteration: i + 1,
					duration,
					success: false,
					error: result.error,
				});
				
				console.log(`   Iteration ${i + 1}: ${duration.toFixed(2)}ms ❌ ${result.error?.message}`);
			}
			
			// Add delay between requests
			if (i < iterations - 1) {
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
			
		} catch (error) {
			const endTime = performance.now();
			const duration = endTime - startTime;
			
			results.push({
				iteration: i + 1,
				duration,
				success: false,
				error: { message: error.message },
			});
			
			console.log(`   Iteration ${i + 1}: ${duration.toFixed(2)}ms ❌ ${error.message}`);
		}
	}
	
	const successfulResults = results.filter(r => r.success);
	const avgLatency = successfulResults.length > 0 
		? successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length 
		: 0;
	
	console.log(`   Average Latency: ${avgLatency.toFixed(2)}ms (${successfulResults.length}/${iterations} successful)`);
	
	return {
		testName: 'basic-latency',
		iterations,
		avgLatency,
		successRate: successfulResults.length / iterations,
		results,
	};
}

/**
 * Measure prompt complexity impact on response time
 */
async function measurePromptComplexity(aiProvider) {
	console.log(`\n🔍 Testing prompt complexity impact...`);
	
	const testPrompts = createTestPrompts();
	const results = [];
	
	for (const [name, { prompt, expectedTokens }] of Object.entries(testPrompts)) {
		console.log(`\n   Testing ${name} prompt (~${expectedTokens} tokens)...`);
		
		const startTime = performance.now();
		
		try {
			// Use a flexible schema that accepts any object structure
			const flexibleSchema = {
				parse: (obj) => obj,
				safeParse: (obj) => ({ success: true, data: obj }),
			};
			
			const result = await aiProvider.generateObject(
				prompt,
				flexibleSchema,
				{ 
					maxTokens: Math.max(expectedTokens * 2, 100),
					temperature: 0.1 
				}
			);
			
			const endTime = performance.now();
			const duration = endTime - startTime;
			
			if (result.success) {
				const tokensPerMs = expectedTokens / duration;
				const msPerToken = duration / expectedTokens;
				
				results.push({
					name,
					prompt: prompt.substring(0, 100) + '...',
					expectedTokens,
					duration,
					tokensPerMs,
					msPerToken,
					success: true,
				});
				
				console.log(`     Duration: ${duration.toFixed(2)}ms`);
				console.log(`     Speed: ${tokensPerMs.toFixed(3)} tokens/ms (${msPerToken.toFixed(2)}ms/token)`);
			} else {
				results.push({
					name,
					expectedTokens,
					duration,
					success: false,
					error: result.error,
				});
				
				console.log(`     Duration: ${duration.toFixed(2)}ms ❌ ${result.error?.message}`);
			}
			
		} catch (error) {
			const endTime = performance.now();
			const duration = endTime - startTime;
			
			results.push({
				name,
				expectedTokens,
				duration,
				success: false,
				error: { message: error.message },
			});
			
			console.log(`     Duration: ${duration.toFixed(2)}ms ❌ ${error.message}`);
		}
		
		// Add delay between different complexity tests
		await new Promise(resolve => setTimeout(resolve, 1500));
	}
	
	return {
		testName: 'prompt-complexity',
		results,
	};
}

/**
 * Test concurrent request handling
 */
async function measureConcurrentRequests(aiProvider, concurrency = 3) {
	console.log(`\n🔍 Testing concurrent requests (${concurrency} parallel)...`);
	
	const simplePrompt = 'Return JSON with current timestamp: {"timestamp": "2024-01-01T00:00:00Z"}';
	const simpleSchema = {
		parse: (obj) => obj,
		safeParse: (obj) => ({ success: true, data: obj }),
	};
	
	const startTime = performance.now();
	
	// Create concurrent promises
	const promises = Array.from({ length: concurrency }, (_, index) => {
		const requestStartTime = performance.now();
		
		return aiProvider.generateObject(
			simplePrompt,
			simpleSchema,
			{ maxTokens: 50, temperature: 0 }
		).then(result => ({
			index: index + 1,
			duration: performance.now() - requestStartTime,
			success: result.success,
			error: result.success ? null : result.error,
		})).catch(error => ({
			index: index + 1,
			duration: performance.now() - requestStartTime,
			success: false,
			error: { message: error.message },
		}));
	});
	
	const results = await Promise.allSettled(promises);
	const endTime = performance.now();
	const totalDuration = endTime - startTime;
	
	const processedResults = results.map(result => 
		result.status === 'fulfilled' ? result.value : {
			success: false,
			error: { message: result.reason?.message || 'Promise rejected' },
			duration: 0,
		}
	);
	
	const successfulResults = processedResults.filter(r => r.success);
	const avgRequestTime = successfulResults.length > 0
		? successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length
		: 0;
	
	console.log(`   Total Time: ${totalDuration.toFixed(2)}ms`);
	console.log(`   Avg Request Time: ${avgRequestTime.toFixed(2)}ms`);
	console.log(`   Success Rate: ${successfulResults.length}/${concurrency}`);
	console.log(`   Concurrency Efficiency: ${(avgRequestTime > 0 ? (concurrency * avgRequestTime) / totalDuration : 0).toFixed(2)}x`);
	
	processedResults.forEach(result => {
		const status = result.success ? '✅' : '❌';
		const error = result.success ? '' : ` (${result.error?.message})`;
		console.log(`     Request ${result.index}: ${result.duration.toFixed(2)}ms ${status}${error}`);
	});
	
	return {
		testName: 'concurrent-requests',
		concurrency,
		totalDuration,
		avgRequestTime,
		successRate: successfulResults.length / concurrency,
		efficiency: avgRequestTime > 0 ? (concurrency * avgRequestTime) / totalDuration : 0,
		results: processedResults,
	};
}

/**
 * Measure model-specific latency patterns
 */
async function measureModelLatency(aiProvider, env) {
	console.log(`\n🔍 Testing model-specific latency patterns...`);
	console.log(`   Current Model: ${env.AI_MODEL}`);
	console.log(`   Current Provider: ${env.AI_PROVIDER}`);
	
	const testPrompt = 'Extract one entity from this text: "Apple announced new iPhone." Return JSON: {"entity": "entity_name"}';
	const simpleSchema = {
		parse: (obj) => obj,
		safeParse: (obj) => ({ success: true, data: obj }),
	};
	
	// Test current model configuration
	const iterations = 5;
	const results = [];
	
	for (let i = 0; i < iterations; i++) {
		const startTime = performance.now();
		
		try {
			const result = await aiProvider.generateObject(
				testPrompt,
				simpleSchema,
				{ maxTokens: 100, temperature: 0.1 }
			);
			
			const endTime = performance.now();
			const duration = endTime - startTime;
			
			results.push({
				iteration: i + 1,
				duration,
				success: result.success,
				error: result.success ? null : result.error,
			});
			
			const status = result.success ? '✅' : '❌';
			const error = result.success ? '' : ` (${result.error?.message})`;
			console.log(`     Iteration ${i + 1}: ${duration.toFixed(2)}ms ${status}${error}`);
			
		} catch (error) {
			const endTime = performance.now();
			const duration = endTime - startTime;
			
			results.push({
				iteration: i + 1,
				duration,
				success: false,
				error: { message: error.message },
			});
			
			console.log(`     Iteration ${i + 1}: ${duration.toFixed(2)}ms ❌ ${error.message}`);
		}
		
		// Add delay between iterations
		if (i < iterations - 1) {
			await new Promise(resolve => setTimeout(resolve, 800));
		}
	}
	
	const successfulResults = results.filter(r => r.success);
	const avgLatency = successfulResults.length > 0
		? successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length
		: 0;
	
	const latencyVariance = successfulResults.length > 1
		? successfulResults.reduce((sum, r) => sum + Math.pow(r.duration - avgLatency, 2), 0) / (successfulResults.length - 1)
		: 0;
	
	const latencyStdDev = Math.sqrt(latencyVariance);
	
	console.log(`   Model: ${env.AI_MODEL}`);
	console.log(`   Avg Latency: ${avgLatency.toFixed(2)}ms`);
	console.log(`   Std Deviation: ${latencyStdDev.toFixed(2)}ms`);
	console.log(`   Success Rate: ${successfulResults.length}/${iterations}`);
	
	return {
		testName: 'model-latency',
		model: env.AI_MODEL,
		provider: env.AI_PROVIDER,
		iterations,
		avgLatency,
		latencyStdDev,
		successRate: successfulResults.length / iterations,
		results,
	};
}

/**
 * Run comprehensive API latency test
 */
async function runAPILatencyTest() {
	console.log('🧪 API Latency Performance Isolation Test');
	console.log('=========================================\n');
	
	const { aiProvider, env } = await loadAIProvider();
	
	const testResults = [];
	
	// Test 1: Basic API latency
	const basicLatencyResult = await measureBasicLatency(aiProvider, 5);
	testResults.push(basicLatencyResult);
	
	// Test 2: Prompt complexity impact
	const complexityResult = await measurePromptComplexity(aiProvider);
	testResults.push(complexityResult);
	
	// Test 3: Concurrent request handling
	const concurrentResult = await measureConcurrentRequests(aiProvider, 3);
	testResults.push(concurrentResult);
	
	// Test 4: Model-specific latency
	const modelLatencyResult = await measureModelLatency(aiProvider, env);
	testResults.push(modelLatencyResult);
	
	// Generate comprehensive report
	console.log('\n📊 API LATENCY PERFORMANCE ANALYSIS');
	console.log('===================================\n');
	
	// Basic latency analysis
	const basicLatency = testResults.find(t => t.testName === 'basic-latency');
	if (basicLatency && basicLatency.avgLatency > 0) {
		console.log('🔵 BASIC API LATENCY:');
		console.log(`   Average Response Time: ${basicLatency.avgLatency.toFixed(2)}ms`);
		console.log(`   Success Rate: ${(basicLatency.successRate * 100).toFixed(1)}%`);
		
		if (basicLatency.avgLatency > 3000) {
			console.log('   ⚠️  High latency detected - investigate network or API issues');
		} else if (basicLatency.avgLatency > 1000) {
			console.log('   ⚠️  Moderate latency - monitor for optimization opportunities');
		} else {
			console.log('   ✅ Good latency performance');
		}
	}
	
	// Prompt complexity analysis
	const complexity = testResults.find(t => t.testName === 'prompt-complexity');
	if (complexity) {
		console.log('\n🔵 PROMPT COMPLEXITY IMPACT:');
		const successfulComplexity = complexity.results.filter(r => r.success);
		
		if (successfulComplexity.length >= 2) {
			const minDuration = Math.min(...successfulComplexity.map(r => r.duration));
			const maxDuration = Math.max(...successfulComplexity.map(r => r.duration));
			const complexityFactor = maxDuration / minDuration;
			
			console.log(`   Fastest: ${minDuration.toFixed(2)}ms`);
			console.log(`   Slowest: ${maxDuration.toFixed(2)}ms`);
			console.log(`   Complexity Factor: ${complexityFactor.toFixed(2)}x`);
			
			if (complexityFactor > 3) {
				console.log('   ⚠️  High complexity impact - consider prompt optimization');
			} else {
				console.log('   ✅ Reasonable complexity scaling');
			}
		}
		
		successfulComplexity.forEach(result => {
			console.log(`     ${result.name}: ${result.duration.toFixed(2)}ms (${result.msPerToken.toFixed(2)}ms/token)`);
		});
	}
	
	// Concurrent request analysis
	const concurrent = testResults.find(t => t.testName === 'concurrent-requests');
	if (concurrent) {
		console.log('\n🔵 CONCURRENT REQUEST EFFICIENCY:');
		console.log(`   Total Time: ${concurrent.totalDuration.toFixed(2)}ms`);
		console.log(`   Avg Request Time: ${concurrent.avgRequestTime.toFixed(2)}ms`);
		console.log(`   Efficiency: ${concurrent.efficiency.toFixed(2)}x`);
		console.log(`   Success Rate: ${(concurrent.successRate * 100).toFixed(1)}%`);
		
		if (concurrent.efficiency < 0.5) {
			console.log('   ⚠️  Poor concurrent efficiency - investigate rate limiting or queue issues');
		} else if (concurrent.efficiency > 0.8) {
			console.log('   ✅ Good concurrent performance');
		}
	}
	
	// Model latency analysis
	const modelLatency = testResults.find(t => t.testName === 'model-latency');
	if (modelLatency) {
		console.log('\n🔵 MODEL LATENCY CHARACTERISTICS:');
		console.log(`   Model: ${modelLatency.model}`);
		console.log(`   Provider: ${modelLatency.provider}`);
		console.log(`   Avg Latency: ${modelLatency.avgLatency.toFixed(2)}ms`);
		console.log(`   Variability: ±${modelLatency.latencyStdDev.toFixed(2)}ms`);
		console.log(`   Success Rate: ${(modelLatency.successRate * 100).toFixed(1)}%`);
		
		const cv = modelLatency.latencyStdDev / modelLatency.avgLatency;
		if (cv > 0.3) {
			console.log('   ⚠️  High latency variability - API may be unstable');
		} else {
			console.log('   ✅ Consistent latency performance');
		}
	}
	
	// Generate recommendations
	const recommendations = generateLatencyRecommendations(testResults);
	
	const reportData = {
		testName: 'API Latency Performance Isolation',
		timestamp: new Date().toISOString(),
		environment: {
			nodeVersion: process.version,
			platform: process.platform,
			aiModel: env.AI_MODEL,
			aiProvider: env.AI_PROVIDER,
		},
		testResults,
		recommendations,
	};
	
	console.log('\n💡 OPTIMIZATION RECOMMENDATIONS:');
	console.log('================================');
	recommendations.forEach((rec, index) => {
		console.log(`${index + 1}. ${rec}`);
	});
	
	return reportData;
}

/**
 * Generate API latency optimization recommendations
 */
function generateLatencyRecommendations(testResults) {
	const recommendations = [];
	
	const basicLatency = testResults.find(t => t.testName === 'basic-latency');
	const complexity = testResults.find(t => t.testName === 'prompt-complexity');
	const concurrent = testResults.find(t => t.testName === 'concurrent-requests');
	const modelLatency = testResults.find(t => t.testName === 'model-latency');
	
	// Basic latency recommendations
	if (basicLatency?.avgLatency > 2000) {
		recommendations.push(`High API latency (${basicLatency.avgLatency.toFixed(0)}ms) - investigate network issues, API region, or provider status`);
	}
	
	// Success rate recommendations
	if (basicLatency?.successRate < 0.9) {
		recommendations.push(`Low API success rate (${(basicLatency.successRate * 100).toFixed(1)}%) - implement retry logic with exponential backoff`);
	}
	
	// Complexity recommendations
	if (complexity?.results) {
		const successful = complexity.results.filter(r => r.success);
		if (successful.length >= 2) {
			const complexityFactor = Math.max(...successful.map(r => r.duration)) / Math.min(...successful.map(r => r.duration));
			if (complexityFactor > 4) {
				recommendations.push(`High prompt complexity impact (${complexityFactor.toFixed(1)}x) - optimize prompts for production workloads`);
			}
		}
	}
	
	// Concurrency recommendations
	if (concurrent?.efficiency < 0.6) {
		recommendations.push(`Poor concurrent efficiency (${concurrent.efficiency.toFixed(2)}x) - reduce parallel requests or implement request queuing`);
	} else if (concurrent?.efficiency > 0.9) {
		recommendations.push(`Excellent concurrent efficiency - consider increasing parallelism for better throughput`);
	}
	
	// Model variability recommendations
	if (modelLatency && modelLatency.avgLatency > 0) {
		const cv = modelLatency.latencyStdDev / modelLatency.avgLatency;
		if (cv > 0.4) {
			recommendations.push(`High latency variability (CV: ${cv.toFixed(2)}) - implement adaptive timeout strategies`);
		}
	}
	
	// Overall performance assessment
	const overallLatency = modelLatency?.avgLatency || basicLatency?.avgLatency || 0;
	if (overallLatency > 5000) {
		recommendations.push(`Overall API performance is slow (${overallLatency.toFixed(0)}ms) - consider model switching or provider alternatives`);
	} else if (overallLatency > 2000) {
		recommendations.push(`Moderate API latency detected - monitor performance trends and implement caching where appropriate`);
	}
	
	if (recommendations.length === 0) {
		recommendations.push('API latency performance within acceptable parameters');
	}
	
	return recommendations;
}

// Run the test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runAPILatencyTest()
		.then(results => {
			console.log('\n✅ API latency performance test completed successfully');
			process.exit(0);
		})
		.catch(error => {
			console.error('\n❌ API latency performance test failed:', error);
			process.exit(1);
		});
}

export { runAPILatencyTest };