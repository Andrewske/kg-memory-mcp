/**
 * Benchmark Configuration
 *
 * Centralized configuration for benchmark runs.
 * Edit this file to change benchmark defaults instead of using CLI flags.
 */

import { env } from '~/shared/env.js';

export const benchmarkConfig = {
	/**
	 * Default test fixture to use (~8K chars, ~2K tokens)
	 */
	defaultFixture: 'default' as const,

	/**
	 * Enable deduplication by default
	 */
	enableDeduplication: true,

	/**
	 * AI model to use for extraction
	 */
	model: env.AI_MODEL || 'gpt-4o-mini',

	/**
	 * AI provider (openai or anthropic)
	 */
	provider: (env.AI_PROVIDER || 'openai') as 'openai' | 'anthropic',

	/**
	 * Vocabulary tracking configuration
	 */
	vocabulary: {
		/**
		 * Enable vocabulary frequency tracking
		 */
		enabled: true,

		/**
		 * Path to vocabulary storage file (relative to project root)
		 */
		path: 'benchmarks/vocabulary.json',
	},

	/**
	 * Prompt version for tracking iterations (optional)
	 * Update this when making significant prompt changes
	 */
	promptVersion: 'v1.0',

	/**
	 * Optional notes for this benchmark configuration
	 */
	notes: '',

	/**
	 * Regression detection configuration
	 */
	regression: {
		/**
		 * Enable automatic regression detection
		 */
		enabled: true,

		/**
		 * Number of recent runs to use for rolling median baseline
		 */
		rolling_window: 5,

		/**
		 * Threshold percentages for regression detection
		 * Format: { warning: %, critical: % }
		 */
		thresholds: {
			performance: {
				total_duration_ms: { warning: 15, critical: 30 },
				tokens_per_second: { warning: 10, critical: 20 },
				memory_used_mb: { warning: 20, critical: 40 },
			},
			quality: {
				triples_extracted: { warning: 10, critical: 20 },
				concepts_extracted: { warning: 15, critical: 30 },
				avg_confidence: { warning: 5, critical: 10 },
			},
			cost: {
				estimated_cost_usd: { warning: 15, critical: 30 },
				total_tokens: { warning: 15, critical: 30 },
			},
		},
	},
} as const;

export type BenchmarkConfig = typeof benchmarkConfig;
