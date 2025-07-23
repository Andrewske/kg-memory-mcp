// Configuration types for the Knowledge Graph system

export interface KnowledgeGraphConfig {
	embeddings: EmbeddingConfig;
	search: SearchConfig;
	extraction: ExtractionConfig;
	deduplication: DeduplicationConfig;
	ai: AIConfig;
	database: DatabaseConfig;
}

export interface EmbeddingConfig {
	model: string;
	dimensions: number;
	batchSize: number;
}

export interface SearchConfig {
	topK: number;
	minScore: number;
}

export interface ExtractionConfig {
	extractionMethod?: 'single-pass' | 'four-stage';
	delayBetweenTypes?: number;
	maxChunkTokens: number;
	model: string;
	temperature: number;
}

export interface DeduplicationConfig {
	enableSemanticDeduplication: boolean;
	semanticSimilarityThreshold: number;
	exactMatchFields: string[];
}

export interface AIConfig {
	provider: 'openai' | 'anthropic';
	model: string;
	temperature: number;
	maxTokens: number;
}

export interface DatabaseConfig {
	url: string;
	maxConnections: number;
	timeout: number;
}
