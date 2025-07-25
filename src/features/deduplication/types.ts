import type { Triple } from '~/shared/types/core';

export interface DeduplicationResult {
	uniqueTriples: Triple[];
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
