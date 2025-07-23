// Feature-specific types for knowledge-graph operations
// Note: SearchOptions, TemporalFilter, SearchResult, and GraphStats are now in ~/shared/types/

export interface StoreResult {
	triplesStored: number;
	conceptsStored: number;
	duplicatesSkipped: number;
	vectorsGenerated?: number;
}
