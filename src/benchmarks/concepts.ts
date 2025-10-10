/**
 * Conceptualization Benchmark
 * Tests only the concept generation stage
 */

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { JobStatus, JobType } from '@prisma/client';
import { z } from 'zod';
import { executeConcepts } from '~/features/knowledge-processing/handlers/concept-function.js';
import { executeExtraction } from '~/features/knowledge-processing/handlers/extraction-function.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { createContext, log, logError } from '~/shared/utils/debug-logger.js';
import { getPstTimestamp } from '~/shared/utils/pst-time.js';
import {
	cleanupBenchmarkData,
	cleanupBySourcePrefix,
	createCleanupTracker,
} from './shared/cleanup.js';
import { type FixtureSize, loadCustomFixture, loadFixture } from './shared/fixtures.js';
import {
	calculateAverageConfidence,
	calculateCostMetrics,
	calculatePerformanceMetrics,
	getMemoryUsageMb,
} from './shared/metrics-calculator.js';
import { saveBenchmarkResult } from './shared/storage.js';
import type { BenchmarkMetrics } from './shared/types.js';

const ConceptsConfigSchema = z.object({
	testText: z.string().min(1),
	source: z.string(),
	model: z.string().optional(),
	provider: z.enum(['openai', 'anthropic']).optional(),
	promptVersion: z.string().optional(),
	notes: z.string().optional(),
});

type ConceptsConfig = z.infer<typeof ConceptsConfigSchema>;

/**
 * Run concepts benchmark
 */
async function runConceptsBenchmark(config: ConceptsConfig): Promise<BenchmarkMetrics> {
	const tracker = createCleanupTracker();
	const startTime = Date.now();
	const startMemory = getMemoryUsageMb();

	const context = createContext('CONCEPTS_BENCHMARK', 'concepts', {
		source: config.source,
		model: config.model || env.AI_MODEL,
	});

	try {
		log('INFO', context, 'Starting concepts benchmark', { config });

		// Clean up any leftover benchmark data from previous runs
		log('INFO', context, 'Cleaning up old benchmark data');
		await cleanupBySourcePrefix(db, 'benchmark');
		log('INFO', context, 'Cleanup complete - starting fresh');

		// First run extraction to get triples (prerequisite for concepts)
		const extractionJob = await db.processingJob.create({
			data: {
				job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
				text: config.testText,
				status: JobStatus.PROCESSING,
				metadata: {
					source: config.source,
					source_type: 'benchmark',
					source_date: new Date().toISOString(),
					model: config.model || env.AI_MODEL,
				},
			},
		});
		tracker.processingJobIds.add(extractionJob.id);

		await executeExtraction(extractionJob, true);
		await new Promise(resolve => setTimeout(resolve, 2000));

		const triples = await db.knowledgeTriple.findMany({
			where: { source: { startsWith: config.source } },
		});
		triples.forEach(t => tracker.tripleIds.add(t.id));

		// Now run concept generation (this is what we're benchmarking)
		const conceptJob = await db.processingJob.create({
			data: {
				job_type: JobType.GENERATE_CONCEPTS,
				text: config.testText,
				status: JobStatus.PROCESSING,
				metadata: {
					source: config.source,
					source_type: 'benchmark',
					source_date: new Date().toISOString(),
					model: config.model || env.AI_MODEL,
				},
			},
		});
		tracker.processingJobIds.add(conceptJob.id);

		const conceptStartTime = Date.now();
		const result = await executeConcepts(conceptJob, true);

		if (!result.success) {
			throw new Error(`Concept generation failed: ${result.error?.message}`);
		}

		// Query created concepts
		const concepts = await db.conceptNode.findMany({
			where: { source: { startsWith: config.source } },
		});
		concepts.forEach(c => tracker.conceptIds.add(c.id));

		// Query token usage (only for concept generation)
		const tokenUsage = await db.tokenUsage.findMany({
			where: {
				source: { startsWith: config.source },
				operation_type: 'conceptualization',
				timestamp: { gte: new Date(conceptStartTime) },
			},
		});
		tokenUsage.forEach(t => tracker.tokenUsageIds.add(t.id));

		// Query vectors
		const vectors = await db.vectorEmbedding.findMany({
			where: { concept_node_id: { in: concepts.map(c => c.id) } },
		});
		vectors.forEach(v => tracker.vectorIds.add(v.id));

		// Calculate metrics (only for concept stage)
		const totalDuration = Date.now() - conceptStartTime;
		const endMemory = getMemoryUsageMb();

		const totalTokens = tokenUsage.reduce((sum, u) => sum + u.total_tokens, 0);
		const inputTokens = tokenUsage.reduce((sum, u) => sum + u.input_tokens, 0);
		const outputTokens = tokenUsage.reduce((sum, u) => sum + u.output_tokens, 0);

		const performance = calculatePerformanceMetrics(
			totalDuration,
			totalTokens,
			endMemory - startMemory
		);

		const cost = calculateCostMetrics(
			inputTokens,
			outputTokens,
			tokenUsage.length,
			config.model || env.AI_MODEL
		);

		const avgConfidence = calculateAverageConfidence(
			concepts.map(c => ({ confidence: Number(c.confidence) }))
		);

		// Group concepts by abstraction level
		const abstractionLevels = concepts.reduce(
			(acc, c) => {
				const level = c.abstraction_level || 'unknown';
				acc[level] = (acc[level] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>
		);

		const metrics: BenchmarkMetrics = {
			id: randomUUID(),
			timestamp: getPstTimestamp(),
			benchmark_type: 'concepts',
			config: {
				model: config.model || env.AI_MODEL,
				provider: (config.provider || 'openai') as 'openai' | 'anthropic',
				prompt_version: config.promptVersion,
			},
			performance,
			quality: {
				concepts_generated: concepts.length,
				avg_confidence: avgConfidence,
			},
			cost,
			output_analysis: {
				abstraction_levels: abstractionLevels,
			},
			notes: config.notes,
		};

		// Save result
		const benchmarkResult = await saveBenchmarkResult(metrics);

		log('INFO', context, 'Benchmark completed', {
			jsonPath: benchmarkResult.jsonPath,
			mdPath: benchmarkResult.mdPath,
		});

		// Cleanup
		await cleanupBenchmarkData(db, tracker);

		return metrics;
	} catch (error) {
		logError(context, error instanceof Error ? error : new Error(String(error)));

		try {
			await cleanupBenchmarkData(db, tracker);
		} catch {
			// Ignore cleanup errors
		}

		throw error;
	}
}

/**
 * Main CLI
 */
async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			input: { type: 'string', short: 'i' },
			fixture: { type: 'string', short: 'f' },
			model: { type: 'string' },
			provider: { type: 'string' },
			'prompt-version': { type: 'string' },
			notes: { type: 'string' },
		},
		allowPositionals: true,
	});

	// Load test text
	let testText: string;
	if (values.input) {
		testText = await loadCustomFixture(values.input);
	} else if (values.fixture) {
		testText = await loadFixture(values.fixture as FixtureSize);
	} else if (positionals[0]) {
		testText = await loadCustomFixture(positionals[0]);
	} else {
		testText = await loadFixture('default');
	}

	const config = ConceptsConfigSchema.parse({
		testText,
		source: `concepts-benchmark-${Date.now()}`,
		model: values.model,
		provider: values.provider as 'openai' | 'anthropic' | undefined,
		promptVersion: values['prompt-version'],
		notes: values.notes,
	});

	console.log('🧠 Starting Conceptualization Benchmark');
	console.log(`📄 Test text: ${testText.length} characters`);
	console.log(`🤖 Model: ${config.model || env.AI_MODEL}`);
	if (config.promptVersion) {
		console.log(`📝 Prompt version: ${config.promptVersion}`);
	}
	console.log('');

	const metrics = await runConceptsBenchmark(config);

	console.log('');
	console.log('✅ Benchmark Complete!');
	console.log('');
	console.log('📊 Results:');
	console.log(`   Duration: ${metrics.performance.total_duration_ms}ms`);
	console.log(`   Concepts: ${metrics.quality.concepts_generated}`);
	console.log(`   Tokens: ${metrics.cost.total_tokens.toLocaleString()}`);
	console.log(`   Cost: $${metrics.cost.estimated_cost_usd.toFixed(4)}`);
	console.log(`   Avg Confidence: ${((metrics.quality.avg_confidence || 0) * 100).toFixed(1)}%`);
	console.log('');
	console.log('📈 View results: benchmarks/results/concepts/');
	console.log('📊 Compare: pnpm benchmark:compare --type concepts --last 5');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(error => {
		console.error('❌ Benchmark failed:', error.message);
		process.exit(1);
	});
}

export { runConceptsBenchmark, type ConceptsConfig };
