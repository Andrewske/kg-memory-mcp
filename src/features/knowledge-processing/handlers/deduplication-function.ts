/**
 * Functional deduplication handler - Pure function extracted from DeduplicationJobHandler
 */

import type { ProcessingJob } from '@prisma/client';
import { deduplicateTriples } from '~/features/deduplication/deduplicate.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import type { JobMetadata, JobResult } from '../job-types.js';
import { updateJobProgress } from '../pipeline-coordinator.js';

/**
 * Execute deduplication logic - pure function version
 * @param job Processing job with metadata
 * @param skipQStashUpdates Skip QStash progress updates for testing
 * @param onProgress Optional progress callback for testing
 * @param updateProgressFn Optional dependency injection for progress updates
 */
export async function executeDeduplication(
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

	try {
		console.debug('[Deduplication] Starting deduplication', {
			jobId: job.id,
			source: metadata.source,
			source_type: metadata.source_type,
		});

		// Check if semantic deduplication is enabled
		if (!env.ENABLE_SEMANTIC_DEDUP) {
			console.debug('[Deduplication] Semantic deduplication is disabled');
			await updateProgress(100);
			return {
				success: true,
				data: {
					message: 'Semantic deduplication disabled',
					duplicatesRemoved: 0,
					skipped: true,
				},
			};
		}

		await updateProgress(10);

		// Get all triples for this source (account for chunk suffixes)
		console.debug('[Deduplication] Loading triples from database...');
		const triples = await db.knowledgeTriple.findMany({
			where: {
				source: {
					startsWith: metadata.source,
				},
				source_type: metadata.source_type,
			},
			select: {
				id: true,
				subject: true,
				predicate: true,
				object: true,
				type: true,
				source: true,
				source_type: true,
				source_date: true,
				extracted_at: true,
				confidence: true,
			},
		});

		if (triples.length === 0) {
			console.debug('[Deduplication] No triples found for deduplication');
			await updateProgress(100);
			return {
				success: true,
				data: {
					message: 'No triples found for deduplication',
					duplicatesRemoved: 0,
				},
			};
		}

		console.debug(`[Deduplication] Found ${triples.length} triples to deduplicate`);
		await updateProgress(30);

		// Initialize embedding service
		const embeddingService = createEmbeddingService({
			model: env.EMBEDDING_MODEL,
			dimensions: env.EMBEDDING_DIMENSIONS,
			batchSize: env.BATCH_SIZE,
		});

		// Generate embeddings for deduplication
		console.debug('[Deduplication] Generating embeddings for triples...');
		const allTexts = new Set<string>();
		for (const triple of triples) {
			allTexts.add(triple.subject);
			allTexts.add(triple.predicate);
			allTexts.add(triple.object);
			allTexts.add(`${triple.subject} ${triple.predicate} ${triple.object}`);
		}

		const embeddingResults = await embeddingService.embedBatch(Array.from(allTexts));

		if (!embeddingResults.success) {
			return {
				success: false,
				error: {
					message: `Embedding generation failed: ${embeddingResults.error?.message}`,
					operation: 'embedding_generation',
				},
			};
		}

		const embeddingMap = new Map<string, number[]>();
		Array.from(allTexts).forEach((text, index) => {
			embeddingMap.set(text, embeddingResults.data[index]);
		});

		// Run deduplication
		console.debug('[Deduplication] Running semantic deduplication...');
		const deduplicationResult = await deduplicateTriples(triples, embeddingMap);

		if (!deduplicationResult.success) {
			return {
				success: false,
				error: {
					message: `Deduplication failed: ${deduplicationResult.error?.message}`,
					operation: 'deduplication',
				},
			};
		}

		const uniqueTriples = deduplicationResult.data?.uniqueTriples ?? triples;
		const duplicateCount = triples.length - uniqueTriples.length;

		console.debug(`[Deduplication] Found ${duplicateCount} duplicates`);
		await updateProgress(60);

		// Remove duplicates from database if any found
		if (duplicateCount > 0) {
			console.debug('[Deduplication] Removing duplicates from database...');
			const uniqueIds = new Set(uniqueTriples.map((t: any) => t.id));
			const duplicateIds = triples.filter((t: any) => !uniqueIds.has(t.id)).map((t: any) => t.id);

			// Use transaction to remove duplicates and their associated vectors
			await db.$transaction([
				// Delete duplicate triples
				db.knowledgeTriple.deleteMany({
					where: { id: { in: duplicateIds } },
				}),
				// Delete associated vectors from unified VectorEmbedding table
				db.vectorEmbedding.deleteMany({
					where: { knowledge_triple_id: { in: duplicateIds } },
				}),
			]);

			console.debug(`[Deduplication] Removed ${duplicateCount} duplicates and their vectors`);
		}

		await updateProgress(100);

		return {
			success: true,
			data: {
				originalCount: triples.length,
				uniqueCount: uniqueTriples.length,
				duplicatesRemoved: duplicateCount,
				processingTime: Date.now() - job.createdAt.getTime(),
			},
		};
	} catch (error) {
		console.error('[Deduplication] Failed:', error);
		return {
			success: false,
			error: {
				message: error instanceof Error ? error.message : 'Deduplication failed',
				operation: 'deduplication',
				cause: error,
			},
		};
	}
}
