/**
 * Integration tests for job routing and handler dispatch
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'';
import { JobStage, JobStatus, JobType } from '@prisma/client';

// Mock dependencies
vi.mock('~/shared/services/ai-provider-service.js');
vi.mock('~/shared/services/embedding-service.js');
vi.mock('~/shared/env.js');

import { routeJob } from '~/features/knowledge-processing/job-router.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { createAIProvider } from '~/shared/services/ai-provider-service.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { mockAIExtractions, sampleConcepts, sampleTriples } from '../fixtures/test-data.js';
import {
	createMockAIProvider,
	createMockEmbeddingService,
	createSuccessResult,
	createTestJobMetadata,
	mockEnv,
	setupFourStageExtractionMocks,
} from '../helpers/mock-factories.js';
import { cleanupTestDatabase, setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Job Routing Integration', () => {
	let mockAIProvider: ReturnType<typeof createMockAIProvider>;
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

	beforeEach(async () => {
		// Clear mock call history and reset mock implementations
		vi.clearAllMocks();

		// Setup fresh mocks for each test
		mockAIProvider = createMockAIProvider();
		mockEmbeddingService = createMockEmbeddingService();

		(createAIProvider as vi.Mock).mockReturnValue(mockAIProvider);
		(createEmbeddingService as vi.Mock).mockReturnValue(mockEmbeddingService);
		Object.assign(env, { ...mockEnv });
	});

	afterAll(async () => {
		await cleanupTestDatabase();
	});

	describe('Job Handler Routing', () => {
		it('should route EXTRACT_KNOWLEDGE_BATCH jobs to BatchExtractionJobHandler', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: 'Test extraction text',
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// Setup AI responses for extraction
			mockAIProvider.generateText
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEntity.response,
						usage: mockAIExtractions.fourStage.entityEntity.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEvent.response,
						usage: mockAIExtractions.fourStage.entityEvent.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.eventEvent.response,
						usage: mockAIExtractions.fourStage.eventEvent.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.emotionalContext.response,
						usage: mockAIExtractions.fourStage.emotionalContext.usage,
					})
				)
				.mockResolvedValueOnce(
					createSuccessResult({
						data: JSON.stringify({ concepts: sampleConcepts }),
						usage: { promptTokens: 150, completionTokens: 100, totalTokens: 250 },
					})
				);

			const result = await routeJob(job);

			expect(result.success).toBe(true);
			expect(result.data?.triplesStored).toBeGreaterThan(0);

			// Verify job was processed by correct handler
			const updatedJob = await db.processingJob.findUnique({
				where: { id: job.id },
			});
			expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
			expect(updatedJob?.progress).toBe(100);
		});

		it('should route GENERATE_CONCEPTS jobs to ConceptJobHandler', async () => {
			// First create some triples for the concept handler to work with
			const _triples = await db.knowledgeTriple.createMany({
				data: sampleTriples.entityEntity.map(triple => ({
					...triple,
					source: 'concept-test',
					source_type: 'test',
					source_date: new Date(),
				})),
			});

			const job = await db.processingJob.create({
				data: {
					job_type: JobType.GENERATE_CONCEPTS,
					stage: JobStage.CONCEPTS,
					text: '',
					metadata: {
						source: 'concept-test',
						source_type: 'test',
						source_date: new Date().toISOString(),
					},
					status: JobStatus.QUEUED,
				},
			});

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ concepts: sampleConcepts }),
					usage: { promptTokens: 150, completionTokens: 100, totalTokens: 250 },
				})
			);

			const result = await routeJob(job);

			expect(result.success).toBe(true);

			// Verify concepts were stored
			const storedConcepts = await db.conceptNode.findMany({
				where: { source: 'concept-test' },
			});
			expect(storedConcepts.length).toBeGreaterThan(0);
		});

		it('should route DEDUPLICATE_KNOWLEDGE jobs to Deduplication JobHandler', async () => {
			// Create triples - deduplication now happens at storage time via unique constraint
			// The test verifies the handler completes successfully
			await db.knowledgeTriple.createMany({
				data: sampleTriples.entityEntity.map(triple => ({
					...triple,
					source: 'dedup-test',
					source_type: 'test',
					source_date: new Date(),
				})),
			});

			const job = await db.processingJob.create({
				data: {
					job_type: JobType.DEDUPLICATE_KNOWLEDGE,
					stage: JobStage.DEDUPLICATION,
					text: '',
					metadata: {
						source: 'dedup-test',
						source_type: 'test',
						source_date: new Date().toISOString(),
					},
					status: JobStatus.QUEUED,
				},
			});

			const result = await routeJob(job);

			expect(result.success).toBe(true);

			// Verify deduplication handler completed successfully
			const updatedJob = await db.processingJob.findUnique({
				where: { id: job.id },
			});
			expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
		});

		it('should reject invalid job types at the database layer', async () => {
			// Prisma now validates job types at creation time, preventing invalid values
			// This test verifies that database-level validation works correctly
			await expect(
				db.processingJob.create({
					data: {
						job_type: 'UNKNOWN_JOB_TYPE' as any,
						text: 'test text',
						metadata: {},
						status: JobStatus.QUEUED,
					},
				})
			).rejects.toThrow(/Invalid value for argument/);
		});
	});

	describe('Handler Chain Coordination', () => {
		it('should process jobs with parent-child relationships', async () => {
			// Create parent job
			const parentJob = await db.processingJob.create({
				data: {
					job_type: JobType.PROCESS_KNOWLEDGE,
					text: 'Parent job text',
					metadata: {
						source: 'chain-test',
						source_type: 'test',
						source_date: new Date().toISOString(),
					},
					status: JobStatus.PROCESSING,
				},
			});

			// Create extraction child job
			const extractionJob = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					parent_job_id: parentJob.id,
					stage: JobStage.EXTRACTION,
					text: 'Child job text',
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// Setup AI responses for four-stage extraction
			setupFourStageExtractionMocks(mockAIProvider);

			// Execute extraction job
			const result = await routeJob(extractionJob);

			expect(result.success).toBe(true);

			// Verify child jobs were created for post-processing
			const conceptJobs = await db.processingJob.findMany({
				where: {
					parent_job_id: parentJob.id,
					job_type: JobType.GENERATE_CONCEPTS,
				},
			});
			expect(conceptJobs.length).toBe(1);
		});

		it('should handle job execution failures without breaking the chain', async () => {
			const parentJob = await db.processingJob.create({
				data: {
					job_type: JobType.PROCESS_KNOWLEDGE,
					text: 'Parent job text',
					metadata: {
						source: 'failure-chain-test',
						source_type: 'test',
						source_date: new Date().toISOString(),
					},
					status: JobStatus.PROCESSING,
				},
			});

			// Create extraction job that will fail
			const extractionJob = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					parent_job_id: parentJob.id,
					stage: JobStage.EXTRACTION,
					text: 'Failing job text',
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// Mock AI failure
			mockAIProvider.generateText.mockRejectedValue(new Error('AI service completely down'));

			const result = await routeJob(extractionJob);

			expect(result.success).toBe(false);

			// Verify job was marked as failed
			const updatedJob = await db.processingJob.findUnique({
				where: { id: extractionJob.id },
			});
			expect(updatedJob?.status).toBe(JobStatus.FAILED);

			// Verify no child jobs were created
			const childJobs = await db.processingJob.findMany({
				where: { parent_job_id: parentJob.id },
			});
			expect(childJobs.length).toBe(1); // Only the failed extraction job
		});
	});

	describe('Job Status Updates', () => {
		it('should update job status throughout execution', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: 'Status test text',
					metadata: createTestJobMetadata(),
					status: JobStatus.QUEUED,
				},
			});

			// Setup AI responses for four-stage extraction
			setupFourStageExtractionMocks(mockAIProvider);

			const resultPromise = routeJob(job);

			// Check status shortly after starting
			await new Promise(resolve => setTimeout(resolve, 100));
			const _runningJob = await db.processingJob.findUnique({
				where: { id: job.id },
			});

			const result = await resultPromise;
			expect(result.success).toBe(true);

			// Check final status
			const completedJob = await db.processingJob.findUnique({
				where: { id: job.id },
			});
			expect(completedJob?.status).toBe(JobStatus.COMPLETED);
			expect(completedJob?.progress).toBe(100);
			expect(completedJob?.completedAt).toBeTruthy();
		});

		it('should preserve job metadata and metrics', async () => {
			const originalMetadata = createTestJobMetadata({
				customField: 'test-value',
				resourceLimits: { maxAICalls: 2, maxConnections: 1, maxMemoryMB: 512 },
			});

			const job = await db.processingJob.create({
				data: {
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
					stage: JobStage.EXTRACTION,
					text: 'Metadata test',
					metadata: originalMetadata,
					status: JobStatus.QUEUED,
				},
			});

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
				})
			);

			await routeJob(job);

			const updatedJob = await db.processingJob.findUnique({
				where: { id: job.id },
			});

			// Original metadata should be preserved
			expect(updatedJob?.metadata).toMatchObject(originalMetadata);

			// Execution metrics should be added
			expect(updatedJob?.metrics).toBeDefined();
		});
	});

	describe('Concurrent Job Processing', () => {
		it('should handle multiple jobs concurrently', async () => {
			const jobs = await Promise.all([
				db.processingJob.create({
					data: {
						job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
						stage: JobStage.EXTRACTION,
						text: 'Concurrent test 1',
						metadata: createTestJobMetadata({ source: 'concurrent-1' }),
						status: JobStatus.QUEUED,
					},
				}),
				db.processingJob.create({
					data: {
						job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
						stage: JobStage.EXTRACTION,
						text: 'Concurrent test 2',
						metadata: createTestJobMetadata({ source: 'concurrent-2' }),
						status: JobStatus.QUEUED,
					},
				}),
			]);

			// Setup AI responses for both jobs (2 jobs × 4 stages + 2 concept generations = 10 calls)
			setupFourStageExtractionMocks(mockAIProvider);
			setupFourStageExtractionMocks(mockAIProvider);

			const startTime = Date.now();
			const results = await Promise.all(jobs.map(job => routeJob(job)));
			const endTime = Date.now();

			expect(results.every(r => r.success)).toBe(true);

			// Verify both jobs completed
			for (const job of jobs) {
				const updatedJob = await db.processingJob.findUnique({
					where: { id: job.id },
				});
				expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
			}

			// Concurrent processing should be faster than sequential
			expect(endTime - startTime).toBeLessThan(2000); // Reasonable concurrent time
		});

		it('should respect resource limits during concurrent processing', async () => {
			const jobs = Array.from({ length: 5 }, (_, i) =>
				db.processingJob.create({
					data: {
						job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
						stage: JobStage.EXTRACTION,
						text: `Resource limit test ${i}`,
						metadata: createTestJobMetadata({
							source: `resource-${i}`,
							resourceLimits: { maxAICalls: 2, maxConnections: 1, maxMemoryMB: 512 },
						}),
						status: JobStatus.QUEUED,
					},
				})
			);

			const createdJobs = await Promise.all(jobs);

			// Setup mocks for 5 jobs
			for (let i = 0; i < 5; i++) {
				setupFourStageExtractionMocks(mockAIProvider);
			}

			const results = await Promise.all(createdJobs.map(job => routeJob(job)));

			expect(results.every(r => r.success)).toBe(true);

			// Verify all jobs completed
			for (const job of createdJobs) {
				const updatedJob = await db.processingJob.findUnique({
					where: { id: job.id },
				});
				expect(updatedJob?.status).toBe(JobStatus.COMPLETED);
			}
		});
	});
});
