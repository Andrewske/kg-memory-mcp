import type { Triple, Concept } from '~/shared/types/core.js';
import type { EmbeddingService } from '~/shared/types/services.js';
import { env } from '~/shared/env.js';

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
		const allTexts: string[] = [];
		const textSet = new Set<string>();
		
		// Collect all unique texts from triples
		for (const triple of triples) {
			// Entity texts (subject and object)
			const subject = triple.subject;
			const object = triple.object;
			const predicate = triple.predicate;
			
			if (!textSet.has(subject)) {
				textSet.add(subject);
				allTexts.push(subject);
			}
			if (!textSet.has(object)) {
				textSet.add(object);
				allTexts.push(object);
			}
			if (!textSet.has(predicate)) {
				textSet.add(predicate);
				allTexts.push(predicate);
			}
			
			// Semantic text (full triple content)
			const semanticText = `${subject} ${predicate} ${object}`;
			if (!textSet.has(semanticText)) {
				textSet.add(semanticText);
				allTexts.push(semanticText);
			}
			
			// Include semantic deduplication texts if enabled
			if (includeSemanticDuplication && env.ENABLE_SEMANTIC_DEDUP) {
				// This is the same as semantic text above, so already included
			}
		}
		
		// Collect concept texts
		for (const concept of concepts) {
			const conceptText = concept.concept;
			if (!textSet.has(conceptText)) {
				textSet.add(conceptText);
				allTexts.push(conceptText);
			}
		}
		
		const totalTexts = allTexts.length;
		const uniqueTexts = textSet.size;
		const duplicatesAverted = totalTexts - uniqueTexts;
		
		console.log(`[EMBEDDING MAP] Generating embeddings for ${uniqueTexts} unique texts (${duplicatesAverted} duplicates averted)`);
		console.log(`[EMBEDDING MAP] Text breakdown: entities, relationships, semantic content, concepts`);
		console.log(`[EMBEDDING MAP] Sample texts:`, allTexts.slice(0, 3));
		
		// Generate embeddings in batches
		const embeddingMap = new Map<string, number[]>();
		const batchSize = env.BATCH_SIZE;
		let batchCalls = 0;
		
		// Use the first triple's metadata for embedding context
		const source_type = triples[0]?.source_type || 'unknown';
		const source = triples[0]?.source || 'unknown';
		
		console.log(`[EMBEDDING MAP] Processing ${Math.ceil(allTexts.length / batchSize)} batches with batch size ${batchSize}`);
		
		for (let i = 0; i < allTexts.length; i += batchSize) {
			const batch = allTexts.slice(i, i + batchSize);
			batchCalls++;
			
			console.log(`[EMBEDDING MAP] Batch ${batchCalls}: Processing ${batch.length} texts`);
			console.log(`[EMBEDDING MAP] Sample from batch: "${batch[0]}"`);
			
			const embeddingResult = await embeddingService.embedBatch(batch, {
				source_type,
				source,
			});
			
			if (!embeddingResult.success) {
				console.error(`[EMBEDDING MAP] ❌ Failed to generate embeddings for batch ${batchCalls}:`, embeddingResult.error);
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
			
			console.log(`[EMBEDDING MAP] ✅ Batch ${batchCalls} completed: ${batch.length} embeddings stored`);
		}
		
		console.log(`[EMBEDDING MAP] ✅ Complete! Generated ${embeddingMap.size} embeddings in ${batchCalls} API calls`);
		console.log(`[EMBEDDING MAP] Efficiency: ${duplicatesAverted} duplicate embeddings averted`);
		
		return {
			success: true,
			data: {
				embeddings: embeddingMap,
				stats: {
					totalTexts,
					uniqueTexts,
					duplicatesAverted,
					batchCalls,
				},
			},
		};
	} catch (error) {
		console.error(`[EMBEDDING MAP] ❌ Unexpected error:`, error);
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