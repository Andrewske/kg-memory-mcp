/**
 * Cleanup old benchmark results
 */

import { parseArgs } from 'node:util';
import { cleanOldResults } from './shared/storage.js';

/**
 * Main CLI
 */
async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			type: { type: 'string', short: 't' },
			keep: { type: 'string', short: 'k', default: '10' },
			all: { type: 'boolean', default: false },
		},
	});

	const keepLast = Number.parseInt(values.keep || '10');
	const benchmarkTypes = values.all
		? ['pipeline', 'extraction', 'concepts', 'deduplication']
		: values.type
			? [values.type]
			: [];

	if (benchmarkTypes.length === 0) {
		console.log('❌ Please specify --type or use --all');
		console.log('\nExamples:');
		console.log('  pnpm benchmark:clean --type pipeline --keep 5');
		console.log('  pnpm benchmark:clean --all --keep 10');
		process.exit(1);
	}

	console.log(`🧹 Cleaning old benchmark results (keeping last ${keepLast} per type)...\n`);

	let totalDeleted = 0;

	for (const type of benchmarkTypes) {
		const deleted = await cleanOldResults(type, keepLast);
		if (deleted > 0) {
			console.log(`   ${type}: Deleted ${deleted} old results`);
			totalDeleted += deleted;
		} else {
			console.log(`   ${type}: Nothing to clean`);
		}
	}

	console.log('');
	if (totalDeleted > 0) {
		console.log(`✅ Cleanup complete! Deleted ${totalDeleted} old results.`);
	} else {
		console.log('✅ No old results to clean.');
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(error => {
		console.error('❌ Cleanup failed:', error.message);
		process.exit(1);
	});
}
