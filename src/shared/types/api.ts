// API and transport-related types

import type { KnowledgeGraphConfig } from './config.js';
import type { DatabaseAdapter, EmbeddingService, AIProvider } from './services.js';

// Transport-specific types
export interface ToolDependencies {
	config: KnowledgeGraphConfig;
	db: DatabaseAdapter;
	embeddingService: EmbeddingService;
	aiProvider: AIProvider;
}

export interface ToolResult<T = any> {
	success: boolean;
	data?: T;
	error?: {
		message: string;
		code?: string;
		operation: string;
	};
}

export interface RoutesDependencies {
	config: KnowledgeGraphConfig;
	db: DatabaseAdapter;
	embeddingService: EmbeddingService;
	aiProvider: AIProvider;
}

// Graph statistics interface
export interface GraphStats {
	totalTriples: number;
	totalConcepts: number;
	triplesByType: Record<string, number>;
	lastUpdated: string;
}

// Note: StoreResult is co-located with operations in features/knowledge-graph/types.ts
