import type { EntityType } from '~/shared/types/core.js';
import type {
	ConceptNode,
	ConceptualizationRelationship,
	KnowledgeTriple,
	Result,
} from '~/shared/types/index.js';
import { db } from './client.js';
import {
	convertEmbeddingToVector,
	generateConceptId,
	generateConceptualizationId,
	mapAbstractionLevel,
	mapEntityType,
	mapPrismaConcept,
	mapPrismaConceptualization,
	mapPrismaTriple,
	unmapAbstractionLevel,
} from './database-utils.js';

/**
 * Store concept nodes in the database
 */
export async function storeConcepts(concepts: ConceptNode[]): Promise<Result<void>> {
	try {
		const prismaConcepts = concepts.map(concept => ({
			id: generateConceptId(concept),
			concept: concept.concept,
			abstraction_level: mapAbstractionLevel(concept.abstraction_level),
			confidence: concept.confidence,
			source: concept.source,
			source_type: concept.source_type,
			extracted_at: new Date(concept.extracted_at),
			processing_batch_id: concept.processing_batch_id,
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
export async function searchConcepts(query: string, abstraction?: string): Promise<Result<ConceptNode[]>> {
	try {
		const where: any = {
			concept: { contains: query, mode: 'insensitive' },
		};

		if (abstraction) {
			where.abstraction_level = mapAbstractionLevel(abstraction as any);
		}

		const concepts = await db.conceptNode.findMany({
			where,
			take: 50,
		});

		return {
			success: true,
			data: concepts.map(mapPrismaConcept),
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
): Promise<Result<ConceptNode[]>> {
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

		// Map results to ConceptNode format
		const concepts = results.map((row: any) => ({
			concept: row.concept,
			abstraction_level: unmapAbstractionLevel(row.abstraction_level),
			confidence: row.confidence,
			source: row.source,
			source_type: row.source_type,
			extracted_at: row.extracted_at.toISOString(),
			processing_batch_id: row.processing_batch_id,
			// Add similarity score for debugging
			_similarity: row.similarity,
		}));

		return {
			success: true,
			data: concepts,
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
export async function getConceptsByIds(ids: string[]): Promise<ConceptNode[]> {
	try {
		const concepts = await db.conceptNode.findMany({
			where: { id: { in: ids } },
		});
		return concepts.map(mapPrismaConcept);
	} catch (error) {
		console.error('Error getting concepts by IDs:', error);
		return [];
	}
}

/**
 * Store conceptualization relationships
 */
export async function storeConceptualizations(
	relationships: ConceptualizationRelationship[]
): Promise<Result<void>> {
	try {
		const prismaRelationships = relationships.map(rel => ({
			id: generateConceptualizationId(rel),
			source_element: rel.source_element,
			entity_type: mapEntityType(rel.entity_type as EntityType),
			concept: rel.concept,
			confidence: rel.confidence,
			context_triples: rel.context_triples || [],
			source: rel.source,
			source_type: rel.source_type,
			extracted_at: new Date(rel.extracted_at),
			processing_batch_id: rel.processing_batch_id,
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
 * Get conceptualization relationships by source element
 */
export async function getConceptualizationsByElement(
	element: string,
	entityType?: EntityType
): Promise<ConceptualizationRelationship[]> {
	try {
		const where: any = { source_element: element };
		if (entityType) {
			where.entity_type = entityType;
		}

		const relationships = await db.conceptualizationRelationship.findMany({
			where,
		});

		return relationships.map(mapPrismaConceptualization);
	} catch (error) {
		console.error('Error getting conceptualizations by element:', error);
		return [];
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

		return relationships.map(mapPrismaConceptualization);
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

		return triples.map(mapPrismaTriple);
	} catch (error) {
		console.error('Error getting triples by conceptualization:', error);
		return [];
	}
}