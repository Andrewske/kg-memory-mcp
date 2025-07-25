/**
 * Functional Queue Service using Prisma
 */

import { JobStatus, type ProcessingJob } from '@prisma/client';
import { db } from '~/shared/database/client';
import { env } from '~/shared/env';
import { getQStash } from '~/shared/services/qstash';


export async function addJobToQueue(text: string, metadata: any): Promise<string> {
	// Add to database
	const job = await db.processingJob.create({
		data: {
			text,
			metadata,
			status: JobStatus.QUEUED,
		},
	});

	// Send to QStash if available
	const qstash = getQStash();
	if (qstash && env.HTTP_SERVER_URL) {
		try {
			await qstash.publishJSON({
				url: `${env.HTTP_SERVER_URL}/api/process-job`,
				body: { jobId: job.id },
				// Optional: Add delay, retries, etc.
				// delay: 5,
				// retries: 3
			});

			console.log(`Job ${job.id} queued with QStash`);
		} catch (error) {
			console.error('Failed to queue job with QStash:', error);
			// Job is still in database, can be processed manually
		}
	} else {
		console.log(`Job ${job.id} added to database (QStash not configured)`);
	}

	return job.id;
}

export async function updateJobStatus(
	jobId: string,
	status: JobStatus,
	result?: any,
	error?: string
): Promise<void> {
	const updateData: any = { status };

	if (status === JobStatus.PROCESSING) {
		updateData.startedAt = new Date();
	} else if (status === JobStatus.COMPLETED) {
		updateData.completedAt = new Date();
		if (result !== undefined) {
			updateData.result = result;
		}
	} else if (status === JobStatus.FAILED) {
		updateData.completedAt = new Date();
		if (error) {
			updateData.errorMessage = error;
		}
		// Increment retry count
		await db.processingJob.update({
			where: { id: jobId },
			data: { retryCount: { increment: 1 } },
		});
	}

	await db.processingJob.update({
		where: { id: jobId },
		data: updateData,
	});
}

export async function getJob(jobId: string): Promise<ProcessingJob | null> {
	const job = await db.processingJob.findUnique({
		where: { id: jobId },
	});

	if (!job) return null;

	return {
		id: job.id,
		text: job.text,
		metadata: job.metadata,
		status: job.status,
		result: job.result,
		errorMessage: job.errorMessage,
		createdAt: job.createdAt,
		startedAt: job.startedAt,
		completedAt: job.completedAt,
		retryCount: job.retryCount,
		maxRetries: job.maxRetries,
	};
}

export async function getJobsByStatus(
	status: JobStatus,
	limit: number = 10
): Promise<ProcessingJob[]> {
	const jobs = await db.processingJob.findMany({
		where: { status },
		orderBy: { createdAt: 'asc' },
		take: limit,
	});

	return jobs.map(job => ({
		id: job.id,
		text: job.text,
		metadata: job.metadata,
		status: job.status,
		result: job.result,
		errorMessage: job.errorMessage,
		createdAt: job.createdAt,
		startedAt: job.startedAt,
		completedAt: job.completedAt,
		retryCount: job.retryCount,
		maxRetries: job.maxRetries,
	}));
}

export async function getQueueStats(): Promise<{
	queued: number;
	processing: number;
	completed: number;
	failed: number;
	total: number;
}> {
	const [queued, processing, completed, failed, total] = await Promise.all([
		db.processingJob.count({ where: { status: JobStatus.QUEUED } }),
		db.processingJob.count({ where: { status: JobStatus.PROCESSING } }),
		db.processingJob.count({ where: { status: JobStatus.COMPLETED } }),
		db.processingJob.count({ where: { status: JobStatus.FAILED } }),
		db.processingJob.count(),
	]);

	return { queued, processing, completed, failed, total };
}

export async function retryFailedJob(jobId: string): Promise<boolean> {
	const job = await db.processingJob.findUnique({
		where: { id: jobId },
	});

	if (!job || job.status !== JobStatus.FAILED) {
		return false;
	}

	if (job.retryCount >= job.maxRetries) {
		console.log(`Job ${jobId} has exceeded max retries (${job.maxRetries})`);
		return false;
	}

	// Reset job to queued status
	await db.processingJob.update({
		where: { id: jobId },
		data: {
			status: JobStatus.QUEUED,
			errorMessage: null,
			startedAt: null,
			completedAt: null,
		},
	});

	// Re-queue with QStash if available
	const qstash = getQStash();
	if (qstash && env.HTTP_SERVER_URL) {
		try {
			await qstash.publishJSON({
				url: `${env.HTTP_SERVER_URL}/api/process-job`,
				body: { jobId: job.id },
			});
		} catch (error) {
			console.error(`Failed to re-queue job ${jobId} with QStash:`, error);
		}
	}

	return true;
}

export async function cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

	const result = await db.processingJob.deleteMany({
		where: {
			OR: [{ status: JobStatus.COMPLETED }, { status: JobStatus.FAILED }],
			completedAt: {
				lt: cutoffDate,
			},
		},
	});

	return result.count;
}

export async function getNextQueuedJob(): Promise<ProcessingJob | null> {
	// Get the oldest queued job
	const job = await db.processingJob.findFirst({
		where: { status: JobStatus.QUEUED },
		orderBy: { createdAt: 'asc' },
	});

	if (!job) return null;

	return {
		id: job.id,
		text: job.text,
		metadata: job.metadata,
		status: job.status,
		result: job.result,
		errorMessage: job.errorMessage,
		createdAt: job.createdAt,
		startedAt: job.startedAt,
		completedAt: job.completedAt,
		retryCount: job.retryCount,
		maxRetries: job.maxRetries,
	};
}
