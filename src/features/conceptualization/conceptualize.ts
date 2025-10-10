import { writeFileSync } from 'node:fs';
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { env } from '~/shared/env.js';
import { mapAbstractionLevel } from '~/shared/database/database-utils.js';
import { createAIProvider } from '~/shared/services/ai-provider-service.js';
import {
	getSuiteDefinition,
	loadPrompt,
	renderPrompt,
} from '~/shared/services/prompt-loader.js';
import type { Triple } from '~/shared/types/core.js';
import { trackTokenUsage } from '~/shared/utils/token-tracking.js';

export interface ConceptualizationInput {
	entities: string[];
	events: string[];
	relationships: string[];
	contextTriples: string[];
}

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
			triple_type: z.enum(['ENTITY_ENTITY', 'ENTITY_EVENT', 'EVENT_EVENT', 'EMOTIONAL_CONTEXT']),
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
) {
	try {
		// Load prompt from versioned prompt system
		const suiteVersion = env.PROMPT_VERSION;

		// Get suite definition
		const suiteResult = getSuiteDefinition(suiteVersion);
		if (!suiteResult.success) {
			throw new Error(`Failed to load prompt suite: ${suiteResult.error?.message}`);
		}

		// Load conceptualization prompt
		const promptVersion = suiteResult.data.conceptualization;
		const promptResult = loadPrompt('conceptualization', 'default', promptVersion);

		if (!promptResult.success) {
			throw new Error(`Failed to load prompt: ${promptResult.error?.message}`);
		}

		// Render prompt with variables
		const renderedPromptResult = renderPrompt(promptResult.data, {
			entities: input.entities.join(', '),
			events: input.events.join(', '),
			relationships: input.relationships.join(', '),
		});

		if (!renderedPromptResult.success) {
			throw new Error(`Failed to render prompt: ${renderedPromptResult.error?.message}`);
		}

		const prompt = renderedPromptResult.data;

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
		const now = new Date();

		// Convert to ConceptNode format
		const concepts = conceptData.map(concept => ({
			concept: concept.concept,
			abstraction_level: mapAbstractionLevel(concept.abstraction_level),
			confidence: new Decimal(concept.confidence),
			source: metadata.source,
			source_type: metadata.source_type,
			extracted_at: now,
		}));

		// Convert to ConceptualizationRelationship format
		const conceptualizations = relationshipData.map(rel => ({
			source_element: rel.source_element,
			triple_type: rel.triple_type,
			concept: rel.concept,
			confidence: new Decimal(rel.confidence),
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
export function extractElementsFromTriples(triples: Triple[]) {
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
function generateTripleId(triple: Triple): string {
	const key = `${triple.subject}|${triple.predicate}|${triple.object}|${triple.type}`;
	return Buffer.from(key).toString('base64').replace(/[+/=]/g, '_');
}
