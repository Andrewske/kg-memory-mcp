// API and transport-related types

import type { AIProvider, DatabaseAdapter, EmbeddingService } from './services';

// Transport-specific types
export interface ToolDependencies {
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
