/**
 * Job types and interfaces for the knowledge processing pipeline
 */

import type { JobStage, JobType, ProcessingJob } from '@prisma/client';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';

// Job metadata interface - extends for database JSON storage
export interface JobMetadata extends ProcessKnowledgeArgs {
	parent_job_id?: string;
	stage?: JobStage;
	resourceLimits?: {
		maxConnections: number;
		maxAICalls: number;
		maxMemoryMB: number;
	};
	[key: string]: any; // Allow additional properties for JSON storage
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
	[key: string]: any; // Allow additional properties for JSON storage
}

// Job result interface
export interface JobResult {
	success: boolean;
	data?: any;
	error?: {
		message: string;
		operation: string;
		cause?: any;
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
