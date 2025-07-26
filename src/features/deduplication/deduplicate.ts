import { env } from '~/shared/env.js';
import type { Triple } from '~/shared/types/core.js';
import type { EmbeddingService } from '~/shared/types/services.js';

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
 * Deduplicate knowledge triples using exact and semantic matching
 * Pure function that takes all dependencies as parameters
 */
export async function deduplicateTriples(triples: Triple[], embeddingService: EmbeddingService) {
	try {
		let processedTriples = [...triples];
		let duplicatesRemoved = 0;
		let semanticDuplicatesRemoved = 0;
		const mergedMetadata: Array<{
			originalId: string;
			mergedIntoId: string;
			reason: 'exact' | 'semantic';
		}> = [];

		// Step 1: Remove exact duplicates
		const exactResult = removeExactDuplicates(processedTriples);
		processedTriples = exactResult.uniqueTriples;
		duplicatesRemoved += exactResult.duplicatesCount;
		mergedMetadata.push(...exactResult.mergedMetadata);

		// Step 2: Remove semantic duplicates if enabled
		if (env.ENABLE_SEMANTIC_DEDUP) {
			const semanticResult = await removeSemanticDuplicates(processedTriples, embeddingService);
			if (semanticResult.success && semanticResult.data) {
				processedTriples = semanticResult.data.uniqueTriples;
				semanticDuplicatesRemoved = semanticResult.data.duplicatesCount;
				mergedMetadata.push(...semanticResult.data.mergedMetadata);
			}
		}

		return {
			success: true,
			data: {
				uniqueTriples: processedTriples,
				duplicatesRemoved: duplicatesRemoved + semanticDuplicatesRemoved,
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
			const existing = uniqueMap.get(key)!;
			const merged = mergeTripleMetadata(existing, triple);
			uniqueMap.set(key, merged);

			mergedMetadata.push({
				originalId: generateTripleId(triple),
				mergedIntoId: generateTripleId(existing),
				reason: 'exact',
			});
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
 * Remove semantic duplicates using embedding similarity
 */
export async function removeSemanticDuplicates(
	triples: Triple[],
	embeddingService: EmbeddingService
) {
	try {
		// Generate embeddings for all triples
		const tripleTexts = triples.map(
			triple => `${triple.subject} ${triple.predicate} ${triple.object}`
		);

		const embeddingResult = await embeddingService.embedBatch(tripleTexts, {
			source_type: triples[0].source_type,
			source: triples[0].source,
		});
		if (!embeddingResult.success) {
			return embeddingResult;
		}

		const embeddings = embeddingResult.data;
		const uniqueTriples = [];
		const mergedMetadata: Array<{
			originalId: string;
			mergedIntoId: string;
			reason: 'semantic';
		}> = [];
		const processedIndices = new Set<number>();

		// Compare each triple with others
		for (let i = 0; i < triples.length; i++) {
			if (processedIndices.has(i)) continue;

			const currentTriple = triples[i];
			const currentEmbedding = embeddings[i];
			let bestMatch = currentTriple;
			const bestMatchIndex = i;

			// Find semantically similar triples
			for (let j = i + 1; j < triples.length; j++) {
				if (processedIndices.has(j)) continue;

				const similarity = calculateCosineSimilarity(currentEmbedding, embeddings[j]);

				if (similarity >= env.SEMANTIC_THRESHOLD) {
					// Merge the similar triple
					bestMatch = mergeTripleMetadata(bestMatch, triples[j]);
					processedIndices.add(j);

					mergedMetadata.push({
						originalId: generateTripleId(triples[j]),
						mergedIntoId: generateTripleId(bestMatch),
						reason: 'semantic',
					});
				}
			}

			uniqueTriples.push(bestMatch);
			processedIndices.add(bestMatchIndex);
		}

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
