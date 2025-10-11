/**
 * Full Pipeline Benchmark
 * Tests complete extraction → concepts → (optional) deduplication pipeline
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { JobStatus, JobType, type ProcessingJob, VectorType } from '@prisma/client';
import { z } from 'zod';
import { executeConcepts } from '~/features/knowledge-processing/handlers/concept-function.js';
import { executeDeduplication } from '~/features/knowledge-processing/handlers/deduplication-function.js';
import { executeExtraction } from '~/features/knowledge-processing/handlers/extraction-function.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import type { TokenUsage } from '~/shared/types/core.js';
import { redirectConsoleToFiles } from '~/shared/utils/console-redirect.js';
import {
	createContext,
	log,
	logError,
	logQueryResult,
	withTiming,
} from '~/shared/utils/debug-logger.js';
import { getPstTimestamp } from '~/shared/utils/pst-time.js';
import { benchmarkConfig } from './benchmark.config.js';
import {
	type CleanupTracker,
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
import {
	analyzeNovelty,
	extractTerms,
	getTopFrequent,
	getTotalVocabularySize,
	loadVocabulary,
	saveVocabulary,
	updateVocabulary,
} from './shared/vocabulary-tracker.js';

// Configuration schema
const PipelineConfigSchema = z.object({
	testText: z.string().min(1),
	source: z.string().optional(),
	sourceType: z.string().optional(),
	model: z.string().optional(),
	provider: z.enum(['openai', 'anthropic']).optional(),
	enableDedup: z.boolean().optional(),
	promptVersion: z.string().optional(),
	notes: z.string().optional(),
	fixtureFilename: z.string().optional(),
});

type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

/**
 * Main pipeline benchmark execution
 */
async function runPipelineBenchmark(config: PipelineConfig): Promise<BenchmarkMetrics> {
	const tracker = createCleanupTracker();
	const startTime = Date.now();
	const startMemory = getMemoryUsageMb();
	const logDir = path.join(process.cwd(), 'logs', 'pipeline-reports');
	await fs.mkdir(logDir, { recursive: true });

	// Setup log capture
	await fs.mkdir(path.join(logDir, 'logs'), { recursive: true });
	await fs.mkdir(path.join(logDir, 'errors'), { recursive: true });
	const restoreConsole = redirectConsoleToFiles(logDir);

	const pipelineContext = createContext('PIPELINE_BENCHMARK', 'full_pipeline', {
		source: config.source,
		model: config.model || env.AI_MODEL,
	});

	try {
		log('INFO', pipelineContext, 'Starting pipeline benchmark', { config });

		// Clean up any leftover benchmark data from previous runs
		log('INFO', pipelineContext, 'Cleaning up old benchmark data');
		await cleanupBySourcePrefix(db, 'benchmark');
		log('INFO', pipelineContext, 'Cleanup complete - starting fresh');

		const stageDurations: Record<string, number> = {};

		// Load vocabulary for tracking if enabled
		let vocabulary = null;
		let oldVocabSize = 0;
		if (benchmarkConfig.vocabulary.enabled) {
			vocabulary = await loadVocabulary(
				benchmarkConfig.vocabulary.path,
				config.model || env.AI_MODEL,
				config.provider || 'openai'
			);
			oldVocabSize = getTotalVocabularySize(vocabulary);
			log('INFO', pipelineContext, 'Loaded vocabulary', {
				size: oldVocabSize,
				runs: vocabulary.metadata.total_runs,
			});
		}

		// Stage 1: Extraction
		log('INFO', pipelineContext, 'Stage 1: Extraction');
		const mockExtractionJob = await createMockJob(
			JobType.EXTRACT_KNOWLEDGE_BATCH,
			config.testText,
			config
		);
		tracker.processingJobIds.add(mockExtractionJob.id);

		const extractionTiming = await withTiming(
			pipelineContext,
			async () => await executeExtraction(mockExtractionJob, true),
			'Extraction'
		);
		stageDurations.extraction = extractionTiming.duration;

		if (!extractionTiming.result.success) {
			throw new Error(`Extraction failed: ${extractionTiming.result.error?.message}`);
		}

		// Wait for post-transaction vector generation
		await new Promise(resolve => setTimeout(resolve, 2000));

		// DIAGNOSTIC LOGGING: Log query parameters before execution
		log('DEBUG', pipelineContext, 'Preparing to query triples', {
			configSource: config.source,
			expectedSourcePrefix: config.source || 'undefined',
			triplesReportedByExtraction: extractionTiming.result.data?.triplesStored,
			extractionSuccess: extractionTiming.result.success,
		});

		// Query created triples with robust pattern matching
		// Use multiple fallback strategies to handle edge cases
		let createdTriples = await db.knowledgeTriple.findMany({
			where: {
				OR: [
					// Primary: Match by source prefix (handles _chunk_N suffix)
					{ source: { startsWith: config.source || '' } },
					// Fallback 1: Match by source pattern (in case startsWith fails)
					{ source: { contains: config.source || '' } },
					// Fallback 2: Match by source_type and recent timestamp
					{
						source_type: config.sourceType || 'benchmark',
						created_at: { gte: new Date(startTime) },
					},
				],
			},
		});

		// DIAGNOSTIC: If 0 found, try querying ALL recent benchmark triples for debugging
		if (createdTriples.length === 0) {
			log('WARN', pipelineContext, 'Initial query returned 0 triples, checking database state', {
				configSource: config.source,
			});

			const allRecentBenchmarkTriples = await db.knowledgeTriple.findMany({
				where: {
					source_type: 'benchmark',
					created_at: { gte: new Date(startTime) },
				},
				select: { id: true, source: true, created_at: true },
				take: 10,
			});

			log('DEBUG', pipelineContext, 'All recent benchmark triples in database', {
				count: allRecentBenchmarkTriples.length,
				sources: allRecentBenchmarkTriples.map(t => t.source),
				timestamps: allRecentBenchmarkTriples.map(t => t.created_at.toISOString()),
			});

			// Retry with exponential backoff (in case of timing issues)
			for (let attempt = 1; attempt <= 3; attempt++) {
				const backoffMs = attempt * 1000; // 1s, 2s, 3s
				log('INFO', pipelineContext, `Retry attempt ${attempt}/3 after ${backoffMs}ms`, {
					reason: 'Zero triples found',
				});

				await new Promise(resolve => setTimeout(resolve, backoffMs));

				createdTriples = await db.knowledgeTriple.findMany({
					where: {
						OR: [
							{ source: { startsWith: config.source || '' } },
							{ source: { contains: config.source || '' } },
							{
								source_type: config.sourceType || 'benchmark',
								created_at: { gte: new Date(startTime) },
							},
						],
					},
				});

				log('DEBUG', pipelineContext, `Retry ${attempt} result`, {
					foundTriples: createdTriples.length,
				});

				if (createdTriples.length > 0) {
					log('INFO', pipelineContext, 'Triples found after retry', {
						attempt,
						tripleCount: createdTriples.length,
					});
					break;
				}
			}
		}

		createdTriples.forEach(t => tracker.tripleIds.add(t.id));

		logQueryResult(
			pipelineContext,
			{ operation: 'findMany_triples' },
			createdTriples,
			'Triples queried'
		);

		// FAIL-FAST: Detect critical extraction failure (0 triples from substantial input)
		// This prevents subtle regressions from going unnoticed in benchmarks
		const MIN_TEXT_LENGTH_FOR_VALIDATION = 500; // ~125 tokens
		if (createdTriples.length === 0 && config.testText.length > MIN_TEXT_LENGTH_FOR_VALIDATION) {
			// Enhanced diagnostics for debugging
			const allBenchmarkTriplesCount = await db.knowledgeTriple.count({
				where: { source_type: 'benchmark' },
			});

			const recentBenchmarkTriples = await db.knowledgeTriple.findMany({
				where: {
					source_type: 'benchmark',
					created_at: { gte: new Date(startTime - 60000) }, // Last minute
				},
				select: { id: true, source: true, created_at: true },
				take: 20,
			});

			const errorMessage = [
				'🔴 CRITICAL REGRESSION DETECTED: Zero triples extracted from substantial input',
				'',
				`Input length: ${config.testText.length} characters (~${Math.ceil(config.testText.length / 4)} tokens)`,
				`Expected: At least a few triples from this input`,
				`Got: 0 triples`,
				'',
				`Extraction reported: ${extractionTiming.result.data?.triplesStored || 0} triples stored`,
				`Query source pattern: "${config.source || 'undefined'}"`,
				`Total benchmark triples in database: ${allBenchmarkTriplesCount}`,
				`Recent benchmark triples (last minute): ${recentBenchmarkTriples.length}`,
				recentBenchmarkTriples.length > 0
					? `Sample sources: ${recentBenchmarkTriples
							.slice(0, 3)
							.map(t => `"${t.source}"`)
							.join(', ')}`
					: 'No recent benchmark triples found',
				'',
				'This indicates a complete extraction failure OR a source tracking mismatch.',
				'Possible causes:',
				'  1. Source mismatch: Stored source does not match query pattern',
				'  2. Transaction isolation: Query cannot see committed data',
				'  3. Extraction prompts returning incompatible schema (wrong field names)',
				'  4. Schema validation failures (AI not following expected JSON format)',
				'  5. Prompt version mismatch or corrupted prompt files',
				'  6. Database connection or schema issues',
				'',
				'Action required:',
				'  1. Check full log file for source field values and query results',
				'  2. Verify extraction handler is using correct source field',
				'  3. Check extraction logs for schema validation errors',
				'  4. Verify prompt files contain explicit JSON schema specifications',
				'  5. Run prompt validation: pnpm test src/__tests__/unit/prompt-validator.test.ts',
				'  6. Enable AI integration tests: ENABLE_AI_INTEGRATION_TESTS=true pnpm test:integration',
			].join('\n');

			logError(pipelineContext, new Error(errorMessage));
			throw new Error(errorMessage);
		}

		// Capture sample triples (top 20) for report
		const sampleTriples = createdTriples.slice(0, 20).map(t => ({
			subject: t.subject,
			predicate: t.predicate,
			object: t.object,
			type: t.type,
			confidence: Number(t.confidence || 0),
			extraction_stage: (t as any).extraction_stage || 'unknown',
		}));

		// Stage 2: Concepts
		log('INFO', pipelineContext, 'Stage 2: Conceptualization');
		const mockConceptJob = await createMockJob(JobType.GENERATE_CONCEPTS, config.testText, config);
		tracker.processingJobIds.add(mockConceptJob.id);

		const conceptTiming = await withTiming(
			pipelineContext,
			async () => await executeConcepts(mockConceptJob, true),
			'Conceptualization'
		);
		stageDurations.conceptualization = conceptTiming.duration;

		// Query created concepts
		const createdConcepts = await db.conceptNode.findMany({
			where: { source: { startsWith: config.source || '' } },
		});
		createdConcepts.forEach(c => tracker.conceptIds.add(c.id));

		logQueryResult(
			pipelineContext,
			{ operation: 'findMany_concepts' },
			createdConcepts,
			'Concepts queried'
		);

		// Stage 3: Optional deduplication (database-level, usually 0 in benchmarks)
		// Initialize with duplicates found during extraction (internal + database duplicates)
		const duplicateAnalysis = extractionTiming.result.data?.duplicateAnalysis;
		let duplicatesRemoved = 0;
		if (duplicateAnalysis) {
			duplicatesRemoved =
				(duplicateAnalysis.internal_duplicates || 0) + (duplicateAnalysis.database_duplicates || 0);
		}

		const triplesBeforeDedup = createdTriples.length;
		let triplesAfterDedup = createdTriples;

		if (config.enableDedup) {
			log('INFO', pipelineContext, 'Stage 3: Database Deduplication');
			const mockDedupJob = await createMockJob(
				JobType.DEDUPLICATE_KNOWLEDGE,
				config.testText,
				config
			);
			tracker.processingJobIds.add(mockDedupJob.id);

			const dedupTiming = await withTiming(
				pipelineContext,
				async () => await executeDeduplication(mockDedupJob, true),
				'Deduplication'
			);
			stageDurations.deduplication = dedupTiming.duration;

			if (dedupTiming.result.success && dedupTiming.result.data?.duplicatesRemoved) {
				duplicatesRemoved += dedupTiming.result.data.duplicatesRemoved as number;

				// Re-query triples to get the actual stored count after deduplication
				if (duplicatesRemoved > 0) {
					triplesAfterDedup = await db.knowledgeTriple.findMany({
						where: { source: { startsWith: config.source || '' } },
					});

					log('INFO', pipelineContext, 'Database deduplication completed', {
						triplesBeforeDedup,
						triplesAfterDedup: triplesAfterDedup.length,
						duplicatesRemoved,
					});
				}
			}
		}

		// Vocabulary Analysis (if enabled)
		let vocabularyAnalysis = null;
		if (vocabulary && benchmarkConfig.vocabulary.enabled) {
			log('INFO', pipelineContext, 'Analyzing vocabulary');

			// Store old counts before updating
			const oldEntityCount = Object.keys(vocabulary.entities).length;
			const oldRelationshipCount = Object.keys(vocabulary.relationships).length;
			const oldConceptCount = Object.keys(vocabulary.concepts).length;

			// Extract terms from this run (use post-dedup triples for accurate vocabulary)
			const extractedTerms = extractTerms(triplesAfterDedup, createdConcepts);

			// Analyze novelty against existing vocabulary
			const novelty = analyzeNovelty(vocabulary, extractedTerms);

			// Update vocabulary with new terms
			vocabulary = updateVocabulary(vocabulary, extractedTerms);
			const newVocabSize = getTotalVocabularySize(vocabulary);

			vocabularyAnalysis = {
				novelty_rate: novelty.novelty_rate,
				recognition_rate: novelty.recognition_rate,
				new_terms_count: novelty.new_terms,
				known_terms_count: novelty.known_terms,
				total_terms: novelty.total_terms,
				new_term_list: novelty.new_term_list,
				vocabulary_size: {
					entities: Object.keys(vocabulary.entities).length,
					relationships: Object.keys(vocabulary.relationships).length,
					concepts: Object.keys(vocabulary.concepts).length,
					total: newVocabSize,
				},
				vocabulary_growth: {
					entities: Object.keys(vocabulary.entities).length - oldEntityCount,
					relationships: Object.keys(vocabulary.relationships).length - oldRelationshipCount,
					concepts: Object.keys(vocabulary.concepts).length - oldConceptCount,
					total: newVocabSize - oldVocabSize,
				},
				top_frequent: {
					entities: getTopFrequent(vocabulary.entities, 10),
					relationships: getTopFrequent(vocabulary.relationships, 10),
					concepts: getTopFrequent(vocabulary.concepts, 10),
				},
				total_runs: vocabulary.metadata.total_runs,
			};

			log('INFO', pipelineContext, 'Vocabulary analysis complete', {
				noveltyRate: `${(novelty.novelty_rate * 100).toFixed(1)}%`,
				newTerms: novelty.new_terms,
				vocabularyGrowth: newVocabSize - oldVocabSize,
			});
		}

		// Query token usage
		const tokenUsage = await db.tokenUsage.findMany({
			where: {
				source: { startsWith: config.source || '' },
				timestamp: { gte: new Date(startTime) },
			},
			orderBy: { timestamp: 'asc' },
		});
		tokenUsage.forEach(t => tracker.tokenUsageIds.add(t.id));

		// Query vectors (use post-dedup triples)
		const vectors = await db.vectorEmbedding.findMany({
			where: {
				OR: [
					{ knowledge_triple_id: { in: triplesAfterDedup.map(t => t.id) } },
					{ concept_node_id: { in: createdConcepts.map(c => c.id) } },
				],
			},
		});
		vectors.forEach(v => tracker.vectorIds.add(v.id));

		// Calculate metrics
		const totalDuration = Date.now() - startTime;
		const endMemory = getMemoryUsageMb();

		const totalTokens = tokenUsage.reduce((sum, u) => sum + u.total_tokens, 0);
		const inputTokens = tokenUsage.reduce((sum, u) => sum + u.input_tokens, 0);
		const outputTokens = tokenUsage.reduce((sum, u) => sum + u.output_tokens, 0);

		// Ensure memory usage is non-negative (can decrease if GC runs)
		const memoryUsed = Math.max(0, endMemory - startMemory);

		const performance = calculatePerformanceMetrics(
			totalDuration,
			totalTokens,
			memoryUsed,
			stageDurations
		);

		const cost = calculateCostMetrics(
			inputTokens,
			outputTokens,
			tokenUsage.length,
			config.model || env.AI_MODEL
		);

		const avgConfidence = calculateAverageConfidence(
			triplesAfterDedup.map(t => ({ confidence: Number(t.confidence) }))
		);

		// Group triples by type for output analysis (use post-dedup triples)
		const tripleTypes = triplesAfterDedup.reduce(
			(acc, t) => {
				const type = t.type || 'unknown';
				acc[type] = (acc[type] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>
		);

		// Group concepts by abstraction level
		const abstractionLevels = createdConcepts.reduce(
			(acc, c) => {
				const level = c.abstraction_level || 'unknown';
				acc[level] = (acc[level] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>
		);

		// Calculate duplicate rate (against total generated by AI, not stored count)
		const duplicateRate =
			duplicateAnalysis && duplicateAnalysis.total_generated > 0
				? duplicatesRemoved / duplicateAnalysis.total_generated
				: 0;

		// Note: Database deduplication stage is not included in rawExtractionData
		// because it only removes duplicates from the database (which are rare in benchmarks)
		// The REAL deduplication happens inside extraction and is already tracked in rawExtractionData

		const metrics: BenchmarkMetrics = {
			id: randomUUID(),
			timestamp: getPstTimestamp(),
			benchmark_type: 'pipeline',
			config: {
				model: config.model || env.AI_MODEL,
				provider: (config.provider || 'openai') as 'openai' | 'anthropic',
				extraction_method: 'four-stage' as const,
				prompt_version: config.promptVersion,
			},
			performance,
			quality: {
				triples_generated: extractionTiming.result.data?.duplicateAnalysis?.total_generated, // NEW
				triples_extracted: triplesAfterDedup.length, // RENAMED - now uses post-dedup count
				concepts_generated: conceptTiming.result.data?.conceptsGenerated as number | undefined, // NEW
				concepts_extracted: createdConcepts.length, // NEW
				duplicates_removed: duplicatesRemoved,
				duplicate_rate: duplicateRate,
				avg_confidence: avgConfidence,
			},
			cost,
			output_analysis: {
				triple_types: tripleTypes,
				abstraction_levels: abstractionLevels,
				sample_triples: sampleTriples, // NEW
				duplicate_analysis: extractionTiming.result.data?.duplicateAnalysis, // NEW
				raw_extraction_data: extractionTiming.result.data?.rawExtractionData, // Extraction-stage deduplication only
				concepts_generated: conceptTiming.result.data?.conceptsWithStatus, // NEW: All concepts with status
				vocabulary_analysis: vocabularyAnalysis || undefined,
			},
			fixture_info: config.fixtureFilename
				? {
						filename: config.fixtureFilename,
						char_count: config.testText.length,
						estimated_tokens: Math.ceil(config.testText.length / 4),
					}
				: undefined,
			notes: config.notes,
		};

		// Save benchmark result (JSON + MD + CSV)
		const result = await saveBenchmarkResult(metrics);

		log('INFO', pipelineContext, 'Benchmark completed successfully', {
			jsonPath: result.jsonPath,
			mdPath: result.mdPath,
		});

		// Cleanup test data
		// await cleanupBenchmarkData(db, tracker);
		log('INFO', pipelineContext, 'Cleanup completed');

		// Save updated vocabulary (only after successful benchmark)
		if (vocabulary && benchmarkConfig.vocabulary.enabled) {
			await saveVocabulary(vocabulary, benchmarkConfig.vocabulary.path);
			log('INFO', pipelineContext, 'Vocabulary saved', {
				totalRuns: vocabulary.metadata.total_runs,
				totalTerms: getTotalVocabularySize(vocabulary),
			});
		}

		return metrics;
	} catch (error) {
		logError(pipelineContext, error instanceof Error ? error : new Error(String(error)));

		// Cleanup on failure
		try {
			await cleanupBenchmarkData(db, tracker);
		} catch {
			// Ignore cleanup errors
		}

		throw error;
	} finally {
		restoreConsole();
	}
}

/**
 * Create mock processing job
 */
async function createMockJob(
	jobType: JobType,
	text: string,
	config: PipelineConfig
): Promise<ProcessingJob> {
	return await db.processingJob.create({
		data: {
			job_type: jobType,
			text,
			status: JobStatus.PROCESSING,
			metadata: {
				source: config.source || `pipeline-benchmark-${Date.now()}`,
				source_type: config.sourceType || 'benchmark',
				source_date: new Date().toISOString(),
				model: config.model || env.AI_MODEL,
			},
		},
	});
}

/**
 * Main CLI execution
 */
async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			input: { type: 'string', short: 'i' },
			fixture: { type: 'string', short: 'f' },
		},
		allowPositionals: true,
	});

	// Load test text (use config default if no args provided)
	let testText: string;
	let fixtureFilename: string;
	if (values.input) {
		testText = await loadCustomFixture(values.input);
		fixtureFilename = path.basename(values.input);
	} else if (values.fixture) {
		testText = await loadFixture(values.fixture as FixtureSize);
		fixtureFilename =
			values.fixture === 'default' ? 'default-text.md' : `${values.fixture}-text.txt`;
	} else if (positionals[0]) {
		testText = await loadCustomFixture(positionals[0]);
		fixtureFilename = path.basename(positionals[0]);
	} else {
		testText = await loadFixture(benchmarkConfig.defaultFixture);
		fixtureFilename =
			benchmarkConfig.defaultFixture === 'default'
				? 'default-text.md'
				: `${benchmarkConfig.defaultFixture}-text.txt`;
	}

	// Use benchmarkConfig defaults for all settings
	const config = PipelineConfigSchema.parse({
		testText,
		source: `pipeline-benchmark-${Date.now()}`,
		sourceType: 'benchmark',
		model: benchmarkConfig.model,
		provider: benchmarkConfig.provider,
		enableDedup: benchmarkConfig.enableDeduplication,
		promptVersion: benchmarkConfig.promptVersion,
		notes: benchmarkConfig.notes,
		fixtureFilename,
	});

	console.log('🚀 Starting Full Pipeline Benchmark');
	console.log(
		`📄 Test text: ${testText.length} characters (~${Math.ceil(testText.length / 4)} tokens)`
	);
	console.log(`🤖 Model: ${config.model || env.AI_MODEL}`);
	console.log(`⚙️  Method: four-stage (parallel)`);
	console.log(`🔄 Deduplication: ${config.enableDedup ? 'enabled' : 'disabled'}`);
	console.log(
		`📚 Vocabulary tracking: ${benchmarkConfig.vocabulary.enabled ? 'enabled' : 'disabled'}`
	);
	if (config.promptVersion) {
		console.log(`📝 Prompt version: ${config.promptVersion}`);
	}
	console.log('');

	const metrics = await runPipelineBenchmark(config);

	console.log('');
	console.log('✅ Benchmark Complete!');
	console.log('');
	console.log('📊 Results Summary:');
	console.log(`   Duration: ${metrics.performance.total_duration_ms}ms`);
	console.log(`   Triples: ${metrics.quality.triples_extracted}`);
	console.log(`   Concepts: ${metrics.quality.concepts_generated}`);
	if (metrics.quality.duplicate_rate !== undefined) {
		console.log(
			`   Duplicates: ${metrics.quality.duplicates_removed} (${(metrics.quality.duplicate_rate * 100).toFixed(1)}%)`
		);
	}
	console.log(`   Tokens: ${metrics.cost.total_tokens.toLocaleString()}`);
	console.log(`   Cost: $${metrics.cost.estimated_cost_usd.toFixed(4)}`);

	// Show vocabulary stats if available
	if (metrics.output_analysis?.vocabulary_analysis) {
		const vocab = metrics.output_analysis.vocabulary_analysis;
		console.log('');
		console.log('📚 Vocabulary:');
		console.log(
			`   Novelty: ${(vocab.novelty_rate * 100).toFixed(1)}% (${vocab.new_terms_count} new, ${vocab.known_terms_count} known)`
		);
		console.log(
			`   Total terms: ${vocab.vocabulary_size.total} (+${vocab.vocabulary_growth.total})`
		);
		console.log(`   Total runs: ${vocab.total_runs}`);
	}

	console.log('');
	console.log('📈 View results: benchmarks/results/pipeline/');
	console.log('💡 Edit settings: src/benchmarks/benchmark.config.ts');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(error => {
		console.error('❌ Benchmark failed:', error.message);
		process.exit(1);
	});
}

export { runPipelineBenchmark, type PipelineConfig };
