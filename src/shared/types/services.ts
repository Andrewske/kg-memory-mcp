// Service interface types for dependency injection

import type { z } from 'zod';
import type { AIConfig } from './config.js';
import type {
	AIResponseWithUsage,
	ConceptNode,
	ConceptualizationRelationship,
	EntityType,
	KnowledgeTriple,
	TokenUsage,
	TripleType,
} from './core.js';
import type { SearchOptions } from './search.js';

// Result type for consistent error handling
export type Result<T> = { success: true; data: T } | { success: false; error: OperationError };

export interface OperationError {
	type: string;
	message: string;
	cause?: unknown;
}

// Service interfaces for dependency injection
export interface DatabaseAdapter {
	// Triple operations
	storeTriples(triples: KnowledgeTriple[]): Promise<Result<void>>;
	checkExistingTriples(ids: string[]): Promise<string[]>;
	tripleExists(id: string): Promise<boolean>;
	getTriplesByIds(ids: string[]): Promise<KnowledgeTriple[]>;
	getAllTriples(): Promise<Result<KnowledgeTriple[]>>;
	searchByText(query: string, searchType: string): Promise<Result<KnowledgeTriple[]>>;
	searchByEmbedding(
		embedding: number[],
		topK: number,
		minScore: number,
		options?: SearchOptions
	): Promise<Result<KnowledgeTriple[]>>;

	// Multi-index search methods
	searchByEntity(
		entityQuery: string,
		topK: number,
		options?: SearchOptions
	): Promise<Result<KnowledgeTriple[]>>;
	searchByRelationship(
		relationshipQuery: string,
		topK: number,
		options?: SearchOptions
	): Promise<Result<KnowledgeTriple[]>>;
	searchByConcept(
		conceptQuery: string,
		topK: number,
		options?: SearchOptions
	): Promise<Result<KnowledgeTriple[]>>;

	// Vector-based search methods for fusion search
	searchByEntityVector(
		embedding: number[],
		topK: number,
		minScore: number,
		options?: SearchOptions
	): Promise<Result<KnowledgeTriple[]>>;
	searchByRelationshipVector(
		embedding: number[],
		topK: number,
		minScore: number,
		options?: SearchOptions
	): Promise<Result<KnowledgeTriple[]>>;

	// Concept operations
	storeConcepts(concepts: ConceptNode[]): Promise<Result<void>>;
	searchConcepts(query: string, abstraction?: string): Promise<Result<ConceptNode[]>>;
	searchConceptsByEmbedding(
		embedding: number[],
		topK: number,
		minScore: number
	): Promise<Result<ConceptNode[]>>;
	getConceptsByIds(ids: string[]): Promise<ConceptNode[]>;

	// Conceptualization relationship operations
	storeConceptualizations(relationships: ConceptualizationRelationship[]): Promise<Result<void>>;
	getConceptualizationsByElement(
		element: string,
		sourceType?: 'entity' | 'event' | 'relation'
	): Promise<ConceptualizationRelationship[]>;
	getConceptualizationsByConcept(concept: string): Promise<ConceptualizationRelationship[]>;
	getTriplesByConceptualization(concept: string): Promise<KnowledgeTriple[]>;

	// Vector operations
	storeVectors(vectors: {
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
	}): Promise<Result<void>>;

	// Stats operations
	getTripleCount(): Promise<number>;
	getConceptCount(): Promise<number>;
	getTripleCountByType(): Promise<Record<TripleType, number>>;

	// Token usage operations
	storeTokenUsage(usage: TokenUsage): Promise<Result<void>>;
	getTokenUsage(filters?: {
		source?: string;
		source_type?: string;
		operation_type?: string;
		provider?: string;
		model?: string;
		start_time?: string;
		end_time?: string;
	}): Promise<Result<TokenUsage[]>>;
}

export interface EmbeddingService {
	embed(
		text: string,
		context?: { operation_type?: string; thread_id?: string }
	): Promise<Result<number[]>>;
	embedBatch(
		texts: string[],
		context?: { operation_type?: string; thread_id?: string }
	): Promise<Result<number[][]>>;
}

export interface AIProvider {
	generateObject<T>(
		prompt: string,
		schema: z.ZodType<T>,
		overrideConfig?: Partial<AIConfig>,
		context?: {
			operation_type?: string;
			source?: string;
			source_type?: string;
			entity_type?: EntityType;
			source_date?: string;
			processing_batch_id?: string;
		}
	): Promise<Result<AIResponseWithUsage<T>>>;

	generateText(
		prompt: string,
		overrideConfig?: Partial<AIConfig>,
		context?: {
			operation_type?: string;
			thread_id?: string;
			processing_batch_id?: string;
		}
	): Promise<Result<AIResponseWithUsage<string>>>;
}
