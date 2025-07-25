/**
 * Multi-Index Fusion Search Implementation
 * Core AutoSchemaKG functionality that combines multiple search strategies
 */

import {
	getConceptualizationsByConcept,
	searchConceptsByEmbedding,
} from '~/shared/database/concept-operations.js';
import {
	searchByConcept as dbSearchByConcept,
	searchByEmbedding as dbSearchByEmbedding,
	searchByEntity as dbSearchByEntity,
	searchByRelationship as dbSearchByRelationship,
} from '~/shared/database/search-operations.js';
import { getAllTriples } from '~/shared/database/triple-operations.js';
import { env } from '~/shared/env.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import type { Triple } from '~/shared/types/core.js';
import type { SearchOptions } from '~/shared/types/search.js';
import type { EmbeddingService, Result } from '~/shared/types/services.js';

export interface FusionSearchResult {
	triple: Triple;
	scores: {
		entity?: number;
		relationship?: number;
		semantic?: number;
		concept?: number;
		fusion: number;
	};
	searchTypes: string[];
}

export interface FusionSearchWeights {
	entity: number;
	relationship: number;
	semantic: number;
	concept: number;
}

export const DEFAULT_FUSION_WEIGHTS: FusionSearchWeights = {
	entity: 0.3,
	relationship: 0.2,
	semantic: 0.3,
	concept: 0.2,
};

/**
 * Perform fusion search across all 4 search types
 */
export async function searchFusion(
	query: string,
	options?: SearchOptions & {
		weights?: Partial<FusionSearchWeights>;
		enabledSearchTypes?: ('entity' | 'relationship' | 'semantic' | 'concept')[];
	}
): Promise<Result<FusionSearchResult[]>> {
	try {
		const weights = { ...DEFAULT_FUSION_WEIGHTS, ...options?.weights };
		const enabledTypes = options?.enabledSearchTypes || [
			'entity',
			'relationship',
			'semantic',
			'concept',
		];
		const topK = options?.limit || env.SEARCH_TOP_K;

		// Run all enabled search types in parallel
		const searchPromises: Promise<Result<Triple[]>>[] = [];
		const searchTypeNames: string[] = [];

		// Generate embedding once for all vector-based searches
		let queryEmbedding: number[] | null = null;
		if (enabledTypes.some(type => ['entity', 'relationship', 'semantic'].includes(type))) {
			const embeddingResult = await createEmbeddingService({
				model: env.EMBEDDING_MODEL,
				dimensions: env.EMBEDDING_DIMENSIONS,
				batchSize: env.BATCH_SIZE,
			}).embed(query);
			if (embeddingResult.success) {
				queryEmbedding = embeddingResult.data;
			} else {
				console.warn('[FUSION SEARCH] Failed to generate query embedding:', embeddingResult.error);
			}
		}

		if (enabledTypes.includes('entity')) {
			if (queryEmbedding) {
				// Use vector-based entity search
				searchPromises.push(
					dbSearchByEmbedding(queryEmbedding, topK, options?.threshold || env.MIN_SCORE, options)
				);
				searchTypeNames.push('entity');
			} else {
				// Fallback to text-based entity search
				console.warn('[FUSION SEARCH] Using fallback text-based entity search');
				searchPromises.push(dbSearchByEntity(query, topK, options));
				searchTypeNames.push('entity');
			}
		}

		if (enabledTypes.includes('relationship')) {
			if (queryEmbedding) {
				// Use vector-based relationship search
				searchPromises.push(
					dbSearchByEmbedding(queryEmbedding, topK, options?.threshold || env.MIN_SCORE, options)
				);
				searchTypeNames.push('relationship');
			} else {
				// Fallback to text-based relationship search
				console.warn('[FUSION SEARCH] Using fallback text-based relationship search');
				searchPromises.push(dbSearchByRelationship(query, topK, options));
				searchTypeNames.push('relationship');
			}
		}

		if (enabledTypes.includes('semantic')) {
			if (queryEmbedding) {
				// Use vector-based semantic search
				searchPromises.push(
					dbSearchByEmbedding(queryEmbedding, topK, options?.threshold || env.MIN_SCORE, options)
				);
				searchTypeNames.push('semantic');
			} else {
				console.warn('[FUSION SEARCH] Cannot perform semantic search without embedding');
			}
		}

		if (enabledTypes.includes('concept')) {
			if (queryEmbedding) {
				// Use vector-based concept search
				searchPromises.push(
					searchByConceptVector(queryEmbedding, topK, options?.threshold || env.MIN_SCORE, options)
				);
				searchTypeNames.push('concept');
			} else {
				// Fallback to text-based concept search
				console.warn('[FUSION SEARCH] Using fallback text-based concept search');
				searchPromises.push(dbSearchByConcept(query, topK, options));
				searchTypeNames.push('concept');
			}
		}

		// Execute all searches
		const searchResults = await Promise.all(searchPromises);

		// Extract successful results
		const resultSets: Triple[][] = [];
		const activeSearchTypes: string[] = [];

		for (let i = 0; i < searchResults.length; i++) {
			const result = searchResults[i];
			if (result.success) {
				resultSets.push(result.data);
				activeSearchTypes.push(searchTypeNames[i]);
			}
		}

		if (resultSets.length === 0) {
			return {
				success: true,
				data: [],
			};
		}

		// Perform fusion ranking
		const fusionResults = fuseSearchResults(resultSets, activeSearchTypes, weights, topK);

		return {
			success: true,
			data: fusionResults,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'FUSION_SEARCH_ERROR',
				message: 'Failed to perform fusion search',
				cause: error,
			},
		};
	}
}

/**
 * Combine results from multiple search types using weighted fusion
 */
function fuseSearchResults(
	resultSets: Triple[][],
	searchTypes: string[],
	weights: FusionSearchWeights,
	topK: number
): FusionSearchResult[] {
	// Create a map to aggregate results by triple ID
	const tripleMap = new Map<
		string,
		{
			triple: Triple;
			scores: { [key: string]: number };
			searchTypes: Set<string>;
			positions: { [key: string]: number };
		}
	>();

	// Process each search type result set
	for (let typeIndex = 0; typeIndex < resultSets.length; typeIndex++) {
		const searchType = searchTypes[typeIndex];
		const results = resultSets[typeIndex];

		for (let position = 0; position < results.length; position++) {
			const triple = results[position];
			const tripleId = generateTripleKey(triple);

			// Calculate position-based score (higher for better positions)
			const positionScore = (results.length - position) / results.length;

			if (!tripleMap.has(tripleId)) {
				tripleMap.set(tripleId, {
					triple,
					scores: {},
					searchTypes: new Set(),
					positions: {},
				});
			}

			const entry = tripleMap.get(tripleId)!;
			entry.scores[searchType] = positionScore;
			entry.searchTypes.add(searchType);
			entry.positions[searchType] = position;
		}
	}

	// Calculate fusion scores and convert to final format
	const fusionResults: FusionSearchResult[] = [];

	for (const entry of tripleMap.values()) {
		// Calculate weighted fusion score
		let fusionScore = 0;
		let totalWeight = 0;

		for (const [searchType, weight] of Object.entries(weights)) {
			if (entry.scores[searchType] !== undefined) {
				fusionScore += entry.scores[searchType] * weight;
				totalWeight += weight;
			}
		}

		// Normalize by actual weights used
		if (totalWeight > 0) {
			fusionScore = fusionScore / totalWeight;
		}

		// Boost scores for triples found by multiple search types
		const searchTypeCount = entry.searchTypes.size;
		const diversityBoost = Math.log(1 + searchTypeCount) / Math.log(5); // Log scale boost
		fusionScore = fusionScore * (1 + 0.2 * diversityBoost);

		fusionResults.push({
			triple: entry.triple,
			scores: {
				entity: entry.scores.entity,
				relationship: entry.scores.relationship,
				semantic: entry.scores.semantic,
				concept: entry.scores.concept,
				fusion: fusionScore,
			},
			searchTypes: Array.from(entry.searchTypes),
		});
	}

	// Sort by fusion score and return top K
	fusionResults.sort((a, b) => b.scores.fusion - a.scores.fusion);
	return fusionResults.slice(0, topK);
}

/**
 * Generate a unique key for a triple to detect duplicates across search types
 */
function generateTripleKey(triple: Triple): string {
	return `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
}

/**
 * Individual search type functions for direct access
 */
export async function searchByEntity(
	query: string,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	const topK = options?.limit || env.SEARCH_TOP_K;
	return dbSearchByEntity(query, topK, options);
}

export async function searchByRelationship(
	query: string,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	const topK = options?.limit || env.SEARCH_TOP_K;
	return dbSearchByRelationship(query, topK, options);
}

export async function searchBySemantic(
	query: string,
	embeddingService: EmbeddingService,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	const embeddingResult = await embeddingService.embed(query);
	if (!embeddingResult.success) {
		return embeddingResult;
	}

	const topK = options?.limit || env.SEARCH_TOP_K;
	const minScore = options?.threshold || env.MIN_SCORE;

	return dbSearchByEmbedding(embeddingResult.data, topK, minScore, options);
}

export async function searchByConcept(
	query: string,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	const topK = options?.limit || env.SEARCH_TOP_K;
	return dbSearchByConcept(query, topK, options);
}

/**
 * Search for knowledge triples using concept vector similarity
 * Finds similar concepts and returns triples connected via conceptualization relationships
 */
async function searchByConceptVector(
	embedding: number[],
	topK: number,
	minScore: number,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	try {
		console.log(
			`[DB DEBUG] searchByConceptVector: topK=${topK}, minScore=${minScore}, embedding length=${embedding.length}`
		);

		// First, find similar concepts using vector search
		const conceptSearchResult = await searchConceptsByEmbedding(embedding, topK, minScore);

		if (!conceptSearchResult.success) {
			console.log(`[DB DEBUG] Concept vector search failed:`, conceptSearchResult.error);
			return conceptSearchResult as any; // Return the error result
		}

		const similarConcepts = conceptSearchResult.data;
		console.log(`[DB DEBUG] Found ${similarConcepts.length} similar concepts via vector search`);

		if (similarConcepts.length === 0) {
			return {
				success: true,
				data: [],
			};
		}

		// Extract concept names for relationship lookup
		const conceptNames = similarConcepts.map(concept => concept.concept);
		console.log(
			`[DB DEBUG] Looking up triples for concepts: [${conceptNames.slice(0, 3).join(', ')}${conceptNames.length > 3 ? '...' : ''}]`
		);

		// Find triples connected to these concepts via conceptualization relationships
		// We'll use a more direct query to find triples linked to these concepts
		const allTriples: Triple[] = [];

		for (const concept of similarConcepts) {
			// Get conceptualization relationships for this concept
			const relationships = await getConceptualizationsByConcept(concept.concept);
			console.log(
				`[DB DEBUG] Found ${relationships.length} conceptualization relationships for concept "${concept.concept}"`
			);

			// Get triples that contain the elements linked to this concept
			if (relationships.length > 0) {
				const elements = relationships.map(rel => rel.source_element);

				// Find triples that contain any of these elements
				const triplesResult = await getAllTriples();
				if (triplesResult.success) {
					const relevantTriples = triplesResult.data.filter(triple =>
						elements.some(
							element =>
								triple.subject === element ||
								triple.object === element ||
								triple.predicate === element
						)
					);

					console.log(
						`[DB DEBUG] Found ${relevantTriples.length} triples for concept "${concept.concept}"`
					);
					allTriples.push(...relevantTriples);
				}
			}
		}

		// Remove duplicates based on triple ID
		const uniqueTriples = Array.from(
			new Map(
				allTriples.map(triple => {
					const id = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
					return [id, triple];
				})
			).values()
		);

		console.log(`[DB DEBUG] Concept vector search returned ${uniqueTriples.length} unique triples`);

		// Apply additional filtering if needed
		let filteredTriples = uniqueTriples;

		// Apply source filtering
		if (options?.sources && options.sources.length > 0) {
			filteredTriples = filteredTriples.filter(triple => options.sources!.includes(triple.source));
		}

		// Apply type filtering
		if (options?.types && options.types.length > 0) {
			filteredTriples = filteredTriples.filter(triple => options.types!.includes(triple.type));
		}

		// Limit results
		if (topK > 0) {
			filteredTriples = filteredTriples.slice(0, topK);
		}

		return {
			success: true,
			data: filteredTriples,
		};
	} catch (error) {
		console.error('Concept vector search error:', error);
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search by concept vector',
				cause: error,
			},
		};
	}
}
