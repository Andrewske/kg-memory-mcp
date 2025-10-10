/**
 * Benchmark Comparison Tool
 * Compare benchmark results across iterations
 */

import { parseArgs } from 'node:util';
import { compareBenchmarks, formatDelta } from './shared/metrics-calculator.js';
import { loadBenchmarkResults } from './shared/storage.js';
import type { BenchmarkMetrics, ComparisonFilters } from './shared/types.js';

/**
 * Print comparison table
 */
function printComparisonTable(results: BenchmarkMetrics[]): void {
	if (results.length === 0) {
		console.log('No benchmark results found.');
		return;
	}

	console.log('\n📊 BENCHMARK COMPARISON\n');
	console.log(`Comparing ${results.length} ${results[0].benchmark_type} benchmark runs\n`);

	// Table headers
	const headers = [
		'Run',
		'Timestamp',
		'Model',
		'Prompt',
		'Duration (ms)',
		'Δ%',
		'Quality',
		'Cost ($)',
	];
	const colWidths = [12, 20, 15, 10, 15, 8, 12, 10];

	// Print header
	console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(' │ '));
	console.log('─'.repeat(colWidths.reduce((sum, w) => sum + w + 3, 0)));

	// Print rows
	const baseline = results[0];
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		const isBaseline = i === 0;

		// Calculate delta from baseline
		const durationDelta = isBaseline
			? '-'
			: formatDelta(
					((r.performance.total_duration_ms - baseline.performance.total_duration_ms) /
						baseline.performance.total_duration_ms) *
						100
				);

		// Quality metric (varies by benchmark type)
		let quality = '-';
		if (r.quality.triples_extracted) {
			quality = r.quality.triples_extracted.toString();
		} else if (r.quality.concepts_generated) {
			quality = r.quality.concepts_generated.toString();
		}

		const row = [
			(isBaseline ? `${r.id.slice(0, 8)} (base)` : r.id.slice(0, 8)).padEnd(colWidths[0]),
			new Date(r.timestamp).toISOString().slice(0, 19).replace('T', ' ').padEnd(colWidths[1]),
			r.config.model.padEnd(colWidths[2]),
			(r.config.prompt_version || 'N/A').padEnd(colWidths[3]),
			r.performance.total_duration_ms.toLocaleString().padEnd(colWidths[4]),
			durationDelta.padEnd(colWidths[5]),
			quality.padEnd(colWidths[6]),
			r.cost.estimated_cost_usd.toFixed(4).padEnd(colWidths[7]),
		];

		console.log(row.join(' │ '));
	}

	console.log('');
}

/**
 * Print improvement analysis
 */
function printImprovementAnalysis(results: BenchmarkMetrics[]): void {
	if (results.length < 2) {
		console.log('Need at least 2 results for comparison analysis.\n');
		return;
	}

	const baseline = results[0];
	const latest = results[results.length - 1];

	console.log('🏆 IMPROVEMENT SUMMARY\n');
	console.log(
		`Baseline: ${baseline.id.slice(0, 8)} (${new Date(baseline.timestamp).toISOString()})`
	);
	console.log(`Latest:   ${latest.id.slice(0, 8)} (${new Date(latest.timestamp).toISOString()})`);
	console.log('');

	const deltas = compareBenchmarks(baseline, latest);

	// Duration
	const durationImproved = deltas.duration_pct < 0;
	console.log(
		`${durationImproved ? '⚡' : '⚠️ '} Speed: ${formatDelta(deltas.duration_pct)} ${durationImproved ? '(faster)' : '(slower)'}`
	);

	// Quality metrics
	if (baseline.quality.triples_extracted && latest.quality.triples_extracted) {
		const qualityImproved = deltas.triples_pct > 0;
		console.log(
			`${qualityImproved ? '📈' : '📉'} Triples: ${formatDelta(deltas.triples_pct)} ${qualityImproved ? '(more)' : '(fewer)'}`
		);
	}

	if (baseline.quality.concepts_generated && latest.quality.concepts_generated) {
		const conceptsImproved = deltas.concepts_pct > 0;
		console.log(
			`${conceptsImproved ? '📈' : '📉'} Concepts: ${formatDelta(deltas.concepts_pct)} ${conceptsImproved ? '(more)' : '(fewer)'}`
		);
	}

	if (baseline.quality.avg_confidence && latest.quality.avg_confidence) {
		const confidenceImproved = deltas.confidence_pct > 0;
		console.log(
			`${confidenceImproved ? '✨' : '⚠️ '} Confidence: ${formatDelta(deltas.confidence_pct)} ${confidenceImproved ? '(higher)' : '(lower)'}`
		);
	}

	// Cost
	const costImproved = deltas.cost_pct < 0;
	console.log(
		`${costImproved ? '💰' : '💸'} Cost: ${formatDelta(deltas.cost_pct)} ${costImproved ? '(cheaper)' : '(more expensive)'}`
	);

	console.log('');

	// Overall assessment
	const improvements = [
		durationImproved,
		deltas.triples_pct > 0,
		deltas.concepts_pct > 0,
		deltas.confidence_pct > 0,
		costImproved,
	].filter(Boolean).length;

	const regressions = 5 - improvements;

	if (improvements > regressions) {
		console.log(
			`✅ Overall: ${improvements} improvements, ${regressions} regressions - POSITIVE TREND`
		);
	} else if (improvements < regressions) {
		console.log(
			`⚠️  Overall: ${improvements} improvements, ${regressions} regressions - NEGATIVE TREND`
		);
	} else {
		console.log(
			`➡️  Overall: ${improvements} improvements, ${regressions} regressions - MIXED RESULTS`
		);
	}

	console.log('');
}

/**
 * Print statistics summary
 */
function printStatistics(results: BenchmarkMetrics[]): void {
	if (results.length === 0) return;

	console.log('📈 STATISTICS\n');

	// Duration stats
	const durations = results.map(r => r.performance.total_duration_ms);
	const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
	const minDuration = Math.min(...durations);
	const maxDuration = Math.max(...durations);

	console.log(
		`Duration:    Avg ${avgDuration.toFixed(0)}ms │ Min ${minDuration}ms │ Max ${maxDuration}ms`
	);

	// Token stats
	const tokens = results.map(r => r.cost.total_tokens);
	const avgTokens = tokens.reduce((sum, t) => sum + t, 0) / tokens.length;
	const minTokens = Math.min(...tokens);
	const maxTokens = Math.max(...tokens);

	console.log(`Tokens:      Avg ${avgTokens.toFixed(0)} │ Min ${minTokens} │ Max ${maxTokens}`);

	// Cost stats
	const costs = results.map(r => r.cost.estimated_cost_usd);
	const avgCost = costs.reduce((sum, c) => sum + c, 0) / costs.length;
	const minCost = Math.min(...costs);
	const maxCost = Math.max(...costs);

	console.log(
		`Cost:        Avg $${avgCost.toFixed(4)} │ Min $${minCost.toFixed(4)} │ Max $${maxCost.toFixed(4)}`
	);

	console.log('');
}

/**
 * Main CLI
 */
async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			type: { type: 'string', short: 't', default: 'pipeline' },
			last: { type: 'string', short: 'n' },
			ids: { type: 'string' },
			'prompt-version': { type: 'string', short: 'p' },
			from: { type: 'string' },
			to: { type: 'string' },
			stats: { type: 'boolean', default: false },
		},
	});

	const benchmarkType = values.type || 'pipeline';

	const filters: ComparisonFilters = {
		last: values.last ? Number.parseInt(values.last) : undefined,
		ids: values.ids?.split(','),
		promptVersion: values['prompt-version'],
		from: values.from ? new Date(values.from) : undefined,
		to: values.to ? new Date(values.to) : undefined,
	};

	console.log(`\n🔍 Loading ${benchmarkType} benchmark results...`);

	const results = await loadBenchmarkResults(benchmarkType, filters);

	if (results.length === 0) {
		console.log(`\n❌ No results found for benchmark type '${benchmarkType}'`);
		console.log('\nAvailable types: pipeline, extraction, concepts, dedup');
		process.exit(1);
	}

	printComparisonTable(results);

	if (values.stats) {
		printStatistics(results);
	}

	printImprovementAnalysis(results);

	console.log('💡 Tips:');
	console.log('   • Run more benchmarks: pnpm benchmark:pipeline');
	console.log('   • Filter by prompt version: --prompt-version v2.0');
	console.log('   • Show statistics: --stats');
	console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(error => {
		console.error('❌ Comparison failed:', error.message);
		process.exit(1);
	});
}
