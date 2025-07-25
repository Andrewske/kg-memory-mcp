import type { ConceptNode, ConceptualizationRelationship, TripleType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { z } from 'zod';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager';
import { env } from '~/shared/env';
import { createAIProvider } from '~/shared/services/ai-provider-service';
import type { Concept, Triple } from '~/shared/types/core';
import { trackTokenUsage } from '../../shared/utils/token-tracking';
import { extractElementsFromTriples, generateConcepts } from '../conceptualization/conceptualize';

// Zod schemas for validation
const TripleSchema = z.object({
	triples: z.array(
		z.object({
			subject: z.string().min(1),
			predicate: z.string().min(1),
			object: z.string().min(1),
			confidence: z.number().min(0).max(1).optional(),
		})
	),
});

const SinglePassTripleSchema = z.object({
	relationships: z.array(
		z.object({
			subject: z.string().min(1),
			predicate: z.string().min(1),
			object: z.string().min(1),
			relationship_type: z.string().min(1),
			confidence: z.number().min(0).max(1).optional(),
			reasoning: z.string().optional(),
		})
	),
});

/**
 * Extract knowledge triples from text using AI
 * Pure function that takes all dependencies as parameters
 */
export async function extractKnowledgeTriples(data: ProcessKnowledgeArgs) {
	try {
		const method = env.EXTRACTION_METHOD;

		const extractionResult =
			method === 'single-pass' ? await extractSinglePass(data) : await extractFourStage(data);

		if (!extractionResult.success || !extractionResult.data) {
			throw new Error(extractionResult.error?.message);
		}

		const { triples } = extractionResult.data;
		let concepts: Concept[] = [];
		let conceptualizations: Pick<ConceptualizationRelationship, 'source_element' | 'triple_type' | 'concept' | 'confidence' | 'context_triples' | 'source' | 'source_type' | 'extracted_at'>[] = [];

		// Generate concepts if requested
		if (triples.length > 0) {
			const conceptInput = extractElementsFromTriples(triples);
			const conceptResult = await generateConcepts(conceptInput, {
				source: data.source,
				source_type: data.source_type,
			});



			if (conceptResult.success && conceptResult.data) {
				concepts = conceptResult.data.concepts;
				conceptualizations = conceptResult.data.relationships;
			}
		}

		return {
			success: true,
			data: {
				triples,
				concepts,
				conceptualizations,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'EXTRACTION_ERROR',
				message: 'Failed to extract knowledge',
				cause: error,
			},
		};
	}
}

/**
 * Single-pass extraction - extract all relationship types at once
 */
async function extractSinglePass(data: ProcessKnowledgeArgs) {
	try {
		const prompt = createSinglePassPrompt(data);

		const aiProvider = createAIProvider();

		const result = await aiProvider.generateObject(prompt, SinglePassTripleSchema, undefined, {
			operation_type: 'extraction',
			source: data.source,
			source_type: data.source_type,
			source_date: data.source_date,
		});
		if (!result.success) {
			throw new Error(result.error?.message);
		}

		// Track token usage
		await trackTokenUsage(result.data, {
			source: data.source,
			source_type: data.source_type || 'unknown',
			operation_type: 'extraction',

			operation_context: {
				extraction_method: 'single-pass',
				text_length: data.text.length,
				extracted_triples_count: result.data.data.relationships.length,
			},
		});

		// Convert to KnowledgeTriple format
		const triples = result.data.data.relationships.map(rel => ({
			subject: rel.subject,
			predicate: rel.predicate,
			object: rel.object,
			type: rel.relationship_type as TripleType,
			source: data.source,
			source_type: data.source_type,
			source_date: new Date(data.source_date),
			extracted_at: new Date(),
			confidence: rel.confidence ? new Decimal(rel.confidence) : null,
		})) as Triple[];

		return {
			success: true,
			data: {
				triples,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'EXTRACTION_ERROR',
				message: 'Single-pass extraction failed',
				cause: error,
			},
		};
	}
}

/**
 * Four-stage extraction - extract each relationship type separately
 */
async function extractFourStage(data: ProcessKnowledgeArgs) {
	try {
		const allTriples = [];

		for (const type of [
			'ENTITY_ENTITY',
			'ENTITY_EVENT',
			'EVENT_EVENT',
			'EMOTIONAL_CONTEXT',
		] as const) {
			const result = await extractByType(data, type as TripleType);
			if (result.success) {
				allTriples.push(...(result.data ?? []));
			}
		}

		return {
			success: true,
			data: {
				triples: allTriples,
				concepts: [],
				conceptualizations: [],
			},
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'EXTRACTION_ERROR',
				message: 'Four-stage extraction failed',
				cause: error,
			},
		};
	}
}

/**
 * Extract triples for a specific relationship type
 */
async function extractByType(data: ProcessKnowledgeArgs, type: TripleType) {
	try {
		const prompt = createTypeSpecificPrompt(data, type);

		const aiProvider = createAIProvider();

		const result = await aiProvider.generateObject(prompt, TripleSchema, undefined, {
			operation_type: 'extraction',
			source: data.source,
			source_type: data.source_type,
		});
		if (!result.success) {
			return result;
		}

		// Track token usage
		await trackTokenUsage(result.data, {
			source: data.source,
			source_type: data.source_type || 'unknown',
			operation_type: 'extraction',
			operation_context: {
				extraction_method: 'four-stage',
				relationship_type: type,
				text_length: data.text.length,
				extracted_triples_count: result.data.data.triples.length,
			},
		});

		const triples = result.data.data.triples.map(triple => ({
			subject: triple.subject,
			predicate: triple.predicate,
			object: triple.object,
			type,
			source: data.source,
			source_type: data.source_type,
			source_date: new Date(data.source_date),
			extracted_at: new Date(),

			confidence: triple.confidence ? new Decimal(triple.confidence) : null,
		}));

		return {
			success: true,
			data: triples,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'EXTRACTION_ERROR',
				message: `Failed to extract ${type} relationships`,
				cause: error,
			},
		};
	}
}

// Helper functions
function createSinglePassPrompt(data: ProcessKnowledgeArgs): string {
	const temporalContext = data.source_date
		? `\n\nTemporal Context: This text is from ${new Date(data.source_date).toLocaleDateString()}. Pay special attention to temporal relationships and time-sensitive information.`
		: '';

	return `Extract all meaningful relationships from the following text. Identify:
1. Entity-Entity relationships (how entities relate to each other)
2. Entity-Event relationships (entities involved in events)
3. Event-Event relationships (how events relate to each other, including temporal, causal, and sequential relationships)  
4. Emotional-Context relationships (emotional states and context)

For each relationship, specify the relationship_type as one of: "entity-entity", "entity-event", "event-event", "emotional-context"

When extracting event-event relationships, pay special attention to:
- Temporal sequence ("before", "after", "during", "since", "until")
- Causal relationships ("caused by", "resulted in", "led to")
- Conditional relationships ("if", "when", "whenever")
- Duration and timing ("lasted", "took place over", "occurred at")

Text: ${data.text}${temporalContext}

Respond with a JSON object containing an array of relationships.`;
}

function createTypeSpecificPrompt(data: ProcessKnowledgeArgs, type: string): string {
	const typeDescriptions: Record<string, string> = {
		'entity-entity': 'relationships between people, places, things, or concepts',
		'entity-event': 'how entities are involved in or affected by events',
		'event-event': 'causal, temporal, or logical relationships between events',
		'emotional-context': 'emotional states, feelings, or contextual information',
	};

	const temporalContext = data.source_date
		? `\n\nTemporal Context: This text is from ${new Date(data.source_date).toLocaleDateString()}. Consider this temporal context when extracting relationships.`
		: '';

	const temporalGuidance =
		type === 'event-event'
			? `\n\nFor event-event relationships, pay special attention to:
- Temporal sequence and ordering
- Causal connections
- Duration and timing information
- Conditional relationships`
			: '';

	return `Extract ${typeDescriptions[type]} from the following text.

Text: ${data.text}${temporalContext}${temporalGuidance}

Respond with a JSON object containing an array of triples.`;
}

function mapRelationshipType(
	type: string
): 'entity-entity' | 'entity-event' | 'event-event' | 'emotional-context' {
	switch (type) {
		case 'entity-entity':
			return 'entity-entity';
		case 'entity-event':
			return 'entity-event';
		case 'event-event':
			return 'event-event';
		case 'emotional-context':
			return 'emotional-context';
		default:
			return 'entity-entity'; // default fallback
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
