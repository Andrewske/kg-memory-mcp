import type { EntityType } from '../types/core.js';
import type {
	ConceptNode,
	ConceptualizationRelationship,
	DatabaseAdapter,
	DatabaseConfig,
	KnowledgeTriple,
	Result,
	SearchOptions,
	TemporalFilter,
	TokenUsage,
	TripleType,
} from '../types/index.js';
import { db } from './client.js';
// Import all operation modules
import * as TripleOps from './triple-operations.js';
import * as SearchOps from './search-operations.js';
import * as VectorOps from './vector-operations.js';
import * as ConceptOps from './concept-operations.js';
import * as StatsOps from './stats-operations.js';


/**
 * Database adapter implementation using Prisma
 * Implements the DatabaseAdapter interface for dependency injection
 */
export function createDatabaseAdapter(config: DatabaseConfig): DatabaseAdapter {
	return {
		// Triple operations - delegate to TripleOps module
		storeTriples: TripleOps.storeTriples,
		checkExistingTriples: TripleOps.checkExistingTriples,
		tripleExists: TripleOps.tripleExists,
		getTriplesByIds: TripleOps.getTriplesByIds,
		getAllTriples: TripleOps.getAllTriples,

		// Search operations - delegate to SearchOps module
		searchByText: SearchOps.searchByText,
		searchByEmbedding: SearchOps.searchByEmbedding,
		searchByEntity: SearchOps.searchByEntity,
		searchByRelationship: SearchOps.searchByRelationship,
		searchByConcept: SearchOps.searchByConcept,

		// Vector operations - delegate to VectorOps module
		searchByEntityVector: VectorOps.searchByEntityVector,
		searchByRelationshipVector: VectorOps.searchByRelationshipVector,
		storeVectors: VectorOps.storeVectors,

		// Concept operations - delegate to ConceptOps module
		storeConcepts: ConceptOps.storeConcepts,
		searchConcepts: ConceptOps.searchConcepts,
		searchConceptsByEmbedding: ConceptOps.searchConceptsByEmbedding,
		getConceptsByIds: ConceptOps.getConceptsByIds,
		storeConceptualizations: ConceptOps.storeConceptualizations,
		getConceptualizationsByElement: ConceptOps.getConceptualizationsByElement,
		getConceptualizationsByConcept: ConceptOps.getConceptualizationsByConcept,
		getTriplesByConceptualization: ConceptOps.getTriplesByConceptualization,

		// Stats operations - delegate to StatsOps module
		getTripleCount: StatsOps.getTripleCount,
		getConceptCount: StatsOps.getConceptCount,
		getTripleCountByType: StatsOps.getTripleCountByType,
		storeTokenUsage: StatsOps.storeTokenUsage,
		getTokenUsage: StatsOps.getTokenUsage,
	};
}

