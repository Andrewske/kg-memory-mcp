import { JobStatus } from '@prisma/client';
import { routeJob } from '~/features/knowledge-processing/job-router.js';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import { db } from '~/shared/database/client.js';
import { addJobToQueue, getJob, updateJobStatus } from '~/shared/services/queue-service.js';

// Queue processing for large jobs
export async function queueKnowledgeProcessing(data: {
	jobId: string;
	jobData: ProcessKnowledgeArgs;
}) {
	// Add to queue
	const jobId = await addJobToQueue(data.jobData);

	return {
		jobId,
		status: 'queued',
		message: 'Large job queued for background processing',
		estimatedTime: '2-5 minutes',
	};
}

// Handle background job processing (called by QStash)
// Get pipeline status endpoint
export async function getPipelineStatusEndpoint(params: { parentJobId: string }) {
	const { parentJobId } = params;

	try {
		// Import the function here to avoid circular dependencies
		const { getPipelineStatus } = await import(
			'~/features/knowledge-processing/pipeline-coordinator.js'
		);
		const status = await getPipelineStatus(parentJobId);

		if (!status) {
			return {
				success: false,
				error: 'Pipeline not found',
			};
		}

		return {
			success: true,
			data: status,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error(`[QueueRoute] Failed to get pipeline status:`, error);

		return {
			success: false,
			error: errorMessage,
		};
	}
}

export async function handleProcessJob(body: { jobId: string }) {
	const { jobId } = body;

	if (!jobId) {
		throw new Error('Job ID is required');
	}

	// Get job from database using Prisma directly
	const job = await db.processingJob.findUnique({
		where: { id: jobId },
	});

	if (!job) {
		throw new Error(`Job ${jobId} not found`);
	}

	if (job.status !== JobStatus.QUEUED) {
		return {
			jobId,
			status: job.status,
			message: 'Job already processed',
		};
	}

	try {
		console.debug(`[QueueRoute] Processing job ${jobId} of type ${job.job_type}`);

		// Route job to appropriate handler
		const result = await routeJob(job);

		if (!result.success) {
			throw new Error(result.error?.message || 'Processing failed');
		}

		return {
			jobId,
			status: 'completed',
			result: result.data,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error(`[QueueRoute] Job ${jobId} failed:`, error);

		// Update job status to failed
		await db.processingJob.update({
			where: { id: jobId },
			data: {
				status: JobStatus.FAILED,
				errorMessage,
				completedAt: new Date(),
			},
		});

		throw error;
	}
}
