/**
 * Job types and interfaces for the knowledge processing pipeline
 */

import type { JobStage, JobType, ProcessingJob } from '@prisma/client';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import type { Concept, Triple } from '~/shared/types/core.js';

// Resource limits type
export interface ResourceLimits {
	maxConnections: number;
	maxAICalls: number;
	maxMemoryMB: number;
}

// Job metadata interface - extends for database JSON storage
export interface JobMetadata extends ProcessKnowledgeArgs {
	parent_job_id?: string;
	stage?: JobStage;
	resourceLimits?: ResourceLimits;
	[key: string]: any; // Required for Prisma JSON compatibility
}

// Extraction progress tracking
export interface ExtractionProgress {
	entityEntity: 'pending' | 'running' | 'completed' | 'failed';
	entityEvent: 'pending' | 'running' | 'completed' | 'failed';
	eventEvent: 'pending' | 'running' | 'completed' | 'failed';
	emotionalContext: 'pending' | 'running' | 'completed' | 'failed';
	overallProgress: number; // 0-100
}

// Extraction metrics for scheduling decisions
export interface ExtractionMetrics {
	triplesExtracted: number;
	conceptsFound: number;
	processingTime: number;
	chunksProcessed?: number;
	[key: string]: any; // Required for Prisma JSON compatibility
}

// Specific job result data types
export type JobResultData = {
	triples?: Triple[];
	concepts?: Concept[];
	duplicateRemovalCount?: number;
	embeddingCount?: number;
	vectorCount?: number;
	triplesStored?: number;
	conceptsStored?: number;
	chunksProcessed?: number;
	relationshipsStored?: number;
	originalCount?: number;
	vectorsGenerated?: number;
	message?: string;
	[key: string]: any; // For additional properties
};

// Job result interface
export interface JobResult {
	success: boolean;
	data?: JobResultData;
	error?: {
		message: string;
		operation: string;
		cause?: unknown;
	};
}

// Job handler interface
export interface JobHandler {
	canHandle(jobType: JobType): boolean;
	execute(job: ProcessingJob): Promise<JobResult>;
	getProgress?(jobId: string): Promise<ExtractionProgress | number>;
}

// Re-export for convenience
export { JobStage, JobType } from '@prisma/client';
