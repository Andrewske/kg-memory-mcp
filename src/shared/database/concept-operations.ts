import type { ConceptualizationRelationship, KnowledgeTriple } from '@prisma/client';
import { db } from '~/shared/database/client.js';
import {
	convertEmbeddingToVector,
	generateConceptId,
	generateConceptualizationId,
} from '~/shared/database/database-utils.js';
import type { Concept } from '~/shared/types/core.js';
import type { Result } from '~/shared/types/services.js';

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

		// Perform vector similarity search using concept vectors
		const query = `
			SELECT DISTINCT cn.*, 
				   (cv.embedding <-> $1::vector) as distance,
				   (1 - (cv.embedding <-> $1::vector)) as similarity
			FROM concept_nodes cn
			JOIN concept_vectors cv ON cn.id = cv.concept_node_id
			WHERE (1 - (cv.embedding <-> $1::vector)) >= $3
			ORDER BY cv.embedding <-> $1::vector ASC
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
		console.error('Concept embedding search error:', error);
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
		console.error('Error getting concepts by IDs:', error);
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
		console.error('Error getting conceptualizations by concept:', error);
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
		console.error('Error getting triples by conceptualization:', error);
		return [];
	}
}
