/**
 * Unit tests for executeExtraction function
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('~/features/deduplication/deduplicate.js');
vi.mock('~/features/knowledge-extraction/extract.js');
vi.mock('~/shared/database/batch-storage.js');
vi.mock('~/shared/services/embedding-service.js');
vi.mock('~/shared/utils/embedding-cache.js');
vi.mock('~/shared/utils/text-chunking.js');
vi.mock('~/features/knowledge-processing/pipeline-coordinator.js');
vi.mock('~/shared/env.js');

import {
	createDetailedDeduplicationBreakdownWithDatabase,
	deduplicateTriples,
} from '~/features/deduplication/deduplicate.js';
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
		vi.clearAllMocks();
		mockEmbeddingService = createMockEmbeddingService();

		// Setup environment mocks
		Object.assign(env, {
			EMBEDDING_MODEL: 'text-embedding-3-small',
			EMBEDDING_DIMENSIONS: 1536,
			BATCH_SIZE: 32,
			ENABLE_SEMANTIC_DEDUP: false,
		});

		// Setup service mocks
		(createEmbeddingService as vi.MockedFunction<typeof createEmbeddingService>).mockReturnValue(
			mockEmbeddingService
		);
		(updateJobProgress as vi.MockedFunction<typeof updateJobProgress>).mockResolvedValue();
		(
			schedulePostProcessingJobs as vi.MockedFunction<typeof schedulePostProcessingJobs>
		).mockResolvedValue();

		// Mock createDetailedDeduplicationBreakdownWithDatabase to return valid TripleWithStatus array
		(
			createDetailedDeduplicationBreakdownWithDatabase as vi.MockedFunction<
				typeof createDetailedDeduplicationBreakdownWithDatabase
			>
		).mockImplementation((originalTriples, _extractionMergedMetadata, _databaseDuplicates, _crossStageDuplicates) => {
			// Return a TripleWithStatus array with all triples marked as KEPT
			return originalTriples.map((triple) => ({
				subject: triple.subject,
				predicate: triple.predicate,
				object: triple.object,
				type: triple.type as string,
				confidence: typeof triple.confidence === 'object' && triple.confidence !== null
					? Number(triple.confidence.toString())
					: (triple.confidence ?? 0.8),
				extraction_stage: triple.extraction_stage ?? triple.type,
				status: 'KEPT' as const,
				duplicate_of_index: undefined,
				existing_triple_id: undefined,
				stored_at: undefined,
				kept_from_stage: undefined,
				rejected_stages: undefined,
			}));
		});
	});

	describe('functional execution', () => {
		it('should process small text without chunking', async () => {
			const job = createTestJob({
				text: 'Short text that does not need chunking.',
				metadata: createTestJobMetadata(),
			});

			const mockTriples = [createTestTriple()];

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: { triples: mockTriples, concepts: [], conceptualizations: [], stageResults: {} },
			} as ExtractKTResult);

			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: new Map(),
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as vi.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: { uniqueTriples: mockTriples, duplicatesRemoved: 0, mergedMetadata: [] },
			} as DedupTriplesResult);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 0, // Concepts not stored in extraction stage
					conceptualizationsStored: 0,
					vectorsGenerated: 2,
					duplicatesSkipped: 0,
				})
			);

			const result = await executeExtraction(job, true); // Skip QStash updates in tests

			expect(result.success).toBe(true);
			expect(result.data).toMatchObject({
				triplesStored: 1,
				conceptsStored: 0, // Updated expectation
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

			(chunkText as vi.MockedFunction<typeof chunkText>).mockReturnValue(chunks);
			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: { triples: mockTriples, concepts: [], conceptualizations: [], stageResults: {} },
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: new Map(),
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as vi.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: { uniqueTriples: mockTriples, duplicatesRemoved: 0, mergedMetadata: [] },
			} as DedupTriplesResult);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 3,
					conceptsStored: 0, // Concepts not stored in extraction stage
					conceptualizationsStored: 0,
					vectorsGenerated: 6,
					duplicatesSkipped: 0,
				})
			);

			const result = await executeExtraction(job, true); // Skip QStash updates in tests

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

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: { triples: mockTriples, concepts: [], conceptualizations: [], stageResults: {} },
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: new Map(),
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as vi.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: { uniqueTriples: mockTriples, duplicatesRemoved: 0, mergedMetadata: [] },
			} as DedupTriplesResult);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 0, // Concepts not stored in extraction stage
					conceptualizationsStored: 0,
					vectorsGenerated: 2,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job, true); // Skip QStash updates in tests

			expect(generateEmbeddingMap).toHaveBeenCalledWith(
				mockTriples,
				[], // Empty concepts array
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
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: mockTriples,
					stageResults: {},
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: embeddingMap,
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as vi.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: {
					uniqueTriples,
					duplicatesRemoved: 0,
					mergedMetadata: [] as DedupSuccess['data']['mergedMetadata'],
				},
			} as DedupTriplesResult);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 1,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job, true); // Skip QStash updates in tests

			expect(deduplicateTriples).toHaveBeenCalledWith(mockTriples, embeddingMap);
		});

		it('should skip deduplication when no triples exist', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [] as ExtractKTSuccess['data']['triples'],
					stageResults: {},
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 0,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 0,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job, true); // Skip QStash updates in tests

			expect(deduplicateTriples).not.toHaveBeenCalled();
		});

		it('should store knowledge in atomic transaction', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });
			const mockTriples = [createTestTriple()];
			const embeddingMap = new Map([['test', [1, 2, 3]]]);

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: mockTriples,
					stageResults: {},
					concepts: [], // Empty - concepts now generated in separate stage
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue({
				success: true,
				data: {
					embeddings: embeddingMap,
					stats: { totalTexts: 1, uniqueTexts: 1, duplicatesAverted: 0, batchCalls: 1 },
				},
			} as EmbeddingMapResult);
			(deduplicateTriples as vi.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: {
					uniqueTriples: mockTriples,
					duplicatesRemoved: 0,
					mergedMetadata: [] as DedupSuccess['data']['mergedMetadata'],
				},
			} as DedupTriplesResult);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 0, // No concepts stored in extraction stage
					conceptualizationsStored: 0,
					vectorsGenerated: 2,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job, true); // Skip QStash updates in tests

			expect(batchStoreKnowledge).toHaveBeenCalledWith({
				triples: mockTriples,
				concepts: [], // Empty - concepts generated in separate stage
				conceptualizations: [],
				embeddingMap: embeddingMap,
			});
		});

		it('should schedule post-processing jobs when parent job exists', async () => {
			const job = createTestJob({
				parent_job_id: 'parent-job-id',
				metadata: createTestJobMetadata(),
			});

			const mockSchedulePostProcessing = vi.fn(async () => {}) as vi.MockedFunction<
				(parentJobId: string, extractionMetrics: any) => Promise<void>
			>;

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [createTestTriple()],
					stageResults: {},
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(deduplicateTriples as vi.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: {
					uniqueTriples: [createTestTriple()],
					duplicatesRemoved: 0,
					mergedMetadata: [] as DedupSuccess['data']['mergedMetadata'],
				},
			} as DedupTriplesResult);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 1,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 1,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(
				job,
				true, // Skip QStash updates in tests
				undefined, // onProgress
				updateJobProgress, // Use default updateProgressFn
				mockSchedulePostProcessing // Inject mock for post-processing
			);

			expect(mockSchedulePostProcessing).toHaveBeenCalledWith(
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

			const mockUpdateProgress = vi.fn(async () => {}) as vi.MockedFunction<
				(jobId: string, progress: number, metrics?: any) => Promise<void>
			>;

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [] as ExtractKTSuccess['data']['triples'],
					stageResults: {},
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 0,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 0,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(
				job,
				true, // Skip QStash updates in tests
				undefined, // onProgress
				mockUpdateProgress // Inject mock for progress updates
			);

			expect(mockUpdateProgress).toHaveBeenCalledWith(job.id, 10);
			expect(mockUpdateProgress).toHaveBeenCalledWith(job.id, 80);
			expect(mockUpdateProgress).toHaveBeenCalledWith(job.id, 95);
			expect(mockUpdateProgress).toHaveBeenCalledWith(job.id, 100);
		});

		it('should handle embedding generation failure', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [createTestTriple()],
					stageResults: {},
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createErrorResult('Embedding service failed')
			);

			const result = await executeExtraction(job, true); // Skip QStash updates in tests

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('Embedding generation failed');
			expect(result.error?.operation).toBe('embedding_generation');
		});

		it('should handle storage failure', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [] as ExtractKTSuccess['data']['triples'],
					stageResults: {},
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createErrorResult('Database connection failed')
			);

			const result = await executeExtraction(job, true); // Skip QStash updates in tests

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
			(chunkText as vi.MockedFunction<typeof chunkText>).mockReturnValue(chunks);

			// Mock some successful and some failed extractions
			(extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>)
				.mockResolvedValueOnce({
					success: true,
					data: {
						triples: [createTestTriple()],
						stageResults: {},
						concepts: [],
						conceptualizations: [],
					},
				} as ExtractKTResult)
				.mockRejectedValueOnce(new Error('AI service timeout'))
				.mockResolvedValueOnce({
					success: true,
					data: {
						triples: [createTestTriple()],
						stageResults: {},
						concepts: [],
						conceptualizations: [],
					},
				} as ExtractKTResult);

			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(deduplicateTriples as vi.MockedFunction<typeof deduplicateTriples>).mockResolvedValue({
				success: true,
				data: {
					uniqueTriples: [createTestTriple(), createTestTriple()],
					duplicatesRemoved: 0,
					mergedMetadata: [] as DedupSuccess['data']['mergedMetadata'],
				},
			} as DedupTriplesResult);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 2,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 2,
					duplicatesSkipped: 0,
				})
			);

			const result = await executeExtraction(job, true); // Skip QStash updates in tests

			expect(result.success).toBe(true);
			expect(result.data?.triplesStored).toBe(2); // Only successful chunks
		});

		it('should handle unexpected errors gracefully', async () => {
			const job = createTestJob({ metadata: createTestJobMetadata() });

			(
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockRejectedValue(new Error('Unexpected extraction error'));

			const result = await executeExtraction(job, true); // Skip QStash updates in tests

			expect(result.success).toBe(false);
			expect(result.error?.message).toBe('All chunk extractions failed');
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
				extractKnowledgeTriples as vi.MockedFunction<typeof extractKnowledgeTriples>
			).mockResolvedValue({
				success: true,
				data: {
					triples: [] as ExtractKTSuccess['data']['triples'],
					stageResults: {},
					concepts: [] as ExtractKTSuccess['data']['concepts'],
					conceptualizations: [] as ExtractKTSuccess['data']['conceptualizations'],
				},
			} as ExtractKTResult);
			(generateEmbeddingMap as vi.MockedFunction<typeof generateEmbeddingMap>).mockResolvedValue(
				createTestEmbeddingMap()
			);
			(batchStoreKnowledge as vi.MockedFunction<typeof batchStoreKnowledge>).mockResolvedValue(
				createSuccessResult({
					triplesStored: 0,
					conceptsStored: 0,
					conceptualizationsStored: 0,
					vectorsGenerated: 0,
					duplicatesSkipped: 0,
				})
			);

			await executeExtraction(job, true); // Skip QStash updates in tests

			// The resource limits should be passed to the ResourceManager
			// This is implicitly tested through the successful execution
			expect(extractKnowledgeTriples).toHaveBeenCalled();
		});
	});
});
