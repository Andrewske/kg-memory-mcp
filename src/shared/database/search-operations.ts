import { db } from '~/shared/database/client.js';
import { buildTemporalFilter, buildVectorSearchParams } from '~/shared/database/database-utils.js';
import type { Triple } from '~/shared/types/core.js';
import type { SearchOptions } from '~/shared/types/search.js';
import type { Result } from '~/shared/types/services.js';
import { createContext, log, logError, logQueryResult } from '~/shared/utils/debug-logger.js';

/**
 * Search triples by text content
 */
export async function searchByText(query: string, searchType: string): Promise<Result<Triple[]>> {
	try {
		// Simple text search - in real implementation, this would use full-text search
		const results = await db.knowledgeTriple.findMany({
			where: {
				OR: [
					{ subject: { contains: query, mode: 'insensitive' } },
					{ predicate: { contains: query, mode: 'insensitive' } },
					{ object: { contains: query, mode: 'insensitive' } },
				],
			},
			take: 50,
		});

		return {
			success: true,
			data: results,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search by text',
				cause: error,
			},
		};
	}
}

/**
 * Search triples by embedding vector similarity
 */
export async function searchByEmbedding(
	embedding: number[],
	topK: number,
	minScore: number,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	try {
		const searchContext = createContext('DATABASE_SEARCH', 'search_by_embedding', {
			topK,
			minScore,
			embeddingLength: embedding.length,
			hasSearchOptions: !!options,
		});

		log('DEBUG', searchContext, 'Starting vector search', {
			topK,
			minScore,
			embeddingLength: embedding.length,
		});

		// Build filter conditions for joins using utility
		const { whereClause, params } = buildVectorSearchParams(embedding, topK, minScore, {
			temporal: options?.temporal,
			sources: options?.sources,
			types: options?.types ? [options.types] : undefined,
		});

		// Perform vector similarity search using unified VectorEmbedding table
		// This searches by the semantic meaning of complete triples
		const query = `
			SELECT DISTINCT kt.*, 
				   (ve.embedding <-> $1::vector) as distance,
				   (1 - (ve.embedding <-> $1::vector)) as similarity
			FROM knowledge_triples kt
			JOIN vector_embeddings ve ON kt.id = ve.knowledge_triple_id
			WHERE ve.vector_type = 'SEMANTIC'
				AND ${whereClause}
				AND (1 - (ve.embedding <-> $1::vector)) >= $3
			ORDER BY ve.embedding <-> $1::vector ASC
			LIMIT $2
		`;

		log('DEBUG', searchContext, 'Executing semantic vector query', {
			queryPreview: query.slice(0, 200) + '...',
			paramCount: params.length,
			paramPreview: params.slice(1).slice(0, 3), // Skip embedding, show first 3 other params
		});

		const results = await db.$queryRawUnsafe(query, ...params);

		logQueryResult(
			searchContext,
			{
				queryType: 'vector_search',
				topK,
				minScore,
				hasFilter: !!options,
			},
			Array.isArray(results) ? results : [],
			'Semantic vector query executed'
		);

		if (!Array.isArray(results)) {
			return {
				success: true,
				data: [],
			};
		}

		return {
			success: true,
			data: results,
		};
	} catch (error) {
		const errorContext = createContext('DATABASE_SEARCH', 'search_by_embedding_error', {
			topK,
			minScore,
			embeddingLength: embedding.length,
		});

		logError(errorContext, error instanceof Error ? error : new Error(String(error)));

		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search by embedding',
				cause: error,
			},
		};
	}
}

/**
 * Search triples by entity
 */
export async function searchByEntity(
	entityQuery: string,
	topK: number,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	try {
		// Build filter conditions
		const whereConditions: any = {};

		// Add temporal filtering
		const temporalFilter = buildTemporalFilter(options?.temporal);
		Object.assign(whereConditions, temporalFilter);

		// Add source filtering
		if (options?.sources && options.sources.length > 0) {
			whereConditions.source = { in: options.sources };
		}

		// Add type filtering
		if (options?.types && options.types.length > 0) {
			const enumTypes = options.types;
			whereConditions.type = { in: enumTypes };
		}

		// Entity search: find triples where entity appears as subject or object
		// Split the query into words and search for any of them
		const searchTerms = entityQuery
			.trim()
			.split(/\s+/)
			.filter(term => term.length > 0);

		if (searchTerms.length === 1) {
			// Single word search - use simple contains
			whereConditions.OR = [
				{ subject: { contains: entityQuery, mode: 'insensitive' } },
				{ object: { contains: entityQuery, mode: 'insensitive' } },
			];
		} else {
			// Multi-word search - search for any of the words
			const orConditions: any[] = [];
			for (const term of searchTerms) {
				orConditions.push(
					{ subject: { contains: term, mode: 'insensitive' } },
					{ object: { contains: term, mode: 'insensitive' } }
				);
			}
			whereConditions.OR = orConditions;
		}

		const triples = await db.knowledgeTriple.findMany({
			where: whereConditions,
			take: topK,
			orderBy: [
				// Exact matches first
				{ subject: entityQuery === undefined ? 'asc' : 'desc' },
				{ object: entityQuery === undefined ? 'asc' : 'desc' },
				// Then by recency
				{ created_at: 'desc' },
			],
		});

		return {
			success: true,
			data: triples,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search by entity',
				cause: error,
			},
		};
	}
}

/**
 * Search triples by relationship
 */
export async function searchByRelationship(
	relationshipQuery: string,
	topK: number,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	try {
		// Build filter conditions
		const whereConditions: any = {};

		// Add temporal filtering
		const temporalFilter = buildTemporalFilter(options?.temporal);
		Object.assign(whereConditions, temporalFilter);

		// Add source filtering
		if (options?.sources && options.sources.length > 0) {
			whereConditions.source = { in: options.sources };
		}

		// Add type filtering
		if (options?.types && options.types.length > 0) {
			const enumTypes = options.types;
			whereConditions.type = { in: enumTypes };
		}

		// Relationship search: find triples where relationship appears in predicate
		// Split the query into words and search for any of them
		const searchTerms = relationshipQuery
			.trim()
			.split(/\s+/)
			.filter(term => term.length > 0);

		if (searchTerms.length === 1) {
			// Single word search - use simple contains
			whereConditions.predicate = {
				contains: relationshipQuery,
				mode: 'insensitive',
			};
		} else {
			// Multi-word search - search for any of the words in predicate
			const orConditions: any[] = [];
			for (const term of searchTerms) {
				orConditions.push({
					predicate: { contains: term, mode: 'insensitive' },
				});
			}
			whereConditions.OR = orConditions;
		}

		const triples = await db.knowledgeTriple.findMany({
			where: whereConditions,
			take: topK,
			orderBy: [
				// Exact matches first
				{ predicate: relationshipQuery === undefined ? 'asc' : 'desc' },
				// Then by recency
				{ created_at: 'desc' },
			],
		});

		return {
			success: true,
			data: triples,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search by relationship',
				cause: error,
			},
		};
	}
}

/**
 * Search triples by concept
 */
export async function searchByConcept(
	conceptQuery: string,
	topK: number,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	try {
		// Build filter conditions for joins
		let whereClause = '1=1';
		const params: any[] = [conceptQuery, topK];
		let paramIndex = 2;

		// Add temporal filtering
		const temporalFilter = buildTemporalFilter(options?.temporal);
		if (temporalFilter.source_date) {
			if (temporalFilter.source_date.gte) {
				whereClause += ` AND kt.source_date >= $${++paramIndex}`;
				params.push(temporalFilter.source_date.gte);
			}
			if (temporalFilter.source_date.lte) {
				whereClause += ` AND kt.source_date <= $${++paramIndex}`;
				params.push(temporalFilter.source_date.lte);
			}
		}

		// Add source filtering
		if (options?.sources && options.sources.length > 0) {
			whereClause += ` AND kt.source = ANY($${++paramIndex})`;
			params.push(options.sources);
		}

		// Add type filtering
		if (options?.types && options.types.length > 0) {
			const enumTypes = options.types;
			whereClause += ` AND kt.type = ANY($${++paramIndex})`;
			params.push(enumTypes);
		}

		// Concept search: find triples connected to concepts via conceptualization relationships
		const query = `
			SELECT DISTINCT kt.*, cr.confidence as concept_confidence
			FROM knowledge_triples kt
			JOIN conceptualization_relationships cr ON (
				kt.subject = cr.source_element OR 
				kt.object = cr.source_element OR 
				kt.predicate = cr.source_element
			)
			WHERE ${whereClause}
				AND cr.concept ILIKE '%' || $1 || '%'
			ORDER BY cr.confidence DESC, kt.created_at DESC
			LIMIT $2
		`;

		const results = await db.$queryRawUnsafe(query, ...params);

		if (!Array.isArray(results)) {
			return {
				success: true,
				data: [],
			};
		}

		return {
			success: true,
			data: results,
		};
	} catch (error) {
		const errorContext = createContext('DATABASE_SEARCH', 'search_concepts_error', {
			searchQuery: conceptQuery,
			hasTopK: !!topK,
		});

		logError(errorContext, error instanceof Error ? error : new Error(String(error)));

		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search by concept',
				cause: error,
			},
		};
	}
}
