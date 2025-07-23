import type {
	ConceptNode,
	ConceptualizationRelationship,
	KnowledgeTriple,
	TemporalFilter,
	TripleType,
} from '~/shared/types';
import type { EntityType } from '~/shared/types/core';

/**
 * Generic ID generation utility using Base64 encoding
 * Replaces special characters to make safe for database use
 */
function generateId(key: string): string {
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}

/**
 * Generate unique ID for knowledge triple
 */
export function generateTripleId(triple: KnowledgeTriple): string {
	const key = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
	return generateId(key);
}

/**
 * Generate unique ID for concept node
 */
export function generateConceptId(concept: ConceptNode): string {
	const key = `${concept.concept}|${concept.abstraction_level}|${concept.source}`;
	return generateId(key);
}

/**
 * Generate unique ID for conceptualization relationship
 */
export function generateConceptualizationId(rel: ConceptualizationRelationship): string {
	const key = `${rel.source_element}|${rel.source_type}|${rel.concept}`;
	return generateId(key);
}

// Triple type mappings
const TRIPLE_TYPE_TO_DB = {
	'entity-entity': 'ENTITY_ENTITY' as const,
	'entity-event': 'ENTITY_EVENT' as const,
	'event-event': 'EVENT_EVENT' as const,
	'emotional-context': 'EMOTIONAL_CONTEXT' as const,
};

const DB_TO_TRIPLE_TYPE = {
	ENTITY_ENTITY: 'entity-entity' as const,
	ENTITY_EVENT: 'entity-event' as const,
	EVENT_EVENT: 'event-event' as const,
	EMOTIONAL_CONTEXT: 'emotional-context' as const,
};

/**
 * Map TypeScript triple type to database enum
 */
export function mapTripleType(
	type: TripleType
): 'ENTITY_ENTITY' | 'ENTITY_EVENT' | 'EVENT_EVENT' | 'EMOTIONAL_CONTEXT' {
	return TRIPLE_TYPE_TO_DB[type];
}

/**
 * Map database enum to TypeScript triple type
 */
export function unmapTripleType(
	type: 'ENTITY_ENTITY' | 'ENTITY_EVENT' | 'EVENT_EVENT' | 'EMOTIONAL_CONTEXT'
): TripleType {
	return DB_TO_TRIPLE_TYPE[type];
}

// Abstraction level mappings
const ABSTRACTION_TO_DB = {
	high: 'HIGH' as const,
	medium: 'MEDIUM' as const,
	low: 'LOW' as const,
};

const DB_TO_ABSTRACTION = {
	HIGH: 'high' as const,
	MEDIUM: 'medium' as const,
	LOW: 'low' as const,
};

/**
 * Map TypeScript abstraction level to database enum
 */
export function mapAbstractionLevel(level: 'high' | 'medium' | 'low'): 'HIGH' | 'MEDIUM' | 'LOW' {
	return ABSTRACTION_TO_DB[level];
}

/**
 * Map database enum to TypeScript abstraction level
 */
export function unmapAbstractionLevel(level: 'HIGH' | 'MEDIUM' | 'LOW'): 'high' | 'medium' | 'low' {
	return DB_TO_ABSTRACTION[level];
}

// Entity type mappings
const ENTITY_TYPE_TO_DB = {
	entity: 'ENTITY' as const,
	event: 'EVENT' as const,
	relation: 'RELATION' as const,
};

const DB_TO_ENTITY_TYPE = {
	ENTITY: 'entity' as const,
	EVENT: 'event' as const,
	RELATION: 'relation' as const,
};

/**
 * Map TypeScript entity type to database enum
 */
export function mapEntityType(type: EntityType): 'ENTITY' | 'EVENT' | 'RELATION' {
	return ENTITY_TYPE_TO_DB[type as keyof typeof ENTITY_TYPE_TO_DB];
}

/**
 * Map database enum to TypeScript entity type
 */
export function unmapEntityType(type: 'ENTITY' | 'EVENT' | 'RELATION'): EntityType {
	return DB_TO_ENTITY_TYPE[type];
}

/**
 * Build temporal filter conditions for Prisma queries
 */
export function buildTemporalFilter(temporal?: TemporalFilter) {
	if (!temporal) return {};

	const filter: any = {};

	// Handle direct date range
	if (temporal.fromDate || temporal.toDate) {
		filter.source_date = {};
		if (temporal.fromDate) {
			filter.source_date.gte = new Date(temporal.fromDate);
		}
		if (temporal.toDate) {
			filter.source_date.lte = new Date(temporal.toDate);
		}
	}

	// Handle time window
	if (temporal.timeWindow) {
		const fromDate =
			temporal.timeWindow.from === 'now' ? new Date() : new Date(temporal.timeWindow.from);

		const toDate = new Date(fromDate);

		// Calculate the time range based on unit
		switch (temporal.timeWindow.unit) {
			case 'days':
				fromDate.setDate(fromDate.getDate() - temporal.timeWindow.value);
				break;
			case 'weeks':
				fromDate.setDate(fromDate.getDate() - temporal.timeWindow.value * 7);
				break;
			case 'months':
				fromDate.setMonth(fromDate.getMonth() - temporal.timeWindow.value);
				break;
			case 'years':
				fromDate.setFullYear(fromDate.getFullYear() - temporal.timeWindow.value);
				break;
		}

		filter.source_date = {
			gte: fromDate,
			lte: toDate,
		};
	}

	return filter;
}

/**
 * Map Prisma triple to TypeScript type
 */
export function mapPrismaTriple(prismaTriple: any): KnowledgeTriple {
	return {
		subject: prismaTriple.subject,
		predicate: prismaTriple.predicate,
		object: prismaTriple.object,
		type: unmapTripleType(prismaTriple.type),
		source: prismaTriple.source,
		source_type: prismaTriple.source_type,
		source_date: prismaTriple.source_date?.toISOString(),
		extracted_at: prismaTriple.extracted_at.toISOString(),
		processing_batch_id: prismaTriple.processing_batch_id,
		confidence: prismaTriple.confidence,
	};
}

/**
 * Map Prisma concept to TypeScript type
 */
export function mapPrismaConcept(prismaConcept: any): ConceptNode {
	return {
		concept: prismaConcept.concept,
		abstraction_level: unmapAbstractionLevel(prismaConcept.abstraction_level),
		confidence: prismaConcept.confidence,
		source: prismaConcept.source,
		source_type: prismaConcept.source_type,
		extracted_at: prismaConcept.extracted_at.toISOString(),
		processing_batch_id: prismaConcept.processing_batch_id,
	};
}

/**
 * Map Prisma conceptualization relationship to TypeScript type
 */
export function mapPrismaConceptualization(prismaRel: any): ConceptualizationRelationship {
	return {
		source_element: prismaRel.source_element,
		entity_type: unmapEntityType(prismaRel.entity_type),
		concept: prismaRel.concept,
		confidence: prismaRel.confidence,
		context_triples: prismaRel.context_triples,
		source: prismaRel.source,
		source_type: prismaRel.source_type,
		extracted_at: prismaRel.extracted_at.toISOString(),
		processing_batch_id: prismaRel.processing_batch_id,
	};
}

/**
 * Convert triple types for database filtering
 * Handles the repetitive type conversion used in search methods
 */
export function convertTripleTypesForFilter(types: string[]): string[] {
	return types
		.map(type => {
			switch (type) {
				case 'entity-entity':
					return 'ENTITY_ENTITY';
				case 'entity-event':
					return 'ENTITY_EVENT';
				case 'event-event':
					return 'EVENT_EVENT';
				case 'emotional-context':
					return 'EMOTIONAL_CONTEXT';
				default:
					return type;
			}
		})
		.filter(Boolean);
}

/**
 * Convert embedding array to pgvector format string
 */
export function convertEmbeddingToVector(embedding: number[]): string {
	return `[${embedding.join(',')}]`;
}

/**
 * Validate embedding dimensions
 */
export function validateEmbeddingDimensions(
	embedding: number[],
	expectedDimensions: number = 1536
): boolean {
	return embedding.length === expectedDimensions;
}

/**
 * Build dynamic WHERE clause and parameters for vector search queries
 */
export function buildVectorSearchParams(
	embedding: number[],
	topK: number,
	minScore: number,
	options?: { temporal?: TemporalFilter; sources?: string[]; types?: string[] }
): { whereClause: string; params: any[] } {
	const vectorString = convertEmbeddingToVector(embedding);
	let whereClause = '1=1';
	const params: any[] = [vectorString, topK, minScore];
	let paramIndex = 3;

	// Add temporal filtering
	if (options) {
		const temporalFilter = buildTemporalFilter(options.temporal);
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
		if (options.sources && options.sources.length > 0) {
			whereClause += ` AND kt.source = ANY($${++paramIndex})`;
			params.push(options.sources);
		}

		// Add type filtering
		if (options.types && options.types.length > 0) {
			const enumTypes = convertTripleTypesForFilter(options.types);
			whereClause += ` AND kt.type = ANY($${++paramIndex})`;
			params.push(enumTypes);
		}
	}

	return { whereClause, params };
}
