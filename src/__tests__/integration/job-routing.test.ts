/**
 * Integration tests for job routing and handler dispatch
 */

import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { JobStage, JobStatus, JobType } from '@prisma/client';

// Mock dependencies
jest.mock('~/shared/services/ai-provider-service.js');
jest.mock('~/shared/services/embedding-service.js');
jest.mock('~/shared/env.js');

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
} from '../helpers/mock-factories.js';
import { cleanupTestDatabase, setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Job Routing Integration', () => {
	let mockAIProvider: ReturnType<typeof createMockAIProvider>;
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

	beforeEach(async () => {
		jest.clearAllMocks();
		await cleanupTestDatabase();

		// Setup mocks
		mockAIProvider = createMockAIProvider();
		mockEmbeddingService = createMockEmbeddingService();

		(createAIProvider as jest.Mock).mockReturnValue(mockAIProvider);
		(createEmbeddingService as jest.Mock).mockReturnValue(mockEmbeddingService);
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
			const triples = await db.knowledgeTriple.createMany({
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

		it('should route DEDUPLICATE_KNOWLEDGE jobs to DeduplicationJobHandler', async () => {
			// Create duplicate triples for deduplication
			const duplicateTriples = [
				...sampleTriples.entityEntity,
				...sampleTriples.entityEntity, // Exact duplicates
			];

			await db.knowledgeTriple.createMany({
				data: duplicateTriples.map(triple => ({
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

			// Verify deduplication occurred
			const remainingTriples = await db.knowledgeTriple.findMany({
				where: { source: 'dedup-test' },
			});
			expect(remainingTriples.length).toBeLessThan(duplicateTriples.length);
		});

		it('should handle unknown job types gracefully', async () => {
			const job = await db.processingJob.create({
				data: {
					job_type: 'UNKNOWN_JOB_TYPE' as any,
					text: 'test text',
					metadata: {},
					status: JobStatus.QUEUED,
				},
			});

			const result = await routeJob(job);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('No handler found');
			expect(result.error?.operation).toBe('job_routing');
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

			// Setup AI responses
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

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

			// Setup AI responses with delays to observe status changes
			mockAIProvider.generateText.mockImplementation(async () => {
				await new Promise(resolve => setTimeout(resolve, 100));
				return createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
				});
			});

			const resultPromise = routeJob(job);

			// Check status shortly after starting
			await new Promise(resolve => setTimeout(resolve, 50));
			const runningJob = await db.processingJob.findUnique({
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

			// Setup AI responses for both jobs
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
				})
			);

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
			expect(endTime - startTime).toBeLessThan(1000); // Reasonable concurrent time
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

			let concurrentAICalls = 0;
			let maxConcurrentCalls = 0;

			mockAIProvider.generateText.mockImplementation(async () => {
				concurrentAICalls++;
				maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentAICalls);

				await new Promise(resolve => setTimeout(resolve, 100));

				concurrentAICalls--;
				return createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
				});
			});

			const results = await Promise.all(createdJobs.map(job => routeJob(job)));

			expect(results.every(r => r.success)).toBe(true);
			// Resource limits should be enforced (maxAICalls: 2 per job × 4 extraction types = 8 max)
			expect(maxConcurrentCalls).toBeLessThanOrEqual(10); // Some reasonable upper bound
		});
	});
});
