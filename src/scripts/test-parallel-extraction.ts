/**
 * Test script to verify parallel AI call execution
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TripleType } from '@prisma/client';
import { extractByType } from '~/features/knowledge-extraction/extract.js';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';

async function main() {
	// Load test text
	const testText = await readFile(
		path.join(process.cwd(), 'src', 'scripts', 'default-text.md'),
		'utf-8'
	);

	const extractionArgs: ProcessKnowledgeArgs = {
		text: testText,
		source: `parallel-test-${Date.now()}`,
		source_type: 'benchmark',
		source_date: new Date().toISOString(),
	};

	const extractionTypes: TripleType[] = [
		'ENTITY_ENTITY',
		'ENTITY_EVENT',
		'EVENT_EVENT',
		'EMOTIONAL_CONTEXT',
	];

	console.log('\n=== Testing Parallel AI Extraction ===');
	console.log(`Text length: ${testText.length} characters`);
	console.log(`Running ${extractionTypes.length} extraction types\n`);

	// Test 1: Sequential execution (baseline)
	console.log('--- Test 1: Sequential Execution (Baseline) ---');
	const sequentialStart = Date.now();
	const sequentialTimings: number[] = [];

	for (const type of extractionTypes) {
		const start = Date.now();
		await extractByType(extractionArgs, type);
		const duration = Date.now() - start;
		sequentialTimings.push(duration);
		console.log(`  ${type}: ${duration}ms`);
	}

	const sequentialTotal = Date.now() - sequentialStart;
	console.log(`  Total: ${sequentialTotal}ms\n`);

	// Test 2: Parallel execution with Promise.allSettled
	console.log('--- Test 2: Parallel Execution (Promise.allSettled) ---');
	const parallelStart = Date.now();

	const extractionPromises = extractionTypes.map(type => extractByType(extractionArgs, type));
	const results = await Promise.allSettled(extractionPromises);

	const parallelTotal = Date.now() - parallelStart;

	results.forEach((result, i) => {
		const status = result.status === 'fulfilled' ? 'SUCCESS' : 'FAILED';
		console.log(`  ${extractionTypes[i]}: ${status}`);
	});
	console.log(`  Total: ${parallelTotal}ms\n`);

	// Analysis
	console.log('=== Analysis ===');
	console.log(`Sequential total: ${sequentialTotal}ms`);
	console.log(`Parallel total: ${parallelTotal}ms`);
	console.log(`Speedup: ${(sequentialTotal / parallelTotal).toFixed(2)}x`);
	console.log(`Expected speedup (if truly parallel): ~4x`);

	const sumOfIndividual = sequentialTimings.reduce((a, b) => a + b, 0);
	console.log(`\nSum of individual sequential calls: ${sumOfIndividual}ms`);
	console.log(`Ratio (parallel/sequential): ${(parallelTotal / sequentialTotal).toFixed(2)}`);

	if (parallelTotal < sequentialTotal * 0.4) {
		console.log('\n✅ SUCCESS: Parallel execution is working! (>60% time reduction)');
	} else if (parallelTotal < sequentialTotal * 0.7) {
		console.log('\n⚠️  PARTIAL: Some parallelization detected, but not optimal');
	} else {
		console.log('\n❌ ISSUE: Parallel execution appears to be running sequentially');
		console.log('   The parallel time should be much less than sequential time if truly parallel.');
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Error:', error);
		process.exit(1);
	});
