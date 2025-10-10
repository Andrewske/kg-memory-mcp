/**
 * Shared types and Zod schemas for benchmark system
 */

import { z } from 'zod';

// Import shared extraction metadata types for local use and re-export
import {
	type RawExtractionData,
	RawExtractionDataSchema,
	type StageBreakdown,
	StageBreakdownSchema,
	type TripleWithStatus,
	TripleWithStatusSchema,
	type ConceptWithStatus,
	ConceptWithStatusSchema,
} from '~/shared/types/extraction-metadata.js';

// Re-export for external consumers
export {
	type RawExtractionData,
	RawExtractionDataSchema,
	type StageBreakdown,
	StageBreakdownSchema,
	type TripleWithStatus,
	TripleWithStatusSchema,
	type ConceptWithStatus,
	ConceptWithStatusSchema,
};

/**
 * Benchmark configuration schema
 */
export const BenchmarkConfigSchema = z.object({
	model: z.string(),
	provider: z.enum(['openai', 'anthropic']),
	extraction_method: z.enum(['single-pass', 'four-stage']).optional(),
	batch_size: z.number().positive().optional(),
	temperature: z.number().min(0).max(2).optional(),
	prompt_version: z.string().optional(),
	custom_params: z.record(z.unknown()).optional(),
});

export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;

/**
 * Performance metrics schema
 */
export const PerformanceMetricsSchema = z.object({
	total_duration_ms: z.number().nonnegative(),
	stage_durations: z.record(z.number()).optional(),
	tokens_per_second: z.number().nonnegative(),
	ms_per_token: z.number().nonnegative(),
	memory_used_mb: z.number().nonnegative(),
});

export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

/**
 * Quality metrics schema
 */
export const QualityMetricsSchema = z.object({
	triples_generated: z.number().nonnegative().optional(), // NEW: Total AI output
	triples_extracted: z.number().nonnegative().optional(), // RENAMED: Unique stored
	concepts_generated: z.number().nonnegative().optional(), // NEW: Total AI output
	concepts_extracted: z.number().nonnegative().optional(), // RENAMED: Unique stored
	duplicates_removed: z.number().nonnegative().optional(),
	duplicate_rate: z.number().min(0).max(1).optional(),
	avg_confidence: z.number().min(0).max(1).optional(),
	search_recall: z.number().min(0).max(1).optional(),
	search_precision: z.number().min(0).max(1).optional(),
});

export type QualityMetrics = z.infer<typeof QualityMetricsSchema>;

/**
 * Cost metrics schema
 */
export const CostMetricsSchema = z.object({
	input_tokens: z.number().nonnegative(),
	output_tokens: z.number().nonnegative(),
	total_tokens: z.number().nonnegative(),
	estimated_cost_usd: z.number().nonnegative(),
	api_calls: z.number().nonnegative(),
});

export type CostMetrics = z.infer<typeof CostMetricsSchema>;

/**
 * Duplicate analysis schema
 */
export const DuplicateAnalysisSchema = z
	.object({
		total_generated: z.number(),
		internal_duplicates: z.number(),
		database_duplicates: z.number(),
		unique_stored: z.number(),
		cross_stage_overlaps: z.record(z.number()),
		duplicate_examples: z.array(
			z.object({
				triple: z.object({
					subject: z.string(),
					predicate: z.string(),
					object: z.string(),
					type: z.string(),
				}),
				kept_from_stage: z.string(),
				rejected_stages: z.array(z.string()),
			})
		),
		database_duplicate_details: z
			.array(
				z.object({
					triple: z.object({
						subject: z.string(),
						predicate: z.string(),
						object: z.string(),
						type: z.string(),
					}),
					existing_id: z.string(),
					stored_at: z.string(), // ISO date string
				})
			)
			.optional(),
		cross_stage_duplicate_details: z
			.array(
				z.object({
					triple: z.object({
						subject: z.string(),
						predicate: z.string(),
						object: z.string(),
						type: z.string(),
					}),
					kept_from_stage: z.string(),
					rejected_stages: z.array(z.string()),
				})
			)
			.optional(),
	})
	.optional();

export type DuplicateAnalysis = z.infer<typeof DuplicateAnalysisSchema>;

/**
 * Sample triple schema
 */
export const SampleTripleSchema = z.object({
	subject: z.string(),
	predicate: z.string(),
	object: z.string(),
	type: z.string(),
	confidence: z.number(),
	extraction_stage: z.string().optional(),
});

export type SampleTriple = z.infer<typeof SampleTripleSchema>;



/**
 * Fixture information schema
 */
export const FixtureInfoSchema = z
	.object({
		filename: z.string(),
		char_count: z.number().nonnegative(),
		estimated_tokens: z.number().nonnegative(),
	})
	.optional();

export type FixtureInfo = z.infer<typeof FixtureInfoSchema>;

/**
 * Frequent term with count
 */
export const FrequentTermSchema = z.object({
	term: z.string(),
	count: z.number().nonnegative(),
});

export type FrequentTerm = z.infer<typeof FrequentTermSchema>;

/**
 * Vocabulary analysis schema
 */
export const VocabularyAnalysisSchema = z
	.object({
		novelty_rate: z.number().min(0).max(1),
		recognition_rate: z.number().min(0).max(1),
		new_terms_count: z.number().nonnegative(),
		known_terms_count: z.number().nonnegative(),
		total_terms: z.number().nonnegative(),
		new_term_list: z.object({
			entities: z.array(z.string()),
			relationships: z.array(z.string()),
			concepts: z.array(z.string()),
		}),
		vocabulary_size: z.object({
			entities: z.number().nonnegative(),
			relationships: z.number().nonnegative(),
			concepts: z.number().nonnegative(),
			total: z.number().nonnegative(),
		}),
		vocabulary_growth: z.object({
			entities: z.number(),
			relationships: z.number(),
			concepts: z.number(),
			total: z.number(),
		}),
		top_frequent: z.object({
			entities: z.array(FrequentTermSchema),
			relationships: z.array(FrequentTermSchema),
			concepts: z.array(FrequentTermSchema),
		}),
		total_runs: z.number().nonnegative(),
	})
	.optional();

export type VocabularyAnalysis = z.infer<typeof VocabularyAnalysisSchema>;

/**
 * Output analysis schema (optional detailed analysis)
 */
export const OutputAnalysisSchema = z
	.object({
		abstraction_levels: z.record(z.number()).optional(),
		triple_types: z.record(z.number()).optional(),
		sample_outputs: z.array(z.unknown()).optional(),
		sample_triples: z.array(SampleTripleSchema).optional(), // NEW
		duplicate_analysis: DuplicateAnalysisSchema, // NEW
		vocabulary_analysis: VocabularyAnalysisSchema,
		raw_extraction_data: RawExtractionDataSchema.optional(), // NEW: Full extraction breakdown
		concepts_generated: z.array(ConceptWithStatusSchema).optional(), // NEW: All concepts with status
	})
	.optional();

export type OutputAnalysis = z.infer<typeof OutputAnalysisSchema>;

/**
 * Complete benchmark metrics schema
 */
export const BenchmarkMetricsSchema = z.object({
	id: z.string().uuid(),
	timestamp: z.string().datetime({ offset: true }),
	benchmark_type: z.enum(['pipeline', 'extraction', 'concepts', 'dedup', 'search']),
	config: BenchmarkConfigSchema,
	performance: PerformanceMetricsSchema,
	quality: QualityMetricsSchema,
	cost: CostMetricsSchema,
	output_analysis: OutputAnalysisSchema,
	fixture_info: FixtureInfoSchema,
	notes: z.string().optional(),
});

export type BenchmarkMetrics = z.infer<typeof BenchmarkMetricsSchema>;

/**
 * Benchmark result with file paths
 */
export interface BenchmarkResult {
	metrics: BenchmarkMetrics;
	jsonPath: string;
	mdPath: string;
	regressionAnalysis?: RegressionAnalysis;
}

/**
 * Comparison filter options
 */
export interface ComparisonFilters {
	last?: number;
	ids?: string[];
	promptVersion?: string;
	from?: Date;
	to?: Date;
}

/**
 * Comparison result
 */
export interface ComparisonResult {
	baseline: BenchmarkMetrics;
	current: BenchmarkMetrics;
	deltas: {
		duration_pct: number;
		tokens_per_second_pct: number;
		triples_pct: number;
		concepts_pct: number;
		cost_pct: number;
		confidence_pct: number;
	};
}

/**
 * Regression severity levels
 */
export type RegressionSeverity = 'OK' | 'WARNING' | 'CRITICAL';

/**
 * Metric comparison result
 */
export interface MetricComparison {
	name: string;
	baseline: number;
	current: number;
	delta_pct: number;
	severity: RegressionSeverity;
}

/**
 * Regression analysis result
 */
export interface RegressionAnalysis {
	has_regression: boolean;
	baseline_strategy: string;
	baseline_run_ids: string[];
	comparisons: {
		performance: MetricComparison[];
		quality: MetricComparison[];
		cost: MetricComparison[];
	};
	summary: {
		total_metrics: number;
		warning_count: number;
		critical_count: number;
		degraded_metrics: string[];
	};
}

/**
 * Regression threshold configuration
 */
export interface RegressionThresholds {
	warning: number;
	critical: number;
}

/**
 * Regression detection configuration
 */
export interface RegressionConfig {
	enabled: boolean;
	rolling_window: number;
	thresholds: {
		performance: Record<string, RegressionThresholds>;
		quality: Record<string, RegressionThresholds>;
		cost: Record<string, RegressionThresholds>;
	};
}
