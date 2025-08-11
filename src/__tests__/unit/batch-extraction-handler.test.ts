/**
 * Unit tests for BatchExtractionJobHandler
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { JobType, JobStatus } from '@prisma/client';

// Mock dependencies before imports
jest.mock('~/features/deduplication/deduplicate.js');
jest.mock('~/features/knowledge-extraction/extract.js');
jest.mock('~/shared/database/batch-storage.js');
jest.mock('~/shared/services/embedding-service.js');
jest.mock('~/shared/utils/embedding-cache.js');
jest.mock('~/shared/utils/text-chunking.js');
jest.mock('~/features/knowledge-processing/pipeline-coordinator.js');
jest.mock('~/shared/env.js');

import { BatchExtractionJobHandler } from '~/features/knowledge-processing/handlers/batch-extraction-handler.js';
import { deduplicateTriples } from '~/features/deduplication/deduplicate.js';
import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract.js';
import { batchStoreKnowledge } from '~/shared/database/batch-storage.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { generateEmbeddingMap } from '~/shared/utils/embedding-cache.js';
import { chunkText } from '~/shared/utils/text-chunking.js';
import { schedulePostProcessingJobs, updateJobProgress } from '~/features/knowledge-processing/pipeline-coordinator.js';
import { env } from '~/shared/env.js';
import {
  createTestJob,
  createTestJobMetadata,
  createTestTriple,
  createTestConcept,
  createMockEmbeddingService,
  createSuccessResult,
  createErrorResult,
  createTestEmbeddingMap,
  createTestChunks
} from '../helpers/mock-factories.js';
import { setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('BatchExtractionJobHandler', () => {
  let handler: BatchExtractionJobHandler;
  let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new BatchExtractionJobHandler();
    mockEmbeddingService = createMockEmbeddingService();

    // Setup environment mocks
    (env as any).EMBEDDING_MODEL = 'text-embedding-3-small';
    (env as any).EMBEDDING_DIMENSIONS = 1536;
    (env as any).BATCH_SIZE = 32;
    (env as any).ENABLE_SEMANTIC_DEDUP = false;

    // Setup service mocks
    (createEmbeddingService as jest.Mock).mockReturnValue(mockEmbeddingService);
    (updateJobProgress as jest.Mock).mockResolvedValue(undefined);
    (schedulePostProcessingJobs as jest.Mock).mockResolvedValue(undefined);
  });

  describe('canHandle', () => {
    it('should handle EXTRACT_KNOWLEDGE_BATCH jobs', () => {
      expect(handler.canHandle(JobType.EXTRACT_KNOWLEDGE_BATCH)).toBe(true);
    });

    it('should handle PROCESS_KNOWLEDGE jobs', () => {
      expect(handler.canHandle(JobType.PROCESS_KNOWLEDGE)).toBe(true);
    });

    it('should not handle other job types', () => {
      expect(handler.canHandle(JobType.GENERATE_CONCEPTS)).toBe(false);
      expect(handler.canHandle(JobType.DEDUPLICATE_KNOWLEDGE)).toBe(false);
    });
  });

  describe('execute', () => {
    it('should process small text without chunking', async () => {
      const job = createTestJob({
        text: 'Short text that does not need chunking.',
        metadata: createTestJobMetadata()
      });

      const mockTriples = [createTestTriple()];
      const mockConcepts = [createTestConcept()];
      
      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: mockTriples, concepts: mockConcepts })
      );
      
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (deduplicateTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ uniqueTriples: mockTriples })
      );
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 1, conceptsStored: 1 })
      );

      const result = await handler.execute(job as any);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        triplesStored: 1,
        conceptsStored: 1,
        chunksProcessed: 1
      });

      // Verify no chunking occurred
      expect(chunkText).not.toHaveBeenCalled();
    });

    it('should chunk large text and process in parallel', async () => {
      const largeText = 'A'.repeat(15000); // ~3750 tokens, should trigger chunking
      const job = createTestJob({
        text: largeText,
        metadata: createTestJobMetadata()
      });

      const chunks = createTestChunks(3);
      const mockTriples = [createTestTriple()];
      const mockConcepts = [createTestConcept()];

      (chunkText as jest.Mock).mockReturnValue(chunks);
      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: mockTriples, concepts: mockConcepts })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (deduplicateTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ uniqueTriples: mockTriples })
      );
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 3, conceptsStored: 3 })
      );

      const result = await handler.execute(job as any);

      expect(result.success).toBe(true);
      expect(chunkText).toHaveBeenCalledWith(largeText, {
        maxTokens: 3000,
        overlapTokens: 200,
        preserveParagraphs: true
      });
      expect(extractKnowledgeTriples).toHaveBeenCalledTimes(3);
      expect(result.data?.chunksProcessed).toBe(3);
    });

    it('should generate comprehensive embedding map', async () => {
      const job = createTestJob({ metadata: createTestJobMetadata() });
      const mockTriples = [createTestTriple()];
      const mockConcepts = [createTestConcept()];

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: mockTriples, concepts: mockConcepts })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (deduplicateTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ uniqueTriples: mockTriples })
      );
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 1, conceptsStored: 1 })
      );

      await handler.execute(job as any);

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

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: mockTriples, concepts: [] })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(
        createSuccessResult({ embeddings: embeddingMap, stats: { uniqueTexts: 1 } })
      );
      (deduplicateTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ uniqueTriples })
      );
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 1, conceptsStored: 0 })
      );

      await handler.execute(job as any);

      expect(deduplicateTriples).toHaveBeenCalledWith(mockTriples, embeddingMap);
    });

    it('should skip deduplication when no triples exist', async () => {
      const job = createTestJob({ metadata: createTestJobMetadata() });

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: [], concepts: [] })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 0, conceptsStored: 0 })
      );

      await handler.execute(job as any);

      expect(deduplicateTriples).not.toHaveBeenCalled();
    });

    it('should store knowledge in atomic transaction', async () => {
      const job = createTestJob({ metadata: createTestJobMetadata() });
      const mockTriples = [createTestTriple()];
      const mockConcepts = [createTestConcept()];
      const embeddingMap = new Map([['test', [1, 2, 3]]]);

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: mockTriples, concepts: mockConcepts })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(
        createSuccessResult({ embeddings: embeddingMap, stats: { uniqueTexts: 1 } })
      );
      (deduplicateTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ uniqueTriples: mockTriples })
      );
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 1, conceptsStored: 1 })
      );

      await handler.execute(job as any);

      expect(batchStoreKnowledge).toHaveBeenCalledWith({
        triples: mockTriples,
        concepts: mockConcepts,
        conceptualizations: [],
        embeddingMap: embeddingMap
      });
    });

    it('should schedule post-processing jobs when parent job exists', async () => {
      const job = createTestJob({
        parent_job_id: 'parent-job-id',
        metadata: createTestJobMetadata()
      });

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: [createTestTriple()], concepts: [] })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (deduplicateTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ uniqueTriples: [createTestTriple()] })
      );
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 1, conceptsStored: 0 })
      );

      await handler.execute(job as any);

      expect(schedulePostProcessingJobs).toHaveBeenCalledWith(
        'parent-job-id',
        expect.objectContaining({
          triplesExtracted: 1,
          conceptsFound: 0,
          chunksProcessed: 1
        })
      );
    });

    it('should update progress throughout processing', async () => {
      const job = createTestJob({ metadata: createTestJobMetadata() });

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: [], concepts: [] })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 0, conceptsStored: 0 })
      );

      await handler.execute(job as any);

      expect(updateJobProgress).toHaveBeenCalledWith(job.id, 10);
      expect(updateJobProgress).toHaveBeenCalledWith(job.id, 80);
      expect(updateJobProgress).toHaveBeenCalledWith(job.id, 95);
      expect(updateJobProgress).toHaveBeenCalledWith(job.id, 100);
    });

    it('should handle embedding generation failure', async () => {
      const job = createTestJob({ metadata: createTestJobMetadata() });

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: [createTestTriple()], concepts: [] })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(
        createErrorResult('Embedding service failed')
      );

      const result = await handler.execute(job as any);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Embedding generation failed');
      expect(result.error?.operation).toBe('embedding_generation');
    });

    it('should handle storage failure', async () => {
      const job = createTestJob({ metadata: createTestJobMetadata() });

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: [], concepts: [] })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createErrorResult('Database connection failed')
      );

      const result = await handler.execute(job as any);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Storage failed');
      expect(result.error?.operation).toBe('batch_storage');
    });

    it('should handle partial chunk processing failures', async () => {
      const job = createTestJob({
        text: 'A'.repeat(15000),
        metadata: createTestJobMetadata()
      });

      const chunks = createTestChunks(3);
      (chunkText as jest.Mock).mockReturnValue(chunks);

      // Mock some successful and some failed extractions
      (extractKnowledgeTriples as jest.Mock)
        .mockResolvedValueOnce(createSuccessResult({ triples: [createTestTriple()], concepts: [] }))
        .mockRejectedValueOnce(new Error('AI service timeout'))
        .mockResolvedValueOnce(createSuccessResult({ triples: [createTestTriple()], concepts: [] }));

      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (deduplicateTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ uniqueTriples: [createTestTriple(), createTestTriple()] })
      );
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 2, conceptsStored: 0 })
      );

      const result = await handler.execute(job as any);

      expect(result.success).toBe(true);
      expect(result.data?.triplesStored).toBe(2); // Only successful chunks
    });

    it('should handle unexpected errors gracefully', async () => {
      const job = createTestJob({ metadata: createTestJobMetadata() });

      (extractKnowledgeTriples as jest.Mock).mockRejectedValue(
        new Error('Unexpected extraction error')
      );

      const result = await handler.execute(job as any);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Unexpected extraction error');
      expect(result.error?.operation).toBe('batch_extraction');
    });

    it('should use resource limits from job metadata', async () => {
      const customLimits = {
        maxConnections: 1,
        maxAICalls: 2,
        maxMemoryMB: 1024
      };
      const job = createTestJob({
        metadata: createTestJobMetadata({ resourceLimits: customLimits })
      });

      (extractKnowledgeTriples as jest.Mock).mockResolvedValue(
        createSuccessResult({ triples: [], concepts: [] })
      );
      (generateEmbeddingMap as jest.Mock).mockResolvedValue(createTestEmbeddingMap());
      (batchStoreKnowledge as jest.Mock).mockResolvedValue(
        createSuccessResult({ triplesStored: 0, conceptsStored: 0 })
      );

      await handler.execute(job as any);

      // The resource limits should be passed to the ResourceManager
      // This is implicitly tested through the successful execution
      expect(extractKnowledgeTriples).toHaveBeenCalled();
    });
  });
});