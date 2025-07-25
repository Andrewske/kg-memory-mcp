// // Core domain types for the Knowledge Graph system

import type { ConceptNode, KnowledgeTriple } from '@prisma/client';

// export type TripleType = 'entity-entity' | 'entity-event' | 'event-event' | 'emotional-context';

// export interface KnowledgeTriple {
// 	subject: string;
// 	predicate: string;
// 	object: string;
// 	type: TripleType;

// 	// Data lineage fields
// 	source: string; // The actual identifier (thread_12345, filename.txt, etc.)
// 	source_type: string; // "thread", "file", "manual", "api", etc.
// 	source_date: string; // when conversation happened (ISO format)
// 	extracted_at: string; // when relationship was extracted (ISO format)

// 	// Quality fields
// 	confidence?: number;
// }

// export interface ConceptNode {
// 	// Core concept information
// 	concept: string; // The conceptual phrase (e.g., "Person", "Technology", "Event")
// 	abstraction_level: 'high' | 'medium' | 'low'; // Level of abstraction
// 	confidence: number; // Confidence in the conceptualization

// 	// Metadata
// 	source: string; // The actual identifier (thread_12345, filename.txt, etc.)
// 	source_type: string; // "thread", "file", "manual", "api", etc.
// 	extracted_at: string; // When the concept was extracted
// }

// export type EntityType = 'entity' | 'event' | 'relation';

// export interface ConceptualizationRelationship {
// 	// The relationship between an entity/event and its concept
// 	source_element: string; // The original entity or event
// 	entity_type: EntityType; // Type of the source element
// 	concept: string; // The concept it maps to
// 	confidence: number; // Confidence in the mapping

// 	// Context information
// 	context_triples?: string[]; // IDs of related triples that informed this conceptualization

// 	// Metadata
// 	source: string; // The actual identifier (thread_12345, filename.txt, etc.)
// 	source_type: string; // "thread", "file", "manual", "api", etc.
// 	extracted_at: string; // When the conceptualization was extracted
// }

// export interface ConversationMetadata {
// 	source: string; // The actual identifier (thread_12345, filename.txt, etc.)
// 	source_type: string; // "thread", "file", "manual", "api", etc.
// 	source_date?: string;
// }

// export interface VectorIndex {
// 	id: string;
// 	text: string;
// 	embedding: number[];
// 	metadata?: Record<string, any>;
// }

export type Triple = Omit<KnowledgeTriple, 'id' | 'created_at' | 'updated_at'>;
export type Concept = Omit<ConceptNode, 'id' | 'created_at' | 'updated_at'>;

// Token tracking types - aligned with enhanced Prisma schema
export interface TokenUsage {
	// Usage identification
	source: string; // The actual identifier (thread_12345, filename.txt, etc.)
	source_type: string; // "thread", "file", "manual", "api", etc.
	operation_type: string; // "extraction", "conceptualization", "embedding", "search", "deduplication"
	provider: string; // "openai", "anthropic"
	model: string;

	// Standard token counts
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;

	// Advanced token types (optional for backward compatibility)
	thinking_tokens?: number; // Reasoning/thinking tokens for supported models
	reasoning_tokens?: number; // Additional reasoning step tokens
	cached_read_tokens?: number; // Cache hit tokens (prompt caching)
	cached_write_tokens?: number; // Cache write tokens (creating cache)

	// Reasoning and context metadata
	reasoning_steps?: any[]; // Reasoning steps for supported models
	operation_context?: Record<string, any>; // Additional operation-specific context

	// Performance and cost tracking
	duration_ms: number; // Request duration in milliseconds
	estimated_cost?: number; // Estimated cost in USD

	// Processing context // Link to processing batch if applicable
	tools_used?: string[]; // Array of tool names used

	// Timestamp
	timestamp: string; // ISO string format
}

// Extended AI response type that includes token usage and reasoning
export interface AIResponseWithUsage<T> {
	data: T;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		// Advanced token types
		thinkingTokens?: number;
		reasoningTokens?: number;
		cachedReadTokens?: number;
		cachedWriteTokens?: number;
	};
	reasoning?: any[]; // Reasoning steps for supported models
	providerMetadata?: Record<string, any>; // Provider-specific metadata
	duration_ms?: number; // Request duration
}
