/**
 * Metrics calculation utilities for benchmarks
 */

import type { BenchmarkMetrics, CostMetrics, PerformanceMetrics } from './types.js';

/**
 * Calculate performance metrics from duration and token counts
 */
export function calculatePerformanceMetrics(
	durationMs: number,
	totalTokens: number,
	memoryUsedMb: number,
	stageDurations?: Record<string, number>
): PerformanceMetrics {
	return {
		total_duration_ms: durationMs,
		stage_durations: stageDurations,
		tokens_per_second: totalTokens / (durationMs / 1000),
		ms_per_token: durationMs / totalTokens,
		memory_used_mb: memoryUsedMb,
	};
}

/**
 * Calculate cost metrics from token usage
 */
export function calculateCostMetrics(
	inputTokens: number,
	outputTokens: number,
	apiCalls: number,
	model: string = 'gpt-4o-mini'
): CostMetrics {
	// Pricing per million tokens (as of 2025)
	const pricing: Record<string, { input: number; output: number }> = {
		'gpt-4o-mini': { input: 0.15, output: 0.6 }, // $0.15/$0.60 per 1M tokens
		'gpt-4o': { input: 2.5, output: 10.0 }, // $2.50/$10.00 per 1M tokens
		'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 }, // $3/$15 per 1M tokens
		'claude-3-5-haiku-20241022': { input: 1.0, output: 5.0 }, // $1/$5 per 1M tokens
	};

	const modelPricing = pricing[model] || pricing['gpt-4o-mini']; // Default fallback

	const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
	const outputCost = (outputTokens / 1_000_000) * modelPricing.output;

	return {
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		total_tokens: inputTokens + outputTokens,
		estimated_cost_usd: inputCost + outputCost,
		api_calls: apiCalls,
	};
}

/**
 * Calculate percentage delta between two values
 */
export function calculateDelta(baseline: number, current: number): number {
	if (baseline === 0) return current === 0 ? 0 : 100;
	return ((current - baseline) / baseline) * 100;
}

/**
 * Format delta as string with sign
 */
export function formatDelta(delta: number, decimals: number = 1): string {
	const sign = delta > 0 ? '+' : '';
	return `${sign}${delta.toFixed(decimals)}%`;
}

/**
 * Calculate average confidence from triples or concepts
 */
export function calculateAverageConfidence(
	items: Array<{ confidence?: string | number }>
): number | undefined {
	const confidences = items
		.map(item => {
			const conf = item.confidence;
			if (typeof conf === 'number') return conf;
			if (typeof conf === 'string') return Number.parseFloat(conf);
			return null;
		})
		.filter((c): c is number => c !== null && !Number.isNaN(c) && c > 0);

	if (confidences.length === 0) return undefined;

	return confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
}

/**
 * Calculate memory usage delta
 */
export function getMemoryUsageMb(): number {
	const usage = process.memoryUsage();
	return usage.heapUsed / 1024 / 1024;
}

/**
 * Compare two benchmark results
 */
export function compareBenchmarks(baseline: BenchmarkMetrics, current: BenchmarkMetrics) {
	return {
		duration_pct: calculateDelta(
			baseline.performance.total_duration_ms,
			current.performance.total_duration_ms
		),
		tokens_per_second_pct: calculateDelta(
			baseline.performance.tokens_per_second,
			current.performance.tokens_per_second
		),
		triples_pct: calculateDelta(
			baseline.quality.triples_extracted || 0,
			current.quality.triples_extracted || 0
		),
		concepts_pct: calculateDelta(
			baseline.quality.concepts_generated || 0,
			current.quality.concepts_generated || 0
		),
		cost_pct: calculateDelta(baseline.cost.estimated_cost_usd, current.cost.estimated_cost_usd),
		confidence_pct: calculateDelta(
			baseline.quality.avg_confidence || 0,
			current.quality.avg_confidence || 0
		),
	};
}
