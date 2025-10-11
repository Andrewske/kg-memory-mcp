/**
 * Mock factory functions for testing Knowledge Graph MCP Server
 */

import { vi } from 'vitest';
import { JobStatus, JobType, type ProcessingJob } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { ExtractionMetrics, JobMetadata } from '~/features/knowledge-processing/job-types.js';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import type { Concept, Triple } from '~/shared/types/core.js';
import type { AIProvider, EmbeddingService, Result } from '~/shared/types/services.js';
import { mockAIExtractions, sampleConcepts } from '../fixtures/test-data.js';

// Mock AI Provider Service
export function createMockAIProvider() {
	return {
		generateText: vi.fn().mockResolvedValue({
			success: true,
			data: {
				data: JSON.stringify({
					triples: [
						{
							subject: 'John Smith',
							predicate: 'works at',
							object: 'Tech Corp',
							confidence: new Decimal(0.95),
							semantic_content: 'John Smith works at Tech Corp',
							triple_type: 'ENTITY_ENTITY',
							source_context: 'Employment information',
						},
					],
				}),
				usage: {
					promptTokens: 150,
					completionTokens: 100,
					totalTokens: 250,
				},
			},
		}),
		generateObject: vi.fn().mockResolvedValue({
			success: true,
			data: {},
		}),
	};
}

// Mock Embedding Service
export function createMockEmbeddingService() {
	return {
		embed: vi.fn().mockResolvedValue({
			success: true,
			data: Array(1536)
				.fill(0)
				.map(() => Math.random()),
		}),
		embedBatch: vi.fn().mockImplementation((texts: string[]) =>
			Promise.resolve({
				success: true,
				data: texts.map(() =>
					Array(1536)
						.fill(0)
						.map(() => Math.random())
				),
			})
		),
	};
}

// Mock Database Client
export function createMockDatabase() {
	const mockJob = {
		id: 'test-job-id',
		job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
		text: 'Test text',
		metadata: {},
		status: JobStatus.QUEUED,
		progress: 0,
		createdAt: new Date(),
		startedAt: null,
		completedAt: null,
		parent_job_id: null,
		stage: null,
		child_jobs: [],
		metrics: null,
	};

	const mockDatabase = {
		processingJob: {
			create: vi.fn().mockResolvedValue(mockJob),
			findUnique: vi.fn().mockResolvedValue(mockJob),
			findFirst: vi.fn().mockResolvedValue(mockJob),
			findMany: vi.fn().mockResolvedValue([mockJob]),
			update: vi.fn().mockResolvedValue(mockJob),
			deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
		},
		knowledgeTriple: {
			createMany: vi.fn().mockResolvedValue({ count: 1 }),
			findMany: vi.fn().mockResolvedValue([]),
			deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
		},
		conceptNode: {
			createMany: vi.fn().mockResolvedValue({ count: 1 }),
			findMany: vi.fn().mockResolvedValue([]),
			deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
		},
		conceptualizationRelationship: {
			findMany: vi.fn().mockResolvedValue([]),
			deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
		},
		vectorEmbedding: {
			findMany: vi.fn().mockResolvedValue([]),
			deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
		},
		$transaction: vi.fn().mockImplementation((callback: (tx: unknown) => unknown) =>
			callback({
				processingJob: mockDatabase.processingJob,
				knowledgeTriple: mockDatabase.knowledgeTriple,
				conceptNode: mockDatabase.conceptNode,
				vectorEmbedding: mockDatabase.vectorEmbedding,
			})
		),
		$disconnect: vi.fn().mockResolvedValue(undefined),
	};
	return mockDatabase;
}

// Mock QStash Service
export function createMockQStash() {
	return {
		publishJSON: vi.fn().mockResolvedValue({
			messageId: 'test-message-id',
			url: 'https://example.com/api/process-job',
		}),
	};
}

// Mock Resource Manager
export function createMockResourceManager() {
	return {
		withAI: vi.fn().mockImplementation(async <T>(callback: () => Promise<T>) => await callback()),
		withDatabase: vi
			.fn()
			.mockImplementation(async <T>(callback: () => Promise<T>) => await callback()),
		getStatus: vi.fn().mockReturnValue({
			database: { available: 2, waiting: 0 },
			ai: { available: 2, waiting: 0 },
			memory: { usedMB: 100, maxMB: 2048, percentage: 5 },
			rateLimit: { available: 10 },
		}),
	};
}

// Test data factories
export function createTestTriple(overrides: Partial<Triple> = {}): Triple {
	return {
		subject: 'John Smith',
		predicate: 'works at',
		object: 'Tech Corp',
		type: 'ENTITY_ENTITY',
		source: 'test-source',
		source_type: 'test',
		source_date: new Date('2025-01-01T00:00:00.000Z'),
		extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		confidence: new Decimal(0.95),
		extraction_stage: null,
		...overrides,
	};
}

export function createTestConcept(overrides: Partial<Concept> = {}): Concept {
	return {
		concept: 'Software Engineering',
		abstraction_level: 'MEDIUM',
		confidence: new Decimal(0.95),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
		...overrides,
	};
}

export function createTestArgs(
	overrides: Partial<ProcessKnowledgeArgs> = {}
): ProcessKnowledgeArgs {
	return {
		text: 'John Smith is a software engineer at Tech Corp. He works on AI projects and feels excited about new technologies.',
		source: 'test-source',
		source_type: 'test',
		source_date: '2025-01-01T00:00:00.000Z',
		...overrides,
	};
}

export function createTestJob(overrides: Partial<ProcessingJob> = {}): ProcessingJob {
	return {
		id: 'test-job-id',
		job_type: JobType.EXTRACT_KNOWLEDGE_BATCH,
		text: 'Test processing job text',
		metadata: {
			source: 'test-source',
			source_type: 'test',
			source_date: '2025-01-01T00:00:00.000Z',
		},
		status: JobStatus.QUEUED,
		progress: 0,
		result: null,
		errorMessage: null,
		createdAt: new Date('2025-01-01T00:00:00.000Z'),
		startedAt: null,
		completedAt: null,
		parent_job_id: null,
		stage: null,
		retryCount: 0,
		maxRetries: 3,
		metrics: {},
		...overrides,
	};
}

export function createTestJobMetadata(overrides: Partial<JobMetadata> = {}): JobMetadata {
	return {
		text: 'Test job text content',
		source: 'test-source',
		source_type: 'test',
		source_date: '2025-01-01T00:00:00.000Z',
		parent_job_id: 'parent-job-id',
		resourceLimits: {
			maxConnections: 2,
			maxAICalls: 4,
			maxMemoryMB: 2048,
		},
		...overrides,
	} as JobMetadata;
}

export function createTestMetrics(overrides: Partial<ExtractionMetrics> = {}): ExtractionMetrics {
	return {
		triplesExtracted: 5,
		conceptsFound: 3,
		processingTime: 2500,
		chunksProcessed: 1,
		...overrides,
	};
}

// Result factory
export function createSuccessResult<T>(data: T): Result<T> {
	return {
		success: true,
		data,
	};
}

export function createErrorResult(message: string, type: string = 'TEST_ERROR'): Result<never> {
	return {
		success: false,
		error: {
			message,
			type,
		},
	};
}

// Mock text chunks
export function createTestChunks(count: number = 2) {
	return Array.from({ length: count }, (_, i) => ({
		text: `This is chunk ${i + 1} containing test content with various entities and relationships.`,
		estimatedTokens: 25,
		start: i * 100,
		end: (i + 1) * 100,
	}));
}

// Mock embedding map
export function createTestEmbeddingMap(
	texts: string[] = ['John Smith', 'Tech Corp', 'software engineer']
) {
	const embeddings = new Map<string, number[]>();
	texts.forEach(text => {
		embeddings.set(
			text,
			Array(1536)
				.fill(0)
				.map(() => Math.random())
		);
	});

	return {
		success: true as const,
		data: {
			embeddings,
			stats: {
				totalTexts: texts.length + 2, // Simulate some duplicates
				uniqueTexts: texts.length,
				duplicatesAverted: 2,
				batchCalls: 1,
			},
		},
	};
}

// Environment variable mocks
export const mockEnv = {
	AI_PROVIDER: 'openai',
	AI_MODEL: 'gpt-4o-mini',
	EMBEDDING_MODEL: 'text-embedding-3-small',
	BATCH_SIZE: 32,
	ENABLE_SEMANTIC_DEDUP: false,
	SEMANTIC_THRESHOLD: 0.85,
	HTTP_SERVER_URL: 'http://localhost:3000',
	DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
};

/**
 * Create four-stage extraction mock configuration
 * Returns mock responses that can be inspected before use
 *
 * @returns Object containing mock responses for each extraction stage
 */
export function createFourStageExtractionMocks() {
	return {
		entityEntity: createSuccessResult({
			data: mockAIExtractions.fourStage.entityEntity.response,
			usage: mockAIExtractions.fourStage.entityEntity.usage,
		}),
		entityEvent: createSuccessResult({
			data: mockAIExtractions.fourStage.entityEvent.response,
			usage: mockAIExtractions.fourStage.entityEvent.usage,
		}),
		eventEvent: createSuccessResult({
			data: mockAIExtractions.fourStage.eventEvent.response,
			usage: mockAIExtractions.fourStage.eventEvent.usage,
		}),
		emotionalContext: createSuccessResult({
			data: mockAIExtractions.fourStage.emotionalContext.response,
			usage: mockAIExtractions.fourStage.emotionalContext.usage,
		}),
		conceptGeneration: createSuccessResult({
			data: JSON.stringify({ concepts: sampleConcepts }),
			usage: { promptTokens: 200, completionTokens: 150, totalTokens: 350 },
		}),
	};
}

/**
 * Helper to setup four-stage extraction mock responses
 * Call this when you need to mock a complete extraction pipeline
 *
 * DEPRECATED: Use createFourStageExtractionMocks() for better debuggability
 * This function is kept for backward compatibility with existing tests
 *
 * @param mockAIProvider - The mocked AI provider instance
 * @param iterations - Number of chunks to process (default: 1)
 */
export function setupFourStageExtractionMocks(
	mockAIProvider: ReturnType<typeof createMockAIProvider>,
	iterations: number = 1
): void {
	const mocks = createFourStageExtractionMocks();

	for (let i = 0; i < iterations; i++) {
		// Four stages of extraction
		mockAIProvider.generateText
			.mockResolvedValueOnce(mocks.entityEntity)
			.mockResolvedValueOnce(mocks.entityEvent)
			.mockResolvedValueOnce(mocks.eventEvent)
			.mockResolvedValueOnce(mocks.emotionalContext);
	}

	// Add concept generation response (happens after all chunks)
	mockAIProvider.generateText.mockResolvedValueOnce(mocks.conceptGeneration);
}
