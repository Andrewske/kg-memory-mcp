import type { KnowledgeTriple, ConceptNode } from "../../shared/types/index.js";

export interface StoreResult {
	triplesStored: number;
	conceptsStored: number;
	duplicatesSkipped: number;
	vectorsGenerated?: number;
}

export interface TemporalFilter {
	fromDate?: string; // ISO date string
	toDate?: string; // ISO date string
	timeWindow?: {
		value: number;
		unit: "days" | "weeks" | "months" | "years";
		from: "now" | string; // 'now' or ISO date string
	};
}

export interface SearchOptions {
	limit?: number;
	threshold?: number;
	temporal?: TemporalFilter;
	sources?: string[];
	types?: string[];
}

export interface SearchResult {
	triples: Array<{
		triple: KnowledgeTriple;
		score: number;
		searchType: "entity" | "relationship" | "semantic" | "fusion";
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

export interface GraphStats {
	totalTriples: number;
	totalConcepts: number;
	triplesByType: Record<string, number>;
	lastUpdated: string;
}
