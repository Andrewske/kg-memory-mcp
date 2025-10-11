/**
 * Baseline management and regression detection for benchmarks
 * Pure functional implementation - all state passed explicitly
 */

import type {
	BenchmarkMetrics,
	MetricComparison,
	RegressionAnalysis,
	RegressionConfig,
	RegressionSeverity,
	RegressionThresholds,
} from './types.js';

/**
 * Calculate median of numeric array
 */
export function calculateMedian(values: number[]): number {
	if (values.length === 0) {
		throw new Error('Cannot calculate median of empty array');
	}

	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);

	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1] + sorted[mid]) / 2;
	}

	return sorted[mid];
}

/**
 * Calculate rolling baseline metrics from recent runs
 * Uses median for statistical stability (resistant to outliers)
 */
export function calculateRollingBaseline(
	recentRuns: BenchmarkMetrics[]
): BenchmarkMetrics | null {
	if (recentRuns.length === 0) {
		return null;
	}

	// Extract all numeric metrics
	const durations = recentRuns.map(r => r.performance.total_duration_ms);
	const tokensPerSec = recentRuns.map(r => r.performance.tokens_per_second);
	const memory = recentRuns.map(r => r.performance.memory_used_mb);

	const triples = recentRuns
		.map(r => r.quality.triples_extracted)
		.filter((v): v is number => v !== undefined);
	const concepts = recentRuns
		.map(r => r.quality.concepts_extracted)
		.filter((v): v is number => v !== undefined);
	const confidence = recentRuns
		.map(r => r.quality.avg_confidence)
		.filter((v): v is number => v !== undefined);

	const inputTokens = recentRuns.map(r => r.cost.input_tokens);
	const outputTokens = recentRuns.map(r => r.cost.output_tokens);
	const totalTokens = recentRuns.map(r => r.cost.total_tokens);
	const costs = recentRuns.map(r => r.cost.estimated_cost_usd);
	const apiCalls = recentRuns.map(r => r.cost.api_calls);

	// Use first run as template, replace metrics with medians
	const template = recentRuns[0];

	return {
		...template,
		id: 'rolling-baseline',
		timestamp: new Date().toISOString(),
		performance: {
			total_duration_ms: calculateMedian(durations),
			tokens_per_second: calculateMedian(tokensPerSec),
			ms_per_token:
				1000 / calculateMedian(tokensPerSec), // Recalculate from tokens_per_second
			memory_used_mb: calculateMedian(memory),
			stage_durations: undefined,
		},
		quality: {
			triples_extracted: triples.length > 0 ? calculateMedian(triples) : undefined,
			concepts_extracted: concepts.length > 0 ? calculateMedian(concepts) : undefined,
			avg_confidence: confidence.length > 0 ? calculateMedian(confidence) : undefined,
			// Other quality metrics undefined in baseline
			triples_generated: undefined,
			concepts_generated: undefined,
			duplicates_removed: undefined,
			duplicate_rate: undefined,
			search_recall: undefined,
			search_precision: undefined,
		},
		cost: {
			input_tokens: Math.round(calculateMedian(inputTokens)),
			output_tokens: Math.round(calculateMedian(outputTokens)),
			total_tokens: Math.round(calculateMedian(totalTokens)),
			estimated_cost_usd: calculateMedian(costs),
			api_calls: Math.round(calculateMedian(apiCalls)),
		},
	};
}

/**
 * Compare a single metric and determine regression severity
 * For performance/cost: positive delta is worse
 * For quality: negative delta is worse
 */
export function compareMetric(
	name: string,
	baseline: number | undefined,
	current: number | undefined,
	thresholds: RegressionThresholds,
	higherIsBetter: boolean
): MetricComparison | null {
	// Skip if either value is missing
	if (baseline === undefined || current === undefined) {
		return null;
	}

	// Avoid division by zero
	if (baseline === 0) {
		return {
			name,
			baseline: 0,
			current,
			delta_pct: current === 0 ? 0 : 100,
			severity: current === 0 ? 'OK' : 'WARNING',
		};
	}

	const delta_pct = ((current - baseline) / baseline) * 100;

	// Determine if this is a regression
	const absoluteDelta = Math.abs(delta_pct);
	const isRegression = higherIsBetter ? delta_pct < 0 : delta_pct > 0;

	let severity: RegressionSeverity = 'OK';
	if (isRegression) {
		if (absoluteDelta >= thresholds.critical) {
			severity = 'CRITICAL';
		} else if (absoluteDelta >= thresholds.warning) {
			severity = 'WARNING';
		}
	}

	return {
		name,
		baseline,
		current,
		delta_pct,
		severity,
	};
}

/**
 * Detect regressions by comparing current run against baseline
 */
export function detectRegressions(
	current: BenchmarkMetrics,
	baseline: BenchmarkMetrics,
	config: RegressionConfig
): RegressionAnalysis {
	const comparisons: RegressionAnalysis['comparisons'] = {
		performance: [],
		quality: [],
		cost: [],
	};

	// Performance metrics (lower is better)
	const perfComparisons = [
		compareMetric(
			'Duration',
			baseline.performance.total_duration_ms,
			current.performance.total_duration_ms,
			config.thresholds.performance.total_duration_ms,
			false
		),
		compareMetric(
			'Tokens/Second',
			baseline.performance.tokens_per_second,
			current.performance.tokens_per_second,
			config.thresholds.performance.tokens_per_second,
			true
		),
		compareMetric(
			'Memory',
			baseline.performance.memory_used_mb,
			current.performance.memory_used_mb,
			config.thresholds.performance.memory_used_mb,
			false
		),
	].filter((c): c is MetricComparison => c !== null);
	comparisons.performance = perfComparisons;

	// Quality metrics (higher is better)
	const qualityComparisons = [
		compareMetric(
			'Triples Extracted',
			baseline.quality.triples_extracted,
			current.quality.triples_extracted,
			config.thresholds.quality.triples_extracted,
			true
		),
		compareMetric(
			'Concepts Extracted',
			baseline.quality.concepts_extracted,
			current.quality.concepts_extracted,
			config.thresholds.quality.concepts_extracted,
			true
		),
		compareMetric(
			'Avg Confidence',
			baseline.quality.avg_confidence,
			current.quality.avg_confidence,
			config.thresholds.quality.avg_confidence,
			true
		),
	].filter((c): c is MetricComparison => c !== null);
	comparisons.quality = qualityComparisons;

	// Cost metrics (lower is better)
	const costComparisons = [
		compareMetric(
			'Total Cost',
			baseline.cost.estimated_cost_usd,
			current.cost.estimated_cost_usd,
			config.thresholds.cost.estimated_cost_usd,
			false
		),
		compareMetric(
			'Total Tokens',
			baseline.cost.total_tokens,
			current.cost.total_tokens,
			config.thresholds.cost.total_tokens,
			false
		),
	].filter((c): c is MetricComparison => c !== null);
	comparisons.cost = costComparisons;

	// Calculate summary
	const allComparisons = [...perfComparisons, ...qualityComparisons, ...costComparisons];
	const warning_count = allComparisons.filter(c => c.severity === 'WARNING').length;
	const critical_count = allComparisons.filter(c => c.severity === 'CRITICAL').length;
	const degraded_metrics = allComparisons
		.filter(c => c.severity === 'WARNING' || c.severity === 'CRITICAL')
		.map(c => c.name);

	return {
		has_regression: warning_count > 0 || critical_count > 0,
		baseline_strategy: 'rolling',
		baseline_run_ids: [baseline.id],
		comparisons,
		summary: {
			total_metrics: allComparisons.length,
			warning_count,
			critical_count,
			degraded_metrics,
		},
	};
}

/**
 * Format regression analysis as markdown section
 */
export function generateRegressionReport(analysis: RegressionAnalysis): string {
	const lines: string[] = [];

	lines.push('\n---\n\n## 🔍 Regression Analysis\n\n');
	lines.push(`**Baseline Strategy**: Rolling median of recent runs\n`);
	lines.push(`**Status**: ${analysis.has_regression ? '⚠️ REGRESSION DETECTED' : '✅ NO REGRESSIONS'}\n\n`);

	// Helper to format metric rows
	const formatMetricRow = (comp: MetricComparison): string => {
		const statusIcon =
			comp.severity === 'CRITICAL' ? '🔴' : comp.severity === 'WARNING' ? '⚠️' : '✅';
		const sign = comp.delta_pct >= 0 ? '+' : '';
		return `| ${comp.name} | ${formatNumber(comp.baseline)} | ${formatNumber(comp.current)} | ${sign}${comp.delta_pct.toFixed(1)}% | ${statusIcon} ${comp.severity} |`;
	};

	// Helper to format numbers
	const formatNumber = (value: number): string => {
		if (value >= 1000) {
			return value.toLocaleString();
		}
		if (value < 1) {
			return value.toFixed(4);
		}
		return value.toFixed(2);
	};

	// Performance metrics table
	if (analysis.comparisons.performance.length > 0) {
		lines.push('### Performance Comparison\n\n');
		lines.push('| Metric | Baseline | Current | Delta | Status |\n');
		lines.push('|--------|----------|---------|-------|--------|\n');
		for (const comp of analysis.comparisons.performance) {
			lines.push(formatMetricRow(comp) + '\n');
		}
		lines.push('\n');
	}

	// Quality metrics table
	if (analysis.comparisons.quality.length > 0) {
		lines.push('### Quality Comparison\n\n');
		lines.push('| Metric | Baseline | Current | Delta | Status |\n');
		lines.push('|--------|----------|---------|-------|--------|\n');
		for (const comp of analysis.comparisons.quality) {
			lines.push(formatMetricRow(comp) + '\n');
		}
		lines.push('\n');
	}

	// Cost metrics table
	if (analysis.comparisons.cost.length > 0) {
		lines.push('### Cost Comparison\n\n');
		lines.push('| Metric | Baseline | Current | Delta | Status |\n');
		lines.push('|--------|----------|---------|-------|--------|\n');
		for (const comp of analysis.comparisons.cost) {
			lines.push(formatMetricRow(comp) + '\n');
		}
		lines.push('\n');
	}

	// Summary
	if (analysis.has_regression) {
		lines.push('### Summary\n\n');
		lines.push(
			`⚠️ **${analysis.summary.degraded_metrics.length} metric${analysis.summary.degraded_metrics.length > 1 ? 's' : ''} exceeded threshold${analysis.summary.degraded_metrics.length > 1 ? 's' : ''}**\n\n`
		);
		lines.push('**Degraded Metrics:**\n');
		for (const metric of analysis.summary.degraded_metrics) {
			const comp = [
				...analysis.comparisons.performance,
				...analysis.comparisons.quality,
				...analysis.comparisons.cost,
			].find(c => c.name === metric);
			if (comp) {
				const sign = comp.delta_pct >= 0 ? '+' : '';
				lines.push(`- ${metric}: ${sign}${comp.delta_pct.toFixed(1)}%\n`);
			}
		}
	} else {
		lines.push('### Summary\n\n');
		lines.push('✅ **All metrics are within acceptable thresholds**\n');
	}

	return lines.join('');
}

/**
 * Format regression summary for console output
 */
export function formatRegressionSummary(analysis: RegressionAnalysis): string {
	if (!analysis.has_regression) {
		return '✅ No regressions detected - all metrics within thresholds';
	}

	const lines: string[] = [];
	lines.push('⚠️  REGRESSION DETECTED');
	lines.push('');
	lines.push(`${analysis.summary.degraded_metrics.length} metric(s) exceeded thresholds:`);
	for (const metric of analysis.summary.degraded_metrics) {
		const comp = [
			...analysis.comparisons.performance,
			...analysis.comparisons.quality,
			...analysis.comparisons.cost,
		].find(c => c.name === metric);
		if (comp) {
			const sign = comp.delta_pct >= 0 ? '+' : '';
			const icon = comp.severity === 'CRITICAL' ? '🔴' : '⚠️';
			lines.push(`  ${icon} ${metric}: ${sign}${comp.delta_pct.toFixed(1)}%`);
		}
	}

	return lines.join('\n');
}
