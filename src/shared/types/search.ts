// Search-related types for the Knowledge Graph system

import type { ConceptNode, TripleType } from '@prisma/client';
import type { Triple } from '~/shared/types/core.js';

// Unified SearchOptions interface combining both variations
export interface SearchOptions {
	limit?: number;
	threshold?: number;
	// From shared types
	types?: TripleType;
	sources?: string[];
	source_types?: string[]; // Filter by source type: "thread", "file", "manual", etc.
	// From feature types - temporal filtering
	temporal?: TemporalFilter;
}

export interface TemporalFilter {
	fromDate?: string; // ISO date string
	toDate?: string; // ISO date string
	timeWindow?: {
		value: number;
		unit: 'days' | 'weeks' | 'months' | 'years';
		from: 'now' | string; // 'now' or ISO date string
	};
}

export interface TripleSearchResult {
	triple: Triple;
	similarity: number;
	searchType: 'entity' | 'relationship' | 'semantic';
}

export interface ConceptSearchResult {
	concept: ConceptNode;
	similarity: number;
	searchType: 'concept';
}

// Unified SearchResult interface for knowledge graph operations
export interface SearchResult {
	triples: Array<{
		triple: Triple;
		score: number;
		searchType: 'entity' | 'relationship' | 'semantic' | 'fusion';
	}>;
	concepts: Array<{
		concept: ConceptNode;
		score: number;
	}>;
	temporal?: {
		dateRange: {
			earliest: string;
			latest: string;
		};
		clusters?: Array<{
			period: string;
			count: number;
			timespan: string;
		}>;
	};
}

export interface EntityEnumerationOptions {
	role?: 'subject' | 'object' | 'both';
	min_occurrence?: number;
	sources?: string[];
	types?: Array<TripleType>;
	limit?: number;
	sort_by?: 'frequency' | 'alphabetical' | 'recent';
	threshold?: number;
}

// Note: FusionSearchResult and FusionSearchWeights are co-located
// with their implementation in features/knowledge-graph/fusion-search.ts
