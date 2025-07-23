import { z } from 'zod';
import type {
	AIProvider,
	KnowledgeGraphConfig,
	KnowledgeTriple,
	Result,
} from '../../shared/types';
import { trackTokenUsage } from '../../shared/utils/token-tracking';
import {
	extractElementsFromTriples,
	generateConcepts,
} from '../conceptualization/conceptualize';
import type { ExtractedKnowledge, ExtractionMetadata } from './types';

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
export async function extractKnowledgeTriples(
	text: string,
	metadata: ExtractionMetadata,
	aiProvider: AIProvider,
	config: KnowledgeGraphConfig,
	includeConcepts: boolean = false
): Promise<Result<ExtractedKnowledge>> {
	try {
		const method = config.extraction.extractionMethod;

		// Extract triples first
		let extractionResult: Result<ExtractedKnowledge>;
		if (method === 'single-pass') {
			extractionResult = await extractSinglePass(text, metadata, aiProvider, config);
		} else {
			extractionResult = await extractFourStage(text, metadata, aiProvider, config);
		}

		if (!extractionResult.success) {
			return extractionResult;
		}

		let { triples, concepts, conceptualizations } = extractionResult.data;

		// Generate concepts if requested
		if (includeConcepts && triples.length > 0) {
			const conceptInput = extractElementsFromTriples(triples);
			const conceptResult = await generateConcepts(
				conceptInput,
				{
					source: metadata.source,
					source_type: metadata.source_type || 'unknown',
					entity_type: metadata.entity_type || 'entity',
					processing_batch_id: metadata.processing_batch_id,
				},
				aiProvider,
				config
			);

			if (conceptResult.success) {
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
async function extractSinglePass(
	text: string,
	metadata: ExtractionMetadata,
	aiProvider: AIProvider,
	config: KnowledgeGraphConfig
): Promise<Result<ExtractedKnowledge>> {
	try {
		const prompt = createSinglePassPrompt(text, metadata);

		const result = await aiProvider.generateObject(prompt, SinglePassTripleSchema, undefined, {
			operation_type: 'extraction',
			source: metadata.source,
			source_type: metadata.source_type,
			source_date: metadata.source_date,
			processing_batch_id: metadata.processing_batch_id,
		});
		if (!result.success) {
			return result;
		}

		// Track token usage
		await trackTokenUsage(
			result.data,
			{
				source: metadata.source,
				source_type: metadata.source_type || 'unknown',
				operation_type: 'extraction',
				processing_batch_id: metadata.processing_batch_id,
				operation_context: {
					extraction_method: 'single-pass',
					text_length: text.length,
					extracted_triples_count: result.data.data.relationships.length,
				},
			},
			config.ai
		);

		// Convert to KnowledgeTriple format
		const triples: KnowledgeTriple[] = result.data.data.relationships.map(rel => ({
			subject: rel.subject,
			predicate: rel.predicate,
			object: rel.object,
			type: mapRelationshipType(rel.relationship_type),
			source: metadata.source,
			source_type: metadata.source_type,
			source_date: metadata.source_date,
			extracted_at: new Date().toISOString(),
			processing_batch_id: metadata.processing_batch_id,
			confidence: rel.confidence,
		}));

		return {
			success: true,
			data: {
				triples,
				concepts: [], // Concepts would be extracted separately
				conceptualizations: [],
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
async function extractFourStage(
	text: string,
	metadata: ExtractionMetadata,
	aiProvider: AIProvider,
	config: KnowledgeGraphConfig
): Promise<Result<ExtractedKnowledge>> {
	try {
		const allTriples: KnowledgeTriple[] = [];
		const types = ['entity-entity', 'entity-event', 'event-event', 'emotional-context'] as const;

		for (const type of types) {
			const result = await extractByType(text, type, metadata, aiProvider, config);
			if (result.success) {
				allTriples.push(...result.data);
			}

			// Add delay between types if configured
			const delay = config.extraction?.delayBetweenTypes || 1000;
			await sleep(delay);
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
async function extractByType(
	text: string,
	type: 'entity-entity' | 'entity-event' | 'event-event' | 'emotional-context',
	metadata: ExtractionMetadata,
	aiProvider: AIProvider,
	config: KnowledgeGraphConfig
): Promise<Result<KnowledgeTriple[]>> {
	try {
		const prompt = createTypeSpecificPrompt(text, type, metadata);

		const result = await aiProvider.generateObject(prompt, TripleSchema, undefined, {
			operation_type: 'extraction',
			source: metadata.source,
			source_type: metadata.source_type,
			processing_batch_id: metadata.processing_batch_id,
		});
		if (!result.success) {
			return result;
		}

		// Track token usage
		await trackTokenUsage(
			result.data,
			{
				source: metadata.source,
				source_type: metadata.source_type || 'unknown',
				operation_type: 'extraction',
				processing_batch_id: metadata.processing_batch_id,
				operation_context: {
					extraction_method: 'four-stage',
					relationship_type: type,
					text_length: text.length,
					extracted_triples_count: result.data.data.triples.length,
				},
			},
			config.ai
		);

		const triples: KnowledgeTriple[] = result.data.data.triples.map(triple => ({
			subject: triple.subject,
			predicate: triple.predicate,
			object: triple.object,
			type,
			source: metadata.source,
			source_type: metadata.source_type,
			source_date: metadata.source_date,
			extracted_at: new Date().toISOString(),
			processing_batch_id: metadata.processing_batch_id,
			confidence: triple.confidence,
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
function createSinglePassPrompt(text: string, metadata?: ExtractionMetadata): string {
	const temporalContext = metadata?.source_date
		? `\n\nTemporal Context: This text is from ${new Date(metadata.source_date).toLocaleDateString()}. Pay special attention to temporal relationships and time-sensitive information.`
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

Text: ${text}${temporalContext}

Respond with a JSON object containing an array of relationships.`;
}

function createTypeSpecificPrompt(
	text: string,
	type: string,
	metadata?: ExtractionMetadata
): string {
	const typeDescriptions: Record<string, string> = {
		'entity-entity': 'relationships between people, places, things, or concepts',
		'entity-event': 'how entities are involved in or affected by events',
		'event-event': 'causal, temporal, or logical relationships between events',
		'emotional-context': 'emotional states, feelings, or contextual information',
	};

	const temporalContext = metadata?.source_date
		? `\n\nTemporal Context: This text is from ${new Date(metadata.source_date).toLocaleDateString()}. Consider this temporal context when extracting relationships.`
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

Text: ${text}${temporalContext}${temporalGuidance}

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
