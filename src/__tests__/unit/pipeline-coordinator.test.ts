/**
 * Unit tests for pipeline coordinator functions
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { JobStage, JobStatus, JobType } from '@prisma/client';

// Mock dependencies before imports
jest.mock('~/shared/database/client.js', () => ({
	db: {
		processingJob: {
			create: jest.fn(),
			findUnique: jest.fn(),
			findFirst: jest.fn(),
			findMany: jest.fn(),
			update: jest.fn(),
			deleteMany: jest.fn(),
		},
		$disconnect: jest.fn(),
	}
}));
jest.mock('~/shared/services/qstash.js');
jest.mock('~/shared/env.js');

import {
	getJobByStage,
	getPipelineStatus,
	initiateKnowledgePipeline,
	isPipelineComplete,
	schedulePostProcessingJobs,
	updateJobProgress,
} from '~/features/knowledge-processing/pipeline-coordinator.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { getQStash } from '~/shared/services/qstash.js';
import {
	createMockDatabase,
	createMockQStash,
	createTestArgs,
	createTestMetrics,
} from '../helpers/mock-factories.js';
import { setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Pipeline Coordinator', () => {
	let mockDb: ReturnType<typeof createMockDatabase>;
	let mockQStash: ReturnType<typeof createMockQStash>;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();

		// Setup mock implementations
		mockDb = createMockDatabase();
		mockQStash = createMockQStash();

		// Set up the mocked database client
		Object.assign(db.processingJob, mockDb.processingJob);
		(getQStash as jest.Mock).mockReturnValue(mockQStash);
		Object.assign(env, {
			HTTP_SERVER_URL: 'http://localhost:3000',
			ENABLE_SEMANTIC_DEDUP: false,
		});
	});

	describe('initiateKnowledgePipeline', () => {
		it('should create parent and extraction jobs successfully', async () => {
			const args = createTestArgs();
			const parentJobId = 'parent-job-id';
			const extractionJobId = 'extraction-job-id';

			// Mock parent job creation
			mockDb.processingJob.create
				.mockResolvedValueOnce({ id: parentJobId, ...args })
				.mockResolvedValueOnce({ id: extractionJobId, parent_job_id: parentJobId });

			const result = await initiateKnowledgePipeline(args);

			expect(result).toBe(parentJobId);

			// Verify parent job creation
			expect(mockDb.processingJob.create).toHaveBeenCalledWith({
				data: {
					job_type: JobType.PROCESS_KNOWLEDGE,
					text: args.text,
					metadata: expect.objectContaining({
						source: args.source,
						source_type: args.source_type,
						source_date: args.source_date,
						pipeline_version: '3-job-hybrid',
					}),
					status: JobStatus.PROCESSING,
				},
			});

			// Verify extraction job creation
			expect(mockDb.processingJob.create).toHaveBeenCalledWith({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					parent_job_id: parentJobId,
					stage: JobStage.EXTRACTION,
					text: args.text,
					metadata: expect.objectContaining({
						...args,
						parent_job_id: parentJobId,
						resourceLimits: {
							maxConnections: 2,
							maxAICalls: 4,
							maxMemoryMB: 2048,
						},
					}),
					status: JobStatus.QUEUED,
				},
			});

			// Verify QStash scheduling
			expect(mockQStash.publishJSON).toHaveBeenCalledWith({
				url: 'http://localhost:3000/api/process-job',
				body: { jobId: extractionJobId },
			});
		});

		it('should handle QStash unavailability gracefully', async () => {
			const args = createTestArgs();
			(getQStash as jest.Mock).mockReturnValue(null);

			const result = await initiateKnowledgePipeline(args);

			expect(result).toBeTruthy();
			expect(mockQStash.publishJSON).not.toHaveBeenCalled();
		});

		it('should include proper metadata in job creation', async () => {
			const args = createTestArgs();
			await initiateKnowledgePipeline(args);

			const parentJobCall = mockDb.processingJob.create.mock.calls[0][0];
			expect(parentJobCall.data.metadata).toMatchObject({
				source: args.source,
				source_type: args.source_type,
				source_date: args.source_date,
				pipeline_version: '3-job-hybrid',
				initiated_at: expect.any(String),
			});
		});
	});

	describe('schedulePostProcessingJobs', () => {
		const parentJobId = 'parent-job-id';
		const metrics = createTestMetrics({ triplesExtracted: 10, processingTime: 5000 });

		beforeEach(() => {
			(getQStash as jest.Mock).mockReturnValue(mockQStash);
		});

		it('should schedule concept generation job', async () => {
			await schedulePostProcessingJobs(parentJobId, metrics);

			expect(mockDb.processingJob.create).toHaveBeenCalledWith({
				data: {
					job_type: JobType.GENERATE_CONCEPTS,
					parent_job_id: parentJobId,
					stage: JobStage.CONCEPTS,
					text: '',
					metadata: {
						parent_job_id: parentJobId,
						extraction_metrics: metrics,
					},
					status: JobStatus.QUEUED,
				},
			});

			expect(mockQStash.publishJSON).toHaveBeenCalledWith({
				url: 'http://localhost:3000/api/process-job',
				body: { jobId: expect.any(String) },
				delay: expect.any(Number),
			});
		});

		it('should schedule deduplication job when enabled', async () => {
			Object.assign(env, { ENABLE_SEMANTIC_DEDUP: true });

			await schedulePostProcessingJobs(parentJobId, metrics);

			expect(mockDb.processingJob.create).toHaveBeenCalledTimes(2); // Concepts + Dedup

			const dedupJobCall = mockDb.processingJob.create.mock.calls[1][0];
			expect(dedupJobCall.data.job_type).toBe(JobType.DEDUPLICATE_KNOWLEDGE);
			expect(dedupJobCall.data.stage).toBe(JobStage.DEDUPLICATION);
		});

		it('should not schedule deduplication when disabled', async () => {
			Object.assign(env, { ENABLE_SEMANTIC_DEDUP: false });

			await schedulePostProcessingJobs(parentJobId, metrics);

			expect(mockDb.processingJob.create).toHaveBeenCalledTimes(1); // Only concepts
		});

		it('should calculate smart delays based on metrics', async () => {
			const largeMetrics = createTestMetrics({
				triplesExtracted: 100,
				processingTime: 30000, // 30 seconds
			});

			await schedulePostProcessingJobs(parentJobId, largeMetrics);

			const qstashCalls = mockQStash.publishJSON.mock.calls;
			const conceptDelay = qstashCalls[0][0].delay;

			expect(conceptDelay).toBeGreaterThanOrEqual(6); // Minimum delay is now 6
			expect(conceptDelay).toBeLessThanOrEqual(60); // Maximum delay
		});

		it('should handle QStash unavailability', async () => {
			(getQStash as jest.Mock).mockReturnValue(null);

			await expect(schedulePostProcessingJobs(parentJobId, metrics)).resolves.not.toThrow();

			expect(mockDb.processingJob.create).not.toHaveBeenCalled();
		});
	});

	describe('updateJobProgress', () => {
		const jobId = 'test-job-id';

		it('should update progress and status correctly', async () => {
			await updateJobProgress(jobId, 50);

			expect(mockDb.processingJob.update).toHaveBeenCalledWith({
				where: { id: jobId },
				data: {
					progress: 50,
					status: JobStatus.PROCESSING,
					startedAt: expect.any(Date),
				},
			});
		});

		it('should mark job as completed at 100% progress', async () => {
			await updateJobProgress(jobId, 100);

			expect(mockDb.processingJob.update).toHaveBeenCalledWith({
				where: { id: jobId },
				data: {
					progress: 100,
					status: JobStatus.COMPLETED,
					completedAt: expect.any(Date),
				},
			});
		});

		it('should include metrics when provided', async () => {
			const metrics = { processingTime: 1000, itemsProcessed: 5 };

			await updateJobProgress(jobId, 75, metrics);

			expect(mockDb.processingJob.update).toHaveBeenCalledWith({
				where: { id: jobId },
				data: {
					progress: 75,
					status: JobStatus.PROCESSING,
					metrics,
					startedAt: expect.any(Date),
				},
			});
		});

		it('should clamp progress values to valid range', async () => {
			// Test negative progress
			await updateJobProgress(jobId, -10);
			expect(mockDb.processingJob.update).toHaveBeenCalledWith({
				where: { id: jobId },
				data: { progress: 0 },
			});

			// Test progress over 100
			await updateJobProgress(jobId, 150);
			expect(mockDb.processingJob.update).toHaveBeenCalledWith({
				where: { id: jobId },
				data: {
					progress: 100,
					status: JobStatus.COMPLETED,
					completedAt: expect.any(Date),
				},
			});
		});
	});

	describe('getJobByStage', () => {
		it('should find job by parent ID and stage', async () => {
			const parentJobId = 'parent-job-id';
			const stage = JobStage.EXTRACTION;
			const expectedJob = { id: 'child-job', stage, parent_job_id: parentJobId };

			mockDb.processingJob.findFirst.mockResolvedValue(expectedJob);

			const result = await getJobByStage(parentJobId, stage);

			expect(result).toBe(expectedJob);
			expect(mockDb.processingJob.findFirst).toHaveBeenCalledWith({
				where: {
					parent_job_id: parentJobId,
					stage: stage,
				},
			});
		});

		it('should return null if no job found', async () => {
			mockDb.processingJob.findFirst.mockResolvedValue(null);

			const result = await getJobByStage('nonexistent-id', JobStage.CONCEPTS);

			expect(result).toBeNull();
		});
	});

	describe('isPipelineComplete', () => {
		const parentJobId = 'parent-job-id';

		it('should return true when all jobs are completed', async () => {
			const jobs = [
				{ status: JobStatus.COMPLETED, stage: null },
				{ status: JobStatus.COMPLETED, stage: JobStage.EXTRACTION },
				{ status: JobStatus.COMPLETED, stage: JobStage.CONCEPTS },
			];

			mockDb.processingJob.findMany.mockResolvedValue(jobs);

			const result = await isPipelineComplete(parentJobId);

			expect(result).toBe(true);
		});

		it('should return false when jobs are still processing', async () => {
			const jobs = [
				{ status: JobStatus.COMPLETED, stage: null },
				{ status: JobStatus.COMPLETED, stage: JobStage.EXTRACTION },
				{ status: JobStatus.PROCESSING, stage: JobStage.CONCEPTS },
			];

			mockDb.processingJob.findMany.mockResolvedValue(jobs);

			const result = await isPipelineComplete(parentJobId);

			expect(result).toBe(false);
		});

		it('should return true when jobs are failed', async () => {
			const jobs = [
				{ status: JobStatus.FAILED, stage: null },
				{ status: JobStatus.FAILED, stage: JobStage.EXTRACTION },
			];

			mockDb.processingJob.findMany.mockResolvedValue(jobs);

			const result = await isPipelineComplete(parentJobId);

			expect(result).toBe(true);
		});
	});

	describe('getPipelineStatus', () => {
		const parentJobId = 'parent-job-id';

		it('should return comprehensive pipeline status', async () => {
			const mockParentJob = {
				id: parentJobId,
				status: JobStatus.PROCESSING,
				createdAt: new Date('2025-01-01'),
				child_jobs: [
					{
						stage: JobStage.EXTRACTION,
						status: JobStatus.COMPLETED,
						progress: 100,
						startedAt: new Date('2025-01-01T00:01:00'),
						completedAt: new Date('2025-01-01T00:05:00'),
						metrics: { triplesExtracted: 5 },
					},
					{
						stage: JobStage.CONCEPTS,
						status: JobStatus.PROCESSING,
						progress: 50,
						startedAt: new Date('2025-01-01T00:05:30'),
						completedAt: null,
						metrics: null,
					},
				],
			};

			mockDb.processingJob.findUnique.mockResolvedValue(mockParentJob);
			mockDb.processingJob.findMany.mockResolvedValue([
				{ status: JobStatus.PROCESSING, stage: JobStage.CONCEPTS },
			]);

			const result = await getPipelineStatus(parentJobId);

			expect(result).toMatchObject({
				parentJobId: parentJobId,
				status: JobStatus.PROCESSING,
				createdAt: mockParentJob.createdAt,
				stages: {
					EXTRACTION: {
						status: JobStatus.COMPLETED,
						progress: 100,
						startedAt: expect.any(Date),
						completedAt: expect.any(Date),
						metrics: { triplesExtracted: 5 },
					},
					CONCEPTS: {
						status: JobStatus.PROCESSING,
						progress: 50,
						startedAt: expect.any(Date),
						completedAt: null,
						metrics: null,
					},
				},
				isComplete: false,
			});
		});

		it('should return null for non-existent parent job', async () => {
			mockDb.processingJob.findUnique.mockResolvedValue(null);

			const result = await getPipelineStatus('nonexistent-id');

			expect(result).toBeNull();
		});

		it('should handle parent job with no child jobs', async () => {
			const mockParentJob = {
				id: parentJobId,
				status: JobStatus.QUEUED,
				createdAt: new Date(),
				child_jobs: [],
			};

			mockDb.processingJob.findUnique.mockResolvedValue(mockParentJob);
			mockDb.processingJob.findMany.mockResolvedValue([{ status: JobStatus.QUEUED, stage: null }]);

			const result = await getPipelineStatus(parentJobId);

			expect(result.stages).toEqual({});
			expect(result.isComplete).toBe(false);
		});
	});
});
