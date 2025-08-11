import { env } from '~/shared/env.js';
import type { Triple } from '~/shared/types/core.js';

export interface DeduplicationResult {
	uniqueTriples: Triple[];
	duplicatesRemoved: number;
	mergedMetadata: Array<{
		originalId: string;
		mergedIntoId: string;
		reason: 'exact' | 'semantic';
	}>;
}

export interface SimilarityScore {
	triple1Id: string;
	triple2Id: string;
	score: number;
	type: 'exact' | 'semantic';
}

/**
 * Deduplicate knowledge triples using exact and semantic matching with embedding map
 * Pure function that takes all dependencies as parameters
 */
export async function deduplicateTriples(triples: Triple[], embeddingMap: Map<string, number[]>) {
	try {
		console.log(`[DEDUPLICATION OPTIMIZED] Starting deduplication for ${triples.length} triples using embedding map`);
		
		let processedTriples = [...triples];
		let duplicatesRemoved = 0;
		let semanticDuplicatesRemoved = 0;
		const mergedMetadata: Array<{
			originalId: string;
			mergedIntoId: string;
			reason: 'exact' | 'semantic';
		}> = [];

		// Step 1: Remove exact duplicates
		console.log(`[DEDUPLICATION OPTIMIZED] Step 1: Removing exact duplicates...`);
		const exactResult = removeExactDuplicates(processedTriples);
		processedTriples = exactResult.uniqueTriples;
		duplicatesRemoved += exactResult.duplicatesCount;
		mergedMetadata.push(...exactResult.mergedMetadata);
		console.log(`[DEDUPLICATION OPTIMIZED] Step 1 complete: ${exactResult.duplicatesCount} exact duplicates removed`);

		// Step 2: Remove semantic duplicates if enabled (using embedding map)
		if (env.ENABLE_SEMANTIC_DEDUP) {
			console.log(`[DEDUPLICATION OPTIMIZED] Step 2: Removing semantic duplicates using embedding map...`);
			const semanticResult = await removeSemanticDuplicates(processedTriples, embeddingMap);
			if (semanticResult.success && semanticResult.data) {
				processedTriples = semanticResult.data.uniqueTriples;
				semanticDuplicatesRemoved = semanticResult.data.duplicatesCount;
				mergedMetadata.push(...semanticResult.data.mergedMetadata);
				console.log(`[DEDUPLICATION OPTIMIZED] Step 2 complete: ${semanticDuplicatesRemoved} semantic duplicates removed`);
			} else {
				console.warn(`[DEDUPLICATION OPTIMIZED] Step 2 failed:`, semanticResult.error);
			}
		} else {
			console.log(`[DEDUPLICATION OPTIMIZED] Step 2 skipped: Semantic deduplication disabled`);
		}

		const totalDuplicatesRemoved = duplicatesRemoved + semanticDuplicatesRemoved;
		console.log(`[DEDUPLICATION OPTIMIZED] ✅ Deduplication complete: ${totalDuplicatesRemoved} total duplicates removed (${duplicatesRemoved} exact, ${semanticDuplicatesRemoved} semantic)`);

		return {
			success: true,
			data: {
				uniqueTriples: processedTriples,
				duplicatesRemoved: totalDuplicatesRemoved,
				mergedMetadata,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DEDUPLICATION_ERROR',
				message: 'Failed to deduplicate triples',
				cause: error,
			},
		};
	}
}

/**
 * Remove exact duplicate triples based on subject, predicate, object, and type
 */
export function removeExactDuplicates(triples: Triple[]) {
	const uniqueMap = new Map<string, Triple>();
	const mergedMetadata: Array<{
		originalId: string;
		mergedIntoId: string;
		reason: 'exact';
	}> = [];

	for (const triple of triples) {
		const key = createTripleKey(triple);

		if (uniqueMap.has(key)) {
			// This is a duplicate - merge metadata
			const existing = uniqueMap.get(key);
			if (existing) {
				const merged = mergeTripleMetadata(existing, triple);
				uniqueMap.set(key, merged);

				mergedMetadata.push({
					originalId: generateTripleId(triple),
					mergedIntoId: generateTripleId(existing),
					reason: 'exact',
				});
			}
		} else {
			uniqueMap.set(key, triple);
		}
	}

	return {
		uniqueTriples: Array.from(uniqueMap.values()),
		duplicatesCount: triples.length - uniqueMap.size,
		mergedMetadata,
	};
}

/**
 * Remove semantic duplicates using pre-generated embedding map
 */
export async function removeSemanticDuplicates(
	triples: Triple[],
	embeddingMap: Map<string, number[]>
) {
	try {
		console.log(`[SEMANTIC DEDUP OPTIMIZED] Starting semantic deduplication using embedding map for ${triples.length} triples`);

		// Get embeddings from map
		const embeddings: number[][] = [];
		const tripleTexts: string[] = [];
		const validIndices: number[] = [];
		let embeddingLookupMisses = 0;

		for (let i = 0; i < triples.length; i++) {
			const triple = triples[i];
			const semanticText = `${triple.subject} ${triple.predicate} ${triple.object}`;
			const embedding = embeddingMap.get(semanticText);
			
			if (embedding) {
				embeddings.push(embedding);
				tripleTexts.push(semanticText);
				validIndices.push(i);
			} else {
				console.warn(`[SEMANTIC DEDUP OPTIMIZED] ⚠️ Missing embedding for semantic text: "${semanticText}"`);
				embeddingLookupMisses++;
			}
		}

		if (embeddingLookupMisses > 0) {
			console.warn(`[SEMANTIC DEDUP OPTIMIZED] ⚠️ ${embeddingLookupMisses} embedding lookups failed - proceeding with available embeddings`);
		}

		const uniqueTriples = [];
		const mergedMetadata: Array<{
			originalId: string;
			mergedIntoId: string;
			reason: 'semantic';
		}> = [];
		const processedIndices = new Set<number>();

		// Compare each triple with others using the embedding map
		for (let i = 0; i < validIndices.length; i++) {
			if (processedIndices.has(i)) continue;

			const currentTripleIndex = validIndices[i];
			const currentTriple = triples[currentTripleIndex];
			const currentEmbedding = embeddings[i];
			let bestMatch = currentTriple;
			const bestMatchIndex = i;

			// Find semantically similar triples
			for (let j = i + 1; j < validIndices.length; j++) {
				if (processedIndices.has(j)) continue;

				const similarity = calculateCosineSimilarity(currentEmbedding, embeddings[j]);

				if (similarity >= env.SEMANTIC_THRESHOLD) {
					const otherTripleIndex = validIndices[j];
					// Merge the similar triple
					bestMatch = mergeTripleMetadata(bestMatch, triples[otherTripleIndex]);
					processedIndices.add(j);

					mergedMetadata.push({
						originalId: generateTripleId(triples[otherTripleIndex]),
						mergedIntoId: generateTripleId(bestMatch),
						reason: 'semantic',
					});
				}
			}

			uniqueTriples.push(bestMatch);
			processedIndices.add(bestMatchIndex);
		}

		// Add triples that couldn't be processed due to missing embeddings
		if (embeddingLookupMisses > 0) {
			const missingEmbeddingTriples = triples.filter((triple) => {
				const semanticText = `${triple.subject} ${triple.predicate} ${triple.object}`;
				return !embeddingMap.has(semanticText);
			});
			uniqueTriples.push(...missingEmbeddingTriples);
		}

		console.log(`[SEMANTIC DEDUP OPTIMIZED] ✅ Completed semantic deduplication: ${triples.length - uniqueTriples.length} duplicates removed`);

		return {
			success: true,
			data: {
				uniqueTriples,
				duplicatesCount: triples.length - uniqueTriples.length,
				mergedMetadata,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DEDUPLICATION_ERROR',
				message: 'Failed to remove semantic duplicates',
				cause: error,
			},
		};
	}
}

// Helper functions
function createTripleKey(triple: Triple) {
	return `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
}

function generateTripleId(triple: Triple): string {
	const key = createTripleKey(triple);
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

function mergeTripleMetadata(existing: Triple, duplicate: Triple) {
	return {
		...existing,
		confidence:
			existing.confidence && duplicate.confidence
				? existing.confidence.greaterThan(duplicate.confidence)
					? existing.confidence
					: duplicate.confidence
				: existing.confidence || duplicate.confidence,
		extracted_at:
			existing.extracted_at > duplicate.extracted_at
				? existing.extracted_at
				: duplicate.extracted_at,
	};
}

function calculateCosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new Error('Vectors must have the same length');
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
