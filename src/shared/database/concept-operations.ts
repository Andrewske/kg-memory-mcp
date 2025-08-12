import type { ConceptualizationRelationship, KnowledgeTriple } from '@prisma/client';
import { db } from '~/shared/database/client.js';
import {
	convertEmbeddingToVector,
	generateConceptId,
	generateConceptualizationId,
} from '~/shared/database/database-utils.js';
import type { Concept } from '~/shared/types/core.js';
import type { Result } from '~/shared/types/services.js';
import { createContext, logError } from '~/shared/utils/debug-logger.js';

/**
 * Store concept nodes in the database
 */
export async function createConcepts(concepts: Concept[]): Promise<Result<void>> {
	try {
		const prismaConcepts = concepts.map(concept => ({
			id: generateConceptId(concept),
			concept: concept.concept,
			abstraction_level: concept.abstraction_level,
			confidence: concept.confidence,
			source: concept.source,
			source_type: concept.source_type,
			extracted_at: new Date(concept.extracted_at),
		}));

		await db.conceptNode.createMany({
			data: prismaConcepts,
			skipDuplicates: true,
		});

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to store concepts',
				cause: error,
			},
		};
	}
}

/**
 * Search concepts by text query
 */
export async function searchConcepts(
	query: string,
	abstraction?: string
): Promise<Result<Concept[]>> {
	try {
		const where: any = {
			concept: { contains: query, mode: 'insensitive' },
		};

		if (abstraction) {
			where.abstraction_level = abstraction as any;
		}

		const concepts = await db.conceptNode.findMany({
			where,
			take: 50,
		});

		return {
			success: true,
			data: concepts,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search concepts',
				cause: error,
			},
		};
	}
}

/**
 * Search concepts by embedding vector similarity
 */
export async function searchConceptsByEmbedding(
	embedding: number[],
	topK: number,
	minScore: number
): Promise<Result<Concept[]>> {
	try {
		// Convert embedding to pgvector format
		const vectorString = convertEmbeddingToVector(embedding);

		// Perform vector similarity search using unified VectorEmbedding table
		const query = `
			SELECT DISTINCT cn.*, 
				   (ve.embedding <-> $1::vector) as distance,
				   (1 - (ve.embedding <-> $1::vector)) as similarity
			FROM concept_nodes cn
			JOIN vector_embeddings ve ON cn.id = ve.concept_node_id
			WHERE ve.vector_type = 'CONCEPT'
				AND (1 - (ve.embedding <-> $1::vector)) >= $3
			ORDER BY ve.embedding <-> $1::vector ASC
			LIMIT $2
		`;

		const results = await db.$queryRawUnsafe(query, vectorString, topK, minScore);

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
		const context = createContext('CONCEPT_OPERATIONS', 'search_concepts_by_embedding', {
			topK,
			minScore,
		});
		logError(context, error instanceof Error ? error : new Error(String(error)), {
			operation: 'concept_embedding_search',
		});
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to search concepts by embedding',
				cause: error,
			},
		};
	}
}

/**
 * Get concepts by their IDs
 */
export async function getConceptsByIds(ids: string[]): Promise<Concept[]> {
	try {
		const concepts = await db.conceptNode.findMany({
			where: { id: { in: ids } },
		});
		return concepts;
	} catch (error) {
		const context = createContext('CONCEPT_OPERATIONS', 'get_concepts_by_ids', {
			idCount: ids.length,
		});
		logError(context, error instanceof Error ? error : new Error(String(error)), {
			operation: 'get_concepts_by_ids',
		});
		return [];
	}
}

/**
 * Store conceptualization relationships
 */
export async function createConceptualizations(
	relationships: Pick<
		ConceptualizationRelationship,
		| 'source_element'
		| 'triple_type'
		| 'concept'
		| 'confidence'
		| 'context_triples'
		| 'source'
		| 'source_type'
		| 'extracted_at'
	>[]
): Promise<Result<void>> {
	try {
		const prismaRelationships = relationships.map(rel => ({
			id: generateConceptualizationId(rel),
			source_element: rel.source_element,
			triple_type: rel.triple_type,
			concept: rel.concept,
			confidence: rel.confidence,
			context_triples: rel.context_triples || [],
			source: rel.source,
			source_type: rel.source_type,
			extracted_at: new Date(rel.extracted_at),
		}));

		await db.conceptualizationRelationship.createMany({
			data: prismaRelationships,
			skipDuplicates: true,
		});

		return { success: true, data: undefined };
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'DATABASE_ERROR',
				message: 'Failed to store conceptualizations',
				cause: error,
			},
		};
	}
}

/**
 * Get conceptualization relationships by concept
 */
export async function getConceptualizationsByConcept(
	concept: string
): Promise<ConceptualizationRelationship[]> {
	try {
		const relationships = await db.conceptualizationRelationship.findMany({
			where: { concept },
		});

		return relationships;
	} catch (error) {
		const context = createContext('CONCEPT_OPERATIONS', 'get_conceptualizations_by_concept', {
			concept,
		});
		logError(context, error instanceof Error ? error : new Error(String(error)), {
			operation: 'get_conceptualizations_by_concept',
		});
		return [];
	}
}

/**
 * Get triples associated with a concept through conceptualization relationships
 */
export async function getTriplesByConceptualization(concept: string): Promise<KnowledgeTriple[]> {
	try {
		// Get all elements that map to this concept
		const conceptualizations = await db.conceptualizationRelationship.findMany({
			where: { concept },
		});

		const elements = conceptualizations.map(rel => rel.source_element);

		// Find triples that contain any of these elements
		const triples = await db.knowledgeTriple.findMany({
			where: {
				OR: [
					{ subject: { in: elements } },
					{ object: { in: elements } },
					{ predicate: { in: elements } },
				],
			},
		});

		return triples;
	} catch (error) {
		const context = createContext('CONCEPT_OPERATIONS', 'get_triples_by_conceptualization', {
			concept,
		});
		logError(context, error instanceof Error ? error : new Error(String(error)), {
			operation: 'get_triples_by_conceptualization',
		});
		return [];
	}
}
