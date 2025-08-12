import {
	type FusionSearchResult,
	type FusionSearchWeights,
	searchByConcept as fusionSearchByConcept,
	searchByEntity as fusionSearchByEntity,
	searchByRelationship as fusionSearchByRelationship,
	searchBySemantic as fusionSearchBySemantic,
	searchFusion,
} from '~/features/knowledge-graph/fusion-search.js';
import {
	searchConceptsByEmbedding as searchConceptsByEmbeddingDB,
	searchConcepts as searchConceptsDB,
} from '~/shared/database/concept-operations.js';
import { searchByEmbedding as searchByEmbeddingDB } from '~/shared/database/search-operations.js';
import type { KnowledgeGraphConfig } from '~/shared/types/config.js';
import type { Concept, Triple } from '~/shared/types/core.js';
import type { SearchOptions, SearchResult } from '~/shared/types/search.js';
import type { Result } from '~/shared/types/services.js';

/**
 * Generate temporal metadata from search results
 */
function generateTemporalMetadata(triples: Triple[]): SearchResult['temporal'] {
	const triplesWithDates = triples.filter(t => t.source_date);

	if (triplesWithDates.length === 0) {
		return undefined;
	}

	const dates = triplesWithDates.map(t => new Date(t.source_date as string));
	const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
	const latest = new Date(Math.max(...dates.map(d => d.getTime())));

	// Simple temporal clustering by month
	const clusters = new Map<string, number>();
	triplesWithDates.forEach(triple => {
		const date = new Date(triple.source_date!);
		const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
		clusters.set(monthKey, (clusters.get(monthKey) || 0) + 1);
	});

	return {
		dateRange: {
			earliest: earliest.toISOString(),
			latest: latest.toISOString(),
		},
		clusters: Array.from(clusters.entries()).map(([period, count]) => ({
			period,
			count,
			timespan: 'month',
		})),
	};
}

/**
 * Search knowledge graph by text query
 * Uses AutoSchemaKG multi-index fusion search strategy
 */
export async function searchByText(
	query: string,
	config: KnowledgeGraphConfig,
	options?: SearchOptions
): Promise<Result<SearchResult>> {
	try {
		const topK = options?.limit || config.search?.topK || 10;
		const minScore = options?.threshold || config.search?.minScore || 0.7;

		console.log(`[FUSION SEARCH DEBUG] Starting multi-index fusion search for: "${query}"`);
		console.log(`[FUSION SEARCH DEBUG] topK=${topK}, minScore=${minScore}`);

		// Use AutoSchemaKG multi-index fusion search strategy
		const fusionResult = await searchFusion(query, {
			...options,
			weights: {
				entity: 0.25, // Entity-based search
				relationship: 0.2, // Relationship-based search
				semantic: 0.35, // Vector similarity search (highest weight)
				concept: 0.2, // Concept-based search
			},
			enabledSearchTypes: ['entity', 'relationship', 'semantic', 'concept'],
		});

		if (!fusionResult.success) {
			console.log(`[FUSION SEARCH DEBUG] Fusion search failed:`, fusionResult.error);
			return fusionResult;
		}

		console.log(`[FUSION SEARCH DEBUG] Fusion search found ${fusionResult.data.length} results`);

		// Convert fusion results to SearchResult format
		const searchTriples = fusionResult.data.map(fusionTriple => ({
			triple: fusionTriple.triple,
			score: fusionTriple.scores.fusion,
			searchType: 'fusion' as const,
		}));

		console.log(
			`[FUSION SEARCH DEBUG] Fusion search completed: ${searchTriples.length} triples found`
		);
		if (searchTriples.length === 0) {
			console.log(
				`[FUSION SEARCH DEBUG] No triples found - concepts were already used within fusion search for triple discovery`
			);
		}

		// Generate temporal metadata from triples
		const temporal = generateTemporalMetadata(searchTriples.map(st => st.triple));

		const searchResult: SearchResult = {
			triples: searchTriples,
			concepts: [], // Concepts are used within fusion search, not returned separately
			temporal,
		};

		console.log(
			`[FUSION SEARCH DEBUG] Final result: ${searchResult.triples.length} triples (concepts used for triple discovery within fusion search)`
		);

		return {
			success: true,
			data: searchResult,
		};
	} catch (error) {
		console.error(`[FUSION SEARCH DEBUG] Search failed:`, error);
		return {
			success: false,
			error: {
				type: 'SEARCH_ERROR',
				message: 'Failed to search by text',
				cause: error,
			},
		};
	}
}

/**
 * Search knowledge graph by embedding vector
 */
export async function searchByEmbedding(
	embedding: number[],
	config: KnowledgeGraphConfig,
	options?: SearchOptions
): Promise<Result<SearchResult>> {
	try {
		const topK = options?.limit || config.search?.topK || 10;
		const minScore = options?.threshold || config.search?.minScore || 0.7;

		console.log(`[SEARCH DEBUG] Searching with topK=${topK}, minScore=${minScore}`);

		// Search triples by embedding with optional temporal filtering
		const tripleResults = await searchByEmbeddingDB(embedding, topK, minScore, options);
		if (!tripleResults.success) {
			console.log(`[SEARCH DEBUG] Triple search failed:`, tripleResults.error);
			return tripleResults;
		}

		console.log(`[SEARCH DEBUG] Found ${tripleResults.data.length} triples`);

		// Search concepts by embedding (only if triples search was successful)
		let conceptResults: Result<Concept[]> | undefined;
		if (tripleResults.data.length === 0) {
			console.log(`[SEARCH DEBUG] No triples found, searching concepts`);
			// If no triples found, search concepts using the embedding
			conceptResults = await searchConceptsByEmbeddingDB(
				embedding,
				Math.min(topK, 10), // Limit concepts to reasonable number
				minScore
			);
			// Fallback to text-based concept search if embedding search not available
			if (!conceptResults) {
				console.log(`[SEARCH DEBUG] Falling back to text-based concept search`);
				conceptResults = await searchConceptsDB('', undefined);
			} else {
				console.log(
					`[SEARCH DEBUG] Found ${conceptResults.success ? conceptResults.data.length : 0} concepts via embedding`
				);
			}
		} else {
			console.log(`[SEARCH DEBUG] Found triples, skipping concept search to prioritize triples`);
			// If triples found, return empty concepts to prioritize triples
			conceptResults = { success: true, data: [] };
		}

		if (!conceptResults || !conceptResults.success) {
			console.log(`[SEARCH DEBUG] Concept search failed:`, conceptResults?.error);
			return {
				success: false,
				error: conceptResults?.error || {
					type: 'SEARCH_ERROR',
					message: 'Concept search failed',
				},
			};
		}

		// Generate temporal metadata if triples have conversation dates
		const temporal = generateTemporalMetadata(tripleResults.data);

		// Format results
		const searchResult: SearchResult = {
			triples: tripleResults.data.map((triple: any) => ({
				triple,
				score: triple._similarity || 0.0, // Use actual similarity from vector search
				searchType: 'semantic' as const,
			})),
			concepts: conceptResults.data.map((concept: any) => ({
				concept,
				score: concept._similarity || 0.0, // Use actual similarity from concept search
			})),
			temporal,
		};

		return {
			success: true,
			data: searchResult,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'SEARCH_ERROR',
				message: 'Failed to search by embedding',
				cause: error,
			},
		};
	}
}

/**
 * Search concepts by text
 */
export async function searchConcepts(
	query: string,
	abstraction?: string
): Promise<Result<Concept[]>> {
	try {
		const result = await searchConceptsDB(query, abstraction);
		return result;
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'SEARCH_ERROR',
				message: 'Failed to search concepts',
				cause: error,
			},
		};
	}
}

// Export fusion search functions
export { searchFusion, type FusionSearchResult, type FusionSearchWeights };

// Export individual search type functions
export {
	fusionSearchByEntity as searchByEntity,
	fusionSearchByRelationship as searchByRelationship,
	fusionSearchBySemantic as searchBySemantic,
	fusionSearchByConcept as searchByConcept,
};
