/**
 * Integration tests for the complete knowledge processing pipeline
 */

import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { JobStage, JobStatus, JobType } from '@prisma/client';

// Mock external dependencies
jest.mock('~/shared/services/ai-provider-service.js');
jest.mock('~/shared/services/embedding-service.js');
jest.mock('~/shared/services/qstash.js');
jest.mock('~/shared/env.js');

import { routeJob } from '~/features/knowledge-processing/job-router.js';
import {
	getPipelineStatus,
	initiateKnowledgePipeline,
} from '~/features/knowledge-processing/pipeline-coordinator.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { createAIProvider } from '~/shared/services/ai-provider-service.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { getQStash } from '~/shared/services/qstash.js';
import {
	mockAIExtractions,
	sampleConcepts,
	sampleTriples,
	testTexts,
} from '../fixtures/test-data.js';
import {
	createMockAIProvider,
	createMockEmbeddingService,
	createMockQStash,
	createSuccessResult,
	createTestArgs,
	mockEnv,
} from '../helpers/mock-factories.js';
import { cleanupTestDatabase, setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Full Pipeline Integration', () => {
	let mockAIProvider: ReturnType<typeof createMockAIProvider>;
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;
	let mockQStash: ReturnType<typeof createMockQStash>;

	beforeEach(async () => {
		jest.clearAllMocks();
		await cleanupTestDatabase();

		// Setup mocks
		mockAIProvider = createMockAIProvider();
		mockEmbeddingService = createMockEmbeddingService();
		mockQStash = createMockQStash();

		(createAIProvider as jest.Mock).mockReturnValue(mockAIProvider);
		(createEmbeddingService as jest.Mock).mockReturnValue(mockEmbeddingService);
		(getQStash as jest.Mock).mockReturnValue(mockQStash);
		(env as any) = { ...mockEnv };
	});

	afterAll(async () => {
		await cleanupTestDatabase();
	});

	describe('Pipeline Initiation and Extraction', () => {
		it('should complete full extraction pipeline successfully', async () => {
			// Setup AI responses for four-stage extraction
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
						usage: { promptTokens: 200, completionTokens: 150, totalTokens: 350 },
					})
				);

			const args = createTestArgs({ text: testTexts.medium });

			// Step 1: Initiate pipeline
			const parentJobId = await initiateKnowledgePipeline(args);
			expect(parentJobId).toBeTruthy();

			// Verify parent job was created
			const parentJob = await db.processingJob.findUnique({
				where: { id: parentJobId },
			});
			expect(parentJob).toBeTruthy();
			expect(parentJob?.job_type).toBe(JobType.PROCESS_KNOWLEDGE);
			expect(parentJob?.status).toBe(JobStatus.PROCESSING);

			// Step 2: Find and execute extraction job
			const extractionJob = await db.processingJob.findFirst({
				where: {
					parent_job_id: parentJobId,
					job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
				},
			});
			expect(extractionJob).toBeTruthy();
			expect(extractionJob?.stage).toBe(JobStage.EXTRACTION);

			// Step 3: Execute extraction job
			const extractionResult = await routeJob(extractionJob!);
			expect(extractionResult.success).toBe(true);
			expect(extractionResult.data?.triplesStored).toBeGreaterThan(0);

			// Step 4: Verify data was stored
			const storedTriples = await db.knowledgeTriple.findMany({
				where: {
					source: args.source,
					source_type: args.source_type,
				},
			});
			expect(storedTriples.length).toBeGreaterThan(0);

			// Step 5: Verify vectors were generated
			const vectors = await db.vectorEmbedding.findMany({
				where: {
					source_id: { in: storedTriples.map(t => t.id) },
				},
			});
			expect(vectors.length).toBeGreaterThan(0);

			// Step 6: Verify extraction job completion
			const updatedExtractionJob = await db.processingJob.findUnique({
				where: { id: extractionJob!.id },
			});
			expect(updatedExtractionJob?.status).toBe(JobStatus.COMPLETED);
			expect(updatedExtractionJob?.progress).toBe(100);
		});

		it('should handle text chunking in large documents', async () => {
			const largeText = testTexts.large;
			const args = createTestArgs({ text: largeText });

			// Setup repeated AI responses for chunks
			for (let i = 0; i < 5; i++) {
				// Expect multiple chunks
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
					);
			}

			// Add concept generation response
			mockAIProvider.generateText.mockResolvedValueOnce(
				createSuccessResult({
					data: JSON.stringify({ concepts: sampleConcepts }),
					usage: { promptTokens: 200, completionTokens: 150, totalTokens: 350 },
				})
			);

			const parentJobId = await initiateKnowledgePipeline(args);

			const extractionJob = await db.processingJob.findFirst({
				where: { parent_job_id: parentJobId, job_type: JobType.EXTRACT_KNOWLEDGE_BATCH },
			});

			const result = await routeJob(extractionJob!);

			expect(result.success).toBe(true);
			expect(result.data?.chunksProcessed).toBeGreaterThan(1);
			expect(result.data?.triplesStored).toBeGreaterThan(0);
		});

		it('should create child jobs for post-processing', async () => {
			(env as any).ENABLE_SEMANTIC_DEDUP = true;

			// Setup basic AI responses
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 75, totalTokens: 175 },
				})
			);

			const args = createTestArgs();
			const parentJobId = await initiateKnowledgePipeline(args);

			const extractionJob = await db.processingJob.findFirst({
				where: { parent_job_id: parentJobId, job_type: JobType.EXTRACT_KNOWLEDGE_BATCH },
			});

			await routeJob(extractionJob!);

			// Verify concept job was scheduled
			const conceptJob = await db.processingJob.findFirst({
				where: {
					parent_job_id: parentJobId,
					job_type: JobType.GENERATE_CONCEPTS,
				},
			});
			expect(conceptJob).toBeTruthy();
			expect(conceptJob?.stage).toBe(JobStage.CONCEPTS);

			// Verify deduplication job was scheduled
			const dedupJob = await db.processingJob.findFirst({
				where: {
					parent_job_id: parentJobId,
					job_type: JobType.DEDUPLICATE_KNOWLEDGE,
				},
			});
			expect(dedupJob).toBeTruthy();
			expect(dedupJob?.stage).toBe(JobStage.DEDUPLICATION);
		});
	});

	describe('Concept Generation Integration', () => {
		it('should generate and store concepts from extracted triples', async () => {
			// First create some triples
			const triples = await db.knowledgeTriple.createMany({
				data: sampleTriples.entityEntity.map(triple => ({
					...triple,
					source: 'test-concept-source',
					source_type: 'integration_test',
					source_date: new Date(),
				})),
			});

			// Create concept generation job
			const conceptJob = await db.processingJob.create({
				data: {
					job_type: JobType.GENERATE_CONCEPTS,
					stage: JobStage.CONCEPTS,
					text: '',
					metadata: {
						source: 'test-concept-source',
						source_type: 'integration_test',
						source_date: new Date().toISOString(),
					},
					status: JobStatus.QUEUED,
				},
			});

			// Setup AI response for concept generation
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ concepts: sampleConcepts }),
					usage: { promptTokens: 150, completionTokens: 100, totalTokens: 250 },
				})
			);

			const result = await routeJob(conceptJob);

			expect(result.success).toBe(true);

			// Verify concepts were stored
			const storedConcepts = await db.conceptNode.findMany({
				where: {
					source: 'test-concept-source',
					source_type: 'integration_test',
				},
			});
			expect(storedConcepts.length).toBeGreaterThan(0);

			// Verify conceptualization relationships were created
			const relationships = await db.conceptualizationRelationship.findMany({
				where: {
					source: 'test-concept-source',
					source_type: 'integration_test',
				},
			});
			expect(relationships.length).toBeGreaterThan(0);
		});

		it('should handle concept generation failure gracefully', async () => {
			const conceptJob = await db.processingJob.create({
				data: {
					job_type: JobType.GENERATE_CONCEPTS,
					stage: JobStage.CONCEPTS,
					text: '',
					metadata: {
						source: 'test-fail-source',
						source_type: 'integration_test',
						source_date: new Date().toISOString(),
					},
					status: JobStatus.QUEUED,
				},
			});

			// Mock AI failure
			mockAIProvider.generateText.mockRejectedValue(
				new Error('AI service temporarily unavailable')
			);

			const result = await routeJob(conceptJob);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('AI service temporarily unavailable');
		});
	});

	describe('Pipeline Status Tracking', () => {
		it('should track pipeline progress across all stages', async () => {
			const args = createTestArgs();

			// Setup AI responses
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity.slice(0, 1) }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			const parentJobId = await initiateKnowledgePipeline(args);

			// Check initial status
			let status = await getPipelineStatus(parentJobId);
			expect(status.parentJobId).toBe(parentJobId);
			expect(status.status).toBe(JobStatus.PROCESSING);
			expect(status.isComplete).toBe(false);

			// Execute extraction job
			const extractionJob = await db.processingJob.findFirst({
				where: { parent_job_id: parentJobId, job_type: JobType.EXTRACT_KNOWLEDGE_BATCH },
			});
			await routeJob(extractionJob!);

			// Check status after extraction
			status = await getPipelineStatus(parentJobId);
			expect(status.stages.EXTRACTION).toBeDefined();
			expect(status.stages.EXTRACTION.status).toBe(JobStatus.COMPLETED);
			expect(status.stages.EXTRACTION.progress).toBe(100);
		});

		it('should detect pipeline completion correctly', async () => {
			// Create completed parent job
			const parentJob = await db.processingJob.create({
				data: {
					job_type: JobType.PROCESS_KNOWLEDGE,
					text: 'test text',
					metadata: { source: 'complete-test' },
					status: JobStatus.COMPLETED,
				},
			});

			// Create completed child jobs
			await db.processingJob.createMany({
				data: [
					{
						job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
						parent_job_id: parentJob.id,
						stage: JobStage.EXTRACTION,
						text: 'test text',
						metadata: { source: 'complete-test' },
						status: JobStatus.COMPLETED,
						progress: 100,
					},
					{
						job_type: JobType.GENERATE_CONCEPTS,
						parent_job_id: parentJob.id,
						stage: JobStage.CONCEPTS,
						text: '',
						metadata: { source: 'complete-test' },
						status: JobStatus.COMPLETED,
						progress: 100,
					},
				],
			});

			const status = await getPipelineStatus(parentJob.id);
			expect(status.isComplete).toBe(true);
		});
	});

	describe('Error Handling and Recovery', () => {
		it('should handle partial failures in extraction', async () => {
			const args = createTestArgs({ text: testTexts.large });

			// Setup mixed success/failure responses for chunks
			mockAIProvider.generateText
				.mockResolvedValueOnce(
					createSuccessResult({
						data: JSON.stringify({ triples: sampleTriples.entityEntity }),
						usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
					})
				)
				.mockRejectedValueOnce(new Error('Chunk processing failed'))
				.mockResolvedValueOnce(
					createSuccessResult({
						data: JSON.stringify({ triples: sampleTriples.entityEvent }),
						usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
					})
				);

			const parentJobId = await initiateKnowledgePipeline(args);
			const extractionJob = await db.processingJob.findFirst({
				where: { parent_job_id: parentJobId, job_type: JobType.EXTRACT_KNOWLEDGE_BATCH },
			});

			const result = await routeJob(extractionJob!);

			// Should succeed with partial results
			expect(result.success).toBe(true);
			expect(result.data?.triplesStored).toBeGreaterThan(0);

			// Verify some data was still stored
			const storedTriples = await db.knowledgeTriple.findMany({
				where: { source: args.source },
			});
			expect(storedTriples.length).toBeGreaterThan(0);
		});

		it('should handle database transaction failures', async () => {
			const args = createTestArgs();

			// Setup AI responses
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: JSON.stringify({ triples: sampleTriples.entityEntity }),
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			// Simulate database constraint violation by creating duplicate source
			await db.knowledgeTriple.create({
				data: {
					...sampleTriples.entityEntity[0],
					source: args.source,
					source_type: args.source_type,
					source_date: new Date(),
				},
			});

			const parentJobId = await initiateKnowledgePipeline(args);
			const extractionJob = await db.processingJob.findFirst({
				where: { parent_job_id: parentJobId, job_type: JobType.EXTRACT_KNOWLEDGE_BATCH },
			});

			// This should handle the duplicate gracefully or fail cleanly
			const result = await routeJob(extractionJob!);

			// Depending on implementation, this could succeed (with dedup) or fail cleanly
			if (!result.success) {
				expect(result.error).toBeDefined();
				expect(result.error?.operation).toBeDefined();
			}
		});

		it('should maintain data consistency across failed operations', async () => {
			const args = createTestArgs();

			// Setup AI to fail during concept generation
			mockAIProvider.generateText
				.mockResolvedValueOnce(
					createSuccessResult({
						data: JSON.stringify({ triples: sampleTriples.entityEntity }),
						usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
					})
				)
				.mockRejectedValueOnce(new Error('Concept generation failed'));

			const parentJobId = await initiateKnowledgePipeline(args);

			// Execute extraction (should succeed)
			const extractionJob = await db.processingJob.findFirst({
				where: { parent_job_id: parentJobId, job_type: JobType.EXTRACT_KNOWLEDGE_BATCH },
			});
			const extractionResult = await routeJob(extractionJob!);
			expect(extractionResult.success).toBe(true);

			// Execute concept generation (should fail)
			const conceptJob = await db.processingJob.findFirst({
				where: { parent_job_id: parentJobId, job_type: JobType.GENERATE_CONCEPTS },
			});

			if (conceptJob) {
				const conceptResult = await routeJob(conceptJob);
				expect(conceptResult.success).toBe(false);
			}

			// Verify extraction data is still intact
			const storedTriples = await db.knowledgeTriple.findMany({
				where: { source: args.source },
			});
			expect(storedTriples.length).toBeGreaterThan(0);

			// Verify vectors were still generated
			const vectors = await db.vectorEmbedding.findMany({
				where: { source_id: { in: storedTriples.map(t => t.id) } },
			});
			expect(vectors.length).toBeGreaterThan(0);
		});
	});
});
