import type { EntityType } from '~/shared/types/core';
import type {
	ConceptNode,
	ConceptualizationRelationship,
	KnowledgeTriple,
} from '../../shared/types';

export interface ExtractedKnowledge {
	triples: KnowledgeTriple[];
	concepts: ConceptNode[];
	conceptualizations: ConceptualizationRelationship[];
}

export interface ExtractionMetadata {
	source: string;
	source_type: string;
	entity_type?: EntityType;
	source_date: string;
	processing_batch_id?: string;
}
