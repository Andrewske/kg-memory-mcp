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
	 * Extraction method (always four-stage for benchmarks)
	 */
	extractionMethod: 'four-stage' as const,

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
} as const;

export type BenchmarkConfig = typeof benchmarkConfig;
