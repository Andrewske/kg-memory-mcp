/**
 * Pipeline coordinator for managing the 3-job knowledge processing pipeline
 */

import { JobStage, JobStatus, JobType } from '@prisma/client';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { getQStash } from '~/shared/services/qstash.js';
import { createContext, log } from '~/shared/utils/debug-logger.js';
import type { ExtractionMetrics, JobMetadata } from './job-types.js';

/**
 * Initiate the knowledge processing pipeline
 * Creates a parent job and schedules the extraction job
 */
export async function initiateKnowledgePipeline(args: ProcessKnowledgeArgs): Promise<string> {
	const context = createContext('PIPELINE_COORDINATOR', 'initiate_pipeline', {
		source: args.source,
	});

	// Create parent tracking job
	const parentJob = await db.processingJob.create({
		data: {
			job_type: JobType.PROCESS_KNOWLEDGE,
			text: args.text,
			metadata: {
				source: args.source,
				source_type: args.source_type,
				source_date: args.source_date,
				pipeline_version: '3-job-hybrid',
				initiated_at: new Date().toISOString(),
			},
			status: JobStatus.PROCESSING,
		},
	});

	// Create coordinated extraction job
	const extractionJob = await db.processingJob.create({
		data: {
			job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
			parent_job_id: parentJob.id,
			stage: JobStage.EXTRACTION,
			text: args.text,
			metadata: {
				...args,
				parent_job_id: parentJob.id,
				resourceLimits: {
					maxConnections: 2, // Controlled DB connections
					maxAICalls: 4, // Allow 4 parallel AI calls
					maxMemoryMB: 2048, // Memory limit
				},
			} as JobMetadata,
			status: JobStatus.QUEUED,
		},
	});

	// Queue extraction job with QStash
	const qstash = getQStash();
	if (qstash) {
		await qstash.publishJSON({
			url: `${env.HTTP_SERVER_URL}/api/process-job`,
			body: { jobId: extractionJob.id },
		});
	} else {
		// If QStash is not configured, mark job for immediate processing
		log('WARN', context, 'QStash not configured, job will need manual processing');
	}

	log('DEBUG', context, 'Pipeline initiated', {
		parentJobId: parentJob.id,
		extractionJobId: extractionJob.id,
	});
	return parentJob.id;
}

/**
 * Schedule post-processing jobs based on extraction completion
 * Uses smart delays based on extraction metrics
 */
export async function schedulePostProcessingJobs(
	parentJobId: string,
	extractionMetrics: ExtractionMetrics
): Promise<void> {
	const context = createContext('PIPELINE_COORDINATOR', 'schedule_post_processing', {
		parentJobId,
	});

	const qstash = getQStash();
	if (!qstash) {
		log('WARN', context, 'QStash not configured, skipping post-processing job scheduling');
		return;
	}

	// Calculate dynamic delays based on extraction metrics
	const baseDelay = calculateProcessingDelay(extractionMetrics);

	// Create and schedule concept generation job
	const conceptJob = await db.processingJob.create({
		data: {
			job_type: JobType.GENERATE_CONCEPTS,
			parent_job_id: parentJobId,
			stage: JobStage.CONCEPTS,
			text: '', // Concepts work with stored triples, not raw text
			metadata: {
				parent_job_id: parentJobId,
				extraction_metrics: extractionMetrics,
			},
			status: JobStatus.QUEUED,
		},
	});

	await qstash.publishJSON({
		url: `${env.HTTP_SERVER_URL}/api/process-job`,
		body: { jobId: conceptJob.id },
		delay: Math.max(6, baseDelay * 0.1), // Minimum 6 second delay
	});

	log('DEBUG', context, 'Scheduled concept generation job', {
		conceptJobId: conceptJob.id,
		delay: Math.max(6, baseDelay * 0.1),
	});

	// Only schedule deduplication if enabled
	if (env.ENABLE_SEMANTIC_DEDUP) {
		const dedupJob = await db.processingJob.create({
			data: {
				job_type: JobType.DEDUPLICATE_KNOWLEDGE,
				parent_job_id: parentJobId,
				stage: JobStage.DEDUPLICATION,
				text: '', // Dedup works with stored triples
				metadata: {
					parent_job_id: parentJobId,
					extraction_metrics: extractionMetrics,
				},
				status: JobStatus.QUEUED,
			},
		});

		await qstash.publishJSON({
			url: `${env.HTTP_SERVER_URL}/api/process-job`,
			body: { jobId: dedupJob.id },
			delay: Math.max(10, baseDelay * 0.2), // Minimum 10 second delay
		});

		log('DEBUG', context, 'Scheduled deduplication job', {
			dedupJobId: dedupJob.id,
			delay: Math.max(10, baseDelay * 0.2),
		});
	}
}

/**
 * Calculate smart delay based on extraction metrics
 */
function calculateProcessingDelay(metrics: ExtractionMetrics): number {
	// Base delay on processing time and data volume
	const timeBasedDelay = Math.ceil(metrics.processingTime / 1000); // Convert ms to seconds
	const volumeBasedDelay = Math.ceil(metrics.triplesExtracted / 10); // 1 second per 10 triples

	// Use the larger of the two delays, with minimum 6 seconds, capped at 60 seconds
	return Math.min(60, Math.max(6, Math.max(timeBasedDelay, volumeBasedDelay)));
}

/**
 * Update job progress
 */
export async function updateJobProgress(
	jobId: string,
	progress: number,
	metrics?: any
): Promise<void> {
	const clampedProgress = Math.min(100, Math.max(0, progress));
	const updateData: any = {
		progress: clampedProgress,
	};

	if (metrics) {
		updateData.metrics = metrics;
	}

	if (clampedProgress === 100) {
		updateData.status = JobStatus.COMPLETED;
		updateData.completedAt = new Date();
	} else if (clampedProgress > 0) {
		updateData.status = JobStatus.PROCESSING;
		updateData.startedAt = new Date();
	}

	await db.processingJob.update({
		where: { id: jobId },
		data: updateData,
	});
}

/**
 * Get job by stage for a parent job
 */
export async function getJobByStage(parentJobId: string, stage: JobStage): Promise<any | null> {
	return await db.processingJob.findFirst({
		where: {
			parent_job_id: parentJobId,
			stage: stage,
		},
	});
}

/**
 * Check if pipeline is complete
 */
export async function isPipelineComplete(parentJobId: string): Promise<boolean> {
	const jobs = await db.processingJob.findMany({
		where: {
			OR: [{ id: parentJobId }, { parent_job_id: parentJobId }],
		},
		select: {
			status: true,
			stage: true,
		},
	});

	// Check if all jobs are either completed or failed
	return jobs.every(job => job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED);
}

/**
 * Get pipeline status and metrics
 */
export async function getPipelineStatus(parentJobId: string): Promise<any> {
	const parentJob = await db.processingJob.findUnique({
		where: { id: parentJobId },
		include: {
			child_jobs: true,
		},
	});

	if (!parentJob) {
		return null;
	}

	const stages: Record<string, any> = {};
	for (const job of parentJob.child_jobs) {
		if (job.stage) {
			stages[job.stage] = {
				status: job.status,
				progress: job.progress,
				startedAt: job.startedAt,
				completedAt: job.completedAt,
				metrics: job.metrics,
			};
		}
	}

	return {
		parentJobId: parentJob.id,
		status: parentJob.status,
		createdAt: parentJob.createdAt,
		stages,
		isComplete: await isPipelineComplete(parentJobId),
	};
}
