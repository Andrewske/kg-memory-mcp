/**
 * Storage layer for benchmark results
 * Handles JSON (source of truth), markdown reports, and CSV tracking
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	convertStoredTimestampToPst,
	formatPstForDisplay,
	formatPstForFilename,
} from '~/shared/utils/pst-time.js';
import {
	type BenchmarkMetrics,
	BenchmarkMetricsSchema,
	type BenchmarkResult,
	type ComparisonFilters,
} from './types.js';

const RESULTS_DIR = path.join(process.cwd(), 'benchmarks/results');

/**
 * Save benchmark result - writes JSON, generates MD report, updates CSV
 */
export async function saveBenchmarkResult(metrics: BenchmarkMetrics): Promise<BenchmarkResult> {
	// Validate metrics
	BenchmarkMetricsSchema.parse(metrics);

	const dir = path.join(RESULTS_DIR, metrics.benchmark_type);
	await fs.mkdir(dir, { recursive: true });

	const timestamp = formatPstForFilename(metrics.timestamp);
	const jsonPath = path.join(dir, `${timestamp}.json`);
	const mdPath = path.join(dir, `${timestamp}.md`);

	// Save JSON (source of truth)
	await fs.writeFile(jsonPath, JSON.stringify(metrics, null, 2));

	// Generate markdown report
	const markdown = generateMarkdownReport(metrics);
	await fs.writeFile(mdPath, markdown);

	// Update metrics CSV (append mode)
	await appendToCsvLog(metrics);

	return { metrics, jsonPath, mdPath };
}

/**
 * Generate detailed markdown report (keeps current format style)
 */
function generateMarkdownReport(metrics: BenchmarkMetrics): string {
	const { benchmark_type, config, performance, quality, cost, timestamp, notes, fixture_info } =
		metrics;

	const lines: string[] = [];

	lines.push(`# Benchmark Report: ${benchmark_type.toUpperCase()}

**Run ID**: \`${metrics.id}\`
**Timestamp**: ${formatPstForDisplay(timestamp)}
${
	fixture_info
		? `**Input File**: ${fixture_info.filename}
**Input Size**: ${fixture_info.char_count.toLocaleString()} characters (~${fixture_info.estimated_tokens.toLocaleString()} tokens)
`
		: ''
}**Model**: ${config.model} (${config.provider})
${config.extraction_method ? `**Extraction Method**: ${config.extraction_method}` : ''}
${config.prompt_version ? `**Prompt Version**: ${config.prompt_version}` : ''}
${notes ? `\n**Notes**: ${notes}\n` : ''}

---

## ⚡ Performance Metrics

- **Total Duration**: ${performance.total_duration_ms.toLocaleString()}ms (${(performance.total_duration_ms / 1000).toFixed(2)}s)
- **Tokens/Second**: ${performance.tokens_per_second.toFixed(2)}
- **MS/Token**: ${performance.ms_per_token.toFixed(2)}
- **Memory Used**: ${performance.memory_used_mb.toFixed(2)}MB
`);

	if (performance.stage_durations) {
		lines.push('\n### Stage Durations\n\n');
		for (const [stage, duration] of Object.entries(performance.stage_durations)) {
			lines.push(`- **${stage}**: ${duration.toLocaleString()}ms (${(duration / 1000).toFixed(2)}s)\n`);
		}
	}

	lines.push(`
---

## 📊 Quality Metrics

`);

	if (quality.triples_generated !== undefined) {
		lines.push(`- **Triples Generated (AI)**: ${quality.triples_generated.toLocaleString()}\n`);
	}
	if (quality.triples_extracted !== undefined) {
		let line = `- **Triples Stored (Unique)**: ${quality.triples_extracted.toLocaleString()}`;
		if (quality.triples_generated && quality.triples_extracted) {
			const dupRate = (
				((quality.triples_generated - quality.triples_extracted) / quality.triples_generated) *
				100
			).toFixed(1);
			line += ` (${dupRate}% dedup rate)`;
		}
		line += '\n';
		lines.push(line);
	}

	if (quality.concepts_generated !== undefined) {
		lines.push(`- **Concepts Generated (AI)**: ${quality.concepts_generated.toLocaleString()}\n`);
	}
	if (quality.concepts_extracted !== undefined) {
		let line = `- **Concepts Stored (Unique)**: ${quality.concepts_extracted.toLocaleString()}`;
		if (quality.concepts_generated && quality.concepts_extracted) {
			const dupRate = (
				((quality.concepts_generated - quality.concepts_extracted) / quality.concepts_generated) *
				100
			).toFixed(1);
			line += ` (${dupRate}% dedup rate)`;
		}
		line += '\n';
		lines.push(line);
	}

	if (quality.duplicates_removed !== undefined && quality.duplicates_removed > 0) {
		let line = `- **Duplicates Removed**: ${quality.duplicates_removed.toLocaleString()}`;
		if (quality.duplicate_rate !== undefined) {
			line += ` (${(quality.duplicate_rate * 100).toFixed(1)}%)`;
		}
		line += '\n';
		lines.push(line);

		// Add breakdown if duplicate_analysis is available
		if (metrics.output_analysis?.duplicate_analysis) {
			const dup = metrics.output_analysis.duplicate_analysis;
			const totalGenerated = dup.total_generated;

			if (dup.internal_duplicates > 0 || dup.database_duplicates > 0) {
				if (dup.internal_duplicates > 0) {
					const pct = ((dup.internal_duplicates / totalGenerated) * 100).toFixed(1);
					lines.push(`  - Internal Duplicates: ${dup.internal_duplicates.toLocaleString()} (${pct}%)\n`);
				}
				if (dup.database_duplicates > 0) {
					const pct = ((dup.database_duplicates / totalGenerated) * 100).toFixed(1);
					lines.push(`  - Database Duplicates: ${dup.database_duplicates.toLocaleString()} (${pct}%)\n`);
				}
			}
		}
	}
	if (quality.avg_confidence !== undefined) {
		lines.push(`- **Average Confidence**: ${(quality.avg_confidence * 100).toFixed(1)}%\n`);
	}
	if (quality.search_recall !== undefined) {
		lines.push(`- **Search Recall**: ${(quality.search_recall * 100).toFixed(1)}%\n`);
	}
	if (quality.search_precision !== undefined) {
		lines.push(`- **Search Precision**: ${(quality.search_precision * 100).toFixed(1)}%\n`);
	}

	lines.push(`
---

## 💰 Cost Analysis

- **Input Tokens**: ${cost.input_tokens.toLocaleString()}
- **Output Tokens**: ${cost.output_tokens.toLocaleString()}
- **Total Tokens**: ${cost.total_tokens.toLocaleString()}
- **Estimated Cost**: $${cost.estimated_cost_usd.toFixed(4)}
- **API Calls**: ${cost.api_calls}
- **Cost per Token**: $${(cost.estimated_cost_usd / cost.total_tokens).toFixed(6)}
`);

	// Output analysis if available
	if (metrics.output_analysis) {
		lines.push('\n---\n\n## 📈 Output Analysis\n\n');

		if (metrics.output_analysis.triple_types) {
			lines.push('### Triple Types Distribution\n\n');
			const total = Object.values(metrics.output_analysis.triple_types).reduce(
				(sum, count) => sum + count,
				0
			);
			for (const [type, count] of Object.entries(metrics.output_analysis.triple_types)) {
				const pct = ((count / total) * 100).toFixed(1);
				lines.push(`- **${type}**: ${count} (${pct}%)\n`);
			}
			lines.push('\n');
		}

		if (metrics.output_analysis.abstraction_levels) {
			lines.push('### Abstraction Levels Distribution\n\n');
			const total = Object.values(metrics.output_analysis.abstraction_levels).reduce(
				(sum, count) => sum + count,
				0
			);
			for (const [level, count] of Object.entries(metrics.output_analysis.abstraction_levels)) {
				const pct = ((count / total) * 100).toFixed(1);
				lines.push(`- **${level}**: ${count} (${pct}%)\n`);
			}
			lines.push('\n');
		}

		// Sample Triples section
		if (
			metrics.output_analysis.sample_triples &&
			metrics.output_analysis.sample_triples.length > 0
		) {
			lines.push('### 📋 Sample Triples Extracted (Top 20)\n\n');
			for (const [i, t] of metrics.output_analysis.sample_triples.entries()) {
				const conf = (t.confidence * 100).toFixed(0);
				const stage = t.extraction_stage ? `, stage: ${t.extraction_stage}` : '';
				lines.push(`${i + 1}. \`${t.subject}\` --[${t.predicate}]--> \`${t.object}\` (${t.type}, conf: ${conf}%${stage})\n`);
			}
			lines.push('\n');
		}

		// Raw Extraction Data with Duplicate Markers
		if (
			metrics.output_analysis.raw_extraction_data &&
			metrics.output_analysis.raw_extraction_data.stages.length > 0
		) {
			const rawData = metrics.output_analysis.raw_extraction_data;
			lines.push('### 🔍 Raw Extraction by Stage (with Duplicate Markers)\n\n');

			lines.push('**Summary**\n');
			lines.push(`- Total Extracted: ${rawData.summary.total_extracted}\n`);
			lines.push(`- Total Kept: ${rawData.summary.total_kept}\n`);
			lines.push(`- Exact Duplicates: ${rawData.summary.total_exact_duplicates}\n`);
			lines.push(`- Semantic Duplicates: ${rawData.summary.total_semantic_duplicates}\n`);
			lines.push(`- Cross-Stage Duplicates: ${rawData.summary.total_cross_stage_duplicates}\n`);
			let dbDupLine = `- Database Duplicates: ${rawData.summary.total_database_duplicates}`;
			if (rawData.summary.total_database_duplicates > 0) {
				dbDupLine += ' ⚠️ **WARNING: Cleanup function may not be working!**';
			}
			dbDupLine += '\n\n';
			lines.push(dbDupLine);

			// Show each stage
			for (const stage of rawData.stages) {
				lines.push(`#### ${stage.stage_name} (${stage.total_extracted} extracted)\n\n`);
				lines.push(`- Kept: ${stage.kept}\n`);
				lines.push(`- Exact Duplicates: ${stage.exact_duplicates}\n`);
				lines.push(`- Semantic Duplicates: ${stage.semantic_duplicates}\n\n`);

				// Show all triples with status markers
				for (const [i, t] of stage.triples.entries()) {
					const conf = (t.confidence * 100).toFixed(0);
					let statusMarker = '';
					if (t.status === 'KEPT') {
						statusMarker = '✅ KEPT';
					} else if (t.status === 'EXACT_DUPLICATE') {
						statusMarker = '❌ EXACT DUPLICATE';
						if (t.duplicate_of_index !== undefined) {
							statusMarker += ` of #${t.duplicate_of_index + 1}`;
						}
					} else if (t.status === 'SEMANTIC_DUPLICATE') {
						statusMarker = '⚠️ SEMANTIC DUPLICATE';
						if (t.duplicate_of_index !== undefined) {
							statusMarker += ` of #${t.duplicate_of_index + 1}`;
						}
					} else if (t.status === 'CROSS_STAGE_DUPLICATE') {
						statusMarker = '🔄 CROSS-STAGE DUPLICATE';
						if (t.kept_from_stage && t.rejected_stages) {
							statusMarker += ` (kept from: ${t.kept_from_stage}, also in: ${t.rejected_stages.join(', ')})`;
						}
					} else if (t.status === 'DATABASE_DUPLICATE') {
						statusMarker = '🔴 DATABASE DUPLICATE';
						if (t.stored_at) {
							const pstTimestamp = convertStoredTimestampToPst(t.stored_at);
							const formattedDate = pstTimestamp.split('T')[0]; // YYYY-MM-DD
							const formattedTime = pstTimestamp.split('T')[1].split(/[+-]/)[0]; // HH:MM:SS.mmm
							statusMarker += ` (stored: ${formattedDate} ${formattedTime} PST`;
							if (t.existing_triple_id) {
								statusMarker += `, id: ${t.existing_triple_id.substring(0, 8)}...`;
							}
							statusMarker += ')';
						}
					}

					lines.push(`${i + 1}. \`${t.subject}\` --[${t.predicate}]--> \`${t.object}\` (${t.type}, conf: ${conf}%) **${statusMarker}**\n`);
				}
				lines.push('\n');
			}
		}

		// Concepts Generated with Status Markers
		if (
			metrics.output_analysis.concepts_generated &&
			metrics.output_analysis.concepts_generated.length > 0
		) {
			const concepts = metrics.output_analysis.concepts_generated;
			lines.push('### 💡 Concepts Generated (with Duplicate Markers)\n\n');

			const kept = concepts.filter(c => c.status === 'KEPT').length;
			const exactDups = concepts.filter(c => c.status === 'EXACT_DUPLICATE').length;
			const semanticDups = concepts.filter(c => c.status === 'SEMANTIC_DUPLICATE').length;

			lines.push('**Summary**\n');
			lines.push(`- Total Generated: ${concepts.length}\n`);
			lines.push(`- Kept: ${kept}\n`);
			lines.push(`- Exact Duplicates: ${exactDups}\n`);
			lines.push(`- Semantic Duplicates: ${semanticDups}\n\n`);

			lines.push('**All Concepts**\n\n');
			for (const [i, c] of concepts.entries()) {
				const conf = (c.confidence * 100).toFixed(0);
				let statusMarker = '';
				if (c.status === 'KEPT') {
					statusMarker = '✅ KEPT';
				} else if (c.status === 'EXACT_DUPLICATE') {
					statusMarker = '❌ EXACT DUPLICATE';
					if (c.duplicate_of_index !== undefined) {
						statusMarker += ` of #${c.duplicate_of_index + 1}`;
					}
				} else if (c.status === 'SEMANTIC_DUPLICATE') {
					statusMarker = '⚠️ SEMANTIC DUPLICATE';
					if (c.duplicate_of_index !== undefined) {
						statusMarker += ` of #${c.duplicate_of_index + 1}`;
					}
				}

				lines.push(`${i + 1}. **${c.concept}** (${c.abstraction_level}, conf: ${conf}%) **${statusMarker}**\n`);
			}
			lines.push('\n');
		}

		// Vocabulary Analysis section
		if (metrics.output_analysis.vocabulary_analysis) {
			const vocab = metrics.output_analysis.vocabulary_analysis;
			lines.push('### 📚 Vocabulary Analysis\n\n');

			lines.push('**Current Run Statistics**\n');
			lines.push(`- Total Terms: ${vocab.total_terms}\n`);
			lines.push(`- New Terms: ${vocab.new_terms_count} (${(vocab.novelty_rate * 100).toFixed(1)}% novelty rate)\n`);
			lines.push(`- Known Terms: ${vocab.known_terms_count} (${(vocab.recognition_rate * 100).toFixed(1)}% recognition rate)\n\n`);

			lines.push('**Vocabulary Growth**\n');
			lines.push(`- Total Entities: ${vocab.vocabulary_size.entities} (+${vocab.vocabulary_growth.entities})\n`);
			lines.push(`- Total Relationships: ${vocab.vocabulary_size.relationships} (+${vocab.vocabulary_growth.relationships})\n`);
			lines.push(`- Total Concepts: ${vocab.vocabulary_size.concepts} (+${vocab.vocabulary_growth.concepts})\n`);
			lines.push(`- Total Terms: ${vocab.vocabulary_size.total} (+${vocab.vocabulary_growth.total})\n`);
			lines.push(`- Total Benchmark Runs: ${vocab.total_runs}\n\n`);

			// Top frequent terms
			if (vocab.top_frequent.entities.length > 0) {
				lines.push('**Most Frequent Entities (Top 10)**\n');
				for (const { term, count } of vocab.top_frequent.entities.slice(0, 10)) {
					lines.push(`- ${term} (${count})\n`);
				}
				lines.push('\n');
			}

			if (vocab.top_frequent.relationships.length > 0) {
				lines.push('**Most Frequent Relationships (Top 10)**\n');
				for (const { term, count } of vocab.top_frequent.relationships.slice(0, 10)) {
					lines.push(`- ${term} (${count})\n`);
				}
				lines.push('\n');
			}

			if (vocab.top_frequent.concepts.length > 0) {
				lines.push('**Most Frequent Concepts (Top 10)**\n');
				for (const { term, count } of vocab.top_frequent.concepts.slice(0, 10)) {
					lines.push(`- ${term} (${count})\n`);
				}
				lines.push('\n');
			}

			// New terms discovered
			const hasNewTerms =
				vocab.new_term_list.entities.length > 0 ||
				vocab.new_term_list.relationships.length > 0 ||
				vocab.new_term_list.concepts.length > 0;

			if (hasNewTerms) {
				lines.push('**New Terms Discovered This Run**\n');
				if (vocab.new_term_list.entities.length > 0) {
					let entitiesLine = `- **Entities**: ${vocab.new_term_list.entities.slice(0, 20).join(', ')}`;
					if (vocab.new_term_list.entities.length > 20) {
						entitiesLine += ` ... (${vocab.new_term_list.entities.length - 20} more)`;
					}
					entitiesLine += '\n';
					lines.push(entitiesLine);
				}
				if (vocab.new_term_list.relationships.length > 0) {
					let relationshipsLine = `- **Relationships**: ${vocab.new_term_list.relationships.slice(0, 20).join(', ')}`;
					if (vocab.new_term_list.relationships.length > 20) {
						relationshipsLine += ` ... (${vocab.new_term_list.relationships.length - 20} more)`;
					}
					relationshipsLine += '\n';
					lines.push(relationshipsLine);
				}
				if (vocab.new_term_list.concepts.length > 0) {
					let conceptsLine = `- **Concepts**: ${vocab.new_term_list.concepts.slice(0, 20).join(', ')}`;
					if (vocab.new_term_list.concepts.length > 20) {
						conceptsLine += ` ... (${vocab.new_term_list.concepts.length - 20} more)`;
					}
					conceptsLine += '\n';
					lines.push(conceptsLine);
				}
				lines.push('\n');
			}
		}

		// Duplicate Analysis section
		if (metrics.output_analysis.duplicate_analysis) {
			const dup = metrics.output_analysis.duplicate_analysis;
			lines.push('\n---\n\n## 🔄 Duplicate Analysis\n\n');

			lines.push('**Generation Summary**\n');
			lines.push(`- Triples Generated (AI): ${dup.total_generated.toLocaleString()}\n`);
			lines.push(`- Internal Duplicates: ${dup.internal_duplicates.toLocaleString()} (${((dup.internal_duplicates / dup.total_generated) * 100).toFixed(1)}%)\n`);
			lines.push(`- Database Duplicates: ${dup.database_duplicates.toLocaleString()}\n`);
			lines.push(`- Unique Triples Stored: ${dup.unique_stored.toLocaleString()}\n\n`);

			if (Object.keys(dup.cross_stage_overlaps).length > 0) {
				lines.push('**Cross-Stage Duplication Matrix**\n');
				const sortedOverlaps = Object.entries(dup.cross_stage_overlaps).sort((a, b) => b[1] - a[1]);
				for (const [stages, count] of sortedOverlaps) {
					lines.push(`- ${stages}: ${count} overlap${count > 1 ? 's' : ''}\n`);
				}
				lines.push('\n');
			}

			if (dup.duplicate_examples.length > 0) {
				lines.push('### Example Duplicates\n\n');
				for (const [i, example] of dup.duplicate_examples.entries()) {
					const t = example.triple;
					lines.push(`${i + 1}. ✅ **KEPT**: \`${t.subject}\` --[${t.predicate}]--> \`${t.object}\` (${t.type}, stage: ${example.kept_from_stage})\n`);
					lines.push(`   ❌ Rejected from: ${example.rejected_stages.join(', ')}\n\n`);
				}
			}
		}
	}

	lines.push(`
---

## 🔧 Configuration Details

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

---

*Generated by KG Memory MCP Benchmark Suite*
*Run ID: ${metrics.id}*
`);

	return lines.join('');
}

/**
 * Append metrics to CSV log for historical tracking
 */
async function appendToCsvLog(metrics: BenchmarkMetrics): Promise<void> {
	const csvPath = path.join(RESULTS_DIR, 'metrics.csv');

	// Create header if file doesn't exist
	try {
		await fs.access(csvPath);
	} catch {
		const header =
			'id,timestamp,benchmark_type,model,provider,extraction_method,prompt_version,total_duration_ms,tokens_per_second,triples_extracted,concepts_generated,total_tokens,estimated_cost_usd,avg_confidence,notes\n';
		await fs.writeFile(csvPath, header);
	}

	// Append row
	const row =
		[
			metrics.id,
			metrics.timestamp,
			metrics.benchmark_type,
			metrics.config.model,
			metrics.config.provider,
			metrics.config.extraction_method || '',
			metrics.config.prompt_version || '',
			metrics.performance.total_duration_ms,
			metrics.performance.tokens_per_second.toFixed(2),
			metrics.quality.triples_extracted ?? '',
			metrics.quality.concepts_generated ?? '',
			metrics.cost.total_tokens,
			metrics.cost.estimated_cost_usd.toFixed(4),
			metrics.quality.avg_confidence?.toFixed(3) ?? '',
			metrics.notes ? `"${metrics.notes.replace(/"/g, '""')}"` : '',
		].join(',') + '\n';

	await fs.appendFile(csvPath, row);
}

/**
 * Load benchmark results from disk
 */
export async function loadBenchmarkResults(
	benchmarkType: string,
	filters?: ComparisonFilters
): Promise<BenchmarkMetrics[]> {
	const dir = path.join(RESULTS_DIR, benchmarkType);

	try {
		const files = await fs.readdir(dir);
		const jsonFiles = files
			.filter(f => f.endsWith('.json'))
			.sort()
			.reverse();

		let selectedFiles = jsonFiles;

		// Apply filters
		if (filters?.last) {
			selectedFiles = selectedFiles.slice(0, filters.last);
		}

		const results: BenchmarkMetrics[] = [];
		for (const file of selectedFiles) {
			const content = await fs.readFile(path.join(dir, file), 'utf-8');
			const metrics = JSON.parse(content) as BenchmarkMetrics;

			// Apply additional filters
			if (filters?.ids && !filters.ids.includes(metrics.id)) continue;
			if (filters?.promptVersion && metrics.config.prompt_version !== filters.promptVersion)
				continue;
			if (filters?.from && new Date(metrics.timestamp) < filters.from) continue;
			if (filters?.to && new Date(metrics.timestamp) > filters.to) continue;

			results.push(metrics);
		}

		return results;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}
		throw error;
	}
}

/**
 * Clean old benchmark results (keep last N results per type)
 */
export async function cleanOldResults(
	benchmarkType: string,
	keepLast: number = 10
): Promise<number> {
	const dir = path.join(RESULTS_DIR, benchmarkType);

	try {
		const files = await fs.readdir(dir);
		const jsonFiles = files
			.filter(f => f.endsWith('.json'))
			.sort()
			.reverse();

		if (jsonFiles.length <= keepLast) {
			return 0;
		}

		const filesToDelete = jsonFiles.slice(keepLast);
		let deletedCount = 0;

		for (const file of filesToDelete) {
			const baseName = file.replace('.json', '');
			await fs.unlink(path.join(dir, file));
			// Also delete corresponding markdown file
			try {
				await fs.unlink(path.join(dir, `${baseName}.md`));
			} catch {
				// Markdown file might not exist
			}
			deletedCount++;
		}

		return deletedCount;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return 0;
		}
		throw error;
	}
}
