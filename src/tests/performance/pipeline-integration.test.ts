/**
 * Integration test for the 3-job knowledge processing pipeline
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobStatus, JobType } from '@prisma/client';
import { routeJob } from '~/features/knowledge-processing/job-router.js';
import { setupTestSuite } from '~/__tests__/helpers/test-setup.js';

setupTestSuite();
import {
	getPipelineStatus,
	initiateKnowledgePipeline,
	isPipelineComplete,
} from '~/features/knowledge-processing/pipeline-coordinator.js';
import { db } from '~/shared/database/client.js';
import {
	cleanupTestDatabase,
	setupTestSuite,
	testEnv,
} from '~//__tests__/helpers/test-setup.js';
import {
	createMockAIProvider,
	createMockEmbeddingService,
	createMockQStash,
	mockEnv,
} from '~//__tests__/helpers/mock-factories.js';
import { createAIProvider } from '~/shared/services/ai-provider-service.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { getQStash } from '~/shared/services/qstash.js';
import { env } from '~/shared/env.js';

// Setup test environment
setupTestSuite();

// Mock external dependencies
jest.mock('~/shared/services/ai-provider-service.js');
jest.mock('~/shared/services/embedding-service.js');
jest.mock('~/shared/services/qstash.js');
jest.mock('~/shared/env.js');

describe('Knowledge Processing Pipeline Integration', () => {
	const testSource = 'pipeline-test';
	const testSourceType = 'integration_test';
	const testText = `
		John Smith is a software engineer at Tech Corp. He has been working on artificial intelligence projects for the past five years.
		The company recently launched a new AI product that analyzes customer behavior patterns.
		John feels excited about the project's potential impact on the industry.
		The product launch event happened last month and was very successful.
	`;

	let mockAIProvider: ReturnType<typeof createMockAIProvider>;
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;
	let mockQStash: ReturnType<typeof createMockQStash>;

	beforeAll(() => {
		// Setup mocks once for all tests
		mockAIProvider = createMockAIProvider();
		mockEmbeddingService = createMockEmbeddingService();
		mockQStash = createMockQStash();

		(createAIProvider as jest.Mock).mockReturnValue(mockAIProvider);
		(createEmbeddingService as jest.Mock).mockReturnValue(mockEmbeddingService);
		(getQStash as jest.Mock).mockReturnValue(mockQStash);
		Object.assign(env, { ...mockEnv });
	});

	afterAll(async () => {
		// Final cleanup
		await cleanupTestDatabase();
	});

	it('should initiate pipeline successfully', async () => {
		const parentJobId = await initiateKnowledgePipeline({
			text: testText,
			source: testSource,
			source_type: testSourceType,
			source_date: new Date().toISOString(),
		});

		expect(parentJobId).toBeTruthy();
		expect(typeof parentJobId).toBe('string');

		// Check that parent job was created
		const parentJob = await db.processingJob.findUnique({
			where: { id: parentJobId },
		});

		expect(parentJob).toBeTruthy();
		expect(parentJob?.job_type).toBe(JobType.PROCESS_KNOWLEDGE);
		expect(parentJob?.status).toBe(JobStatus.PROCESSING);
	}, 10000);

	it('should process extraction job successfully', async () => {
		// Create and process an extraction job directly
		const extractionJob = await db.processingJob.create({
			data: {
				job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
				text: testText,
				metadata: {
					source: testSource,
					source_type: testSourceType,
					source_date: new Date().toISOString(),
					resourceLimits: {
						maxConnections: 2,
						maxAICalls: 4,
						maxMemoryMB: 2048,
					},
				},
				status: JobStatus.QUEUED,
			},
		});

		// Process the job
		const result = await routeJob(extractionJob);

		expect(result.success).toBe(true);
		expect(result.data).toBeTruthy();
		expect(result.data?.triplesStored).toBeGreaterThan(0);

		// Check job was marked as completed
		const updatedJob = await db.processingJob.findUnique({
			where: { id: extractionJob.id },
		});

		expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
		expect(updatedJob?.progress).toBe(100);
	}, 30000);

	it('should get pipeline status correctly', async () => {
		// Create a test parent job
		const parentJob = await db.processingJob.create({
			data: {
				job_type: JobType.PROCESS_KNOWLEDGE,
				text: testText,
				metadata: {
					source: `${testSource}_status`,
					source_type: testSourceType,
					source_date: new Date().toISOString(),
				},
				status: JobStatus.PROCESSING,
			},
		});

		// Create child jobs
		const _childJob = await db.processingJob.create({
			data: {
				job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
				parent_job_id: parentJob.id,
				stage: 'EXTRACTION',
				text: testText,
				metadata: {
					source: `${testSource}_status`,
					source_type: testSourceType,
					source_date: new Date().toISOString(),
				},
				status: JobStatus.COMPLETED,
				progress: 100,
			},
		});

		// Get pipeline status
		const status = await getPipelineStatus(parentJob.id);

		expect(status).toBeTruthy();
		expect(status.parentJobId).toBe(parentJob.id);
		expect(status.stages).toBeTruthy();
		expect(status.stages.EXTRACTION).toBeTruthy();
		expect(status.stages.EXTRACTION.status).toBe(JobStatus.COMPLETED);
		expect(status.stages.EXTRACTION.progress).toBe(100);
	});

	it('should detect pipeline completion correctly', async () => {
		// Create a test parent job
		const parentJob = await db.processingJob.create({
			data: {
				job_type: JobType.PROCESS_KNOWLEDGE,
				text: testText,
				metadata: {
					source: `${testSource}_complete`,
					source_type: testSourceType,
					source_date: new Date().toISOString(),
				},
				status: JobStatus.COMPLETED,
			},
		});

		// Create completed child jobs
		await db.processingJob.create({
			data: {
				job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
				parent_job_id: parentJob.id,
				stage: 'EXTRACTION',
				text: testText,
				metadata: {
					source: `${testSource}_complete`,
					source_type: testSourceType,
					source_date: new Date().toISOString(),
				},
				status: JobStatus.COMPLETED,
				progress: 100,
			},
		});

		const isComplete = await isPipelineComplete(parentJob.id);
		expect(isComplete).toBe(true);
	});

	it('should handle partial pipeline completion', async () => {
		// Create a test parent job
		const parentJob = await db.processingJob.create({
			data: {
				job_type: JobType.PROCESS_KNOWLEDGE,
				text: testText,
				metadata: {
					source: `${testSource}_partial`,
					source_type: testSourceType,
					source_date: new Date().toISOString(),
				},
				status: JobStatus.PROCESSING,
			},
		});

		// Create jobs in different stages
		await db.processingJob.createMany({
			data: [
				{
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					parent_job_id: parentJob.id,
					stage: 'EXTRACTION',
					text: testText,
					metadata: {
						source: `${testSource}_partial`,
						source_type: testSourceType,
						source_date: new Date().toISOString(),
					},
					status: JobStatus.COMPLETED,
					progress: 100,
				},
				{
					job_type: JobType.GENERATE_CONCEPTS,
					parent_job_id: parentJob.id,
					stage: 'CONCEPTS',
					text: '',
					metadata: {
						source: `${testSource}_partial`,
						source_type: testSourceType,
						source_date: new Date().toISOString(),
					},
					status: JobStatus.PROCESSING,
					progress: 50,
				},
			],
		});

		const isComplete = await isPipelineComplete(parentJob.id);
		expect(isComplete).toBe(false);

		const status = await getPipelineStatus(parentJob.id);
		expect(status.isComplete).toBe(false);
	});
});
