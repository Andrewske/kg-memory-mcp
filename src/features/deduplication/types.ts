import type { KnowledgeTriple } from '../../shared/types/index.js';

export interface DeduplicationResult {
	uniqueTriples: KnowledgeTriple[];
	duplicatesRemoved: number;
	mergedMetadata: Array<{
		originalId: string;
		mergedIntoId: string;
		reason: 'exact' | 'semantic';
	}>;
}

export interface SimilarityScore {
	triple1Id: string;
	triple2Id: string;
	score: number;
	type: 'exact' | 'semantic';
}
