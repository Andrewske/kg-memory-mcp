import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { createAIProvider } from '~/shared/services/ai-provider-service';
import type { Result } from '~/shared/types';
import type { Triple } from '~/shared/types/core';
import { trackTokenUsage } from '../../shared/utils/token-tracking';
import type { ConceptualizationInput, ConceptualizationOutput } from './types';

// Zod schema for concept validation
const ConceptSchema = z.object({
	concepts: z.array(
		z.object({
			concept: z.string().min(1),
			abstraction_level: z.enum(['high', 'medium', 'low']),
			confidence: z.number().min(0).max(1),
			reasoning: z.string().optional(),
		})
	),
	relationships: z.array(
		z.object({
			source_element: z.string().min(1),
			entity_type: z.enum(['entity', 'event', 'relation']),
			concept: z.string().min(1),
			confidence: z.number().min(0).max(1),
			reasoning: z.string().optional(),
		})
	),
});

/**
 * Generate concepts and conceptualization relationships from knowledge triples
 * Pure function that takes all dependencies as parameters
 */
export async function generateConcepts(
	input: ConceptualizationInput,
	metadata: {
		source: string;
		source_type: string;
	}
): Promise<Result<ConceptualizationOutput>> {
	try {
		const prompt = createConceptualizationPrompt(input);
		const aiProvider = createAIProvider();

		const result = await aiProvider.generateObject(prompt, ConceptSchema, undefined, {
			operation_type: 'conceptualization',
		});

		if (!result.success) {
			return result;
		}

		// Save the raw result as JSON for debugging/auditing

		const debugDir = './logs';
		try {
			console.log('Saving conceptualization result as JSON...');
			// Ensure directory exists
			const fileName = `${debugDir}/conceptualization-${Date.now()}.json`;
			writeFileSync(fileName, JSON.stringify(result, null, 2), 'utf-8');
		} catch (err) {
			// Non-fatal: log to console if file write fails
			console.warn('Could not save conceptualization result as JSON:', err);
		}

		// Track token usage
		const tokenUsage = await trackTokenUsage(result.data, {
			source: metadata.source,
			source_type: metadata.source_type,
			operation_type: 'conceptualization',
			operation_context: {
				entities_count: input.entities.length,
				events_count: input.events.length,
				relationships_count: input.relationships.length,
				context_triples_count: input.contextTriples?.length || 0,
				generated_concepts_count: result.data.data.concepts.length,
				generated_relationships_count: result.data.data.relationships.length,
			},
		});

		const { concepts: conceptData, relationships: relationshipData } = result.data.data;
		const now = new Date().toISOString();

		// Convert to ConceptNode format
		const concepts = conceptData.map(concept => ({
			concept: concept.concept,
			abstraction_level: concept.abstraction_level,
			confidence: concept.confidence,
			source: metadata.source,
			source_type: metadata.source_type,
			extracted_at: now,
		}));

		// Convert to ConceptualizationRelationship format
		const conceptualizations = relationshipData.map(rel => ({
			source_element: rel.source_element,
			entity_type: rel.entity_type,
			concept: rel.concept,
			confidence: rel.confidence,
			context_triples: input.contextTriples,
			source: metadata.source,
			source_type: metadata.source_type,
			extracted_at: now,
		}));

		return {
			success: true,
			data: {
				concepts,
				relationships: conceptualizations,
				tokenUsage,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'CONCEPTUALIZATION_ERROR',
				message: 'Failed to generate concepts',
				cause: error,
			},
		};
	}
}

/**
 * Extract entities and events from knowledge triples for conceptualization
 */
export function extractElementsFromTriples(triples: Triple[]): ConceptualizationInput {
	const entities = new Set<string>();
	const events = new Set<string>();
	const relationships = new Set<string>();
	const contextTriples: string[] = [];

	for (const triple of triples) {
		// Add context triple ID (generated deterministically)
		const tripleId = generateTripleId(triple);
		contextTriples.push(tripleId);

		// Extract entities and events based on triple type
		switch (triple.type) {
			case 'ENTITY_ENTITY':
				entities.add(triple.subject);
				entities.add(triple.object);
				relationships.add(triple.predicate);
				break;
			case 'ENTITY_EVENT':
				entities.add(triple.subject);
				events.add(triple.object);
				relationships.add(triple.predicate);
				break;
			case 'EVENT_EVENT':
				events.add(triple.subject);
				events.add(triple.object);
				relationships.add(triple.predicate);
				break;
			case 'EMOTIONAL_CONTEXT':
				// Treat emotional context as events
				events.add(triple.subject);
				events.add(triple.object);
				relationships.add(triple.predicate);
				break;
		}
	}

	return {
		entities: Array.from(entities),
		events: Array.from(events),
		relationships: Array.from(relationships),
		contextTriples,
	};
}

// Helper functions
function createConceptualizationPrompt(input: ConceptualizationInput): string {
	return `Analyze the following knowledge elements and generate high-level concepts that organize and categorize them.

Entities: ${input.entities.join(', ')}
Events: ${input.events.join(', ')}
Relationships: ${input.relationships.join(', ')}

For each concept, provide:
1. The concept name (e.g., "Technology", "Human Interaction", "Business Process")
2. Abstraction level: high (very general), medium (somewhat specific), or low (very specific)
3. Confidence score (0.0 to 1.0)

For each conceptualization relationship, specify:
1. Which specific element (entity/event/relation) maps to which concept
2. The type of the source element (entity, event, or relation)
3. Confidence in the mapping

Generate concepts that would be useful for organizing and searching this knowledge.`;
}

function generateTripleId(triple: Triple): string {
	const key = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}
