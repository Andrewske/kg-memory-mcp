import type { KnowledgeTriple, Result, SearchOptions } from '~/shared/types/index.js';
import { db } from './client.js';
import {
	buildTemporalFilter,
	buildVectorSearchParams,
	convertTripleTypesForFilter,
	mapPrismaTriple,
	unmapTripleType,
} from './database-utils.js';

/**
 * Search triples by text content
 */
export async function searchByText(query: string, searchType: string): Promise<Result<KnowledgeTriple[]>> {
	try {
		// Simple text search - in real implementation, this would use full-text search
		const triples = await db.knowledgeTriple.findMany({
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
			data: triples.map(mapPrismaTriple),
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
): Promise<Result<KnowledgeTriple[]>> {
	try {
		console.log(
			`[DB DEBUG] searchByEmbedding: topK=${topK}, minScore=${minScore}, embedding length=${embedding.length}`
		);

		// Build filter conditions for joins using utility
		const { whereClause, params } = buildVectorSearchParams(embedding, topK, minScore, {
			temporal: options?.temporal,
			sources: options?.sources,
			types: options?.types,
		});

		// Perform vector similarity search using semantic vectors
		// This searches by the semantic meaning of complete triples
		const query = `
			SELECT DISTINCT kt.*, 
				   (sv.embedding <-> $1::vector) as distance,
				   (1 - (sv.embedding <-> $1::vector)) as similarity
			FROM knowledge_triples kt
			JOIN semantic_vectors sv ON kt.id = sv.knowledge_triple_id
			WHERE ${whereClause}
				AND (1 - (sv.embedding <-> $1::vector)) >= $3
			ORDER BY sv.embedding <-> $1::vector ASC
			LIMIT $2
		`;

		console.log(`[DB DEBUG] Executing semantic vector query: ${query.slice(0, 200)}...`);
		console.log(`[DB DEBUG] Query params: ${params.slice(1)}`); // Skip the long embedding

		const results = await db.$queryRawUnsafe(query, ...params);

		console.log(
			`[DB DEBUG] Semantic vector query returned ${Array.isArray(results) ? results.length : 'non-array'} results`
		);

		if (!Array.isArray(results)) {
			return {
				success: true,
				data: [],
			};
		}

		// Map results to KnowledgeTriple format
		const triples = results.map((row: any) => ({
			subject: row.subject,
			predicate: row.predicate,
			object: row.object,
			type: unmapTripleType(row.type),
			source: row.source,
			source_type: row.source_type,
			source_date: row.source_date?.toISOString(),
			extracted_at: row.extracted_at.toISOString(),
			processing_batch_id: row.processing_batch_id,
			confidence: row.confidence,
			// Add similarity score for debugging
			_similarity: row.similarity,
		}));

		return {
			success: true,
			data: triples,
		};
	} catch (error) {
		console.error('Vector search error:', error);
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
): Promise<Result<KnowledgeTriple[]>> {
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
			const enumTypes = convertTripleTypesForFilter(options.types);
			whereConditions.type = { in: enumTypes };
		}

		// Entity search: find triples where entity appears as subject or object
		whereConditions.OR = [
			{ subject: { contains: entityQuery, mode: 'insensitive' } },
			{ object: { contains: entityQuery, mode: 'insensitive' } },
		];

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
			data: triples.map(mapPrismaTriple),
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
): Promise<Result<KnowledgeTriple[]>> {
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
			const enumTypes = convertTripleTypesForFilter(options.types);
			whereConditions.type = { in: enumTypes };
		}

		// Relationship search: find triples where relationship appears in predicate
		whereConditions.predicate = {
			contains: relationshipQuery,
			mode: 'insensitive',
		};

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
			data: triples.map(mapPrismaTriple),
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
): Promise<Result<KnowledgeTriple[]>> {
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
			const enumTypes = convertTripleTypesForFilter(options.types);
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

		// Map results to KnowledgeTriple format
		const triples = results.map((row: any) => ({
			subject: row.subject,
			predicate: row.predicate,
			object: row.object,
			type: unmapTripleType(row.type),
			source: row.source,
			source_type: row.source_type,
			source_date: row.source_date?.toISOString(),
			extracted_at: row.extracted_at.toISOString(),
			processing_batch_id: row.processing_batch_id,
			confidence: row.confidence,
			// Add concept confidence for debugging
			_concept_confidence: row.concept_confidence,
		}));

		return {
			success: true,
			data: triples,
		};
	} catch (error) {
		console.error('Concept search error:', error);
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