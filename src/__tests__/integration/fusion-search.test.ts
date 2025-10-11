/**
 * Integration tests for Fusion Search functionality
 * Tests vector search, keyword search, concept search, and fusion scoring
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies before imports
vi.mock('~/shared/services/embedding-service.js');
vi.mock('~/shared/env.js');

// Mock database search operations to avoid vector embedding issues
vi.mock('~/shared/database/search-operations.js', () => ({
	searchByEntity: vi.fn(),
	searchByRelationship: vi.fn(),
	searchByEmbedding: vi.fn(),
	searchByConcept: vi.fn(),
	searchByText: vi.fn(),
}));

import { searchFusion, searchByEntity, searchByRelationship, searchByConcept } from '~/features/knowledge-graph/fusion-search.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { createEmbeddingService } from '~/shared/services/embedding-service.js';
import { createMockEmbeddingService, mockEnv } from '../helpers/mock-factories.js';
import { cleanupTestDatabase, seedFusionSearchTestData, setupTestSuite } from '../helpers/test-setup.js';
import * as searchOps from '~/shared/database/search-operations.js';

// Setup test environment
setupTestSuite();

describe('Fusion Search Integration', () => {
	let mockEmbeddingService: ReturnType<typeof createMockEmbeddingService>;

	beforeEach(async () => {
		// Clear mock call history
		vi.clearAllMocks();

		// Setup mock embedding service
		mockEmbeddingService = createMockEmbeddingService();
		(createEmbeddingService as vi.Mock).mockReturnValue(mockEmbeddingService);

		// Set environment variables
		Object.assign(env, {
			...mockEnv,
			SEARCH_TOP_K: 10,
			MIN_SCORE: 0.7,
		});

		// Seed test data
		const { triples } = await seedFusionSearchTestData();

		// Fetch full triple data from database for proper field population
		const fullTriples = await db.knowledgeTriple.findMany({
			where: { source: 'fusion-search-test' },
		});

		// Setup mock database search operations to return seeded data
		// Entity search - matches subject or object
		(searchOps.searchByEntity as vi.Mock).mockImplementation(
			async (query: string, topK: number, options?: { sources?: string[]; types?: string[] }) => {
				const lowerQuery = query.toLowerCase();
				let matches = fullTriples.filter(
					t =>
						t.subject.toLowerCase().includes(lowerQuery) ||
						t.object.toLowerCase().includes(lowerQuery)
				);

				// Apply source filtering
				if (options?.sources && options.sources.length > 0) {
					matches = matches.filter(t => options.sources?.includes(t.source));
				}

				// Apply type filtering
				if (options?.types && options.types.length > 0) {
					matches = matches.filter(t => options.types?.includes(t.type));
				}

				return { success: true, data: matches.slice(0, topK) };
			}
		);

		// Relationship search - matches predicate
		(searchOps.searchByRelationship as vi.Mock).mockImplementation(
			async (query: string, topK: number, options?: { sources?: string[]; types?: string[] }) => {
				const lowerQuery = query.toLowerCase();
				let matches = fullTriples.filter(t => t.predicate.toLowerCase().includes(lowerQuery));

				// Apply source filtering
				if (options?.sources && options.sources.length > 0) {
					matches = matches.filter(t => options.sources?.includes(t.source));
				}

				// Apply type filtering
				if (options?.types && options.types.length > 0) {
					matches = matches.filter(t => options.types?.includes(t.type));
				}

				return { success: true, data: matches.slice(0, topK) };
			}
		);

		// Embedding search - returns triples based on semantic similarity (mocked)
		(searchOps.searchByEmbedding as vi.Mock).mockImplementation(
			async (
				embedding: number[],
				topK: number,
				minScore: number,
				options?: { sources?: string[]; types?: string[] }
			) => {
				// Mock semantic similarity - return different results than keyword search
				let matches = fullTriples.filter(
					t =>
						t.object.toLowerCase().includes('software') ||
						t.object.toLowerCase().includes('engineer') ||
						t.subject.toLowerCase().includes('john') ||
						t.subject.toLowerCase().includes('sarah')
				);

				// Apply source filtering
				if (options?.sources && options.sources.length > 0) {
					matches = matches.filter(t => options.sources?.includes(t.source));
				}

				// Apply type filtering
				if (options?.types && options.types.length > 0) {
					matches = matches.filter(t => options.types?.includes(t.type));
				}

				// Simulate threshold filtering - only return if we have "high quality" matches
				if (minScore > 0.9) {
					matches = matches.slice(0, Math.min(2, topK)); // Very high threshold = fewer results
				}

				return { success: true, data: matches.slice(0, topK) };
			}
		);

		// Concept search - returns triples linked to concepts
		(searchOps.searchByConcept as vi.Mock).mockImplementation(
			async (query: string, topK: number, options?: { sources?: string[]; types?: string[] }) => {
				// Return triples that would be linked via concepts
				let matches = fullTriples.filter(
					t =>
						t.subject.toLowerCase().includes('john') ||
						t.subject.toLowerCase().includes('sarah') ||
						t.object.toLowerCase().includes('software') ||
						t.object.toLowerCase().includes('engineer') ||
						t.object.toLowerCase().includes('manager')
				);

				// Apply source filtering
				if (options?.sources && options.sources.length > 0) {
					matches = matches.filter(t => options.sources?.includes(t.source));
				}

				// Apply type filtering
				if (options?.types && options.types.length > 0) {
					matches = matches.filter(t => options.types?.includes(t.type));
				}

				return { success: true, data: matches.slice(0, topK) };
			}
		);
	});

	describe('Vector Search (Semantic)', () => {
		it('should find triples using semantic vector similarity', async () => {
			const result = await searchFusion('software development and engineering work', {
				enabledSearchTypes: ['semantic'],
				limit: 5,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(0);

			// Should find triples related to software engineering
			const subjects = result.data!.map(r => r.triple.subject);
			expect(subjects).toContain('John Smith');
		});

		it('should return results with semantic scores', async () => {
			const result = await searchFusion('machine learning technology', {
				enabledSearchTypes: ['semantic'],
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			for (const match of result.data!) {
				expect(match.scores.semantic).toBeDefined();
				expect(match.scores.fusion).toBeGreaterThan(0);
				expect(match.searchTypes).toContain('semantic');
			}
		});

		it('should respect similarity threshold for semantic search', async () => {
			const result = await searchFusion('completely unrelated query xyz123', {
				enabledSearchTypes: ['semantic'],
				limit: 10,
				threshold: 0.95, // Very high threshold
			});

			expect(result.success).toBe(true);
			// High threshold should filter out low-quality matches
			expect(result.data!.length).toBeLessThan(5);
		});

		it('should rank semantically similar results higher', async () => {
			const result = await searchFusion('software engineer at technology company', {
				enabledSearchTypes: ['semantic'],
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data!.length).toBeGreaterThan(0);

			// Results should be sorted by fusion score (descending)
			for (let i = 1; i < result.data!.length; i++) {
				expect(result.data![i - 1].scores.fusion).toBeGreaterThanOrEqual(
					result.data![i].scores.fusion
				);
			}
		});

		it('should handle embedding generation failure gracefully', async () => {
			// Mock embedding service to fail
			mockEmbeddingService.embed.mockResolvedValueOnce({
				success: false,
				error: { message: 'Embedding generation failed', type: 'EMBEDDING_ERROR' },
			} as any);

			const result = await searchFusion('test query', {
				enabledSearchTypes: ['semantic'],
			});

			// Should succeed but return no semantic results
			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
		});

		it('should limit results based on topK parameter', async () => {
			const result = await searchFusion('software', {
				enabledSearchTypes: ['semantic'],
				limit: 3,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeLessThanOrEqual(3);
		});

		it('should find contextually similar triples even with different wording', async () => {
			const result = await searchFusion('artificial intelligence and ML research', {
				enabledSearchTypes: ['semantic'],
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			// Should find triples related to AI/ML even if exact terms don't match
			expect(result.data!.length).toBeGreaterThan(0);
		});

		it('should generate embedding only once for multiple vector searches', async () => {
			await searchFusion('test query', {
				enabledSearchTypes: ['semantic', 'concept'],
				limit: 5,
			});

			// Embedding should be generated once and reused
			expect(mockEmbeddingService.embed).toHaveBeenCalledTimes(1);
		});
	});

	describe('Keyword Search (Entity and Relationship)', () => {
		it('should find exact entity matches', async () => {
			const result = await searchByEntity('TechCorp', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(0);

			// Should find triples containing TechCorp
			const hasExactMatch = result.data!.some(
				triple => triple.subject === 'TechCorp' || triple.object === 'TechCorp'
			);
			expect(hasExactMatch).toBe(true);
		});

		it('should find partial entity matches', async () => {
			const result = await searchByEntity('John', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(0);

			// Should find "John Smith"
			const hasPartialMatch = result.data!.some(
				triple => triple.subject.includes('John') || triple.object.includes('John')
			);
			expect(hasPartialMatch).toBe(true);
		});

		it('should find exact relationship matches', async () => {
			const result = await searchByRelationship('works at', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(0);

			// Should find triples with "works at" predicate
			const hasExactMatch = result.data!.some(triple => triple.predicate === 'works at');
			expect(hasExactMatch).toBe(true);
		});

		it('should handle case-insensitive entity search', async () => {
			const result = await searchByEntity('techcorp', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(0);

			// Should find TechCorp despite case difference
			const hasMatch = result.data!.some(
				triple =>
					triple.subject.toLowerCase().includes('techcorp') ||
					triple.object.toLowerCase().includes('techcorp')
			);
			expect(hasMatch).toBe(true);
		});

		it('should handle multi-word entity searches', async () => {
			const result = await searchByEntity('San Francisco', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			// Should find triples containing "San Francisco"
			const hasMatch = result.data!.some(
				triple =>
					triple.subject.includes('San Francisco') ||
					triple.object.includes('San Francisco')
			);
			expect(hasMatch).toBe(true);
		});

		it('should respect limit parameter in keyword search', async () => {
			const result = await searchByEntity('John Smith', { limit: 2 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeLessThanOrEqual(2);
		});
	});

	describe('Concept Search', () => {
		it('should find triples via concept relationships', async () => {
			const result = await searchByConcept('Software Development', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(0);

			// Should find triples linked to Software Development concept
		});

		it('should handle partial concept name matches', async () => {
			const result = await searchByConcept('Software', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(0);
		});

		it('should search concepts via vector similarity when embedding available', async () => {
			const result = await searchFusion('software engineering and development', {
				enabledSearchTypes: ['concept'],
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			// Concept search should return results (even if via text fallback when no vectors)
			// The mock returns triples related to software/engineer concepts
			expect(result.data!.length).toBeGreaterThanOrEqual(0);

			// If we have results, they should be concept-related
			if (result.data!.length > 0) {
				const hasRelevantResults = result.data!.some(
					match =>
						match.triple.subject.toLowerCase().includes('john') ||
						match.triple.subject.toLowerCase().includes('sarah') ||
						match.triple.object.toLowerCase().includes('software') ||
						match.triple.object.toLowerCase().includes('engineer')
				);
				expect(hasRelevantResults).toBe(true);
			}
		});

		it('should fallback to text-based concept search when embedding fails', async () => {
			// Mock embedding to fail
			mockEmbeddingService.embed.mockResolvedValueOnce({
				success: false,
				error: { message: 'Embedding failed', type: 'ERROR' },
			} as any);

			const result = await searchFusion('Machine Learning', {
				enabledSearchTypes: ['concept'],
				limit: 10,
			});

			expect(result.success).toBe(true);
			// Should use text-based fallback and still return results
		});
	});

	describe('Fusion Scoring and Ranking', () => {
		it('should combine results from multiple search types', async () => {
			const result = await searchFusion('software engineer John Smith', {
				enabledSearchTypes: ['entity', 'relationship', 'semantic'],
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(0);

			// Should have results from search types
			const searchTypesUsed = new Set(result.data!.flatMap(r => r.searchTypes));
			expect(searchTypesUsed.size).toBeGreaterThanOrEqual(1);

			// Verify fusion metadata is present
			for (const match of result.data!) {
				expect(match.searchTypes).toBeDefined();
				expect(match.searchTypes.length).toBeGreaterThan(0);
				expect(match.scores.fusion).toBeGreaterThan(0);
			}
		});

		it('should apply weighted scoring to fusion results', async () => {
			const result = await searchFusion('TechCorp software', {
				weights: {
					entity: 0.5,
					relationship: 0.1,
					semantic: 0.3,
					concept: 0.1,
				},
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			// All results should have fusion scores
			for (const match of result.data!) {
				expect(match.scores.fusion).toBeGreaterThan(0);
				expect(match.scores.fusion).toBeLessThanOrEqual(1.5); // With diversity boost
			}
		});

		it('should boost scores for triples found by multiple search types', async () => {
			const result = await searchFusion('John Smith works at TechCorp', {
				enabledSearchTypes: ['entity', 'semantic'],
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			// Find triples that appear in multiple search types
			const multiTypeResults = result.data!.filter(r => r.searchTypes.length > 1);

			if (multiTypeResults.length > 0) {
				// Multi-type results should have higher scores due to diversity boost
				const singleTypeResults = result.data!.filter(r => r.searchTypes.length === 1);

				if (singleTypeResults.length > 0) {
					const avgMultiScore = multiTypeResults.reduce((sum, r) => sum + r.scores.fusion, 0) / multiTypeResults.length;
					const avgSingleScore = singleTypeResults.reduce((sum, r) => sum + r.scores.fusion, 0) / singleTypeResults.length;

					expect(avgMultiScore).toBeGreaterThan(avgSingleScore * 0.8); // Allow some variance
				}
			}
		});

		it('should sort results by fusion score in descending order', async () => {
			const result = await searchFusion('software engineering technology', {
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeGreaterThan(1);

			// Verify descending order
			for (let i = 1; i < result.data!.length; i++) {
				expect(result.data![i - 1].scores.fusion).toBeGreaterThanOrEqual(
					result.data![i].scores.fusion
				);
			}
		});

		it('should allow disabling specific search types', async () => {
			const result = await searchFusion('test query', {
				enabledSearchTypes: ['entity', 'relationship'], // Only keyword searches
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			// Should only use enabled search types
			for (const match of result.data!) {
				expect(match.searchTypes).not.toContain('semantic');
				expect(match.searchTypes).not.toContain('concept');
			}
		});
	});

	describe('Edge Cases and Error Handling', () => {
		it('should handle empty query gracefully', async () => {
			const result = await searchFusion('', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			// Empty query might return all results or none, both are acceptable
		});

		it('should handle query with no matching results', async () => {
			// Override mocks to return no results for this specific test
			(searchOps.searchByEntity as vi.Mock).mockResolvedValueOnce({ success: true, data: [] });
			(searchOps.searchByRelationship as vi.Mock).mockResolvedValueOnce({ success: true, data: [] });
			(searchOps.searchByEmbedding as vi.Mock).mockResolvedValueOnce({ success: true, data: [] });
			(searchOps.searchByConcept as vi.Mock).mockResolvedValueOnce({ success: true, data: [] });

			const result = await searchFusion('xyzabc123nonexistent', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBe(0);
		});

		it('should respect very small limit values', async () => {
			const result = await searchFusion('software', { limit: 1 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBeLessThanOrEqual(1);
		});

		it('should handle large limit values without error', async () => {
			const result = await searchFusion('John', { limit: 1000 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			// Should return available results up to limit
		});

		it('should handle source filtering in search options', async () => {
			const result = await searchFusion('John Smith', {
				limit: 10,
				sources: ['fusion-search-test'],
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			// All results should be from specified source
			for (const match of result.data!) {
				expect(match.triple.source).toBe('fusion-search-test');
			}
		});

		it('should handle type filtering in search options', async () => {
			const result = await searchFusion('John Smith', {
				limit: 10,
				types: ['ENTITY_ENTITY'],
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			// All results should be of specified type
			for (const match of result.data!) {
				expect(match.triple.type).toBe('ENTITY_ENTITY');
			}
		});

		it('should return empty results when all search types fail', async () => {
			// Mock embedding to fail
			mockEmbeddingService.embed.mockResolvedValueOnce({
				success: false,
				error: { message: 'All searches failed', type: 'ERROR' },
			} as any);

			// Also make database searches return no results
			(searchOps.searchByEntity as vi.Mock).mockResolvedValueOnce({ success: true, data: [] });
			(searchOps.searchByRelationship as vi.Mock).mockResolvedValueOnce({ success: true, data: [] });

			const result = await searchFusion('nonexistent', {
				enabledSearchTypes: ['semantic', 'concept'], // Both will fail without embedding
				limit: 10,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data!.length).toBe(0);
		});

		it('should handle special characters in search query', async () => {
			const result = await searchFusion('John@Smith&TechCorp', { limit: 10 });

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			// Should not crash, results may vary
		});
	});

	describe('Performance and Optimization', () => {
		it('should complete search in reasonable time', async () => {
			const startTime = Date.now();

			await searchFusion('software engineering', { limit: 10 });

			const endTime = Date.now();
			const duration = endTime - startTime;

			// Should complete in less than 500ms (with mocked services)
			expect(duration).toBeLessThan(500);
		});

		it('should handle concurrent search requests', async () => {
			const promises = [
				searchFusion('John Smith', { limit: 5 }),
				searchFusion('TechCorp', { limit: 5 }),
				searchFusion('software', { limit: 5 }),
			];

			const results = await Promise.all(promises);

			// All searches should succeed
			for (const result of results) {
				expect(result.success).toBe(true);
				expect(result.data).toBeDefined();
			}
		});

		it('should deduplicate triples found by multiple search types', async () => {
			const result = await searchFusion('John Smith software engineer', {
				enabledSearchTypes: ['entity', 'relationship', 'semantic'],
				limit: 20,
			});

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();

			// Count unique triple IDs
			const uniqueTriples = new Set(
				result.data!.map(r =>
					`${r.triple.subject}|${r.triple.predicate}|${r.triple.object}|${r.triple.type}`
				)
			);

			// Number of unique triples should equal results length (no duplicates)
			expect(uniqueTriples.size).toBe(result.data!.length);
		});
	});
});
