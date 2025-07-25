import type { ConceptNode, ConceptualizationRelationship, TokenUsage } from '../../shared/types';

export interface ConceptualizationInput {
	entities: string[];
	events: string[];
	relationships: string[];
	contextTriples: string[];
}

export interface ConceptualizationOutput {
	concepts: ConceptNode[];
	relationships: ConceptualizationRelationship[];
	tokenUsage: TokenUsage | null;
}
