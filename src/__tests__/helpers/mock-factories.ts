/**
 * Mock factory functions for testing Knowledge Graph MCP Server
 */

import type { ProcessingJob, JobType, JobStatus, JobStage } from '@prisma/client';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import type { Result } from '~/shared/types/services.js';
import type { Triple, Concept } from '~/shared/types/core.js';
import type { ExtractionMetrics, JobMetadata } from '~/features/knowledge-processing/job-types.js';

// Mock AI Provider Service
export function createMockAIProvider() {
  return {
    generateText: jest.fn().mockResolvedValue({
      success: true,
      data: {
        data: JSON.stringify({
          triples: [
            {
              subject: 'John Smith',
              predicate: 'works at',
              object: 'Tech Corp',
              confidence: 0.95,
              semantic_content: 'John Smith works at Tech Corp',
              triple_type: 'ENTITY_ENTITY',
              source_context: 'Employment information'
            }
          ]
        }),
        usage: {
          promptTokens: 150,
          completionTokens: 100,
          totalTokens: 250
        }
      }
    }),
    generateObject: jest.fn()
  };
}

// Mock Embedding Service
export function createMockEmbeddingService() {
  return {
    generateEmbeddings: jest.fn().mockImplementation((texts: string[]) => ({
      success: true,
      data: {
        embeddings: texts.map(() => Array(1536).fill(0).map(() => Math.random())),
        usage: {
          promptTokens: texts.length * 8,
          totalTokens: texts.length * 8
        }
      }
    })),
    generateSingleEmbedding: jest.fn().mockResolvedValue({
      success: true,
      data: {
        embedding: Array(1536).fill(0).map(() => Math.random()),
        usage: { promptTokens: 8, totalTokens: 8 }
      }
    }),
    embed: jest.fn(),
    embedBatch: jest.fn()
  };
}

// Mock Database Client
export function createMockDatabase() {
  const mockJob = {
    id: 'test-job-id',
    job_type: 'EXTRACT_KNOWLEDGE_BATCH' as JobType,
    text: 'Test text',
    metadata: {},
    status: 'QUEUED' as JobStatus,
    progress: 0,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    parent_job_id: null,
    stage: null,
    child_jobs: [],
    metrics: null
  };

  return {
    processingJob: {
      create: jest.fn().mockResolvedValue(mockJob),
      findUnique: jest.fn().mockResolvedValue(mockJob),
      findFirst: jest.fn().mockResolvedValue(mockJob),
      findMany: jest.fn().mockResolvedValue([mockJob]),
      update: jest.fn().mockResolvedValue(mockJob),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    knowledgeTriple: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    conceptNode: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    vectorEmbedding: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    $transaction: jest.fn().mockImplementation((callback) => callback({
      processingJob: this.processingJob,
      knowledgeTriple: this.knowledgeTriple,
      conceptNode: this.conceptNode,
      vectorEmbedding: this.vectorEmbedding
    }))
  };
}

// Mock QStash Service
export function createMockQStash() {
  return {
    publishJSON: jest.fn().mockResolvedValue({
      messageId: 'test-message-id',
      url: 'https://example.com/api/process-job'
    })
  };
}

// Mock Resource Manager
export function createMockResourceManager() {
  return {
    withAI: jest.fn().mockImplementation(async (callback) => await callback()),
    withDB: jest.fn().mockImplementation(async (callback) => await callback()),
    getCurrentUsage: jest.fn().mockReturnValue({
      connections: 0,
      aiCalls: 0,
      memoryMB: 100
    })
  };
}

// Test data factories
export function createTestTriple(overrides: Partial<Triple> = {}): Triple {
  return {
    subject: 'John Smith',
    predicate: 'works at',
    object: 'Tech Corp',
    confidence: 0.95,
    semantic_content: 'John Smith works at Tech Corp',
    triple_type: 'ENTITY_ENTITY',
    source_context: 'Employment information',
    ...overrides
  };
}

export function createTestConcept(overrides: Partial<Concept> = {}): Concept {
  return {
    concept: 'Software Engineering',
    abstraction_level: 'MEDIUM',
    confidence: new (require('@prisma/client/runtime/library').Decimal)(0.95),
    source: 'test-source',
    source_type: 'test',
    extracted_at: new Date(),
    ...overrides
  };
}

export function createTestArgs(overrides: Partial<ProcessKnowledgeArgs> = {}): ProcessKnowledgeArgs {
  return {
    text: 'John Smith is a software engineer at Tech Corp. He works on AI projects and feels excited about new technologies.',
    source: 'test-document',
    source_type: 'document',
    source_date: '2025-01-01T00:00:00.000Z',
    ...overrides
  };
}

export function createTestJob(overrides: Partial<ProcessingJob> = {}): Partial<ProcessingJob> {
  return {
    id: 'test-job-id',
    job_type: 'EXTRACT_KNOWLEDGE_BATCH' as JobType,
    text: 'Test processing job text',
    metadata: {
      source: 'test-source',
      source_type: 'test',
      source_date: '2025-01-01T00:00:00.000Z'
    },
    status: 'QUEUED' as JobStatus,
    progress: 0,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    parent_job_id: null,
    stage: null,
    ...overrides
  };
}

export function createTestJobMetadata(overrides: Partial<JobMetadata> = {}): JobMetadata {
  return {
    source: 'test-source',
    source_type: 'test',
    source_date: '2025-01-01T00:00:00.000Z',
    parent_job_id: 'parent-job-id',
    resourceLimits: {
      maxConnections: 2,
      maxAICalls: 4,
      maxMemoryMB: 2048
    },
    ...overrides
  };
}

export function createTestMetrics(overrides: Partial<ExtractionMetrics> = {}): ExtractionMetrics {
  return {
    triplesExtracted: 5,
    conceptsFound: 3,
    processingTime: 2500,
    chunksProcessed: 1,
    ...overrides
  };
}

// Result factory
export function createSuccessResult<T>(data: T): Result<T> {
  return {
    success: true,
    data
  };
}

export function createErrorResult(message: string, operation?: string): Result<never> {
  return {
    success: false,
    error: {
      message,
      operation,
      type: 'TEST_ERROR'
    }
  };
}

// Mock text chunks
export function createTestChunks(count: number = 2) {
  return Array.from({ length: count }, (_, i) => ({
    text: `This is chunk ${i + 1} containing test content with various entities and relationships.`,
    estimatedTokens: 25,
    start: i * 100,
    end: (i + 1) * 100
  }));
}

// Mock embedding map
export function createTestEmbeddingMap(texts: string[] = ['John Smith', 'Tech Corp', 'software engineer']) {
  const embeddings = new Map<string, number[]>();
  texts.forEach(text => {
    embeddings.set(text, Array(1536).fill(0).map(() => Math.random()));
  });
  
  return {
    success: true,
    data: {
      embeddings,
      stats: {
        totalTexts: texts.length + 2, // Simulate some duplicates
        uniqueTexts: texts.length,
        duplicatesAverted: 2,
        batchCalls: 1
      }
    }
  };
}

// Environment variable mocks
export const mockEnv = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'gpt-4o-mini',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EXTRACTION_METHOD: 'four-stage',
  BATCH_SIZE: 32,
  ENABLE_SEMANTIC_DEDUP: false,
  SEMANTIC_THRESHOLD: 0.85,
  HTTP_SERVER_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test'
};