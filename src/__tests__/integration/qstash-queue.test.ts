/**
 * Integration tests for QStash queue integration
 */

import { JobStatus, JobType, type ProcessingJob } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('~/shared/services/qstash.js');
vi.mock('~/shared/env.js');

import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import {
	addJobToQueue,
	cleanupOldJobs,
	getJobsByStatus,
	getNextQueuedJob,
	getQueueStats,
	retryFailedJob,
	updateJobStatus,
} from '~/shared/services/queue-service.js';
import { getQStash } from '~/shared/services/qstash.js';
import { createMockQStash, mockEnv } from '../helpers/mock-factories.js';
import { cleanupTestDatabase, setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('QStash Queue Integration', () => {
	let mockQStash: ReturnType<typeof createMockQStash>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockQStash = createMockQStash();
		(getQStash as vi.Mock).mockReturnValue(mockQStash);
		Object.assign(env, {
			...mockEnv,
			HTTP_SERVER_URL: 'http://localhost:3000',
			QSTASH_TOKEN: 'test-token',
		});
	});

	afterAll(async () => {
		await cleanupTestDatabase();
	});

	describe('Job Queuing', () => {
		it('should queue a job successfully with QStash', async () => {
			const jobData = {
				text: 'Test text for processing',
				source: 'qstash-test',
				source_type: 'test',
				source_date: new Date().toISOString(),
			};

			mockQStash.publishJSON.mockResolvedValue({ messageId: 'test-msg-id' } as any);

			const jobId = await addJobToQueue(jobData);

			expect(jobId).toBeTruthy();
			expect(mockQStash.publishJSON).toHaveBeenCalledWith({
				url: 'http://localhost:3000/api/process-job',
				body: { jobId },
			});

			// Verify job created in database
			const job = await db.processingJob.findUnique({ where: { id: jobId } });
			expect(job).toBeTruthy();
			expect(job?.status).toBe(JobStatus.QUEUED);
			expect(job?.text).toBe(jobData.text);
		});

		it('should queue job to database even if QStash fails', async () => {
			const jobData = {
				text: 'Test text',
				source: 'qstash-fail-test',
				source_type: 'test',
				source_date: new Date().toISOString(),
			};

			mockQStash.publishJSON.mockRejectedValue(new Error('QStash service unavailable'));

			const jobId = await addJobToQueue(jobData);

			expect(jobId).toBeTruthy();

			// Verify job still created in database
			const job = await db.processingJob.findUnique({ where: { id: jobId } });
			expect(job).toBeTruthy();
			expect(job?.status).toBe(JobStatus.QUEUED);
		});

		it('should handle multiple jobs queued concurrently', async () => {
			const jobDataArray = Array.from({ length: 5 }, (_, i) => ({
				text: `Test text ${i}`,
				source: `concurrent-test-${i}`,
				source_type: 'test',
				source_date: new Date().toISOString(),
			}));

			mockQStash.publishJSON.mockResolvedValue({ messageId: 'test-msg-id' } as any);

			const jobIds = await Promise.all(jobDataArray.map(data => addJobToQueue(data)));

			expect(jobIds).toHaveLength(5);
			expect(new Set(jobIds).size).toBe(5); // All unique

			// Verify all jobs created
			const jobs = await db.processingJob.findMany({
				where: { id: { in: jobIds } },
			});
			expect(jobs).toHaveLength(5);
			expect(mockQStash.publishJSON).toHaveBeenCalledTimes(5);
		});

		it('should not queue to QStash when token not configured', async () => {
			Object.assign(env, { QSTASH_TOKEN: undefined });
			(getQStash as vi.Mock).mockReturnValue(null);

			const jobData = {
				text: 'Test text',
				source: 'no-qstash-test',
				source_type: 'test',
				source_date: new Date().toISOString(),
			};

			const jobId = await addJobToQueue(jobData);

			expect(jobId).toBeTruthy();
			expect(mockQStash.publishJSON).not.toHaveBeenCalled();

			// Job still created in database
			const job = await db.processingJob.findUnique({ where: { id: jobId } });
			expect(job?.status).toBe(JobStatus.QUEUED);
		});
	});

	describe('Job Processing and Status Updates', () => {
		it('should update job status to PROCESSING', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Test text',
					metadata: { source: 'status-test' },
					status: JobStatus.QUEUED,
				},
			});

			await updateJobStatus(job.id, JobStatus.PROCESSING);

			const updatedJob = await db.processingJob.findUnique({ where: { id: job.id } });
			expect(updatedJob?.status).toBe(JobStatus.PROCESSING);
			expect(updatedJob?.startedAt).toBeTruthy();
		});

		it('should update job status to COMPLETED with result', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Test text',
					metadata: { source: 'complete-test' },
					status: JobStatus.PROCESSING,
				},
			});

			const result = { triplesStored: 10, conceptsStored: 5 };
			await updateJobStatus(job.id, JobStatus.COMPLETED, result);

			const updatedJob = await db.processingJob.findUnique({ where: { id: job.id } });
			expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
			expect(updatedJob?.completedAt).toBeTruthy();
			expect(updatedJob?.result).toEqual(result);
		});

		it('should update job status to FAILED and increment retry count', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Test text',
					metadata: { source: 'fail-test' },
					status: JobStatus.PROCESSING,
					retryCount: 0,
				},
			});

			await updateJobStatus(job.id, JobStatus.FAILED, undefined, 'Processing failed');

			const updatedJob = await db.processingJob.findUnique({ where: { id: job.id } });
			expect(updatedJob?.status).toBe(JobStatus.FAILED);
			expect(updatedJob?.errorMessage).toBe('Processing failed');
			expect(updatedJob?.retryCount).toBe(1);
			expect(updatedJob?.completedAt).toBeTruthy();
		});
	});

	describe('Job Retry Logic', () => {
		it('should retry a failed job successfully', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Test text',
					metadata: { source: 'retry-test' },
					status: JobStatus.FAILED,
					retryCount: 1,
					maxRetries: 3,
					errorMessage: 'Previous failure',
				},
			});

			mockQStash.publishJSON.mockResolvedValue({ messageId: 'retry-msg-id' } as any);

			const success = await retryFailedJob(job.id);

			expect(success).toBe(true);
			expect(mockQStash.publishJSON).toHaveBeenCalledWith({
				url: 'http://localhost:3000/api/process-job',
				body: { jobId: job.id },
			});

			const updatedJob = await db.processingJob.findUnique({ where: { id: job.id } });
			expect(updatedJob?.status).toBe(JobStatus.QUEUED);
			expect(updatedJob?.errorMessage).toBeNull();
			expect(updatedJob?.startedAt).toBeNull();
			expect(updatedJob?.completedAt).toBeNull();
		});

		it('should not retry job that exceeded max retries', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Test text',
					metadata: { source: 'max-retry-test' },
					status: JobStatus.FAILED,
					retryCount: 3,
					maxRetries: 3,
				},
			});

			const success = await retryFailedJob(job.id);

			expect(success).toBe(false);
			expect(mockQStash.publishJSON).not.toHaveBeenCalled();

			const updatedJob = await db.processingJob.findUnique({ where: { id: job.id } });
			expect(updatedJob?.status).toBe(JobStatus.FAILED);
		});

		it('should not retry job that is not in FAILED status', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Test text',
					metadata: { source: 'completed-retry-test' },
					status: JobStatus.COMPLETED,
				},
			});

			const success = await retryFailedJob(job.id);

			expect(success).toBe(false);
			expect(mockQStash.publishJSON).not.toHaveBeenCalled();
		});

		it('should handle retry when QStash fails', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Test text',
					metadata: { source: 'qstash-fail-retry-test' },
					status: JobStatus.FAILED,
					retryCount: 0,
					maxRetries: 3,
				},
			});

			mockQStash.publishJSON.mockRejectedValue(new Error('QStash unavailable'));

			const success = await retryFailedJob(job.id);

			// Should still return true (job reset to QUEUED in database)
			expect(success).toBe(true);

			const updatedJob = await db.processingJob.findUnique({ where: { id: job.id } });
			expect(updatedJob?.status).toBe(JobStatus.QUEUED);
		});
	});

	describe('Queue Ordering and Processing', () => {
		it('should process jobs in FIFO order', async () => {
			const job1 = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'First job',
					metadata: { source: 'fifo-test-1' },
					status: JobStatus.QUEUED,
				},
			});

			// Wait a bit to ensure different timestamps
			await new Promise(resolve => setTimeout(resolve, 10));

			const job2 = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Second job',
					metadata: { source: 'fifo-test-2' },
					status: JobStatus.QUEUED,
				},
			});

			const nextJob = await getNextQueuedJob();

			expect(nextJob?.id).toBe(job1.id);
		});

		it('should get jobs by status with limit', async () => {
			// Create multiple queued jobs
			await Promise.all(
				Array.from({ length: 15 }, (_, i) =>
					db.processingJob.create({
						data: {
							job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
							text: `Job ${i}`,
							metadata: { source: `batch-test-${i}` },
							status: JobStatus.QUEUED,
						},
					})
				)
			);

			const queuedJobs = await getJobsByStatus(JobStatus.QUEUED, 10);

			expect(queuedJobs).toHaveLength(10);
			expect(queuedJobs.every(job => job.status === JobStatus.QUEUED)).toBe(true);
		});

		it('should handle queue backpressure with many jobs', async () => {
			// Create 100 jobs
			const jobs = await Promise.all(
				Array.from({ length: 100 }, (_, i) =>
					db.processingJob.create({
						data: {
							job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
							text: `Job ${i}`,
							metadata: { source: `backpressure-test-${i}` },
							status: JobStatus.QUEUED,
						},
					})
				)
			);

			expect(jobs).toHaveLength(100);

			// Verify queue stats
			const stats = await getQueueStats();
			expect(stats.queued).toBeGreaterThanOrEqual(100);

			// Process first batch
			const firstBatch = await getJobsByStatus(JobStatus.QUEUED, 10);
			expect(firstBatch).toHaveLength(10);

			// Mark some as processing
			await Promise.all(
				firstBatch.slice(0, 5).map(job => updateJobStatus(job.id, JobStatus.PROCESSING))
			);

			const updatedStats = await getQueueStats();
			expect(updatedStats.processing).toBeGreaterThanOrEqual(5);
			expect(updatedStats.queued).toBeLessThan(stats.queued);
		});
	});

	describe('Queue Statistics and Monitoring', () => {
		it('should return accurate queue statistics', async () => {
			const timestamp = Date.now();
			// Create jobs in different statuses with unique sources
			await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Queued job',
					metadata: { source: `stats-queued-${timestamp}` },
					status: JobStatus.QUEUED,
				},
			});

			await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Processing job',
					metadata: { source: `stats-processing-${timestamp}` },
					status: JobStatus.PROCESSING,
				},
			});

			await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Completed job',
					metadata: { source: `stats-completed-${timestamp}` },
					status: JobStatus.COMPLETED,
				},
			});

			await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Failed job',
					metadata: { source: `stats-failed-${timestamp}` },
					status: JobStatus.FAILED,
				},
			});

			const stats = await getQueueStats();

			// Check that each category has at least the jobs we just created
			expect(stats.total).toBeGreaterThanOrEqual(4);
			expect(stats.queued).toBeGreaterThanOrEqual(1);
			expect(stats.processing).toBeGreaterThanOrEqual(1);
			expect(stats.completed).toBeGreaterThanOrEqual(1);
			expect(stats.failed).toBeGreaterThanOrEqual(1);
		});
	});

	describe('Job Cleanup', () => {
		it('should cleanup old completed jobs', async () => {
			const timestamp = Date.now();
			const oldDate = new Date();
			oldDate.setDate(oldDate.getDate() - 40); // 40 days ago

			const oldJob = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Old completed job',
					metadata: { source: `cleanup-old-${timestamp}` },
					status: JobStatus.COMPLETED,
					completedAt: oldDate,
					createdAt: oldDate,
				},
			});

			const recentJob = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Recent completed job',
					metadata: { source: `cleanup-recent-${timestamp}` },
					status: JobStatus.COMPLETED,
					completedAt: new Date(),
				},
			});

			// Count old jobs before cleanup
			const oldJobsBefore = await db.processingJob.count({
				where: {
					completedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
					status: { in: [JobStatus.COMPLETED, JobStatus.FAILED] },
				},
			});

			const deletedCount = await cleanupOldJobs(30);

			expect(deletedCount).toBeGreaterThanOrEqual(1);
			expect(deletedCount).toBeLessThanOrEqual(oldJobsBefore);

			// Verify old job deleted
			const oldJobCheck = await db.processingJob.findUnique({ where: { id: oldJob.id } });
			expect(oldJobCheck).toBeNull();

			// Verify recent job still exists
			const recentJobCheck = await db.processingJob.findUnique({ where: { id: recentJob.id } });
			expect(recentJobCheck).toBeTruthy();
		});

		it('should cleanup old failed jobs', async () => {
			const timestamp = Date.now();
			const oldDate = new Date();
			oldDate.setDate(oldDate.getDate() - 40);

			const oldFailedJob = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Old failed job',
					metadata: { source: `cleanup-old-failed-${timestamp}` },
					status: JobStatus.FAILED,
					completedAt: oldDate,
					createdAt: oldDate,
				},
			});

			const deletedCount = await cleanupOldJobs(30);

			expect(deletedCount).toBeGreaterThanOrEqual(1);

			// Verify old failed job was deleted
			const jobCheck = await db.processingJob.findUnique({ where: { id: oldFailedJob.id } });
			expect(jobCheck).toBeNull();
		});

		it('should not cleanup queued or processing jobs', async () => {
			const timestamp = Date.now();
			const oldDate = new Date();
			oldDate.setDate(oldDate.getDate() - 40);

			const queuedJob = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Old queued job',
					metadata: { source: `cleanup-queued-${timestamp}` },
					status: JobStatus.QUEUED,
					createdAt: oldDate,
				},
			});

			const processingJob = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Old processing job',
					metadata: { source: `cleanup-processing-${timestamp}` },
					status: JobStatus.PROCESSING,
					startedAt: oldDate,
					createdAt: oldDate,
				},
			});

			const beforeCount = await db.processingJob.count({
				where: {
					id: { in: [queuedJob.id, processingJob.id] },
				},
			});
			expect(beforeCount).toBe(2);

			await cleanupOldJobs(30);

			// Verify jobs still exist
			const queuedJobCheck = await db.processingJob.findUnique({ where: { id: queuedJob.id } });
			const processingJobCheck = await db.processingJob.findUnique({
				where: { id: processingJob.id },
			});

			expect(queuedJobCheck).toBeTruthy();
			expect(processingJobCheck).toBeTruthy();
		});
	});

	describe('Error Handling', () => {
		it('should handle retry of non-existent job gracefully', async () => {
			// Use a valid UUID format
			const fakeUuid = '00000000-0000-0000-0000-000000000000';

			// Should return false and not throw
			const success = await retryFailedJob(fakeUuid);

			expect(success).toBe(false);
			expect(mockQStash.publishJSON).not.toHaveBeenCalled();
		});

		it('should handle concurrent status updates gracefully', async () => {
			const timestamp = Date.now();
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					text: 'Concurrent test',
					metadata: { source: `concurrent-status-${timestamp}` },
					status: JobStatus.QUEUED,
				},
			});

			// Verify job exists before updates
			const jobBeforeUpdate = await db.processingJob.findUnique({ where: { id: job.id } });
			expect(jobBeforeUpdate).toBeTruthy();

			// Attempt concurrent updates
			await Promise.all([
				updateJobStatus(job.id, JobStatus.PROCESSING),
				updateJobStatus(job.id, JobStatus.PROCESSING),
				updateJobStatus(job.id, JobStatus.PROCESSING),
			]);

			const updatedJob = await db.processingJob.findUnique({ where: { id: job.id } });
			expect(updatedJob?.status).toBe(JobStatus.PROCESSING);
		});

		it('should handle QStash publish failures during queue', async () => {
			const jobData = {
				text: 'Test text',
				source: 'qstash-fail',
				source_type: 'test',
				source_date: new Date().toISOString(),
			};

			let callCount = 0;
			mockQStash.publishJSON.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					throw new Error('QStash temporary failure');
				}
				return { messageId: 'success-msg' } as any;
			});

			// First call should handle error gracefully
			const jobId1 = await addJobToQueue(jobData);
			expect(jobId1).toBeTruthy();

			// Second call should succeed
			const jobId2 = await addJobToQueue(jobData);
			expect(jobId2).toBeTruthy();

			expect(mockQStash.publishJSON).toHaveBeenCalledTimes(2);
		});
	});
});
