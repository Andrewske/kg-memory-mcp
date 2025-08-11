/**
 * Unit tests for knowledge extraction functions
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock dependencies before imports
jest.mock('~/shared/services/ai-provider-service.js');
jest.mock('~/shared/utils/retry-mechanism.js');
jest.mock('~/shared/utils/token-tracking.js');
jest.mock('~/features/conceptualization/conceptualize.js');
jest.mock('~/shared/env.js');

import { extractKnowledgeTriples } from '~/features/knowledge-extraction/extract.js';
import { env } from '~/shared/env.js';
import { createAIProvider } from '~/shared/services/ai-provider-service.js';
import { retryAIOperation, withCircuitBreaker } from '~/shared/utils/retry-mechanism.js';
import { trackTokenUsage } from '~/shared/utils/token-tracking.js';
import { errorScenarios, mockAIExtractions, testTexts } from '../fixtures/test-data.js';
import {
	createErrorResult,
	createMockAIProvider,
	createSuccessResult,
	createTestArgs,
	mockEnv,
} from '../helpers/mock-factories.js';
import { setupTestSuite } from '../helpers/test-setup.js';

// Setup test environment
setupTestSuite();

describe('Knowledge Extraction', () => {
	let mockAIProvider: ReturnType<typeof createMockAIProvider>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockAIProvider = createMockAIProvider();

		// Setup mocks
		(createAIProvider as jest.Mock).mockReturnValue(mockAIProvider);
		(env as any) = { ...mockEnv, EXTRACTION_METHOD: 'four-stage' };
		(trackTokenUsage as jest.Mock).mockImplementation(usage => usage);

		// Mock retry mechanism to pass through function calls
		(retryAIOperation as jest.Mock).mockImplementation(async (fn: any) => await fn());
		(withCircuitBreaker as jest.Mock).mockImplementation(async (fn: any) => await fn());
	});

	describe('extractKnowledgeTriples', () => {
		it('should extract triples using four-stage method by default', async () => {
			const args = createTestArgs({ text: testTexts.medium });

			// Mock successful responses for all four stages
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

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			expect(mockAIProvider.generateText).toHaveBeenCalledTimes(4);

			// Verify all triple types are extracted
			const triples = result.data?.triples || [];
			expect(triples.some(t => t.triple_type === 'ENTITY_ENTITY')).toBe(true);
			expect(triples.some(t => t.triple_type === 'ENTITY_EVENT')).toBe(true);
			expect(triples.some(t => t.triple_type === 'EVENT_EVENT')).toBe(true);
			expect(triples.some(t => t.triple_type === 'EMOTIONAL_CONTEXT')).toBe(true);
		});

		it('should extract triples using single-pass method when configured', async () => {
			(env as any).EXTRACTION_METHOD = 'single-pass';
			const args = createTestArgs({ text: testTexts.small });

			mockAIProvider.generateText.mockResolvedValueOnce(
				createSuccessResult({
					data: mockAIExtractions.singlePass.response,
					usage: mockAIExtractions.singlePass.usage,
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			expect(mockAIProvider.generateText).toHaveBeenCalledTimes(1);
			expect(result.data?.triples).toHaveLength(4); // Mixed triple types
		});

		it('should handle malformed JSON responses gracefully', async () => {
			const args = createTestArgs();

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: errorScenarios.malformedJSON.response,
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(false);
			expect(result.error?.type).toBe('PARSE_ERROR');
			expect(result.error?.message).toContain('Failed to parse AI response as JSON');
		});

		it('should clean markdown formatting from responses', async () => {
			const args = createTestArgs();

			const markdownResponse = '```json\n' + mockAIExtractions.singlePass.response + '\n```';
			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: markdownResponse,
					usage: mockAIExtractions.singlePass.usage,
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			expect(result.data?.triples).toBeDefined();
		});

		it('should filter out empty triples before validation', async () => {
			const args = createTestArgs();

			const responseWithEmptyTriples = JSON.stringify({
				triples: [
					{
						subject: 'John Smith',
						predicate: 'works at',
						object: 'Tech Corp',
						confidence: 0.9,
						semantic_content: 'John Smith works at Tech Corp',
						triple_type: 'ENTITY_ENTITY',
						source_context: 'Employment',
					},
					{
						subject: '',
						predicate: 'invalid',
						object: '',
						confidence: 0.5,
						semantic_content: '',
						triple_type: 'ENTITY_ENTITY',
						source_context: 'Invalid',
					},
				],
			});

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: responseWithEmptyTriples,
					usage: mockAIExtractions.singlePass.usage,
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			expect(result.data?.triples).toHaveLength(1);
			expect(result.data?.triples[0].subject).toBe('John Smith');
		});

		it('should use retry mechanism for AI operations', async () => {
			const args = createTestArgs();

			(retryAIOperation as jest.Mock).mockImplementation(
				async (fn: any, operation: any, config: any) => {
					expect(operation).toContain('extraction_');
					expect(config.maxRetries).toBe(2);
					return await fn();
				}
			);

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: mockAIExtractions.singlePass.response,
					usage: mockAIExtractions.singlePass.usage,
				})
			);

			await extractKnowledgeTriples(args);

			expect(retryAIOperation).toHaveBeenCalled();
		});

		it('should use circuit breaker for AI operations', async () => {
			const args = createTestArgs();

			(withCircuitBreaker as jest.Mock).mockImplementation(
				async (fn: any, key: any, config: any) => {
					expect(key).toContain(`text_extraction_${args.source}`);
					expect(config.failureThreshold).toBe(3);
					expect(config.timeout).toBe(45000);
					return await fn();
				}
			);

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: mockAIExtractions.singlePass.response,
					usage: mockAIExtractions.singlePass.usage,
				})
			);

			await extractKnowledgeTriples(args);

			expect(withCircuitBreaker).toHaveBeenCalled();
		});

		it('should track token usage correctly', async () => {
			const args = createTestArgs();

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: mockAIExtractions.singlePass.response,
					usage: mockAIExtractions.singlePass.usage,
				})
			);

			await extractKnowledgeTriples(args);

			expect(trackTokenUsage).toHaveBeenCalledWith(mockAIExtractions.singlePass.usage);
		});

		it('should handle AI provider failures gracefully', async () => {
			const args = createTestArgs();

			mockAIProvider.generateText.mockRejectedValue(new Error('AI service unavailable'));

			// Mock retry mechanism to propagate the error
			(retryAIOperation as jest.Mock).mockImplementation(
				async (...args: any[]) => {
					throw new Error('AI service unavailable');
				}
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('AI service unavailable');
		});

		it('should generate concepts from extracted elements', async () => {
			const args = createTestArgs();

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: mockAIExtractions.singlePass.response,
					usage: mockAIExtractions.singlePass.usage,
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			expect(result.data?.concepts).toBeDefined();
			// Concepts generation is mocked, so we just verify it's called
		});

		it('should handle partial extraction failures in four-stage mode', async () => {
			const args = createTestArgs();

			// Mock successful responses for some stages, failures for others
			mockAIProvider.generateText
				.mockResolvedValueOnce(
					createSuccessResult({
						data: mockAIExtractions.fourStage.entityEntity.response,
						usage: mockAIExtractions.fourStage.entityEntity.usage,
					})
				)
				.mockRejectedValueOnce(new Error('Network timeout'))
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

			// Mock retry to fail for the second call
			(retryAIOperation as jest.Mock)
				.mockImplementationOnce(async (fn: any) => await fn())
				.mockRejectedValueOnce(createErrorResult('Network timeout', 'ai_extraction'))
				.mockImplementationOnce(async (fn: any) => await fn())
				.mockImplementationOnce(async (fn: any) => await fn());

			const result = await extractKnowledgeTriples(args);

			// Should still succeed with partial results
			expect(result.success).toBe(true);
			const triples = result.data?.triples || [];
			expect(triples.some(t => t.triple_type === 'ENTITY_ENTITY')).toBe(true);
			expect(triples.some(t => t.triple_type === 'EVENT_EVENT')).toBe(true);
			expect(triples.some(t => t.triple_type === 'EMOTIONAL_CONTEXT')).toBe(true);
			// Should not have ENTITY_EVENT triples due to failure
			expect(triples.some(t => t.triple_type === 'ENTITY_EVENT')).toBe(false);
		});

		it('should validate confidence scores are within valid range', async () => {
			const args = createTestArgs();

			const invalidConfidenceResponse = JSON.stringify({
				triples: [
					{
						subject: 'John Smith',
						predicate: 'works at',
						object: 'Tech Corp',
						confidence: 1.5, // Invalid: > 1.0
						semantic_content: 'John Smith works at Tech Corp',
						triple_type: 'ENTITY_ENTITY',
						source_context: 'Employment',
					},
					{
						subject: 'Tech Corp',
						predicate: 'located in',
						object: 'San Francisco',
						confidence: 0.8, // Valid
						semantic_content: 'Tech Corp is located in San Francisco',
						triple_type: 'ENTITY_ENTITY',
						source_context: 'Location',
					},
				],
			});

			mockAIProvider.generateText.mockResolvedValue(
				createSuccessResult({
					data: invalidConfidenceResponse,
					usage: mockAIExtractions.singlePass.usage,
				})
			);

			const result = await extractKnowledgeTriples(args);

			expect(result.success).toBe(true);
			// Should filter out invalid confidence scores during validation
			expect(result.data?.triples).toHaveLength(1);
			expect(result.data?.triples[0].confidence).toBe(0.8);
		});
	});
});
