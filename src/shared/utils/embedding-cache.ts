import { env } from '~/shared/env.js';
import type { Concept, Triple } from '~/shared/types/core.js';
import type { EmbeddingService } from '~/shared/types/services.js';
import { debugLog, errorLog, infoLog } from '~/shared/utils/conditional-logging.js';

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
	includeSemanticDuplication = true
): Promise<{ success: true; data: EmbeddingMap } | { success: false; error: any }> {
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

		infoLog(
			`[EMBEDDING MAP] Generating embeddings for ${uniqueTexts.size} unique texts (${duplicatesAverted} duplicates averted)`
		);
		debugLog(
			`[EMBEDDING MAP] Text breakdown: entities, relationships, semantic content, concepts`
		);
		debugLog(`[EMBEDDING MAP] Sample texts:`, allTexts.slice(0, 3));

		// Generate embeddings in batches
		const embeddingMap = new Map<string, number[]>();
		const batchSize = env.BATCH_SIZE;
		let batchCalls = 0;

		// Use the first triple's metadata for embedding context
		const source_type = triples[0]?.source_type || 'unknown';
		const source = triples[0]?.source || 'unknown';

		debugLog(
			`[EMBEDDING MAP] Processing ${Math.ceil(allTexts.length / batchSize)} batches with batch size ${batchSize}`
		);

		for (let i = 0; i < allTexts.length; i += batchSize) {
			const batch = allTexts.slice(i, i + batchSize);
			batchCalls++;

			debugLog(`[EMBEDDING MAP] Batch ${batchCalls}: Processing ${batch.length} texts`);
			debugLog(`[EMBEDDING MAP] Sample from batch: "${batch[0]}"`);

			const embeddingResult = await embeddingService.embedBatch(batch, {
				source_type,
				source,
			});

			if (!embeddingResult.success) {
				errorLog(
					`[EMBEDDING MAP] ❌ Failed to generate embeddings for batch ${batchCalls}:`,
					embeddingResult.error
				);
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

			debugLog(
				`[EMBEDDING MAP] ✅ Batch ${batchCalls} completed: ${batch.length} embeddings stored`
			);
		}

		infoLog(
			`[EMBEDDING MAP] ✅ Complete! Generated ${embeddingMap.size} embeddings in ${batchCalls} API calls`
		);
		infoLog(`[EMBEDDING MAP] Efficiency: ${duplicatesAverted} duplicate embeddings averted`);

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
		errorLog(`[EMBEDDING MAP] ❌ Unexpected error:`, error);
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
