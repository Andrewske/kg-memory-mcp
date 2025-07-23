import type { EntityType } from '~/shared/types/core.js';
import type {
	ConceptNode,
	ConceptualizationRelationship,
	KnowledgeTriple,
} from '../../shared/types/index.js';

export interface ExtractedKnowledge {
	triples: KnowledgeTriple[];
	concepts: ConceptNode[];
	conceptualizations: ConceptualizationRelationship[];
}

export interface ExtractionMetadata {
	source: string;
	source_type: string;
	entity_type?: EntityType;
	source_date?: string;
	processing_batch_id?: string;
}
