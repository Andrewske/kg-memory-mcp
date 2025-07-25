import { JobStatus } from '@prisma/client';
import { type ProcessKnowledgeArgs, processKnowledge } from '~/server/transport-manager';
import { addJobToQueue, getJob, updateJobStatus } from '~/shared/services/queue-service';

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
export async function handleProcessJob(body: { jobId: string }) {
	const { jobId } = body;

	if (!jobId) {
		throw new Error('Job ID is required');
	}

	// Get job from database
	const job = await getJob(jobId);
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
		// Mark job as processing
		await updateJobStatus(jobId, JobStatus.PROCESSING);

		const processKnowledgeArgs: ProcessKnowledgeArgs = {
			text: job.text,
			...(job.metadata as Omit<ProcessKnowledgeArgs, 'text'>),
		};

		// Process the knowledge using your existing function
		const result = await processKnowledge(processKnowledgeArgs);

		if (!result.success) {
			await updateJobStatus(jobId, JobStatus.FAILED, null, result.error?.message);
			throw new Error(result.error?.message || 'Processing failed');
		}

		// Mark job as completed
		await updateJobStatus(jobId, JobStatus.COMPLETED, result.data);

		return {
			jobId,
			status: 'completed',
			result: result.data,
		};
	} catch (error) {
		// Mark job as failed
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		await updateJobStatus(jobId, JobStatus.FAILED, null, errorMessage);

		throw error;
	}
}
