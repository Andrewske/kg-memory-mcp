/**
 * Deduplication Benchmark
 * Tests semantic deduplication effectiveness
 */

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { JobStatus, JobType } from '@prisma/client';
import { z } from 'zod';
import { executeDeduplication } from '~/features/knowledge-processing/handlers/deduplication-function.js';
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
	calculateCostMetrics,
	calculatePerformanceMetrics,
	getMemoryUsageMb,
} from './shared/metrics-calculator.js';
import { saveBenchmarkResult } from './shared/storage.js';
import type { BenchmarkMetrics } from './shared/types.js';

const DedupConfigSchema = z.object({
	testText: z.string().min(1),
	source: z.string(),
	model: z.string().optional(),
	provider: z.enum(['openai', 'anthropic']).optional(),
	promptVersion: z.string().optional(),
	notes: z.string().optional(),
});

type DedupConfig = z.infer<typeof DedupConfigSchema>;

/**
 * Run deduplication benchmark
 */
async function runDedupBenchmark(config: DedupConfig): Promise<BenchmarkMetrics> {
	const tracker = createCleanupTracker();
	const startTime = Date.now();
	const startMemory = getMemoryUsageMb();

	const context = createContext('DEDUP_BENCHMARK', 'deduplication', {
		source: config.source,
	});

	try {
		log('INFO', context, 'Starting deduplication benchmark', { config });

		// Clean up any leftover benchmark data from previous runs
		log('INFO', context, 'Cleaning up old benchmark data');
		await cleanupBySourcePrefix(db, 'benchmark');
		log('INFO', context, 'Cleanup complete - starting fresh');

		// First run extraction to get triples (prerequisite for dedup)
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

		const triplesBeforeDedup = await db.knowledgeTriple.findMany({
			where: { source: { startsWith: config.source } },
		});
		triplesBeforeDedup.forEach(t => tracker.tripleIds.add(t.id));

		// Now run deduplication (this is what we're benchmarking)
		const dedupJob = await db.processingJob.create({
			data: {
				job_type: JobType.DEDUPLICATE_KNOWLEDGE,
				text: config.testText,
				status: JobStatus.PROCESSING,
				metadata: {
					source: config.source,
					source_type: 'benchmark',
					source_date: new Date().toISOString(),
				},
			},
		});
		tracker.processingJobIds.add(dedupJob.id);

		const dedupStartTime = Date.now();
		const result = await executeDeduplication(dedupJob, true);

		if (!result.success) {
			throw new Error(`Deduplication failed: ${result.error?.message}`);
		}

		const triplesAfterDedup = await db.knowledgeTriple.findMany({
			where: { source: { startsWith: config.source } },
		});

		const duplicatesRemoved = triplesBeforeDedup.length - triplesAfterDedup.length;

		// Query token usage (dedup might use tokens for embeddings)
		const tokenUsage = await db.tokenUsage.findMany({
			where: {
				source: { startsWith: config.source },
				timestamp: { gte: new Date(dedupStartTime) },
			},
		});
		tokenUsage.forEach(t => tracker.tokenUsageIds.add(t.id));

		// Calculate metrics
		const totalDuration = Date.now() - dedupStartTime;
		const endMemory = getMemoryUsageMb();

		const totalTokens = tokenUsage.reduce((sum, u) => sum + u.total_tokens, 0);
		const inputTokens = tokenUsage.reduce((sum, u) => sum + u.input_tokens, 0);
		const outputTokens = tokenUsage.reduce((sum, u) => sum + u.output_tokens, 0);

		const performance = calculatePerformanceMetrics(
			totalDuration,
			totalTokens || 1, // Avoid division by zero if no tokens used
			endMemory - startMemory
		);

		const cost = calculateCostMetrics(
			inputTokens,
			outputTokens,
			tokenUsage.length,
			config.model || env.AI_MODEL
		);

		const metrics: BenchmarkMetrics = {
			id: randomUUID(),
			timestamp: getPstTimestamp(),
			benchmark_type: 'dedup',
			config: {
				model: config.model || env.AI_MODEL,
				provider: (config.provider || 'openai') as 'openai' | 'anthropic',
				prompt_version: config.promptVersion,
			},
			performance,
			quality: {
				triples_extracted: triplesBeforeDedup.length,
				duplicates_removed: duplicatesRemoved,
			},
			cost,
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

	const config = DedupConfigSchema.parse({
		testText,
		source: `dedup-benchmark-${Date.now()}`,
		model: values.model,
		provider: values.provider as 'openai' | 'anthropic' | undefined,
		promptVersion: values['prompt-version'],
		notes: values.notes,
	});

	console.log('🔄 Starting Deduplication Benchmark');
	console.log(`📄 Test text: ${testText.length} characters`);
	if (config.promptVersion) {
		console.log(`📝 Prompt version: ${config.promptVersion}`);
	}
	console.log('');

	const metrics = await runDedupBenchmark(config);

	console.log('');
	console.log('✅ Benchmark Complete!');
	console.log('');
	console.log('📊 Results:');
	console.log(`   Duration: ${metrics.performance.total_duration_ms}ms`);
	console.log(`   Triples Before: ${metrics.quality.triples_extracted}`);
	console.log(`   Duplicates Removed: ${metrics.quality.duplicates_removed}`);
	console.log(`   Tokens: ${metrics.cost.total_tokens.toLocaleString()}`);
	console.log(`   Cost: $${metrics.cost.estimated_cost_usd.toFixed(4)}`);
	console.log('');
	console.log('📈 View results: benchmarks/results/deduplication/');
	console.log('📊 Compare: pnpm benchmark:compare --type deduplication --last 5');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(error => {
		console.error('❌ Benchmark failed:', error.message);
		process.exit(1);
	});
}

export { runDedupBenchmark, type DedupConfig };
