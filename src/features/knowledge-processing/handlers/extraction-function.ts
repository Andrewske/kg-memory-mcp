/**
 * Functional extraction handler - Pure function extracted from BatchExtractionJobHandler
 */

import type { ProcessingJob } from '@prisma/client';
import { deduplicateTriples } from '~/features/deduplication/deduplicate.js';
import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract.js';
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

		// Merge chunk results
		const allTriples: any[] = [];
		const allConcepts: any[] = [];
		for (const result of chunkResults) {
			if (result.data?.triples) allTriples.push(...result.data.triples);
			if (result.data?.concepts) allConcepts.push(...result.data.concepts);
		}
		logDataFlow(
			context,
			{
				input: chunkResults,
				output: { allTriples, allConcepts },
				counts: {
					inputCount: chunkResults.length,
					outputCount: allTriples.length + allConcepts.length,
				},
			},
			'Chunk results merged'
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

		// Deduplicate triples using embedding map
		let dedupTriples = allTriples;
		if (allTriples.length > 0) {
			log('DEBUG', context, 'Starting triple deduplication', { tripleCount: allTriples.length });
			const deduplicationResult = await deduplicateTriples(
				allTriples,
				embeddingMapResult.data.embeddings
			);
			if (deduplicationResult.success) {
				dedupTriples = deduplicationResult.data?.uniqueTriples ?? allTriples;
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

		log('INFO', context, 'Storage completed successfully', storageResult.data);

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
