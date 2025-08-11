/**
 * Unit tests for embedding cache optimization functions
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock dependencies before imports
jest.mock('~/shared/env.js');

import { env } from '~/shared/env.js';
import { generateEmbeddingMap } from '~/shared/utils/embedding-cache.js';
import { sampleTriples } from '../fixtures/test-data.js';
import {
	createErrorResult,
	createMockEmbeddingService,
	createSuccessResult,
	createTestConcept,
	createTestTriple,
} from '../helpers/mock-factories.js';
import { setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Embedding Cache Optimization', () => {
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockEmbeddingService = createMockEmbeddingService();
		(env as any).BATCH_SIZE = 32;
	});

	describe('generateEmbeddingMap', () => {
		it('should generate embeddings for unique texts only', async () => {
			const triples = [
				createTestTriple({ subject: 'John Smith', object: 'Tech Corp' }),
				createTestTriple({ subject: 'John Smith', object: 'Software Engineer' }), // Duplicate subject
				createTestTriple({ subject: 'Sarah Johnson', object: 'Tech Corp' }), // Duplicate object
			];
			const concepts = [
				createTestConcept({ concept: 'Software Engineering' }),
				createTestConcept({ concept: 'Technology' }),
			];

			const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			expect(result.success).toBe(true);

			// Should call embedding service with unique texts only
			const expectedUniqueTexts = [
				'John Smith',
				'Tech Corp',
				'works at',
				'Software Engineer',
				'Sarah Johnson',
				'John Smith works at Tech Corp',
				'John Smith works at Software Engineer',
				'Sarah Johnson works at Tech Corp',
				'Software Engineering',
				'Technology',
			];

			expect(mockEmbeddingService.generateEmbeddings).toHaveBeenCalledWith(
				expect.arrayContaining(expectedUniqueTexts)
			);

			// Verify efficiency metrics
			expect(result.data?.stats.duplicatesAverted).toBeGreaterThan(0);
			expect(result.data?.stats.uniqueTexts).toBeLessThan(result.data?.stats.totalTexts);
		});

		it('should collect all text types for embedding', async () => {
			const triples = [createTestTriple()];
			const concepts = [createTestConcept()];

			await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			const calledTexts = mockEmbeddingService.generateEmbeddings.mock.calls[0][0];

			// Should include entity names (subjects/objects)
			expect(calledTexts).toContain('John Smith');
			expect(calledTexts).toContain('Tech Corp');

			// Should include relationship names (predicates)
			expect(calledTexts).toContain('works at');

			// Should include semantic content (full triples)
			expect(calledTexts).toContain('John Smith works at Tech Corp');

			// Should include concept names
			expect(calledTexts).toContain('Software Engineering');
		});

		it('should handle semantic deduplication texts when enabled', async () => {
			const triples = [createTestTriple()];
			const concepts = [createTestConcept()];

			await generateEmbeddingMap(triples, concepts, mockEmbeddingService, true);

			const calledTexts = mockEmbeddingService.generateEmbeddings.mock.calls[0][0];

			// When semantic dedup is enabled, should include additional semantic texts
			expect(calledTexts.length).toBeGreaterThan(0);
		});

		it('should skip semantic deduplication texts when disabled', async () => {
			const triples = [createTestTriple()];
			const concepts = [createTestConcept()];

			await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			// Should still work without semantic dedup texts
			expect(mockEmbeddingService.generateEmbeddings).toHaveBeenCalled();
		});

		it('should process embeddings in batches', async () => {
			// Create many triples to trigger batching
			const triples = Array.from({ length: 50 }, (_, i) =>
				createTestTriple({
					subject: `Entity ${i}`,
					object: `Object ${i}`,
					predicate: `relation ${i}`,
				})
			);
			const concepts = Array.from({ length: 20 }, (_, i) =>
				createTestConcept({ concept: `Concept ${i}` })
			);

			(env as any).BATCH_SIZE = 10; // Small batch size to force multiple batches

			mockEmbeddingService.generateEmbeddings.mockImplementation(async (texts: string[]) =>
				createSuccessResult({
					embeddings: texts.map(() =>
						Array(1536)
							.fill(0)
							.map(() => Math.random())
					),
					usage: { promptTokens: texts.length * 8, totalTokens: texts.length * 8 },
				})
			);

			const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			expect(result.success).toBe(true);
			expect(mockEmbeddingService.generateEmbeddings).toHaveBeenCalledTimes(
				Math.ceil(result.data?.stats.uniqueTexts! / 10)
			);
			expect(result.data?.stats.batchCalls).toBeGreaterThan(1);
		});

		it('should create comprehensive embedding map', async () => {
			const triples = [createTestTriple({ subject: 'John', predicate: 'likes', object: 'coffee' })];
			const concepts = [createTestConcept({ concept: 'Preferences' })];

			mockEmbeddingService.generateEmbeddings.mockResolvedValue(
				createSuccessResult({
					embeddings: [
						[0.1, 0.2, 0.3], // John
						[0.4, 0.5, 0.6], // coffee
						[0.7, 0.8, 0.9], // likes
						[0.2, 0.3, 0.4], // semantic content
						[0.5, 0.6, 0.7], // concept
					],
					usage: { promptTokens: 40, totalTokens: 40 },
				})
			);

			const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			expect(result.success).toBe(true);

			const embeddings = result.data?.embeddings;
			expect(embeddings).toBeInstanceOf(Map);
			expect(embeddings?.has('John')).toBe(true);
			expect(embeddings?.has('coffee')).toBe(true);
			expect(embeddings?.has('likes')).toBe(true);
			expect(embeddings?.has('Preferences')).toBe(true);
		});

		it('should calculate correct efficiency statistics', async () => {
			const triples = [
				createTestTriple({ subject: 'John', object: 'Tech Corp' }),
				createTestTriple({ subject: 'John', object: 'Manager' }), // Duplicate subject
				createTestTriple({ subject: 'Sarah', object: 'Tech Corp' }), // Duplicate object
			];
			const concepts = [createTestConcept()];

			const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			expect(result.success).toBe(true);

			const stats = result.data?.stats;
			expect(stats?.totalTexts).toBeGreaterThan(stats?.uniqueTexts!);
			expect(stats?.duplicatesAverted).toBe(stats?.totalTexts - stats?.uniqueTexts!);
			expect(stats?.batchCalls).toBe(1); // Single batch for small dataset
		});

		it('should handle embedding service failures', async () => {
			const triples = [createTestTriple()];
			const concepts = [createTestConcept()];

			mockEmbeddingService.generateEmbeddings.mockResolvedValue(
				createErrorResult('Embedding service unavailable')
			);

			const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('Failed to generate embeddings');
		});

		it('should handle partial batch failures', async () => {
			const triples = Array.from({ length: 20 }, (_, i) =>
				createTestTriple({ subject: `Entity ${i}` })
			);
			const concepts = [];

			(env as any).BATCH_SIZE = 5;

			// Mock first batch success, second batch failure, third batch success
			mockEmbeddingService.generateEmbeddings
				.mockResolvedValueOnce(
					createSuccessResult({
						embeddings: Array(5).fill([0.1, 0.2, 0.3]),
						usage: { promptTokens: 40, totalTokens: 40 },
					})
				)
				.mockResolvedValueOnce(createErrorResult('Temporary service error'))
				.mockResolvedValueOnce(
					createSuccessResult({
						embeddings: Array(5).fill([0.4, 0.5, 0.6]),
						usage: { promptTokens: 40, totalTokens: 40 },
					})
				);

			const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('batch failed');
		});

		it('should handle empty input gracefully', async () => {
			const result = await generateEmbeddingMap([], [], mockEmbeddingService, false);

			expect(result.success).toBe(true);
			expect(result.data?.embeddings.size).toBe(0);
			expect(result.data?.stats.totalTexts).toBe(0);
			expect(result.data?.stats.uniqueTexts).toBe(0);
			expect(mockEmbeddingService.generateEmbeddings).not.toHaveBeenCalled();
		});

		it('should preserve text-embedding relationships', async () => {
			const triples = [
				createTestTriple({
					subject: 'Unique Subject',
					predicate: 'unique predicate',
					object: 'unique object',
				}),
			];
			const concepts = [createTestConcept({ concept: 'Unique Concept' })];

			mockEmbeddingService.generateEmbeddings.mockResolvedValue(
				createSuccessResult({
					embeddings: [
						[1, 2, 3], // First text
						[4, 5, 6], // Second text
						[7, 8, 9], // Third text
						[10, 11, 12], // Fourth text
					],
					usage: { promptTokens: 32, totalTokens: 32 },
				})
			);

			const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			expect(result.success).toBe(true);

			const embeddings = result.data?.embeddings;
			expect(embeddings?.get('Unique Subject')).toEqual([1, 2, 3]);
			expect(embeddings?.get('unique object')).toBeDefined();
			expect(embeddings?.get('unique predicate')).toBeDefined();
			expect(embeddings?.get('Unique Concept')).toBeDefined();
		});

		it('should optimize for real-world deduplication scenarios', async () => {
			// Simulate realistic data with many duplicates
			const triples = [
				...sampleTriples.entityEntity, // 3 triples with some shared entities
				...sampleTriples.entityEvent, // 2 more triples with overlapping entities
				createTestTriple({ subject: 'John Smith', predicate: 'manages', object: 'AI Team' }),
			];
			const concepts = [
				createTestConcept({ concept: 'Technology' }),
				createTestConcept({ concept: 'Technology' }), // Duplicate concept name
				createTestConcept({ concept: 'Business' }),
			];

			const result = await generateEmbeddingMap(triples, concepts, mockEmbeddingService, false);

			expect(result.success).toBe(true);

			// Should achieve significant deduplication
			const efficiency = result.data?.stats.duplicatesAverted! / result.data?.stats.totalTexts!;
			expect(efficiency).toBeGreaterThan(0.2); // At least 20% efficiency gain
		});
	});
});
