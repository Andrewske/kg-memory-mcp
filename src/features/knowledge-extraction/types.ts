import type {
	KnowledgeTriple,
	ConceptNode,
	ConceptualizationRelationship,
} from "../../shared/types/index.js";

export interface ExtractedKnowledge {
	triples: KnowledgeTriple[];
	concepts: ConceptNode[];
	conceptualizations: ConceptualizationRelationship[];
}

export interface ExtractionMetadata {
	source: string;
	thread_id?: string;
	conversation_date?: string;
	processing_batch_id?: string;
}
