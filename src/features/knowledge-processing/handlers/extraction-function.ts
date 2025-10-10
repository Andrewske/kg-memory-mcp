/**
 * Functional extraction handler - Pure function extracted from BatchExtractionJobHandler
 */

import type { ProcessingJob } from '@prisma/client';
import {
	createDetailedDeduplicationBreakdownWithDatabase,
	deduplicateTriples,
} from '~/features/deduplication/deduplicate.js';
import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract.js';
import type { RawExtractionData, StageBreakdown } from '~/shared/types/extraction-metadata.js';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import { batchStoreKnowledge } from '~/shared/database/batch-storage.js';
import { env } from '~/shared/env.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { createContext, log, logDataFlow, logError } from '~/shared/utils/debug-logger.js';
import { generateEmbeddingMap } from '~/shared/utils/embedding-cache.js';
import { chunkText, type TextChunk } from '~/shared/utils/text-chunking.js';
import type { JobMetadata, JobResult } from '../job-types.js';
import { schedulePostProcessingJobs, updateJobProgress } from '../pipeline-coordinator.js';
import { ResourceManager, Semaphore } from '../resource-manager.js';
import type { Triple } from '~/shared/types/core.js';

/**
 * Execute extraction logic - pure function version
 * @param job Processing job with text and metadata
 * @param skipQStashUpdates Skip QStash progress updates for testing
 * @param onProgress Optional progress callback for testing
 * @param updateProgressFn Optional dependency injection for progress updates
 */
export async function executeExtraction(
	job: ProcessingJob,
	skipQStashUpdates: boolean = false,
	onProgress?: (progress: number) => void,
	updateProgressFn = updateJobProgress
): Promise<JobResult> {
	const updateProgress = async (progress: number) => {
		onProgress?.(progress);
		if (!skipQStashUpdates) {
			await updateProgressFn(job.id, progress);
		}
	};

	const metadata = job.metadata as unknown as JobMetadata;
	const resourceLimits = metadata.resourceLimits || {
		maxConnections: 2,
		maxAICalls: 4,
		maxMemoryMB: 2048,
	};

	const context = createContext('BATCH_EXTRACTION', 'execute_extraction', {
		jobId: job.id,
		textLength: job.text.length,
	});

	try {
		log('DEBUG', context, 'Starting coordinated extraction', {
			jobId: job.id,
			textLength: job.text.length,
			resourceLimits,
		});

		// Initialize resource manager
		const resourceManager = new ResourceManager(resourceLimits);

		// Check if text needs chunking (>3000 tokens)
		const estimatedTokens = Math.ceil(job.text.length / 4);
		const chunks =
			estimatedTokens > 3000
				? chunkText(job.text, {
						maxTokens: 3000,
						overlapTokens: 200,
						preserveParagraphs: true,
					})
				: [{ text: job.text, estimatedTokens, start: 0, end: job.text.length }];

		log('DEBUG', context, 'Text chunking completed', {
			chunkCount: chunks.length,
			estimatedTokens,
		});
		await updateProgress(10);

		// Process chunks with controlled parallelization
		const chunkResults = await processChunksWithResourceLimits(
			chunks,
			metadata,
			resourceManager,
			job.id,
			updateProgress
		);

		await updateProgress(80);

		// Merge chunk results while preserving stage information
		const allTriples: any[] = [];
		const allConcepts: any[] = [];
		const stageResultsMap: Record<string, Triple[]> = {};

		for (const result of chunkResults) {
			if (result.data?.triples) allTriples.push(...result.data.triples);
			if (result.data?.concepts) allConcepts.push(...result.data.concepts);

			// Merge stage results from each chunk
			if (result.data?.stageResults) {
				for (const [stage, stageTriples] of Object.entries(result.data.stageResults)) {
					if (!stageResultsMap[stage]) {
						stageResultsMap[stage] = [];
					}
					stageResultsMap[stage].push(...(stageTriples as Triple[]));
				}
			}
		}
		logDataFlow(
			context,
			{
				input: chunkResults,
				output: { allTriples, allConcepts, stageResultsMap },
				counts: {
					inputCount: chunkResults.length,
					outputCount: allTriples.length + allConcepts.length,
				},
			},
			'Chunk results merged with stage tracking'
		);

		// Generate comprehensive embedding map ONCE for all operations
		const embeddingService = createEmbeddingService({
			model: env.EMBEDDING_MODEL,
			dimensions: env.EMBEDDING_DIMENSIONS,
			batchSize: env.BATCH_SIZE,
		});

		log('DEBUG', context, 'Generating comprehensive embedding map', {
			tripleCount: allTriples.length,
			conceptCount: allConcepts.length,
		});
		const embeddingMapResult = await generateEmbeddingMap(
			allTriples,
			allConcepts,
			embeddingService,
			env.ENABLE_SEMANTIC_DEDUP
		);

		if (!embeddingMapResult.success) {
			return {
				success: false,
				error: {
					message: `Embedding generation failed: ${embeddingMapResult.error?.message}`,
					operation: 'embedding_generation',
				},
			};
		}

		const embeddingStats = embeddingMapResult.data.stats;
		log('DEBUG', context, 'Embedding generation completed', {
			uniqueEmbeddings: embeddingStats.uniqueTexts,
			duplicatesAverted: embeddingStats.duplicatesAverted,
			batchCalls: embeddingStats.batchCalls,
		});

		// Deduplicate triples using embedding map (extraction-stage deduplication)
		let dedupTriples = allTriples;
		let dedupMetadata: any;

		if (allTriples.length > 0) {
			log('DEBUG', context, 'Starting triple deduplication', { tripleCount: allTriples.length });
			const deduplicationResult = await deduplicateTriples(
				allTriples,
				embeddingMapResult.data.embeddings
			);
			if (deduplicationResult.success && deduplicationResult.data) {
				dedupTriples = deduplicationResult.data.uniqueTriples;
				dedupMetadata = deduplicationResult.data.mergedMetadata;

				logDataFlow(
					context,
					{
						input: allTriples,
						output: dedupTriples,
						counts: { inputCount: allTriples.length, outputCount: dedupTriples.length },
						transformations: ['deduplication'],
					},
					'Triple deduplication completed'
				);
			}
		}

		// Batch store all knowledge data in atomic transaction
		log('DEBUG', context, 'Starting atomic storage', {
			tripleCount: dedupTriples.length,
			conceptCount: allConcepts.length,
			embeddingCount: Object.keys(embeddingMapResult.data.embeddings).length,
		});
		const storageResult = await batchStoreKnowledge({
			triples: dedupTriples,
			concepts: allConcepts,
			conceptualizations: [], // Generated in concept job
			embeddingMap: embeddingMapResult.data.embeddings,
		});

		await updateProgress(95);

		if (!storageResult.success) {
			return {
				success: false,
				error: {
					message: `Storage failed: ${storageResult.error?.message}`,
					operation: 'batch_storage',
				},
			};
		}

		log('INFO', context, 'Storage completed successfully', {
			triplesStored: storageResult.data.triplesStored,
			conceptsStored: storageResult.data.conceptsStored,
			vectorsGenerated: storageResult.data.vectorsGenerated,
			duplicatesSkipped: storageResult.data.duplicatesSkipped,
		});

		// Create detailed breakdown AFTER storage to capture database and cross-stage duplicates
		let rawExtractionData: RawExtractionData | undefined = undefined;
		if (allTriples.length > 0 && dedupMetadata) {
			// Create detailed breakdown with status markers for benchmarking (includes database and cross-stage duplicates)
			const triplesWithStatus = createDetailedDeduplicationBreakdownWithDatabase(
				allTriples,
				dedupMetadata,
				storageResult.data.duplicateAnalysis?.database_duplicate_details,
				storageResult.data.duplicateAnalysis?.cross_stage_duplicate_details
			);

			// Group by extraction stage
			const stageBreakdowns: StageBreakdown[] = [];
			for (const [stageName, stageTriples] of Object.entries(stageResultsMap)) {
				const stageTripleIds = new Set(
					stageTriples.map(t => `${t.subject}|${t.predicate}|${t.object}|${t.type}`)
				);
				const stageTripleStatuses = triplesWithStatus.filter(t => {
					const id = `${t.subject}|${t.predicate}|${t.object}|${t.type}`;
					return stageTripleIds.has(id);
				});

				const kept = stageTripleStatuses.filter(t => t.status === 'KEPT').length;
				const exactDups = stageTripleStatuses.filter(t => t.status === 'EXACT_DUPLICATE').length;
				const semanticDups = stageTripleStatuses.filter(
					t => t.status === 'SEMANTIC_DUPLICATE'
				).length;

				stageBreakdowns.push({
					stage_name: stageName,
					total_extracted: stageTripleStatuses.length,
					kept,
					exact_duplicates: exactDups,
					semantic_duplicates: semanticDups,
					triples: stageTripleStatuses,
				});
			}

			rawExtractionData = {
				stages: stageBreakdowns,
				summary: {
					total_extracted: allTriples.length,
					total_kept: storageResult.data.triplesStored, // Use actual stored count from database
					total_exact_duplicates: triplesWithStatus.filter(t => t.status === 'EXACT_DUPLICATE')
						.length,
					total_semantic_duplicates: triplesWithStatus.filter(
						t => t.status === 'SEMANTIC_DUPLICATE'
					).length,
					total_database_duplicates: triplesWithStatus.filter(
						t => t.status === 'DATABASE_DUPLICATE'
					).length,
					total_cross_stage_duplicates: triplesWithStatus.filter(
						t => t.status === 'CROSS_STAGE_DUPLICATE'
					).length,
				},
			};
		}

		// Schedule post-processing jobs (concepts and deduplication) - only if not skipping QStash
		if (job.parent_job_id && !skipQStashUpdates) {
			await schedulePostProcessingJobs(job.parent_job_id, {
				triplesExtracted: dedupTriples.length,
				conceptsFound: allConcepts.length,
				processingTime: Date.now() - job.createdAt.getTime(),
				chunksProcessed: chunks.length,
			});
		}

		await updateProgress(100);

		return {
			success: true,
			data: {
				triplesStored: storageResult.data.triplesStored,
				conceptsStored: storageResult.data.conceptsStored,
				vectorsGenerated: embeddingStats.uniqueTexts,
				chunksProcessed: chunks.length,
				duplicateAnalysis: storageResult.data.duplicateAnalysis, // NEW: Pass through duplicate analysis
				rawExtractionData, // NEW: Full stage-by-stage breakdown with database-aware duplicates
				metrics: {
					embeddingEfficiency: embeddingStats.duplicatesAverted,
					processingTime: Date.now() - job.createdAt.getTime(),
					batchCalls: embeddingStats.batchCalls,
				},
			},
		};
	} catch (error) {
		logError(context, error instanceof Error ? error : new Error(String(error)), {
			operation: 'batch_extraction',
		});
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Batch extraction failed',
				operation: 'batch_extraction',
				cause: error,
			},
		};
	}
}

async function processChunksWithResourceLimits(
	chunks: TextChunk[],
	metadata: JobMetadata,
	resourceManager: ResourceManager,
	_jobId: string,
	updateProgress: (progress: number) => Promise<void>
): Promise<any[]> {
	// Use semaphore for controlled concurrency
	const semaphore = new Semaphore(metadata.resourceLimits?.maxAICalls || 4);

	const chunkPromises = chunks.map(async (chunk, index) => {
		return await semaphore.acquire(async () => {
			// Update progress for this chunk
			const progress = 10 + (index / chunks.length) * 70; // 10-80% range
			await updateProgress(Math.round(progress));

			log(
				'DEBUG',
				createContext('BATCH_EXTRACTION', 'process_chunk', {
					chunkIndex: index + 1,
					totalChunks: chunks.length,
				}),
				'Processing chunk',
				{ chunkIndex: index + 1, totalChunks: chunks.length }
			);

			// Use resource manager for AI calls
			return await resourceManager.withAI(async () => {
				const extractionArgs: ProcessKnowledgeArgs = {
					text: chunk.text,
					source: `${metadata.source}_chunk_${index}`,
					source_type: metadata.source_type,
					source_date: metadata.source_date,
				};

				return await extractKnowledgeTriples(extractionArgs);
			});
		});
	});

	// Process all chunks and handle partial failures
	const results = await Promise.allSettled(chunkPromises);

	const successfulResults = results
		.filter(
			(result): result is PromiseFulfilledResult<any> =>
				result.status === 'fulfilled' && result.value.success
		)
		.map(result => result.value);

	// Log any failures but continue with successful results
	const failedCount = results.length - successfulResults.length;
	if (failedCount > 0) {
		log(
			'WARN',
			createContext('BATCH_EXTRACTION', 'process_chunks', { totalChunks: chunks.length }),
			'Some chunks failed, continuing with partial results',
			{
				failedCount,
				totalChunks: chunks.length,
				successfulCount: successfulResults.length,
			}
		);
	}

	return successfulResults;
}
