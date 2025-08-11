/**
 * Job router for dispatching jobs to appropriate handlers
 */

import { JobStatus, type ProcessingJob } from '@prisma/client';
import { db } from '~/shared/database/client.js';
import { BatchExtractionJobHandler } from './handlers/batch-extraction-handler.js';
import { ConceptJobHandler } from './handlers/concept-handler.js';
import { DeduplicationJobHandler } from './handlers/deduplication-handler.js';
import type { JobHandler, JobResult } from './job-types.js';

// Initialize job handlers
const JOB_HANDLERS: JobHandler[] = [
	new BatchExtractionJobHandler(),
	new ConceptJobHandler(),
	new DeduplicationJobHandler(),
];

/**
 * Route a job to the appropriate handler
 */
export async function routeJob(job: ProcessingJob): Promise<JobResult> {
	const handler = JOB_HANDLERS.find(h => h.canHandle(job.job_type));

	if (!handler) {
		throw new Error(`No handler found for job type: ${job.job_type}`);
	}

	// Update job status to processing
	await updateJobStatus(job.id, JobStatus.PROCESSING);

	const startTime = Date.now();
	console.debug(`[JobRouter] Routing ${job.job_type} job ${job.id} to handler`);

	try {
		const result = await handler.execute(job);

		const duration = Date.now() - startTime;
		console.debug(`[JobRouter] Job ${job.id} completed in ${duration}ms`, {
			success: result.success,
			data: result.data,
		});

		if (result.success) {
			await updateJobStatus(job.id, JobStatus.COMPLETED, result.data);
		} else {
			await updateJobStatus(job.id, JobStatus.FAILED, null, result.error?.message);
		}

		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error(`[JobRouter] Job ${job.id} failed:`, error);

		await updateJobStatus(job.id, JobStatus.FAILED, null, errorMessage);

		return {
			success: false,
			error: {
				message: errorMessage,
				operation: 'job_routing',
				cause: error,
			},
		};
	}
}

/**
 * Update job status in database
 */
async function updateJobStatus(
	jobId: string,
	status: JobStatus,
	result?: any,
	errorMessage?: string
): Promise<void> {
	const updateData: any = {
		status,
	};

	if (status === JobStatus.PROCESSING && !updateData.startedAt) {
		updateData.startedAt = new Date();
	}

	if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
		updateData.completedAt = new Date();
	}

	if (result !== undefined) {
		updateData.result = result;
	}

	if (errorMessage) {
		updateData.errorMessage = errorMessage;
	}

	await db.processingJob.update({
		where: { id: jobId },
		data: updateData,
	});
}

/**
 * Get job progress
 */
export async function getJobProgress(jobId: string): Promise<number> {
	const job = await db.processingJob.findUnique({
		where: { id: jobId },
		select: { progress: true },
	});

	return job?.progress ?? 0;
}

/**
 * Check if job can be retried
 */
export async function canRetryJob(jobId: string): Promise<boolean> {
	const job = await db.processingJob.findUnique({
		where: { id: jobId },
		select: {
			retryCount: true,
			maxRetries: true,
			status: true,
		},
	});

	if (!job) {
		return false;
	}

	return job.status === JobStatus.FAILED && job.retryCount < job.maxRetries;
}

/**
 * Retry a failed job
 */
export async function retryJob(jobId: string): Promise<JobResult> {
	const job = await db.processingJob.findUnique({
		where: { id: jobId },
	});

	if (!job) {
		return {
			success: false,
			error: {
				message: 'Job not found',
				operation: 'retry_job',
			},
		};
	}

	if (!(await canRetryJob(jobId))) {
		return {
			success: false,
			error: {
				message: 'Job cannot be retried',
				operation: 'retry_job',
			},
		};
	}

	// Increment retry count and reset status
	await db.processingJob.update({
		where: { id: jobId },
		data: {
			status: JobStatus.QUEUED,
			retryCount: { increment: 1 },
			errorMessage: null,
			result: {},
			progress: 0,
		},
	});

	// Route the job again
	return routeJob(job);
}
