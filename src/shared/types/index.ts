// Re-export all types from specialized modules for convenience

// Core domain types
export type {
	TripleType,
	KnowledgeTriple,
	ConceptNode,
	ConceptualizationRelationship,
	ConversationMetadata,
	VectorIndex,
	TokenUsage,
	AIResponseWithUsage,
} from './core.js';

// Search-related types
export type {
	SearchOptions,
	TemporalFilter,
	TripleSearchResult,
	ConceptSearchResult,
	SearchResult,
	LegacySearchResult,
	EntityEnumerationOptions,
} from './search.js';

// Configuration types
export type {
	KnowledgeGraphConfig,
	EmbeddingConfig,
	SearchConfig,
	ExtractionConfig,
	DeduplicationConfig,
	AIConfig,
	DatabaseConfig,
} from './config.js';

// Service interface types
export type {
	Result,
	OperationError,
	DatabaseAdapter,
	EmbeddingService,
	AIProvider,
} from './services.js';

// API and transport types
export type {
	ToolDependencies,
	ToolResult,
	RoutesDependencies,
	GraphStats,
} from './api.js';
