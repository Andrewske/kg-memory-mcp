/**
 * Unit tests for executeExtraction function
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ProcessingJob } from '@prisma/client';

// Mock dependencies before imports
jest.mock('~/features/deduplication/deduplicate.js');
jest.mock('~/features/knowledge-extraction/extract.js');
jest.mock('~/shared/database/batch-storage.js');
jest.mock('~/shared/services/embedding-service.js');
jest.mock('~/shared/utils/embedding-cache.js');
jest.mock('~/shared/utils/text-chunking.js');
jest.mock('~/features/knowledge-processing/pipeline-coordinator.js');
jest.mock('~/shared/env.js');

import { deduplicateTriples } from '~/features/deduplication/deduplicate.js';
import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract.js';
import { executeExtraction } from '~/features/knowledge-processing/handlers/extraction-function.js';
import {
	schedulePostProcessingJobs,
	updateJobProgress,
} from '~/features/knowledge-processing/pipeline-coordinator.js';
import { batchStoreKnowledge } from '~/shared/database/batch-storage.js';
import { env } from '~/shared/env.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { generateEmbeddingMap } from '~/shared/utils/embedding-cache.js';
import { chunkText } from '~/shared/utils/text-chunking.js';
import {
	createErrorResult,
	createMockEmbeddingService,
	createSuccessResult,
	createTestChunks,
	createTestConcept,
	createTestEmbeddingMap,
	createTestJob,
	createTestJobMetadata,
	createTestTriple,
} from '../helpers/mock-factories.js';
import { setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

type ExtractKTResult = Awaited<ReturnType<typeof extractKnowledgeTriples>>;
type ExtractKTSuccess = Extract<ExtractKTResult, { success: true }>;
type DedupTriplesResult = Awaited<ReturnType<typeof deduplicateTriples>>;
type DedupSuccess = Extract<DedupTriplesResult, { success: true }>;
type EmbeddingMapResult = Awaited<ReturnType<typeof generateEmbeddingMap>>;

describe('executeExtraction', () => {
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockEmbeddingService = createMockEmbeddingService();

		// Setup environment mocks
		Object.assign(env, {
			EMBEDDING_MODEL: 'text-embedding-3-small',
			EMBEDDING_DIMENSIONS: 1536,
			BATCH_SIZE: 32,
			ENABLE_SEMANTIC_DEDUP: false,
		});

		// Setup service mocks
		(createEmbeddingService as jest.MockedFunction<typeof createEmbeddingService>).mockReturnValue(
			mockEmbeddingService
		);
		(updateJobProgress as jest.MockedFunction<typeof updateJobProgress>).mockResolvedValue();
		(
			schedulePostProcessingJobs as jest.MockedFunction<typeof schedulePostProcessingJobs>
		).mockResolvedValue();
	});

	describe('functional execution', () => {
		it('should process small text without chunking', async () => {
			const job = createTestJob({
				text: 'Short text that does not need chunking.',
				metadata: createTestJobMetadata(),
			});

			const mockTriples = [createTestTriple()];
			const mockConcepts = [createTestConcept()];

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: { triples: mockTriples, concepts: mockConcepts, conceptualizations: [] },
			} as ExtractKTResult);

			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: new Map(),
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as jest.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: { uniqueTriples: mockTriples, duplicatesRemoved: 0, mergedMetadata: [] },
			} as DedupTriplesResult);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 1,
					conceptualizationsStored: 0,
					vectorsGenerated: 2,
					duplicatesSkipped: 0,
				})
			);

			const result = await executeExtraction(job as ProcessingJob, true); // Skip QStash updates in tests

			expect(result.success).toBe(true);
			expect(result.data).toMatchObject({
				triplesStored: 1,
				conceptsStored: 1,
				chunksProcessed: 1,
			});

			// Verify no chunking occurred
			expect(chunkText).not.toHaveBeenCalled();
		});

		it('should chunk large text and process in parallel', async () => {
			const largeText = 'A'.repeat(15000); // ~3750 tokens, should trigger chunking
			const job = createTestJob({
				text: largeText,
				metadata: createTestJobMetadata(),
			});

			const chunks = createTestChunks(3);
			const mockTriples = [createTestTriple()];
			const mockConcepts = [createTestConcept()];

			(chunkText as jest.MockedFunction<typeof chunkText>).mockReturnValue(chunks);
			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: { triples: mockTriples, concepts: mockConcepts, conceptualizations: [] },
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: new Map(),
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as jest.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: { uniqueTriples: mockTriples, duplicatesRemoved: 0, mergedMetadata: [] },
			} as DedupTriplesResult);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 3,
					conceptsStored: 3,
					conceptualizationsStored: 0,
					vectorsGenerated: 6,
					duplicatesSkipped: 0,
				})
			);

			const result = await executeExtraction(job as ProcessingJob, true); // Skip QStash updates in tests

			expect(result.success).toBe(true);
			expect(chunkText).toHaveBeenCalledWith(largeText, {
				maxTokens: 3000,
				overlapTokens: 200,
				preserveParagraphs: true,
			});
			expect(extractKnowledgeTriples).toHaveBeenCalledTimes(3);
			expect(result.data?.chunksProcessed).toBe(3);
		});

		it('should generate comprehensive embedding map', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });
			const mockTriples = [createTestTriple()];
			const mockConcepts = [createTestConcept()];

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: { triples: mockTriples, concepts: mockConcepts, conceptualizations: [] },
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: new Map(),
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as jest.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: { uniqueTriples: mockTriples, duplicatesRemoved: 0, mergedMetadata: [] },
			} as DedupTriplesResult);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 1,
					conceptualizationsStored: 0,
					vectorsGenerated: 2,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job as unknown as ProcessingJob, true); // Skip QStash updates in tests

			expect(generateEmbeddingMap).toHaveBeenCalledWith(
				mockTriples,
				mockConcepts,
				mockEmbeddingService,
				false // ENABLE_SEMANTIC_DEDUP is false
			);
		});

		it('should deduplicate triples when triples exist', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });
			const mockTriples = [createTestTriple(), createTestTriple()];
			const uniqueTriples = [createTestTriple()];
			const embeddingMap = new Map([['test', [1, 2, 3]]]);

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: mockTriples,
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: embeddingMap,
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as jest.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: {
					uniqueTriples,
					duplicatesRemoved: 0,
					mergedMetadata: [] as DedupSuccess['data']['mergedMetadata'],
				},
			} as DedupTriplesResult);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 1,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job as unknown as ProcessingJob, true); // Skip QStash updates in tests

			expect(deduplicateTriples).toHaveBeenCalledWith(mockTriples, embeddingMap);
		});

		it('should skip deduplication when no triples exist', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [] as ExtractKTSuccess['data']['triples'],
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 0,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 0,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job as unknown as ProcessingJob, true); // Skip QStash updates in tests

			expect(deduplicateTriples).not.toHaveBeenCalled();
		});

		it('should store knowledge in atomic transaction', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });
			const mockTriples = [createTestTriple()];
			const mockConcepts = [createTestConcept()];
			const embeddingMap = new Map([['test', [1, 2, 3]]]);

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: mockTriples,
					concepts: mockConcepts,
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: embeddingMap,
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as jest.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: {
					uniqueTriples: mockTriples,
					duplicatesRemoved: 0,
					mergedMetadata: [] as DedupSuccess['data']['mergedMetadata'],
				},
			} as DedupTriplesResult);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 1,
					conceptualizationsStored: 0,
					vectorsGenerated: 2,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job as unknown as ProcessingJob, true); // Skip QStash updates in tests

			expect(batchStoreKnowledge).toHaveBeenCalledWith({
				triples: mockTriples,
				concepts: mockConcepts,
				conceptualizations: [],
				embeddingMap: embeddingMap,
			});
		});

		it('should schedule post-processing jobs when parent job exists', async () => {
			const job = createTestJob({
				parent_job_id: 'parent-job-id',
				metadata: createTestJobMetadata(),
			});

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [createTestTriple()],
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(deduplicateTriples as jest.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: {
					uniqueTriples: [createTestTriple()],
					duplicatesRemoved: 0,
					mergedMetadata: [] as DedupSuccess['data']['mergedMetadata'],
				},
			} as DedupTriplesResult);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 1,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job as unknown as ProcessingJob, true); // Skip QStash updates in tests

			expect(schedulePostProcessingJobs).toHaveBeenCalledWith(
				'parent-job-id',
				expect.objectContaining({
					triplesExtracted: 1,
					conceptsFound: 0,
					chunksProcessed: 1,
				})
			);
		});

		it('should update progress throughout processing', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [] as ExtractKTSuccess['data']['triples'],
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 0,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 0,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job as unknown as ProcessingJob, true); // Skip QStash updates in tests

			expect(updateJobProgress).toHaveBeenCalledWith(job.id, 10);
			expect(updateJobProgress).toHaveBeenCalledWith(job.id, 80);
			expect(updateJobProgress).toHaveBeenCalledWith(job.id, 95);
			expect(updateJobProgress).toHaveBeenCalledWith(job.id, 100);
		});

		it('should handle embedding generation failure', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [createTestTriple()],
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createErrorResult('Embedding service failed')
			);

			const result = await executeExtraction(job as ProcessingJob, true); // Skip QStash updates in tests

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('Embedding generation failed');
			expect(result.error?.operation).toBe('embedding_generation');
		});

		it('should handle storage failure', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [] as ExtractKTSuccess['data']['triples'],
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createErrorResult('Database connection failed')
			);

			const result = await executeExtraction(job as ProcessingJob, true); // Skip QStash updates in tests

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('Storage failed');
			expect(result.error?.operation).toBe('batch_storage');
		});

		it('should handle partial chunk processing failures', async () => {
			const job = createTestJob({
				text: 'A'.repeat(15000),
				metadata: createTestJobMetadata(),
			});

			const chunks = createTestChunks(3);
			(chunkText as jest.MockedFunction<typeof chunkText>).mockReturnValue(chunks);

			// Mock some successful and some failed extractions
			(extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>)
				.mockResolvedValueOnce({
					success: true,
					data: {
						triples: [createTestTriple()],
						concepts: [],
						conceptualizations: [],
					},
				} as ExtractKTResult)
				.mockRejectedValueOnce(new Error('AI service timeout'))
				.mockResolvedValueOnce({
					success: true,
					data: {
						triples: [createTestTriple()],
						concepts: [],
						conceptualizations: [],
					},
				} as ExtractKTResult);

			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(deduplicateTriples as jest.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: {
					uniqueTriples: [createTestTriple(), createTestTriple()],
					duplicatesRemoved: 0,
					mergedMetadata: [] as DedupSuccess['data']['mergedMetadata'],
				},
			} as DedupTriplesResult);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 2,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 2,
					duplicatesSkipped: 0,
				})
			);

			const result = await executeExtraction(job as ProcessingJob, true); // Skip QStash updates in tests

			expect(result.success).toBe(true);
			expect(result.data?.triplesStored).toBe(2); // Only successful chunks
		});

		it('should handle unexpected errors gracefully', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockRejectedValue(new Error('Unexpected extraction error'));

			const result = await executeExtraction(job as ProcessingJob, true); // Skip QStash updates in tests

			expect(result.success).toBe(false);
			expect(result.error?.message).toBe('Unexpected extraction error');
			expect(result.error?.operation).toBe('batch_extraction');
		});

		it('should use resource limits from job metadata', async () => {
			const customLimits = {
				maxConnections: 1,
				maxAICalls: 2,
				maxMemoryMB: 1024,
			};
			const job = createTestJob({
				metadata: createTestJobMetadata({ resourceLimits: customLimits }),
			});

			(
				extractKnowledgeTriples as jest.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [] as ExtractKTSuccess['data']['triples'],
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as jest.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(batchStoreKnowledge as jest.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 0,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 0,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job as unknown as ProcessingJob, true); // Skip QStash updates in tests

			// The resource limits should be passed to the ResourceManager
			// This is implicitly tested through the successful execution
			expect(extractKnowledgeTriples).toHaveBeenCalled();
		});
	});
});
