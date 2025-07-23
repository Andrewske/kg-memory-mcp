import type {
	ConceptNode,
	ConceptualizationRelationship,
} from "../../shared/types/index.js";

export interface ConceptualizationInput {
	entities: string[];
	events: string[];
	relationships: string[];
	contextTriples: string[];
}

export interface ConceptualizationOutput {
	concepts: ConceptNode[];
	relationships: ConceptualizationRelationship[];
}
