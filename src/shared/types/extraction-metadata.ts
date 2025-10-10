/**
 * Extraction metadata types - Used by production and benchmarks
 *
 * These types represent the detailed extraction process including deduplication
 * tracking and stage-by-stage breakdowns. They are shared between production
 * code and benchmark analysis to avoid circular dependencies.
 */

import { z } from 'zod';

/**
 * Triple with duplicate status tracking
 *
 * Used to track the status of each extracted triple through the deduplication
 * process across all extraction stages.
 */
export const TripleWithStatusSchema = z.object({
	subject: z.string(),
	predicate: z.string(),
	object: z.string(),
	type: z.string(),
	confidence: z.number(),
	extraction_stage: z.string(),
	status: z.enum([
		'KEPT',
		'EXACT_DUPLICATE',
		'SEMANTIC_DUPLICATE',
		'DATABASE_DUPLICATE',
		'CROSS_STAGE_DUPLICATE',
	]),
	duplicate_of_index: z.number().optional(), // Index of the original triple this is a duplicate of
	existing_triple_id: z.string().optional(), // Database ID of existing triple (for DATABASE_DUPLICATE)
	stored_at: z.string().optional(), // When the existing triple was stored (for DATABASE_DUPLICATE)
	kept_from_stage: z.string().optional(), // Which stage's version was kept (for CROSS_STAGE_DUPLICATE)
	rejected_stages: z.array(z.string()).optional(), // Which other stages extracted it (for CROSS_STAGE_DUPLICATE)
});

export type TripleWithStatus = z.infer<typeof TripleWithStatusSchema>;

/**
 * Extraction stage breakdown
 *
 * Contains statistics and detailed triple information for a single extraction stage
 * (e.g., ENTITY_ENTITY, ENTITY_EVENT, EVENT_EVENT, EMOTIONAL_CONTEXT)
 */
export const StageBreakdownSchema = z.object({
	stage_name: z.string(),
	total_extracted: z.number(),
	kept: z.number(),
	exact_duplicates: z.number(),
	semantic_duplicates: z.number(),
	triples: z.array(TripleWithStatusSchema),
});

export type StageBreakdown = z.infer<typeof StageBreakdownSchema>;

/**
 * Concept with duplicate status tracking
 *
 * Used to track the status of each generated concept through the deduplication
 * process.
 */
export const ConceptWithStatusSchema = z.object({
	concept: z.string(),
	abstraction_level: z.string(),
	confidence: z.number(),
	status: z.enum(['KEPT', 'EXACT_DUPLICATE', 'SEMANTIC_DUPLICATE']),
	duplicate_of_index: z.number().optional(),
});

export type ConceptWithStatus = z.infer<typeof ConceptWithStatusSchema>;

/**
 * Raw extraction data with deduplication tracking
 *
 * Complete breakdown of extraction process including all stages and summary statistics.
 * Used for detailed analysis and benchmarking of extraction quality.
 */
export const RawExtractionDataSchema = z.object({
	stages: z.array(StageBreakdownSchema),
	summary: z.object({
		total_extracted: z.number(),
		total_kept: z.number(),
		total_exact_duplicates: z.number(),
		total_semantic_duplicates: z.number(),
		total_database_duplicates: z.number(),
		total_cross_stage_duplicates: z.number(),
	}),
});

export type RawExtractionData = z.infer<typeof RawExtractionDataSchema>;

/**
 * Duplicate analysis details
 *
 * Comprehensive analysis of duplicate detection including examples and
 * cross-stage overlap information.
 */
export interface DuplicateAnalysis {
	total_generated: number;
	internal_duplicates: number;
	database_duplicates: number;
	unique_stored: number;
	cross_stage_overlaps: Record<string, number>;
	duplicate_examples: Array<{
		triple: { subject: string; predicate: string; object: string; type: string };
		kept_from_stage: string;
		rejected_stages: string[];
	}>;
	database_duplicate_details?: Array<{
		triple: { subject: string; predicate: string; object: string; type: string };
		existing_id: string;
		stored_at: string;
	}>;
}
