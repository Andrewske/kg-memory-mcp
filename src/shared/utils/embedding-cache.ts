import { env } from '~/shared/env.js';
import type { Concept, Triple } from '~/shared/types/core.js';
import type { EmbeddingService } from '~/shared/types/services.js';
import { createContext, log, logError } from '~/shared/utils/debug-logger.js';

export interface EmbeddingMap {
	/** Map from text to embedding vector */
	embeddings: Map<string, number[]>;
	/** Statistics about embedding generation */
	stats: {
		totalTexts: number;
		uniqueTexts: number;
		duplicatesAverted: number;
		batchCalls: number;
	};
}

/**
 * Generate a comprehensive embedding map for all texts that will be needed
 * during the knowledge processing pipeline. This eliminates duplicate embedding
 * generation across different vector types and operations.
 */
export async function generateEmbeddingMap(
	triples: Triple[],
	concepts: Concept[] = [],
	embeddingService: EmbeddingService,
	_includeSemanticDuplication = true
): Promise<{ success: true; data: EmbeddingMap } | { success: false; error: any }> {
	const context = createContext('EMBEDDING_CACHE', 'generate_embedding_map', {
		tripleCount: triples.length,
		conceptCount: concepts.length,
	});

	try {
		// Collect unique texts using Set for automatic deduplication
		const uniqueTexts = new Set<string>();

		// Collect all unique texts from triples
		for (const triple of triples) {
			uniqueTexts.add(triple.subject);
			uniqueTexts.add(triple.object);
			uniqueTexts.add(triple.predicate);
			// Semantic text (full triple content)
			uniqueTexts.add(`${triple.subject} ${triple.predicate} ${triple.object}`);
		}

		// Collect concept texts
		for (const concept of concepts) {
			uniqueTexts.add(concept.concept);
		}

		// Convert to array for batching
		const allTexts = Array.from(uniqueTexts);
		const totalTextsBeforeDedup = triples.length * 4 + concepts.length; // Rough estimate
		const duplicatesAverted = Math.max(0, totalTextsBeforeDedup - uniqueTexts.size);

		log('INFO', context, 'Generating embeddings', {
			uniqueTexts: uniqueTexts.size,
			duplicatesAverted,
			textTypes: ['entities', 'relationships', 'semantic_content', 'concepts'],
		});
		log('DEBUG', context, 'Sample texts', { sampleTexts: allTexts.slice(0, 3) });

		// Generate embeddings in batches
		const embeddingMap = new Map<string, number[]>();
		const batchSize = env.BATCH_SIZE;
		let batchCalls = 0;

		// Use the first triple's metadata for embedding context
		const source_type = triples[0]?.source_type || 'unknown';
		const source = triples[0]?.source || 'unknown';

		log('DEBUG', context, 'Processing batches', {
			totalBatches: Math.ceil(allTexts.length / batchSize),
			batchSize,
		});

		for (let i = 0; i < allTexts.length; i += batchSize) {
			const batch = allTexts.slice(i, i + batchSize);
			batchCalls++;

			log('DEBUG', context, 'Processing batch', {
				batchNumber: batchCalls,
				batchSize: batch.length,
				sampleText: batch[0],
			});

			const embeddingResult = await embeddingService.embedBatch(batch, {
				source_type,
				source,
			});

			if (!embeddingResult.success) {
				logError(context, `Failed to generate embeddings for batch ${batchCalls}`, {
					errorType: embeddingResult.error.type,
					errorMessage: embeddingResult.error.message,
				});
				return {
					success: false,
					error: {
						type: 'EMBEDDING_GENERATION_ERROR',
						message: `Failed to generate embeddings for batch ${batchCalls}`,
						cause: embeddingResult.error,
					},
				};
			}

			// Store embeddings in map
			for (let j = 0; j < batch.length; j++) {
				embeddingMap.set(batch[j], embeddingResult.data[j]);
			}

			log('DEBUG', context, 'Batch completed', {
				batchNumber: batchCalls,
				embeddingsStored: batch.length,
			});
		}

		log('INFO', context, 'Embedding generation complete', {
			totalEmbeddings: embeddingMap.size,
			apiCalls: batchCalls,
			duplicatesAverted,
		});

		return {
			success: true,
			data: {
				embeddings: embeddingMap,
				stats: {
					totalTexts: totalTextsBeforeDedup,
					uniqueTexts: uniqueTexts.size,
					duplicatesAverted,
					batchCalls,
				},
			},
		};
	} catch (error) {
		logError(context, error instanceof Error ? error : new Error(String(error)), {
			operation: 'generate_embedding_map',
		});
		return {
			success: false,
			error: {
				type: 'EMBEDDING_MAP_ERROR',
				message: 'Failed to generate embedding map',
				cause: error,
			},
		};
	}
}

/**
 * Extract all unique entities from triples (subjects and objects)
 */
export function extractUniqueEntities(triples: Triple[]): string[] {
	const entities = new Set<string>();

	for (const triple of triples) {
		entities.add(triple.subject);
		entities.add(triple.object);
	}

	return Array.from(entities);
}

/**
 * Extract all unique relationships from triples (predicates)
 */
export function extractUniqueRelationships(triples: Triple[]): string[] {
	const relationships = new Set<string>();

	for (const triple of triples) {
		relationships.add(triple.predicate);
	}

	return Array.from(relationships);
}

/**
 * Generate semantic texts for all triples
 */
export function generateSemanticTexts(triples: Triple[]): string[] {
	return triples.map(triple => `${triple.subject} ${triple.predicate} ${triple.object}`);
}
