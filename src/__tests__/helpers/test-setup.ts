/**
 * Test setup utilities for Knowledge Graph MCP Server tests
 */

import { afterAll, afterEach, beforeAll, beforeEach } from '@jest/globals';
import { JobStage, JobStatus, JobType, type ProcessingJob } from '@prisma/client';
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
		await db.processingJob?.deleteMany({});
	} catch (error) {
		// Ignore errors in cleanup for mocked tests
		console.warn('Database cleanup skipped (likely mocked):', error);
	}
}

// Create test processing job
export async function createTestJob(
	overrides: Partial<ProcessingJob> = {}
): Promise<ProcessingJob> {
	const defaultData = {
		job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
		text: 'Test text content',
		metadata: {
			source: 'test-source',
			source_type: 'test',
			source_date: new Date().toISOString(),
		},
		status: JobStatus.QUEUED,
		progress: 0,
		result: null,
		startedAt: null,
		completedAt: null,
		parent_job_id: null,
		stage: null,
		metrics: null,
	};

	// Merge overrides
	const finalData = { ...defaultData, ...overrides };

	// Remove fields that shouldn't be in create data
	const { id, created_at, updated_at, ...dataToCreate } = finalData as any;

	return await db.processingJob.create({
		data: dataToCreate,
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
	EXTRACTION_METHOD: 'four-stage',
	BATCH_SIZE: 32,
	ENABLE_SEMANTIC_DEDUP: false,
	SEMANTIC_THRESHOLD: 0.85,
} as const;

// Setup hooks for test suites
export function setupTestSuite() {
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
			}
		} catch (error) {
			console.error('Error during test cleanup:', error);
		} finally {
			dbConnected = false;
		}
	});
}

// Mock timers for consistent testing
export function mockTimers() {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		jest.useRealTimers();
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
