/**
 * Test setup utilities for Knowledge Graph MCP Server tests
 */

import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { JobStatus, JobType, type Prisma, type ProcessingJob } from '@prisma/client';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import { db } from '~/shared/database/client.js';

// Test database cleanup
export async function cleanupTestDatabase(): Promise<void> {
	// Skip cleanup if db is mocked or undefined
	if (!db || (typeof db === 'object' && 'jest' in db)) {
		return;
	}

	try {
		// Clean up in reverse dependency order
		await db.vectorEmbedding?.deleteMany({});
		await db.conceptualizationRelationship?.deleteMany({});
		await db.conceptNode?.deleteMany({});
		await db.knowledgeTriple?.deleteMany({});

		// Delete child jobs BEFORE parent jobs to respect foreign key constraints
		// With onDelete: Cascade, deleting parents will cascade to children
		await db.processingJob?.deleteMany({});
	} catch (error) {
		// Only suppress errors for mocked tests, not real database issues
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (errorMessage.includes('mock') || errorMessage.includes('jest')) {
			console.warn('Database cleanup skipped (mocked):', error);
		} else {
			// Re-throw real database errors so tests fail fast
			throw error;
		}
	}
}

// Create test processing job
export async function createTestJob(
	overrides: Partial<Prisma.ProcessingJobUncheckedCreateInput> = {}
): Promise<ProcessingJob> {
	const defaultData: Prisma.ProcessingJobUncheckedCreateInput = {
		job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
		text: 'Test text content',
		metadata: {
			source: 'test-source',
			source_type: 'test',
			source_date: new Date().toISOString(),
		},
		status: JobStatus.QUEUED,
		progress: 0,
		result: undefined,
		startedAt: null,
		completedAt: null,
		parent_job_id: null,
		stage: null,
		metrics: {},
	};

	// Merge overrides with default data
	const createData: Prisma.ProcessingJobUncheckedCreateInput = {
		...defaultData,
		...overrides,
	};

	return await db.processingJob.create({
		data: createData,
	});
}

// Create test processing arguments
export function createTestArgs(
	overrides: Partial<ProcessKnowledgeArgs> = {}
): ProcessKnowledgeArgs {
	return {
		text: 'John Smith is a software engineer at Tech Corp. He works on AI projects.',
		source: 'test-source',
		source_type: 'test',
		source_date: new Date().toISOString(),
		...overrides,
	};
}

// Mock AI provider responses
export const mockAIResponses = {
	extraction: {
		triples: [
			{
				subject: 'John Smith',
				predicate: 'is a',
				object: 'software engineer',
				confidence: 0.95,
				semantic_content: 'John Smith is a software engineer',
				triple_type: 'ENTITY_ENTITY' as const,
				source_context: 'Tech Corp context',
			},
			{
				subject: 'John Smith',
				predicate: 'works at',
				object: 'Tech Corp',
				confidence: 0.9,
				semantic_content: 'John Smith works at Tech Corp',
				triple_type: 'ENTITY_ENTITY' as const,
				source_context: 'Employment context',
			},
		],
	},
	concepts: [
		{
			name: 'Professional Role',
			abstraction_level: 'HIGH' as const,
			description: 'High-level professional categorization',
		},
		{
			name: 'Software Engineering',
			abstraction_level: 'MEDIUM' as const,
			description: 'Technical profession category',
		},
		{
			name: 'Software Engineer',
			abstraction_level: 'LOW' as const,
			description: 'Specific job title',
		},
	],
	embeddings: new Map<string, number[]>([
		[
			'John Smith',
			Array(1536)
				.fill(0)
				.map(() => Math.random()),
		],
		[
			'software engineer',
			Array(1536)
				.fill(0)
				.map(() => Math.random()),
		],
		[
			'Tech Corp',
			Array(1536)
				.fill(0)
				.map(() => Math.random()),
		],
	]),
};

// Test environment variables
export const testEnv = {
	AI_PROVIDER: 'openai',
	AI_MODEL: 'gpt-4o-mini',
	EMBEDDING_MODEL: 'text-embedding-3-small',
	BATCH_SIZE: 32,
	ENABLE_SEMANTIC_DEDUP: false,
	SEMANTIC_THRESHOLD: 0.85,
} as const;

// Setup hooks for test suites
export function setupTestSuite(): void {
	let dbConnected = false;

	beforeAll(async () => {
		// Ensure clean test environment
		try {
			await cleanupTestDatabase();
			dbConnected = true;
		} catch (error) {
			console.error('Failed to setup test database:', error);
			throw error;
		}
	});

	beforeEach(async () => {
		// Clean up before each test
		if (dbConnected) {
			await cleanupTestDatabase();
		}
	});

	afterEach(async () => {
		// Clean up after each test
		if (dbConnected) {
			await cleanupTestDatabase();
		}
	});

	afterAll(async () => {
		// Final cleanup with guaranteed connection cleanup
		try {
			if (dbConnected) {
				await cleanupTestDatabase();
				if (db && typeof db.$disconnect === 'function') {
					await db.$disconnect();
				}

				// CRITICAL: Clear the global singleton to prevent reuse across test suites
				const globalForPrisma = globalThis as unknown as {
					prisma: typeof db | undefined;
				};
				globalForPrisma.prisma = undefined;
			}
		} catch (error) {
			console.error('Error during test cleanup:', error);
		} finally {
			dbConnected = false;
		}
	});
}

// Mock timers for consistent testing
export function mockTimers(): void {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});
}

// Wait for async operations
export function waitFor(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Create deterministic test UUIDs
export function createTestId(suffix: string): string {
	return `test-${suffix}-${Date.now()}`;
}

/**
 * Seed database with fusion search test data
 * Creates triples, concepts, and conceptualizations for comprehensive search testing
 * Note: We don't seed embeddings - those are handled by mock services in tests
 */
export async function seedFusionSearchTestData(): Promise<{
	triples: Array<{ id: string; subject: string; predicate: string; object: string }>;
	concepts: Array<{ id: string; concept: string }>;
}> {
	const { searchTestData } = await import('../fixtures/test-data.js');

	// 1. Create triples
	await db.knowledgeTriple.createMany({
		data: searchTestData.triples.map(triple => ({
			...triple,
			source: 'fusion-search-test',
			source_type: 'test',
			source_date: new Date('2025-01-01T00:00:00.000Z'),
		})),
	});

	// Get the created triple IDs
	const storedTriples = await db.knowledgeTriple.findMany({
		where: {
			source: 'fusion-search-test',
			source_type: 'test',
		},
		select: {
			id: true,
			subject: true,
			predicate: true,
			object: true,
		},
	});

	// 2. Create concepts
	await db.conceptNode.createMany({
		data: searchTestData.concepts,
	});

	const storedConcepts = await db.conceptNode.findMany({
		where: {
			source: 'fusion-search-test',
			source_type: 'test',
		},
		select: {
			id: true,
			concept: true,
		},
	});

	// 3. Create conceptualization relationships
	await db.conceptualizationRelationship.createMany({
		data: searchTestData.conceptualizations.map(rel => ({
			...rel,
			extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		})),
	});

	// Note: Vector embeddings are not seeded here.
	// The mock embedding service will handle vector search queries.
	// This is actually better for testing since it allows us to test
	// the search logic without dealing with complex vector database setup.

	return {
		triples: storedTriples,
		concepts: storedConcepts,
	};
}
