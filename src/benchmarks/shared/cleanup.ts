/**
 * Database cleanup utilities for benchmarks
 */

import type { PrismaClient } from '@prisma/client';

/**
 * Cleanup tracker for benchmark runs
 */
export interface CleanupTracker {
	processingJobIds: Set<string>;
	tripleIds: Set<string>;
	conceptIds: Set<string>;
	vectorIds: Set<string>;
	tokenUsageIds: Set<string>;
}

/**
 * Create a new cleanup tracker
 */
export function createCleanupTracker(): CleanupTracker {
	return {
		processingJobIds: new Set(),
		tripleIds: new Set(),
		conceptIds: new Set(),
		vectorIds: new Set(),
		tokenUsageIds: new Set(),
	};
}

/**
 * Cleanup benchmark data from database
 */
export async function cleanupBenchmarkData(
	db: PrismaClient,
	tracker: CleanupTracker
): Promise<{
	processingJobs: number;
	triples: number;
	concepts: number;
	vectors: number;
	tokenUsage: number;
}> {
	const results = {
		processingJobs: 0,
		triples: 0,
		concepts: 0,
		vectors: 0,
		tokenUsage: 0,
	};

	// Delete in correct order to respect foreign key constraints
	if (tracker.tokenUsageIds.size > 0) {
		const deleted = await db.tokenUsage.deleteMany({
			where: { id: { in: Array.from(tracker.tokenUsageIds) } },
		});
		results.tokenUsage = deleted.count;
	}

	if (tracker.vectorIds.size > 0) {
		const deleted = await db.vectorEmbedding.deleteMany({
			where: { id: { in: Array.from(tracker.vectorIds) } },
		});
		results.vectors = deleted.count;
	}

	if (tracker.conceptIds.size > 0) {
		// Delete concept relationships first
		await db.conceptualizationRelationship.deleteMany({
			where: { concept_node_id: { in: Array.from(tracker.conceptIds) } },
		});

		// Then delete concepts
		const deleted = await db.conceptNode.deleteMany({
			where: { id: { in: Array.from(tracker.conceptIds) } },
		});
		results.concepts = deleted.count;
	}

	if (tracker.tripleIds.size > 0) {
		const deleted = await db.knowledgeTriple.deleteMany({
			where: { id: { in: Array.from(tracker.tripleIds) } },
		});
		results.triples = deleted.count;
	}

	if (tracker.processingJobIds.size > 0) {
		const deleted = await db.processingJob.deleteMany({
			where: { id: { in: Array.from(tracker.processingJobIds) } },
		});
		results.processingJobs = deleted.count;
	}

	return results;
}

/**
 * Cleanup benchmark data by source prefix
 */
export async function cleanupBySourcePrefix(
	db: PrismaClient,
	sourcePrefix: string
): Promise<{
	triples: number;
	concepts: number;
	vectors: number;
}> {
	const results = {
		triples: 0,
		concepts: 0,
		vectors: 0,
	};

	// Find entities first
	const triples = await db.knowledgeTriple.findMany({
		where: { source: { startsWith: sourcePrefix } },
		select: { id: true },
	});

	const concepts = await db.conceptNode.findMany({
		where: { source: { startsWith: sourcePrefix } },
		select: { id: true },
	});

	// Delete vectors related to those entities
	if (triples.length > 0 || concepts.length > 0) {
		const deletedVectors = await db.vectorEmbedding.deleteMany({
			where: {
				OR: [
					{ knowledge_triple_id: { in: triples.map(t => t.id) } },
					{ concept_node_id: { in: concepts.map(c => c.id) } },
				],
			},
		});
		results.vectors = deletedVectors.count;
	}

	// Delete concepts with matching source
	const deletedConcepts = await db.conceptNode.deleteMany({
		where: {
			source: { startsWith: sourcePrefix },
		},
	});
	results.concepts = deletedConcepts.count;

	// Delete triples with matching source
	const deletedTriples = await db.knowledgeTriple.deleteMany({
		where: {
			source: { startsWith: sourcePrefix },
		},
	});
	results.triples = deletedTriples.count;

	return results;
}

/**
 * Find and cleanup old benchmark data (older than X days)
 */
export async function cleanupOldBenchmarkData(
	db: PrismaClient,
	daysOld: number = 7
): Promise<{
	triples: number;
	concepts: number;
	vectors: number;
}> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - daysOld);

	const results = {
		triples: 0,
		concepts: 0,
		vectors: 0,
	};

	// Find benchmark sources
	const benchmarkTriples = await db.knowledgeTriple.findMany({
		where: {
			source_type: 'benchmark',
			created_at: { lt: cutoffDate },
		},
		select: { source: true },
		distinct: ['source'],
	});

	// Cleanup each benchmark source
	for (const { source } of benchmarkTriples) {
		const cleaned = await cleanupBySourcePrefix(db, source);
		results.triples += cleaned.triples;
		results.concepts += cleaned.concepts;
		results.vectors += cleaned.vectors;
	}

	return results;
}
