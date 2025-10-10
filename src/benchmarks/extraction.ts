/**
 * Extraction Benchmark
 * Tests only the knowledge extraction stage
 */

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { JobStatus, JobType, type ProcessingJob } from '@prisma/client';
import { z } from 'zod';
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

const ExtractionConfigSchema = z.object({
	testText: z.string().min(1),
	source: z.string(),
	model: z.string().optional(),
	provider: z.enum(['openai', 'anthropic']).optional(),
	promptVersion: z.string().optional(),
	notes: z.string().optional(),
});

type ExtractionConfig = z.infer<typeof ExtractionConfigSchema>;

/**
 * Run extraction benchmark
 */
async function runExtractionBenchmark(config: ExtractionConfig): Promise<BenchmarkMetrics> {
	const tracker = createCleanupTracker();
	const startTime = Date.now();
	const startMemory = getMemoryUsageMb();

	const context = createContext('EXTRACTION_BENCHMARK', 'extraction', {
		source: config.source,
		model: config.model || env.AI_MODEL,
	});

	try {
		log('INFO', context, 'Starting extraction benchmark', { config });

		// Clean up any leftover benchmark data from previous runs
		log('INFO', context, 'Cleaning up old benchmark data');
		await cleanupBySourcePrefix(db, 'benchmark');
		log('INFO', context, 'Cleanup complete - starting fresh');

		// Create mock job
		const mockJob = await db.processingJob.create({
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
		tracker.processingJobIds.add(mockJob.id);

		// Execute extraction
		const result = await executeExtraction(mockJob, true);

		if (!result.success) {
			throw new Error(`Extraction failed: ${result.error?.message}`);
		}

		// Wait for post-transaction vector generation
		await new Promise(resolve => setTimeout(resolve, 2000));

		// Query created triples
		const triples = await db.knowledgeTriple.findMany({
			where: { source: { startsWith: config.source } },
		});
		triples.forEach(t => tracker.tripleIds.add(t.id));

		// Query token usage
		const tokenUsage = await db.tokenUsage.findMany({
			where: {
				source: { startsWith: config.source },
				timestamp: { gte: new Date(startTime) },
			},
		});
		tokenUsage.forEach(t => tracker.tokenUsageIds.add(t.id));

		// Query vectors
		const vectors = await db.vectorEmbedding.findMany({
			where: { knowledge_triple_id: { in: triples.map(t => t.id) } },
		});
		vectors.forEach(v => tracker.vectorIds.add(v.id));

		// Calculate metrics
		const totalDuration = Date.now() - startTime;
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
			triples.map(t => ({ confidence: t.confidence ? Number(t.confidence) : 0 }))
		);

		// Group triples by type
		const tripleTypes = triples.reduce(
			(acc, t) => {
				const type = t.type || 'unknown';
				acc[type] = (acc[type] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>
		);

		const metrics: BenchmarkMetrics = {
			id: randomUUID(),
			timestamp: getPstTimestamp(),
			benchmark_type: 'extraction',
			config: {
				model: config.model || env.AI_MODEL,
				provider: (config.provider || 'openai') as 'openai' | 'anthropic',
				extraction_method: 'four-stage' as const,
				prompt_version: config.promptVersion,
			},
			performance,
			quality: {
				triples_extracted: triples.length,
				avg_confidence: avgConfidence,
			},
			cost,
			output_analysis: {
				triple_types: tripleTypes,
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

	const config = ExtractionConfigSchema.parse({
		testText,
		source: `extraction-benchmark-${Date.now()}`,
		model: values.model,
		provider: values.provider as 'openai' | 'anthropic' | undefined,
		promptVersion: values['prompt-version'],
		notes: values.notes,
	});

	console.log('🔍 Starting Extraction Benchmark');
	console.log(`📄 Test text: ${testText.length} characters`);
	console.log(`🤖 Model: ${config.model || env.AI_MODEL}`);
	console.log(`⚙️  Method: four-stage (parallel)`);
	if (config.promptVersion) {
		console.log(`📝 Prompt version: ${config.promptVersion}`);
	}
	console.log('');

	const metrics = await runExtractionBenchmark(config);

	console.log('');
	console.log('✅ Benchmark Complete!');
	console.log('');
	console.log('📊 Results:');
	console.log(`   Duration: ${metrics.performance.total_duration_ms}ms`);
	console.log(`   Triples: ${metrics.quality.triples_extracted}`);
	console.log(`   Tokens: ${metrics.cost.total_tokens.toLocaleString()}`);
	console.log(`   Cost: $${metrics.cost.estimated_cost_usd.toFixed(4)}`);
	console.log(`   Avg Confidence: ${((metrics.quality.avg_confidence || 0) * 100).toFixed(1)}%`);
	console.log('');
	console.log('📈 View results: benchmarks/results/extraction/');
	console.log('📊 Compare: pnpm benchmark:compare --type extraction --last 5');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(error => {
		console.error('❌ Benchmark failed:', error.message);
		process.exit(1);
	});
}

export { runExtractionBenchmark, type ExtractionConfig };
