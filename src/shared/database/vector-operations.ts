import { db } from '~/shared/database/client.js';
import {
	buildVectorSearchParams,
	convertEmbeddingToVector,
	validateEmbeddingDimensions,
} from '~/shared/database/database-utils.js';
import type { Triple } from '~/shared/types/core.js';
import type { SearchOptions } from '~/shared/types/search.js';
import type { Result } from '~/shared/types/services.js';
import { createContext, log } from '~/shared/utils/debug-logger.js';

/**
 * Search triples by entity vector similarity
 */
export async function searchByEntityVector(
	embedding: number[],
	topK: number,
	minScore: number,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	try {
		const searchContext = createContext('DATABASE_VECTOR', 'search_by_entity_vector', {
			topK,
			minScore,
			embeddingLength: embedding.length,
		});

		log('DEBUG', searchContext, 'Starting entity vector search', {
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

		// Perform entity vector similarity search
		// This searches by entity similarity using entity vectors
		const query = `
			SELECT DISTINCT kt.*, 
				   (ev.embedding <-> $1::vector) as distance,
				   (1 - (ev.embedding <-> $1::vector)) as similarity
			FROM knowledge_triples kt
			JOIN vector_embeddings ev ON kt.id = ev.knowledge_triple_id
			WHERE ev.vector_type = 'ENTITY'
				AND ${whereClause}
				AND (1 - (ev.embedding <-> $1::vector)) >= $3
			ORDER BY ev.embedding <-> $1::vector ASC
			LIMIT $2
		`;

		console.log(`[DB DEBUG] Executing entity vector query: ${query.slice(0, 200)}...`);
		console.log(`[DB DEBUG] Query params: ${params.slice(1)}`); // Skip the long embedding

		const results = await db.$queryRawUnsafe(query, ...params);

		console.log(
			`[DB DEBUG] Entity vector query returned ${Array.isArray(results) ? results.length : 'non-array'} results`
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
		console.error('Entity vector search error:', error);
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search by entity vector',
				cause: error,
			},
		};
	}
}

/**
 * Search triples by relationship vector similarity
 */
export async function searchByRelationshipVector(
	embedding: number[],
	topK: number,
	minScore: number,
	options?: SearchOptions
): Promise<Result<Triple[]>> {
	try {
		console.log(
			`[DB DEBUG] searchByRelationshipVector: topK=${topK}, minScore=${minScore}, embedding length=${embedding.length}`
		);

		// Build filter conditions for joins using utility
		const { whereClause, params } = buildVectorSearchParams(embedding, topK, minScore, {
			temporal: options?.temporal,
			sources: options?.sources,
			types: options?.types ? [options.types] : undefined,
		});

		// Perform relationship vector similarity search
		// This searches by relationship similarity using relationship vectors
		const query = `
			SELECT DISTINCT kt.*, 
				   (rv.embedding <-> $1::vector) as distance,
				   (1 - (rv.embedding <-> $1::vector)) as similarity
			FROM knowledge_triples kt
			JOIN vector_embeddings rv ON kt.id = rv.knowledge_triple_id
			WHERE rv.vector_type = 'RELATIONSHIP'
				AND ${whereClause}
				AND (1 - (rv.embedding <-> $1::vector)) >= $3
			ORDER BY rv.embedding <-> $1::vector ASC
			LIMIT $2
		`;

		console.log(`[DB DEBUG] Executing relationship vector query: ${query.slice(0, 200)}...`);
		console.log(`[DB DEBUG] Query params: ${params.slice(1)}`); // Skip the long embedding

		const results = await db.$queryRawUnsafe(query, ...params);

		console.log(
			`[DB DEBUG] Relationship vector query returned ${Array.isArray(results) ? results.length : 'non-array'} results`
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
		console.error('Relationship vector search error:', error);
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search by relationship vector',
				cause: error,
			},
		};
	}
}

/**
 * Store vectors in the database using the unified VectorEmbedding table
 */
export async function createVectors(vectors: {
	entity?: Array<{
		vector_id: string;
		text: string;
		embedding: number[];
		entity_name: string;
		knowledge_triple_id: string;
	}>;
	relationship?: Array<{
		vector_id: string;
		text: string;
		embedding: number[];
		knowledge_triple_id: string;
	}>;
	semantic?: Array<{
		vector_id: string;
		text: string;
		embedding: number[];
		knowledge_triple_id: string;
	}>;
	concept?: Array<{
		vector_id: string;
		text: string;
		embedding: number[];
		concept_node_id: string;
	}>;
}): Promise<Result<void>> {
	try {
		// Validate embedding dimensions before attempting storage
		for (const [vectorType, vectorArray] of Object.entries(vectors)) {
			if (!vectorArray || vectorArray.length === 0) continue;

			for (const vector of vectorArray) {
				if (!validateEmbeddingDimensions(vector.embedding)) {
					const expectedDimensions = 1536; // Based on text-embedding-3-small model
					console.warn(
						`[VECTOR STORAGE] Dimension mismatch in ${vectorType} vector: expected ${expectedDimensions}, got ${vector.embedding.length}`
					);
					return {
						success: false,
						error: {
							type: 'VECTOR_DIMENSION_ERROR',
							message: `Invalid embedding dimensions: expected ${expectedDimensions}, got ${vector.embedding.length} for ${vectorType} vector`,
						},
					};
				}
			}
		}

		const allVectors: any[] = [];

		// Prepare entity vectors
		if (vectors.entity && vectors.entity.length > 0) {
			vectors.entity.forEach(v => {
				allVectors.push({
					id: v.vector_id,
					vector_id: v.vector_id,
					text: v.text,
					embedding: convertEmbeddingToVector(v.embedding),
					vector_type: 'ENTITY',
					entity_name: v.entity_name,
					knowledge_triple_id: v.knowledge_triple_id,
					concept_node_id: null,
				});
			});
		}

		// Prepare relationship vectors
		if (vectors.relationship && vectors.relationship.length > 0) {
			vectors.relationship.forEach(v => {
				allVectors.push({
					id: v.vector_id,
					vector_id: v.vector_id,
					text: v.text,
					embedding: convertEmbeddingToVector(v.embedding),
					vector_type: 'RELATIONSHIP',
					entity_name: null,
					knowledge_triple_id: v.knowledge_triple_id,
					concept_node_id: null,
				});
			});
		}

		// Prepare semantic vectors
		if (vectors.semantic && vectors.semantic.length > 0) {
			vectors.semantic.forEach(v => {
				allVectors.push({
					id: v.vector_id,
					vector_id: v.vector_id,
					text: v.text,
					embedding: convertEmbeddingToVector(v.embedding),
					vector_type: 'SEMANTIC',
					entity_name: null,
					knowledge_triple_id: v.knowledge_triple_id,
					concept_node_id: null,
				});
			});
		}

		// Prepare concept vectors
		if (vectors.concept && vectors.concept.length > 0) {
			vectors.concept.forEach(v => {
				allVectors.push({
					id: v.vector_id,
					vector_id: v.vector_id,
					text: v.text,
					embedding: convertEmbeddingToVector(v.embedding),
					vector_type: 'CONCEPT',
					entity_name: null,
					knowledge_triple_id: null,
					concept_node_id: v.concept_node_id,
				});
			});
		}

		const storageContext = createContext('DATABASE_VECTOR', 'store_vectors', {
			vectorCount: allVectors.length,
		});

		log('INFO', storageContext, 'Storing vectors in unified table', {
			count: allVectors.length,
		});

		if (allVectors.length > 0) {
			// Build the VALUES clause for bulk insert
			const values = allVectors
				.map((_v, i) => {
					const base = i * 8;
					return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, NOW(), NOW())`;
				})
				.join(', ');

			// Execute bulk insert into unified vector_embeddings table
			await db.$executeRawUnsafe(
				`
				INSERT INTO vector_embeddings (
					id, vector_id, text, embedding, vector_type, 
					entity_name, knowledge_triple_id, concept_node_id,
					created_at, updated_at
				)
				VALUES ${values}
				ON CONFLICT (vector_id) DO UPDATE SET
					text = EXCLUDED.text,
					embedding = EXCLUDED.embedding,
					vector_type = EXCLUDED.vector_type,
					entity_name = EXCLUDED.entity_name,
					knowledge_triple_id = EXCLUDED.knowledge_triple_id,
					concept_node_id = EXCLUDED.concept_node_id,
					updated_at = NOW()
				`,
				...allVectors.flatMap(v => [
					v.id,
					v.vector_id,
					v.text,
					v.embedding,
					v.vector_type,
					v.entity_name,
					v.knowledge_triple_id,
					v.concept_node_id,
				])
			);
		}

		return { success: true, data: undefined };
	} catch (error) {
		console.error('Error storing vectors:', error);
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to store vectors',
				cause: error,
			},
		};
	}
}
