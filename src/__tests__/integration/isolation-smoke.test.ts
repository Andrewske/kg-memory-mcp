/**
 * Isolation Smoke Test
 *
 * Fast test (~5s) to validate database isolation and singleton cleanup.
 * Run this during development: pnpm test -- isolation-smoke
 *
 * This test verifies:
 * 1. Database singleton is properly cleaned up between test files
 * 2. Data persists correctly within a test
 * 3. No "zombie client" issues
 */

import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { JobStatus, JobType } from '@prisma/client';

// Mock dependencies
jest.mock('~/shared/services/ai-provider-service.js');
jest.mock('~/shared/services/embedding-service.js');

import { db } from '~/shared/database/client.js';
import { createAIProvider } from '~/shared/services/ai-provider-service.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { sampleTriples } from '../fixtures/test-data.js';
import {
	createMockAIProvider,
	createMockEmbeddingService,
} from '../helpers/mock-factories.js';
import { cleanupTestDatabase, setupTestSuite } from '../helpers/test-setup.js';

setupTestSuite();

describe('Database Isolation Smoke Test', () => {
	let mockAIProvider: ReturnType<typeof createMockAIProvider>;
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

	beforeEach(async () => {
		jest.clearAllMocks();

		mockAIProvider = createMockAIProvider();
		mockEmbeddingService = createMockEmbeddingService();

		(createAIProvider as jest.Mock).mockReturnValue(mockAIProvider);
		(createEmbeddingService as jest.Mock).mockReturnValue(mockEmbeddingService);
	});

	afterAll(async () => {
		await cleanupTestDatabase();
	});

	it('should store and retrieve data correctly (validates no zombie client)', async () => {
		// Step 1: Create a processing job
		const job = await db.processingJob.create({
			data: {
				job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
				text: 'Isolation smoke test',
				metadata: {
					source: 'smoke-test',
					source_type: 'test',
					source_date: new Date().toISOString(),
				},
				status: JobStatus.QUEUED,
			},
		});

		expect(job.id).toBeTruthy();

		// Step 2: Verify we can retrieve it
		const retrieved = await db.processingJob.findUnique({
			where: { id: job.id },
		});

		expect(retrieved).toBeTruthy();
		expect(retrieved?.text).toBe('Isolation smoke test');

		// Step 3: Create some triples
		await db.knowledgeTriple.createMany({
			data: sampleTriples.entityEntity.slice(0, 2).map(triple => ({
				...triple,
				source: 'smoke-test',
				source_type: 'test',
				source_date: new Date(),
			})),
		});

		// Step 4: Verify we can query them
		const storedTriples = await db.knowledgeTriple.findMany({
			where: {
				source: 'smoke-test',
				source_type: 'test',
			},
		});

		expect(storedTriples.length).toBe(2);
		expect(storedTriples[0].subject).toBeTruthy();
	});

	it('should handle sequential operations without data leakage', async () => {
		// First operation
		const job1 = await db.processingJob.create({
			data: {
				job_type: JobType.GENERATE_CONCEPTS,
				text: 'First job',
				metadata: { source: 'seq-test-1' },
				status: JobStatus.QUEUED,
			},
		});

		// Second operation
		const job2 = await db.processingJob.create({
			data: {
				job_type: JobType.DEDUPLICATE_KNOWLEDGE,
				text: 'Second job',
				metadata: { source: 'seq-test-2' },
				status: JobStatus.QUEUED,
			},
		});

		// Verify both exist and are independent
		const jobs = await db.processingJob.findMany({
			where: {
				id: { in: [job1.id, job2.id] },
			},
			orderBy: { createdAt: 'asc' },
		});

		expect(jobs.length).toBe(2);
		expect(jobs[0].text).toBe('First job');
		expect(jobs[1].text).toBe('Second job');
		expect(jobs[0].id).not.toBe(jobs[1].id);
	});

	it('should confirm database connection is active', async () => {
		// This will throw if connection is broken
		const result = await db.$queryRaw`SELECT 1 as alive`;
		expect(result).toBeTruthy();
	});
});
