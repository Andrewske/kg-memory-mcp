import type { Result, SearchOptions } from '~/shared/types';
import type { Triple } from '~/shared/types/core';
import { db } from './client';
import {
	buildVectorSearchParams,
	convertEmbeddingToVector,
	validateEmbeddingDimensions,
} from './database-utils';

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
		console.log(
			`[DB DEBUG] searchByEntityVector: topK=${topK}, minScore=${minScore}, embedding length=${embedding.length}`
		);

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
			JOIN entity_vectors ev ON kt.id = ev.knowledge_triple_id
			WHERE ${whereClause}
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
			JOIN relationship_vectors rv ON kt.id = rv.knowledge_triple_id
			WHERE ${whereClause}
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
 * Store vectors in the database
 */
export async function storeVectors(vectors: {
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

		const operations: Promise<any>[] = [];
		console.log(`[VECTOR STORAGE] Starting storage of vectors:`, {
			entity: vectors.entity?.length || 0,
			relationship: vectors.relationship?.length || 0,
			semantic: vectors.semantic?.length || 0,
			concept: vectors.concept?.length || 0,
		});

		// Store entity vectors
		if (vectors.entity && vectors.entity.length > 0) {
			const entityVectors = vectors.entity.map(v => ({
				id: v.vector_id,
				vector_id: v.vector_id,
				text: v.text,
				embedding: convertEmbeddingToVector(v.embedding),
				entity_name: v.entity_name,
				knowledge_triple_id: v.knowledge_triple_id,
			}));

			operations.push(
				db.$executeRawUnsafe(
					`
					INSERT INTO entity_vectors (id, vector_id, text, embedding, entity_name, knowledge_triple_id, created_at, updated_at)
					VALUES ${entityVectors.map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}::vector, $${i * 6 + 5}, $${i * 6 + 6}, NOW(), NOW())`).join(', ')}
					ON CONFLICT (vector_id) DO UPDATE SET
						text = EXCLUDED.text,
						embedding = EXCLUDED.embedding,
						entity_name = EXCLUDED.entity_name,
						knowledge_triple_id = EXCLUDED.knowledge_triple_id,
						updated_at = NOW()
				`,
					...entityVectors.flatMap(v => [
						v.id,
						v.vector_id,
						v.text,
						v.embedding,
						v.entity_name,
						v.knowledge_triple_id,
					])
				)
			);
		}

		// Store relationship vectors
		if (vectors.relationship && vectors.relationship.length > 0) {
			const relationshipVectors = vectors.relationship.map(v => ({
				id: v.vector_id,
				vector_id: v.vector_id,
				text: v.text,
				embedding: convertEmbeddingToVector(v.embedding),
				knowledge_triple_id: v.knowledge_triple_id,
			}));

			operations.push(
				db.$executeRawUnsafe(
					`
					INSERT INTO relationship_vectors (id, vector_id, text, embedding, knowledge_triple_id, created_at, updated_at)
					VALUES ${relationshipVectors.map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}::vector, $${i * 5 + 5}, NOW(), NOW())`).join(', ')}
					ON CONFLICT (vector_id) DO UPDATE SET
						text = EXCLUDED.text,
						embedding = EXCLUDED.embedding,
						knowledge_triple_id = EXCLUDED.knowledge_triple_id,
						updated_at = NOW()
				`,
					...relationshipVectors.flatMap(v => [
						v.id,
						v.vector_id,
						v.text,
						v.embedding,
						v.knowledge_triple_id,
					])
				)
			);
		}

		// Store semantic vectors
		if (vectors.semantic && vectors.semantic.length > 0) {
			const semanticVectors = vectors.semantic.map(v => ({
				id: v.vector_id,
				vector_id: v.vector_id,
				text: v.text,
				embedding: convertEmbeddingToVector(v.embedding),
				knowledge_triple_id: v.knowledge_triple_id,
			}));

			operations.push(
				db.$executeRawUnsafe(
					`
					INSERT INTO semantic_vectors (id, vector_id, text, embedding, knowledge_triple_id, created_at, updated_at)
					VALUES ${semanticVectors.map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}::vector, $${i * 5 + 5}, NOW(), NOW())`).join(', ')}
					ON CONFLICT (vector_id) DO UPDATE SET
						text = EXCLUDED.text,
						embedding = EXCLUDED.embedding,
						knowledge_triple_id = EXCLUDED.knowledge_triple_id,
						updated_at = NOW()
				`,
					...semanticVectors.flatMap(v => [
						v.id,
						v.vector_id,
						v.text,
						v.embedding,
						v.knowledge_triple_id,
					])
				)
			);
		}

		// Store concept vectors
		if (vectors.concept && vectors.concept.length > 0) {
			const conceptVectors = vectors.concept.map(v => ({
				id: v.vector_id,
				vector_id: v.vector_id,
				text: v.text,
				embedding: convertEmbeddingToVector(v.embedding),
				concept_node_id: v.concept_node_id,
			}));

			operations.push(
				db.$executeRawUnsafe(
					`
					INSERT INTO concept_vectors (id, vector_id, text, embedding, concept_node_id, created_at, updated_at)
					VALUES ${conceptVectors.map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}::vector, $${i * 5 + 5}, NOW(), NOW())`).join(', ')}
					ON CONFLICT (vector_id) DO UPDATE SET
						text = EXCLUDED.text,
						embedding = EXCLUDED.embedding,
						concept_node_id = EXCLUDED.concept_node_id,
						updated_at = NOW()
				`,
					...conceptVectors.flatMap(v => [
						v.id,
						v.vector_id,
						v.text,
						v.embedding,
						v.concept_node_id,
					])
				)
			);
		}

		// Execute all operations
		await Promise.all(operations);

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
