/**
 * Tests for baseline-manager regression detection
 */

import { describe, expect, it } from 'vitest';
import type { BenchmarkMetrics, RegressionConfig } from '../types.js';
import {
	calculateMedian,
	calculateRollingBaseline,
	compareMetric,
	detectRegressions,
	formatRegressionSummary,
	generateRegressionReport,
} from '../baseline-manager.js';

describe('calculateMedian', () => {
	it('should calculate median of odd-length array', () => {
		expect(calculateMedian([1, 2, 3, 4, 5])).toBe(3);
	});

	it('should calculate median of even-length array', () => {
		expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
	});

	it('should handle single element', () => {
		expect(calculateMedian([42])).toBe(42);
	});

	it('should handle unsorted arrays', () => {
		expect(calculateMedian([5, 1, 3, 2, 4])).toBe(3);
	});

	it('should throw on empty array', () => {
		expect(() => calculateMedian([])).toThrow('Cannot calculate median of empty array');
	});
});

describe('calculateRollingBaseline', () => {
	const createMockRun = (overrides: Partial<BenchmarkMetrics>): BenchmarkMetrics => ({
		id: 'test-id',
		timestamp: '2025-01-01T00:00:00Z',
		benchmark_type: 'pipeline',
		config: {
			model: 'gpt-4o-mini',
			provider: 'openai',
			extraction_method: 'four-stage',
		},
		performance: {
			total_duration_ms: 10000,
			tokens_per_second: 100,
			ms_per_token: 10,
			memory_used_mb: 200,
		},
		quality: {
			triples_extracted: 100,
			concepts_extracted: 20,
			avg_confidence: 0.8,
		},
		cost: {
			input_tokens: 1000,
			output_tokens: 500,
			total_tokens: 1500,
			estimated_cost_usd: 0.01,
			api_calls: 5,
		},
		...overrides,
	});

	it('should return null for empty array', () => {
		expect(calculateRollingBaseline([])).toBeNull();
	});

	it('should calculate median metrics from multiple runs', () => {
		const runs: BenchmarkMetrics[] = [
			createMockRun({
				performance: {
					total_duration_ms: 10000,
					tokens_per_second: 100,
					ms_per_token: 10,
					memory_used_mb: 200,
				},
			}),
			createMockRun({
				performance: {
					total_duration_ms: 12000,
					tokens_per_second: 110,
					ms_per_token: 9.09,
					memory_used_mb: 210,
				},
			}),
			createMockRun({
				performance: {
					total_duration_ms: 11000,
					tokens_per_second: 105,
					ms_per_token: 9.52,
					memory_used_mb: 205,
				},
			}),
		];

		const baseline = calculateRollingBaseline(runs);

		expect(baseline).not.toBeNull();
		expect(baseline?.performance.total_duration_ms).toBe(11000);
		expect(baseline?.performance.tokens_per_second).toBe(105);
		expect(baseline?.performance.memory_used_mb).toBe(205);
	});

	it('should handle undefined quality metrics', () => {
		const runs: BenchmarkMetrics[] = [
			createMockRun({
				quality: {
					triples_extracted: 100,
					concepts_extracted: undefined,
					avg_confidence: undefined,
				},
			}),
			createMockRun({
				quality: {
					triples_extracted: 120,
					concepts_extracted: undefined,
					avg_confidence: undefined,
				},
			}),
		];

		const baseline = calculateRollingBaseline(runs);

		expect(baseline?.quality.triples_extracted).toBe(110);
		expect(baseline?.quality.concepts_extracted).toBeUndefined();
		expect(baseline?.quality.avg_confidence).toBeUndefined();
	});

	it('should use rolling-baseline as id', () => {
		const runs = [createMockRun({})];
		const baseline = calculateRollingBaseline(runs);

		expect(baseline?.id).toBe('rolling-baseline');
	});
});

describe('compareMetric', () => {
	const defaultThresholds = { warning: 10, critical: 20 };

	it('should detect no regression when within threshold', () => {
		const result = compareMetric('Test', 100, 105, defaultThresholds, false);

		expect(result).not.toBeNull();
		expect(result?.severity).toBe('OK');
		expect(result?.delta_pct).toBe(5);
	});

	it('should detect warning when exceeding warning threshold (higher is worse)', () => {
		const result = compareMetric('Test', 100, 115, defaultThresholds, false);

		expect(result?.severity).toBe('WARNING');
		expect(result?.delta_pct).toBe(15);
	});

	it('should detect critical when exceeding critical threshold (higher is worse)', () => {
		const result = compareMetric('Test', 100, 125, defaultThresholds, false);

		expect(result?.severity).toBe('CRITICAL');
		expect(result?.delta_pct).toBe(25);
	});

	it('should detect regression when metric decreases (higher is better)', () => {
		const result = compareMetric('Test', 100, 85, defaultThresholds, true);

		expect(result?.severity).toBe('WARNING');
		expect(result?.delta_pct).toBe(-15);
	});

	it('should not detect regression when metric increases (higher is better)', () => {
		const result = compareMetric('Test', 100, 115, defaultThresholds, true);

		expect(result?.severity).toBe('OK');
		expect(result?.delta_pct).toBe(15);
	});

	it('should return null when baseline is undefined', () => {
		const result = compareMetric('Test', undefined, 100, defaultThresholds, false);

		expect(result).toBeNull();
	});

	it('should return null when current is undefined', () => {
		const result = compareMetric('Test', 100, undefined, defaultThresholds, false);

		expect(result).toBeNull();
	});

	it('should handle baseline of zero', () => {
		const result = compareMetric('Test', 0, 10, defaultThresholds, false);

		expect(result).not.toBeNull();
		expect(result?.baseline).toBe(0);
		expect(result?.current).toBe(10);
		expect(result?.delta_pct).toBe(100);
	});

	it('should handle both zero values', () => {
		const result = compareMetric('Test', 0, 0, defaultThresholds, false);

		expect(result).not.toBeNull();
		expect(result?.severity).toBe('OK');
		expect(result?.delta_pct).toBe(0);
	});
});

describe('detectRegressions', () => {
	const mockConfig: RegressionConfig = {
		enabled: true,
		rolling_window: 5,
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
	};

	const createMockMetrics = (overrides: Partial<BenchmarkMetrics>): BenchmarkMetrics => ({
		id: 'test-id',
		timestamp: '2025-01-01T00:00:00Z',
		benchmark_type: 'pipeline',
		config: {
			model: 'gpt-4o-mini',
			provider: 'openai',
		},
		performance: {
			total_duration_ms: 10000,
			tokens_per_second: 100,
			ms_per_token: 10,
			memory_used_mb: 200,
		},
		quality: {
			triples_extracted: 100,
			concepts_extracted: 20,
			avg_confidence: 0.8,
		},
		cost: {
			input_tokens: 1000,
			output_tokens: 500,
			total_tokens: 1500,
			estimated_cost_usd: 0.01,
			api_calls: 5,
		},
		...overrides,
	});

	it('should detect no regression when all metrics are within thresholds', () => {
		const baseline = createMockMetrics({});
		const current = createMockMetrics({
			performance: {
				total_duration_ms: 10500, // +5%
				tokens_per_second: 105, // +5%
				ms_per_token: 9.52,
				memory_used_mb: 205, // +2.5%
			},
		});

		const analysis = detectRegressions(current, baseline, mockConfig);

		expect(analysis.has_regression).toBe(false);
		expect(analysis.summary.warning_count).toBe(0);
		expect(analysis.summary.critical_count).toBe(0);
	});

	it('should detect performance regression', () => {
		const baseline = createMockMetrics({});
		const current = createMockMetrics({
			performance: {
				total_duration_ms: 12000, // +20% - WARNING
				tokens_per_second: 100,
				ms_per_token: 10,
				memory_used_mb: 200,
			},
		});

		const analysis = detectRegressions(current, baseline, mockConfig);

		expect(analysis.has_regression).toBe(true);
		expect(analysis.summary.warning_count).toBe(1);
		expect(analysis.summary.degraded_metrics).toContain('Duration');
	});

	it('should detect quality regression', () => {
		const baseline = createMockMetrics({});
		const current = createMockMetrics({
			quality: {
				triples_extracted: 85, // -15% - WARNING
				concepts_extracted: 20,
				avg_confidence: 0.8,
			},
		});

		const analysis = detectRegressions(current, baseline, mockConfig);

		expect(analysis.has_regression).toBe(true);
		expect(analysis.summary.warning_count).toBe(1);
		expect(analysis.summary.degraded_metrics).toContain('Triples Extracted');
	});

	it('should detect cost regression', () => {
		const baseline = createMockMetrics({});
		const current = createMockMetrics({
			cost: {
				input_tokens: 1000,
				output_tokens: 500,
				total_tokens: 1800, // +20% - WARNING
				estimated_cost_usd: 0.012, // +20% - WARNING
				api_calls: 5,
			},
		});

		const analysis = detectRegressions(current, baseline, mockConfig);

		expect(analysis.has_regression).toBe(true);
		expect(analysis.summary.warning_count).toBe(2);
		expect(analysis.summary.degraded_metrics).toContain('Total Cost');
		expect(analysis.summary.degraded_metrics).toContain('Total Tokens');
	});

	it('should detect critical regressions', () => {
		const baseline = createMockMetrics({});
		const current = createMockMetrics({
			performance: {
				total_duration_ms: 14000, // +40% - CRITICAL
				tokens_per_second: 100,
				ms_per_token: 10,
				memory_used_mb: 200,
			},
		});

		const analysis = detectRegressions(current, baseline, mockConfig);

		expect(analysis.has_regression).toBe(true);
		expect(analysis.summary.critical_count).toBe(1);
		expect(analysis.summary.warning_count).toBe(0);
	});

	it('should handle multiple regressions', () => {
		const baseline = createMockMetrics({});
		const current = createMockMetrics({
			performance: {
				total_duration_ms: 12000, // +20% - WARNING
				tokens_per_second: 85, // -15% - WARNING
				ms_per_token: 11.76,
				memory_used_mb: 250, // +25% - WARNING
			},
			quality: {
				triples_extracted: 85, // -15% - WARNING
				concepts_extracted: 20,
				avg_confidence: 0.75, // -6.25% - WARNING
			},
		});

		const analysis = detectRegressions(current, baseline, mockConfig);

		expect(analysis.has_regression).toBe(true);
		expect(analysis.summary.warning_count).toBe(5);
		expect(analysis.summary.degraded_metrics.length).toBe(5);
	});

	it('should handle missing quality metrics gracefully', () => {
		const baseline = createMockMetrics({
			quality: {
				triples_extracted: 100,
				concepts_extracted: undefined,
				avg_confidence: undefined,
			},
		});
		const current = createMockMetrics({
			quality: {
				triples_extracted: 100,
				concepts_extracted: undefined,
				avg_confidence: undefined,
			},
		});

		const analysis = detectRegressions(current, baseline, mockConfig);

		// Should only compare available metrics
		expect(analysis.comparisons.quality.length).toBe(1); // Only triples_extracted
		expect(analysis.comparisons.quality[0].name).toBe('Triples Extracted');
	});
});

describe('generateRegressionReport', () => {
	it('should generate report with no regressions', () => {
		const analysis = {
			has_regression: false,
			baseline_strategy: 'rolling',
			baseline_run_ids: ['baseline-id'],
			comparisons: {
				performance: [
					{
						name: 'Duration',
						baseline: 10000,
						current: 10500,
						delta_pct: 5,
						severity: 'OK' as const,
					},
				],
				quality: [],
				cost: [],
			},
			summary: {
				total_metrics: 1,
				warning_count: 0,
				critical_count: 0,
				degraded_metrics: [],
			},
		};

		const report = generateRegressionReport(analysis);

		expect(report).toContain('✅ NO REGRESSIONS');
		expect(report).toContain('All metrics are within acceptable thresholds');
	});

	it('should generate report with warnings', () => {
		const analysis = {
			has_regression: true,
			baseline_strategy: 'rolling',
			baseline_run_ids: ['baseline-id'],
			comparisons: {
				performance: [
					{
						name: 'Duration',
						baseline: 10000,
						current: 12000,
						delta_pct: 20,
						severity: 'WARNING' as const,
					},
				],
				quality: [],
				cost: [],
			},
			summary: {
				total_metrics: 1,
				warning_count: 1,
				critical_count: 0,
				degraded_metrics: ['Duration'],
			},
		};

		const report = generateRegressionReport(analysis);

		expect(report).toContain('⚠️ REGRESSION DETECTED');
		expect(report).toContain('Duration');
		expect(report).toContain('+20.0%');
		expect(report).toContain('⚠️ WARNING');
	});
});

describe('formatRegressionSummary', () => {
	it('should format summary for no regressions', () => {
		const analysis = {
			has_regression: false,
			baseline_strategy: 'rolling',
			baseline_run_ids: ['baseline-id'],
			comparisons: { performance: [], quality: [], cost: [] },
			summary: {
				total_metrics: 1,
				warning_count: 0,
				critical_count: 0,
				degraded_metrics: [],
			},
		};

		const summary = formatRegressionSummary(analysis);

		expect(summary).toContain('✅');
		expect(summary).toContain('No regressions');
	});

	it('should format summary for regressions', () => {
		const analysis = {
			has_regression: true,
			baseline_strategy: 'rolling',
			baseline_run_ids: ['baseline-id'],
			comparisons: {
				performance: [
					{
						name: 'Duration',
						baseline: 10000,
						current: 12000,
						delta_pct: 20,
						severity: 'WARNING' as const,
					},
				],
				quality: [],
				cost: [],
			},
			summary: {
				total_metrics: 1,
				warning_count: 1,
				critical_count: 0,
				degraded_metrics: ['Duration'],
			},
		};

		const summary = formatRegressionSummary(analysis);

		expect(summary).toContain('⚠️');
		expect(summary).toContain('REGRESSION DETECTED');
		expect(summary).toContain('Duration');
		expect(summary).toContain('+20.0%');
	});
});
