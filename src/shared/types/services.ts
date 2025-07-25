// Service interface types for dependency injection

import type {
	ConceptNode,
	ConceptualizationRelationship,
	TokenUsage,
	TripleType,
} from '@prisma/client';
import type { z } from 'zod';
import type { AIResponseWithUsage } from '~/shared/types';
import type { AIConfig } from './config';
import type { Triple } from './core';
import type { SearchOptions } from './search';

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
	storeTriples(triples: Triple[]): Promise<Result<void>>;
	checkExistingTriples(ids: string[]): Promise<string[]>;
	tripleExists(id: string): Promise<boolean>;
	getTriplesByIds(ids: string[]): Promise<Triple[]>;
	getAllTriples(): Promise<Result<Triple[]>>;
	searchByText(query: string, searchType: string): Promise<Result<Triple[]>>;
	searchByEmbedding(
		embedding: number[],
		topK: number,
		minScore: number,
		options?: SearchOptions
	): Promise<Result<Triple[]>>;

	// Multi-index search methods
	searchByEntity(
		entityQuery: string,
		topK: number,
		options?: SearchOptions
	): Promise<Result<Triple[]>>;
	searchByRelationship(
		relationshipQuery: string,
		topK: number,
		options?: SearchOptions
	): Promise<Result<Triple[]>>;
	searchByConcept(
		conceptQuery: string,
		topK: number,
		options?: SearchOptions
	): Promise<Result<Triple[]>>;

	// Vector-based search methods for fusion search
	searchByEntityVector(
		embedding: number[],
		topK: number,
		minScore: number,
		options?: SearchOptions
	): Promise<Result<Triple[]>>;
	searchByRelationshipVector(
		embedding: number[],
		topK: number,
		minScore: number,
		options?: SearchOptions
	): Promise<Result<Triple[]>>;

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

	getConceptualizationsByConcept(concept: string): Promise<ConceptualizationRelationship[]>;
	getTriplesByConceptualization(concept: string): Promise<Triple[]>;

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
	embed(text: string): Promise<Result<number[]>>;
	embedBatch(
		texts: string[],
		context?: { source_type?: string; source?: string }
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
			triple_type?: TripleType;
			source_date?: string;
		}
	): Promise<Result<AIResponseWithUsage<T>>>;

	generateText(
		prompt: string,
		overrideConfig?: Partial<AIConfig>,
		context?: {
			operation_type?: string;
			thread_id?: string;
		}
	): Promise<Result<AIResponseWithUsage<string>>>;
}
