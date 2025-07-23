/**
 * Multi-Index Fusion Search Implementation
 * Core AutoSchemaKG functionality that combines multiple search strategies
 */

import type { Result } from "~/shared/services/types.js";
import type {
	DatabaseAdapter,
	EmbeddingService,
} from "~/shared/services/types.js";
import type {
	KnowledgeTriple,
	KnowledgeGraphConfig,
} from "~/shared/types/index.js";
import type { SearchOptions } from "./types.js";

export interface FusionSearchResult {
	triple: KnowledgeTriple;
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
	db: DatabaseAdapter,
	embeddingService: EmbeddingService,
	config: KnowledgeGraphConfig,
	options?: SearchOptions & {
		weights?: Partial<FusionSearchWeights>;
		enabledSearchTypes?: ("entity" | "relationship" | "semantic" | "concept")[];
	},
): Promise<Result<FusionSearchResult[]>> {
	try {
		const weights = { ...DEFAULT_FUSION_WEIGHTS, ...options?.weights };
		const enabledTypes = options?.enabledSearchTypes || [
			"entity",
			"relationship",
			"semantic",
			"concept",
		];
		const topK = options?.limit || config.search.topK;

		// Run all enabled search types in parallel
		const searchPromises: Promise<Result<KnowledgeTriple[]>>[] = [];
		const searchTypeNames: string[] = [];

		// Generate embedding once for all vector-based searches
		let queryEmbedding: number[] | null = null;
		if (enabledTypes.some(type => ["entity", "relationship", "semantic"].includes(type))) {
			const embeddingResult = await embeddingService.embed(query);
			if (embeddingResult.success) {
				queryEmbedding = embeddingResult.data;
			} else {
				console.warn("[FUSION SEARCH] Failed to generate query embedding:", embeddingResult.error);
			}
		}

		if (enabledTypes.includes("entity")) {
			if (queryEmbedding) {
				// Use vector-based entity search
				searchPromises.push(
					db.searchByEntityVector(
						queryEmbedding,
						topK,
						options?.threshold || config.search.minScore,
						options,
					),
				);
				searchTypeNames.push("entity");
			} else {
				// Fallback to text-based entity search
				console.warn("[FUSION SEARCH] Using fallback text-based entity search");
				searchPromises.push(db.searchByEntity(query, topK, options));
				searchTypeNames.push("entity");
			}
		}

		if (enabledTypes.includes("relationship")) {
			if (queryEmbedding) {
				// Use vector-based relationship search
				searchPromises.push(
					db.searchByRelationshipVector(
						queryEmbedding,
						topK,
						options?.threshold || config.search.minScore,
						options,
					),
				);
				searchTypeNames.push("relationship");
			} else {
				// Fallback to text-based relationship search
				console.warn("[FUSION SEARCH] Using fallback text-based relationship search");
				searchPromises.push(db.searchByRelationship(query, topK, options));
				searchTypeNames.push("relationship");
			}
		}

		if (enabledTypes.includes("semantic")) {
			if (queryEmbedding) {
				// Use vector-based semantic search
				searchPromises.push(
					db.searchByEmbedding(
						queryEmbedding,
						topK,
						options?.threshold || config.search.minScore,
						options,
					),
				);
				searchTypeNames.push("semantic");
			} else {
				console.warn("[FUSION SEARCH] Cannot perform semantic search without embedding");
			}
		}

		if (enabledTypes.includes("concept")) {
			if (queryEmbedding) {
				// Use vector-based concept search
				searchPromises.push(
					searchByConceptVector(
						queryEmbedding,
						db,
						topK,
						options?.threshold || config.search.minScore,
						options,
					),
				);
				searchTypeNames.push("concept");
			} else {
				// Fallback to text-based concept search
				console.warn("[FUSION SEARCH] Using fallback text-based concept search");
				searchPromises.push(db.searchByConcept(query, topK, options));
				searchTypeNames.push("concept");
			}
		}

		// Execute all searches
		const searchResults = await Promise.all(searchPromises);

		// Extract successful results
		const resultSets: KnowledgeTriple[][] = [];
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
		const fusionResults = fuseSearchResults(
			resultSets,
			activeSearchTypes,
			weights,
			topK,
		);

		return {
			success: true,
			data: fusionResults,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: "FUSION_SEARCH_ERROR",
				message: "Failed to perform fusion search",
				cause: error,
			},
		};
	}
}

/**
 * Combine results from multiple search types using weighted fusion
 */
function fuseSearchResults(
	resultSets: KnowledgeTriple[][],
	searchTypes: string[],
	weights: FusionSearchWeights,
	topK: number,
): FusionSearchResult[] {
	// Create a map to aggregate results by triple ID
	const tripleMap = new Map<
		string,
		{
			triple: KnowledgeTriple;
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
function generateTripleKey(triple: KnowledgeTriple): string {
	return `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
}

/**
 * Individual search type functions for direct access
 */
export async function searchByEntity(
	query: string,
	db: DatabaseAdapter,
	config: KnowledgeGraphConfig,
	options?: SearchOptions,
): Promise<Result<KnowledgeTriple[]>> {
	const topK = options?.limit || config.search.topK;
	return db.searchByEntity(query, topK, options);
}

export async function searchByRelationship(
	query: string,
	db: DatabaseAdapter,
	config: KnowledgeGraphConfig,
	options?: SearchOptions,
): Promise<Result<KnowledgeTriple[]>> {
	const topK = options?.limit || config.search.topK;
	return db.searchByRelationship(query, topK, options);
}

export async function searchBySemantic(
	query: string,
	db: DatabaseAdapter,
	embeddingService: EmbeddingService,
	config: KnowledgeGraphConfig,
	options?: SearchOptions,
): Promise<Result<KnowledgeTriple[]>> {
	const embeddingResult = await embeddingService.embed(query);
	if (!embeddingResult.success) {
		return embeddingResult;
	}

	const topK = options?.limit || config.search.topK;
	const minScore = options?.threshold || config.search.minScore;

	return db.searchByEmbedding(embeddingResult.data, topK, minScore, options);
}

export async function searchByConcept(
	query: string,
	db: DatabaseAdapter,
	config: KnowledgeGraphConfig,
	options?: SearchOptions,
): Promise<Result<KnowledgeTriple[]>> {
	const topK = options?.limit || config.search.topK;
	return db.searchByConcept(query, topK, options);
}

/**
 * Search for knowledge triples using concept vector similarity
 * Finds similar concepts and returns triples connected via conceptualization relationships
 */
async function searchByConceptVector(
	embedding: number[],
	db: DatabaseAdapter,
	topK: number,
	minScore: number,
	options?: SearchOptions,
): Promise<Result<KnowledgeTriple[]>> {
	try {
		console.log(
			`[DB DEBUG] searchByConceptVector: topK=${topK}, minScore=${minScore}, embedding length=${embedding.length}`,
		);

		// First, find similar concepts using vector search
		const conceptSearchResult = await db.searchConceptsByEmbedding(
			embedding,
			topK,
			minScore,
		);

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
		console.log(`[DB DEBUG] Looking up triples for concepts: [${conceptNames.slice(0, 3).join(', ')}${conceptNames.length > 3 ? '...' : ''}]`);

		// Find triples connected to these concepts via conceptualization relationships
		// We'll use a more direct query to find triples linked to these concepts
		const allTriples: KnowledgeTriple[] = [];
		
		for (const concept of similarConcepts) {
			// Get conceptualization relationships for this concept
			const relationships = await db.getConceptualizationsByConcept(concept.concept);
			console.log(`[DB DEBUG] Found ${relationships.length} conceptualization relationships for concept "${concept.concept}"`);
			
			// Get triples that contain the elements linked to this concept
			if (relationships.length > 0) {
				const elements = relationships.map(rel => rel.source_element);
				
				// Find triples that contain any of these elements
				const triplesResult = await db.getAllTriples();
				if (triplesResult.success) {
					const relevantTriples = triplesResult.data.filter(triple => 
						elements.some(element => 
							triple.subject === element || 
							triple.object === element || 
							triple.predicate === element
						)
					);
					
					console.log(`[DB DEBUG] Found ${relevantTriples.length} triples for concept "${concept.concept}"`);
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
			filteredTriples = filteredTriples.filter(triple => 
				options.sources!.includes(triple.source)
			);
		}

		// Apply type filtering
		if (options?.types && options.types.length > 0) {
			filteredTriples = filteredTriples.filter(triple => 
				options.types!.includes(triple.type)
			);
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
		console.error("Concept vector search error:", error);
		return {
			success: false,
			error: {
				type: "DATABASE_ERROR",
				message: "Failed to search by concept vector",
				cause: error,
			},
		};
	}
}
